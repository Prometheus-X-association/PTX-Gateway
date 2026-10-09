import { loadStudioChatPolicy, allowsStudioChatItem } from "../_shared/studioChatAccess.ts";
import { runRequest } from "../_shared/workflowHttp.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-organization-id",
};

type KeyValue = { key?: string; value?: string; enabled?: boolean };
type ApiConfig = {
  url?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  queryParams?: KeyValue[];
  headers?: KeyValue[];
  authType?: "none" | "bearer" | "basic" | "api_key";
  bearerToken?: string;
  basicUsername?: string;
  basicPassword?: string;
  apiKeyName?: string;
  apiKeyValue?: string;
  apiKeyLocation?: "header" | "query";
  bodyType?: "none" | "json" | "text" | "form_urlencoded";
  body?: string;
  responseType?: "auto" | "json" | "text";
  outputPath?: string;
};

type RequestBody = {
  mode?: "test" | "execute";
  workflowId?: string;
  nodeId?: string;
  config?: ApiConfig;
  input?: unknown;
  result?: unknown;
  userMessage?: string;
  org_execution_token?: string;
  studio_chat_id?: string;
};

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const textEncoder = new TextEncoder();
const fromBase64Url = (input: string): string => {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4));
};
const sign = async (data: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(data)));
  return btoa(String.fromCharCode(...signature)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const publicOrgId = async (token: string | undefined, secret: string): Promise<string | null> => {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || await sign(`${parts[0]}.${parts[1]}`, secret) !== parts[2]) return null;
  try {
    const payload = JSON.parse(fromBase64Url(parts[1])) as { typ?: string; org_id?: string; exp?: number };
    if (payload.typ !== "pdc_exec" || !payload.org_id || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload.org_id;
  } catch { return null; }
};

const authenticatedUser = async (url: string, anonKey: string, authorization: string | null) => {
  if (!authorization) return null;
  const client = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : { client, user: data.user };
};


serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await request.json() as RequestBody;
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
    const tokenSecret = Deno.env.get("PDC_EXECUTE_TOKEN_SECRET") || Deno.env.get("SUPABASE_INTERNAL_JWT_SECRET") || "super-secret-jwt-token-with-at-least-32-characters-long";
    if (!supabaseUrl || !anonKey || !serviceKey || !tokenSecret) return json({ ok: false, error: "Server is not configured." }, 500);

    const requestedOrgId = request.headers.get("x-organization-id");
    const signedIn = await authenticatedUser(supabaseUrl, anonKey, request.headers.get("Authorization"));
    let orgId: string | null = null;
    if (signedIn && requestedOrgId) {
      const { data } = await signedIn.client.from("organization_members").select("organization_id").eq("organization_id", requestedOrgId).eq("user_id", signedIn.user.id).eq("status", "active").maybeSingle();
      if (data) orgId = requestedOrgId;
    }
    if (!orgId) orgId = await publicOrgId(body.org_execution_token, tokenSecret);
    if (!orgId) return json({ ok: false, error: "Unauthorized workflow API request." }, 401);

    let config: ApiConfig | undefined;
    let allowedOutboundHosts: string[] | undefined;
    if (body.mode === "test") {
      if (!signedIn || !requestedOrgId || requestedOrgId !== orgId) return json({ ok: false, error: "An authenticated organization admin is required to test API nodes." }, 403);
      const { data: role } = await signedIn.client.from("user_roles").select("role").eq("organization_id", orgId).eq("user_id", signedIn.user.id).in("role", ["admin", "super_admin"]).maybeSingle();
      if (!role) return json({ ok: false, error: "Admin role required." }, 403);
      config = body.config;
    } else {
      const admin = createClient(supabaseUrl, serviceKey);
      const { data: row, error } = await admin.from("global_configs").select("features").eq("organization_id", orgId).maybeSingle();
      if (error || !row) return json({ ok: false, error: "Organization workflow configuration was not found." }, 404);
      const llm = object(object(row.features).llmInsights);
      const workflow = (Array.isArray(llm.workflows) ? llm.workflows : []).map(object).find((item) => item.id === body.workflowId && item.enabled !== false && !item.deletedAt);
      if (body.studio_chat_id) {
        const policy = await loadStudioChatPolicy(admin, orgId, body.studio_chat_id);
        if (!workflow || !allowsStudioChatItem(policy, "workflow", workflow)) return json({ ok: false, error: "Workflow is not assigned to this chat drawer." }, 403);
      }
      const execution = object(workflow?.execution);
      allowedOutboundHosts = Array.isArray(execution.allowedOutboundHosts) ? execution.allowedOutboundHosts.map(String) : undefined;
      const graph = object(workflow?.graph);
      const node = (Array.isArray(graph.nodes) ? graph.nodes : []).map(object).find((item) => item.id === body.nodeId && item.type === "api");
      config = node ? object(node.data) as ApiConfig : undefined;
    }
    if (!config?.url?.trim()) return json({ ok: false, error: "API node configuration was not found or has no URL." }, 400);
    return json(await runRequest(config, body.input, body.result, body.userMessage ?? "", undefined, undefined, allowedOutboundHosts));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, 200);
  }
});
