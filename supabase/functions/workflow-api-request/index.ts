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
};

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const readPath = (value: unknown, path: string): unknown => {
  const normalized = path.trim().replace(/^\$\.?/, "");
  if (!normalized) return value;
  let current = value;
  for (const part of normalized.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const printable = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
};

const interpolate = (template: string, context: { input: unknown; result: unknown; userMessage: string }): string =>
  template.replace(/\{\{\s*(prevOutput|input|result|userMessage)(?:\.([^}]+))?\s*\}\}/g, (_match, root: string, path?: string) => {
    const source = root === "result" ? context.result : root === "userMessage" ? context.userMessage : context.input;
    return printable(path ? readPath(source, path.trim()) : source);
  });

const blockedHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") return true;
  if (host === "::1" || host === "0.0.0.0" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [a, b] = match.slice(1).map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

const assertPublicUrl = async (url: URL): Promise<void> => {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || blockedHostname(url.hostname)) {
    throw new Error("Only public HTTP(S) API URLs without embedded credentials are allowed.");
  }
  const lookups = await Promise.allSettled([
    Deno.resolveDns(url.hostname, "A"),
    Deno.resolveDns(url.hostname, "AAAA"),
  ]);
  const addresses = lookups.flatMap((lookup) => lookup.status === "fulfilled" ? lookup.value : []);
  if (addresses.some(blockedHostname)) throw new Error("API URLs resolving to a private or local network are not allowed.");
};

const forbiddenHeader = (name: string): boolean =>
  ["host", "content-length", "connection", "transfer-encoding", "upgrade", "proxy-authorization", "proxy-authenticate"].includes(name.toLowerCase());

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

const runRequest = async (config: ApiConfig, input: unknown, result: unknown, userMessage: string) => {
  const context = { input, result, userMessage };
  const rawUrl = interpolate(config.url?.trim() || "", context);
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("API URL is invalid after resolving dynamic values."); }
  await assertPublicUrl(url);

  for (const row of config.queryParams ?? []) {
    if (row.enabled === false || !row.key?.trim()) continue;
    url.searchParams.append(interpolate(row.key, context), interpolate(row.value ?? "", context));
  }

  const headers = new Headers({ Accept: "application/json, text/plain, */*" });
  for (const row of config.headers ?? []) {
    if (row.enabled === false || !row.key?.trim()) continue;
    const name = interpolate(row.key, context).trim();
    if (!name || forbiddenHeader(name)) continue;
    headers.set(name, interpolate(row.value ?? "", context));
  }

  if (config.authType === "bearer" && config.bearerToken) headers.set("Authorization", `Bearer ${config.bearerToken}`);
  if (config.authType === "basic") headers.set("Authorization", `Basic ${btoa(`${config.basicUsername ?? ""}:${config.basicPassword ?? ""}`)}`);
  if (config.authType === "api_key" && config.apiKeyName && config.apiKeyValue) {
    if (config.apiKeyLocation === "query") url.searchParams.set(config.apiKeyName, config.apiKeyValue);
    else headers.set(config.apiKeyName, config.apiKeyValue);
  }

  const method = config.method ?? "GET";
  let requestBody: string | undefined;
  if (method !== "GET" && config.bodyType && config.bodyType !== "none") {
    requestBody = interpolate(config.body ?? "", context);
    if (config.bodyType === "json") {
      try { requestBody = JSON.stringify(JSON.parse(requestBody)); } catch (error) { throw new Error(`Request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    } else if (config.bodyType === "form_urlencoded" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
    } else if (!headers.has("Content-Type")) headers.set("Content-Type", "text/plain; charset=utf-8");
  }

  const started = performance.now();
  const response = await fetch(url, { method, headers, body: requestBody, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  const raw = await response.text();
  if (raw.length > 2_000_000) throw new Error("API response exceeds the 2 MB workflow limit.");
  let data: unknown = raw;
  const responseType = config.responseType ?? "auto";
  if (responseType === "json" || (responseType === "auto" && (response.headers.get("content-type") ?? "").includes("json"))) {
    try { data = raw ? JSON.parse(raw) : null; } catch { if (responseType === "json") throw new Error("API response is not valid JSON."); }
  }
  const safeHeaders: Record<string, string> = {};
  for (const name of ["content-type", "content-length", "etag", "last-modified", "x-request-id"]) {
    const value = response.headers.get(name); if (value) safeHeaders[name] = value;
  }
  const output = readPath(data, config.outputPath ?? "");
  if (config.outputPath?.trim() && output === undefined) throw new Error(`Output data path "${config.outputPath}" was not found in the API response.`);
  return { ok: response.ok, status: response.status, statusText: response.statusText, durationMs: Math.round(performance.now() - started), headers: safeHeaders, data, output, error: response.ok ? undefined : `API returned HTTP ${response.status} ${response.statusText}` };
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
      const workflow = (Array.isArray(llm.workflows) ? llm.workflows : []).map(object).find((item) => item.id === body.workflowId && item.enabled !== false);
      const graph = object(workflow?.graph);
      const node = (Array.isArray(graph.nodes) ? graph.nodes : []).map(object).find((item) => item.id === body.nodeId && item.type === "api");
      config = node ? object(node.data) as ApiConfig : undefined;
    }
    if (!config?.url?.trim()) return json({ ok: false, error: "API node configuration was not found or has no URL." }, 400);
    return json(await runRequest(config, body.input, body.result, body.userMessage ?? ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, 200);
  }
});
