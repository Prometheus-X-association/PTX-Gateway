import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOCAL_SUPABASE_URL_FALLBACK = "http://kong:8000";
const LOCAL_SUPABASE_ANON_KEY_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SUPABASE_JWT_FALLBACK = "super-secret-jwt-token-with-at-least-32-characters-long";

type IssuePublicBody = {
  action: "issue_public";
  org_slug: string;
  ttl_seconds?: number;
};

type Body = IssuePublicBody;

const textEncoder = new TextEncoder();

const toBase64Url = (input: Uint8Array | string): string => {
  const bytes = typeof input === "string" ? textEncoder.encode(input) : input;
  let str = "";
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const sign = async (data: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(data));
  return toBase64Url(new Uint8Array(signature));
};

const issueSignedToken = async (payload: Record<string, unknown>, secret: string): Promise<string> => {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = toBase64Url(JSON.stringify(header));
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const dataToSign = `${headerB64}.${payloadB64}`;
  const signature = await sign(dataToSign, secret);
  return `${dataToSign}.${signature}`;
};

const isValidSlug = (value: string): boolean => /^[a-z0-9-]{2,100}$/i.test(value);

const getSupabaseUrl = (): string | null =>
  Deno.env.get("SUPABASE_URL") || LOCAL_SUPABASE_URL_FALLBACK;

const getSupabaseAnonKey = (): string | null =>
  Deno.env.get("SUPABASE_ANON_KEY") || LOCAL_SUPABASE_ANON_KEY_FALLBACK;

const getExecutionTokenSecret = (): string | null =>
  Deno.env.get("PDC_EXECUTE_TOKEN_SECRET") ||
  Deno.env.get("SUPABASE_INTERNAL_JWT_SECRET") ||
  LOCAL_SUPABASE_JWT_FALLBACK;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = getSupabaseUrl();
    const supabaseAnonKey = getSupabaseAnonKey();
    const executeTokenSecret = getExecutionTokenSecret();

    if (!supabaseUrl || !supabaseAnonKey || !executeTokenSecret) {
      return new Response(
        JSON.stringify({ error: "Server not configured: missing required env vars" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = (await req.json()) as Body;
    if (body.action !== "issue_public") {
      return new Response(
        JSON.stringify({ error: "Unsupported action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const orgSlug = body.org_slug?.toLowerCase().trim();
    if (!orgSlug || !isValidSlug(orgSlug)) {
      return new Response(
        JSON.stringify({ error: "Invalid org_slug" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ttlSeconds = Math.max(60, Math.min(body.ttl_seconds ?? 3600, 24 * 60 * 60));

    const client = createClient(supabaseUrl, supabaseAnonKey);

    const { data: org, error: orgError } = await client
      .from("organizations")
      .select("id, slug, is_active")
      .eq("slug", orgSlug)
      .eq("is_active", true)
      .maybeSingle();

    if (orgError || !org) {
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: activeConfig } = await client
      .from("dataspace_configs")
      .select("id")
      .eq("organization_id", org.id)
      .eq("is_active", true)
      .maybeSingle();

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expSeconds = nowSeconds + ttlSeconds;

    const token = await issueSignedToken(
      {
        typ: "pdc_exec",
        org_id: org.id,
        org_slug: org.slug,
        cfg_id: activeConfig?.id,
        iat: nowSeconds,
        exp: expSeconds,
      },
      executeTokenSecret
    );

    return new Response(
      JSON.stringify({
        ok: true,
        token,
        organization_id: org.id,
        expires_at: new Date(expSeconds * 1000).toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("pdc-auth error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
