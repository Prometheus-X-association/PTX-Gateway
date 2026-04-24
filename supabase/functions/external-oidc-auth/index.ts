import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-organization-id",
};

const LOCAL_SUPABASE_URL_FALLBACK = "http://kong:8000";
const LOCAL_SUPABASE_ANON_KEY_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SUPABASE_SERVICE_ROLE_KEY_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

interface ExternalOidcConfig {
  enabled?: boolean;
  grantType?: "client_credentials" | "authorization_code";
  authorizationEndpoint?: string;
  loginEndpoint?: string;
  tokenEndpoint?: string;
  discoveryUrl?: string;
  issuerUrl?: string;
  clientId?: string;
  provider?: string;
  scope?: string;
  audience?: string;
  resource?: string;
  responseType?: string;
  responseMode?: string;
  clientAuthMethod?: "client_secret_basic" | "client_secret_post";
  additionalTokenParams?: string;
}

type ExchangeCodeBody = {
  action: "exchange_code";
  organizationId: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
};

type GetStatusBody = {
  action: "status";
  organizationId: string;
};

type DisconnectBody = {
  action: "disconnect";
  organizationId: string;
};

type RequestBody = ExchangeCodeBody | GetStatusBody | DisconnectBody;

const getSupabaseUrl = (): string | null =>
  Deno.env.get("SUPABASE_URL") || LOCAL_SUPABASE_URL_FALLBACK;

const getSupabaseAnonKey = (): string | null =>
  Deno.env.get("SUPABASE_ANON_KEY") || LOCAL_SUPABASE_ANON_KEY_FALLBACK;

const getSupabaseServiceRoleKey = (): string | null =>
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || LOCAL_SUPABASE_SERVICE_ROLE_KEY_FALLBACK;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const toExternalOidcConfig = (value: unknown): ExternalOidcConfig | null => {
  if (!isRecord(value)) return null;
  return {
    enabled: value.enabled === true,
    grantType: value.grantType === "authorization_code" ? "authorization_code" : "client_credentials",
    authorizationEndpoint: isNonEmptyString(value.authorizationEndpoint) ? value.authorizationEndpoint.trim() : undefined,
    loginEndpoint: isNonEmptyString(value.loginEndpoint) ? value.loginEndpoint.trim() : undefined,
    tokenEndpoint: isNonEmptyString(value.tokenEndpoint) ? value.tokenEndpoint.trim() : undefined,
    discoveryUrl: isNonEmptyString(value.discoveryUrl) ? value.discoveryUrl.trim() : undefined,
    issuerUrl: isNonEmptyString(value.issuerUrl) ? value.issuerUrl.trim() : undefined,
    clientId: isNonEmptyString(value.clientId) ? value.clientId.trim() : undefined,
    provider: isNonEmptyString(value.provider) ? value.provider.trim() : undefined,
    scope: isNonEmptyString(value.scope) ? value.scope.trim() : undefined,
    audience: isNonEmptyString(value.audience) ? value.audience.trim() : undefined,
    resource: isNonEmptyString(value.resource) ? value.resource.trim() : undefined,
    responseType: isNonEmptyString(value.responseType) ? value.responseType.trim() : undefined,
    responseMode: isNonEmptyString(value.responseMode) ? value.responseMode.trim() : undefined,
    clientAuthMethod:
      value.clientAuthMethod === "client_secret_post" ? "client_secret_post" : "client_secret_basic",
    additionalTokenParams: isNonEmptyString(value.additionalTokenParams)
      ? value.additionalTokenParams.trim()
      : undefined,
  };
};

const normalizeIssuerToDiscoveryUrl = (issuerUrl: string): string => {
  const normalized = issuerUrl.endsWith("/") ? issuerUrl.slice(0, -1) : issuerUrl;
  return `${normalized}/.well-known/openid-configuration`;
};

const resolveOidcTokenEndpoint = async (config: ExternalOidcConfig): Promise<string> => {
  if (config.tokenEndpoint) {
    return config.tokenEndpoint;
  }

  const discoveryUrl = config.discoveryUrl || (config.issuerUrl ? normalizeIssuerToDiscoveryUrl(config.issuerUrl) : "");
  if (!discoveryUrl) {
    throw new Error("External OIDC is enabled but no token endpoint, discovery URL, or issuer URL is configured");
  }

  const response = await fetch(discoveryUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to load OIDC discovery document (${response.status})`);
  }

  const discovery = await response.json();
  if (!isRecord(discovery) || !isNonEmptyString(discovery.token_endpoint)) {
    throw new Error("OIDC discovery document does not contain a token_endpoint");
  }

  return discovery.token_endpoint.trim();
};

const parseAdditionalTokenParams = (raw: string | undefined): Record<string, string> => {
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("External OIDC additional token params must be valid JSON");
  }

  if (!isRecord(parsed)) {
    throw new Error("External OIDC additional token params must be a JSON object");
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || value === undefined) continue;
    result[key] = String(value);
  }
  return result;
};

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
};

const buildTokenRequestHeaders = (
  config: ExternalOidcConfig,
  clientSecret: string,
): HeadersInit => {
  const headers: HeadersInit = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  if ((config.clientAuthMethod || "client_secret_basic") === "client_secret_basic") {
    const basicToken = btoa(`${config.clientId}:${clientSecret}`);
    headers.Authorization = `Basic ${basicToken}`;
  }

  return headers;
};

const requireOrgAdmin = async (
  supabaseUrl: string,
  supabaseAnonKey: string,
  authHeader: string,
  organizationId: string,
): Promise<{ userId: string } | null> => {
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: authError } = await userClient.auth.getUser();
  if (authError || !userData?.user?.id) return null;

  const userId = userData.user.id;
  const { data: roleRow, error: roleError } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .in("role", ["admin", "super_admin"])
    .maybeSingle();

  if (roleError || !roleRow?.role) {
    return null;
  }

  return { userId };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = getSupabaseUrl();
    const supabaseAnonKey = getSupabaseAnonKey();
    const serviceRoleKey = getSupabaseServiceRoleKey();
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Server not configured: missing required env vars" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = (await req.json()) as RequestBody;
    if (!body?.organizationId || typeof body.organizationId !== "string") {
      return new Response(
        JSON.stringify({ error: "organizationId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authResult = await requireOrgAdmin(supabaseUrl, supabaseAnonKey, authHeader, body.organizationId);
    if (!authResult) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    if (body.action === "status") {
      const { data, error } = await adminClient
        .from("organization_pdc_secrets")
        .select("external_oidc_access_token, external_oidc_refresh_token, external_oidc_expires_at, external_oidc_subject, external_oidc_scope")
        .eq("organization_id", body.organizationId)
        .maybeSingle();

      if (error) {
        return new Response(
          JSON.stringify({ error: "Failed to fetch external OIDC connection status" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          data: {
            connected: !!data?.external_oidc_access_token || !!data?.external_oidc_refresh_token,
            expiresAt: data?.external_oidc_expires_at ?? null,
            subject: data?.external_oidc_subject ?? null,
            scope: data?.external_oidc_scope ?? null,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (body.action === "disconnect") {
      const { error } = await adminClient
        .from("organization_pdc_secrets")
        .update({
          external_oidc_access_token: null,
          external_oidc_refresh_token: null,
          external_oidc_id_token: null,
          external_oidc_token_type: null,
          external_oidc_scope: null,
          external_oidc_subject: null,
          external_oidc_expires_at: null,
          updated_by: authResult.userId,
        })
        .eq("organization_id", body.organizationId);

      if (error) {
        return new Response(
          JSON.stringify({ error: "Failed to disconnect external OIDC session" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ data: { connected: false } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (body.action !== "exchange_code") {
      return new Response(
        JSON.stringify({ error: "Unsupported action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: globalConfig, error: globalError } = await adminClient
      .from("global_configs")
      .select("features")
      .eq("organization_id", body.organizationId)
      .maybeSingle();

    if (globalError) {
      return new Response(
        JSON.stringify({ error: "Failed to load global config" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const features = isRecord(globalConfig?.features) ? globalConfig.features : {};
    const config = toExternalOidcConfig(features.externalOidc);
    if (!config?.enabled || config.grantType !== "authorization_code") {
      return new Response(
        JSON.stringify({ error: "External OIDC authorization-code flow is not enabled for this organization" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!config.clientId) {
      return new Response(
        JSON.stringify({ error: "External OIDC client ID is missing" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: secretRow, error: secretError } = await adminClient
      .from("organization_pdc_secrets")
      .select("bearer_token, oidc_client_secret")
      .eq("organization_id", body.organizationId)
      .maybeSingle();

    if (secretError) {
      return new Response(
        JSON.stringify({ error: "Failed to load external OIDC client secret" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!secretRow?.oidc_client_secret) {
      return new Response(
        JSON.stringify({ error: "External OIDC client secret is not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tokenEndpoint = await resolveOidcTokenEndpoint(config);
    const form = new URLSearchParams();
    form.set("grant_type", "authorization_code");
    form.set("code", body.code);
    form.set("redirect_uri", body.redirectUri);
    if ((config.clientAuthMethod || "client_secret_basic") === "client_secret_post") {
      form.set("client_id", config.clientId);
      form.set("client_secret", secretRow.oidc_client_secret);
    }
    if (body.codeVerifier) {
      form.set("code_verifier", body.codeVerifier);
    }

    for (const [key, value] of Object.entries(parseAdditionalTokenParams(config.additionalTokenParams))) {
      if (!form.has(key)) {
        form.set(key, value);
      }
    }

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: buildTokenRequestHeaders(config, secretRow.oidc_client_secret),
      body: form.toString(),
    });

    const responseText = await response.text();
    let responseBody: unknown = null;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = responseText;
    }

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: `Token exchange failed (${response.status})`,
          details: isRecord(responseBody) ? responseBody : { raw: responseText },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!isRecord(responseBody) || !isNonEmptyString(responseBody.access_token)) {
      return new Response(
        JSON.stringify({ error: "Token response does not contain access_token" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const expiresAt =
      typeof responseBody.expires_in === "number"
        ? new Date(Date.now() + responseBody.expires_in * 1000).toISOString()
        : null;
    const idTokenPayload =
      isNonEmptyString(responseBody.id_token) ? decodeJwtPayload(responseBody.id_token) : null;
    const subject =
      (idTokenPayload && isNonEmptyString(idTokenPayload.sub) && idTokenPayload.sub) ||
      (idTokenPayload && isNonEmptyString(idTokenPayload.email) && idTokenPayload.email) ||
      null;

    const payload = {
      organization_id: body.organizationId,
      bearer_token: secretRow?.bearer_token ?? null,
      oidc_client_secret: secretRow.oidc_client_secret,
      external_oidc_access_token: responseBody.access_token.trim(),
      external_oidc_refresh_token: isNonEmptyString(responseBody.refresh_token) ? responseBody.refresh_token.trim() : null,
      external_oidc_id_token: isNonEmptyString(responseBody.id_token) ? responseBody.id_token.trim() : null,
      external_oidc_token_type: isNonEmptyString(responseBody.token_type) ? responseBody.token_type.trim() : "Bearer",
      external_oidc_scope: isNonEmptyString(responseBody.scope) ? responseBody.scope.trim() : config.scope ?? null,
      external_oidc_subject: subject,
      external_oidc_expires_at: expiresAt,
      updated_by: authResult.userId,
    };

    const { error: upsertError } = await adminClient
      .from("organization_pdc_secrets")
      .upsert(payload, { onConflict: "organization_id" });

    if (upsertError) {
      return new Response(
        JSON.stringify({ error: "Failed to store OIDC tokens" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        data: {
          connected: true,
          expiresAt,
          subject,
          scope: payload.external_oidc_scope,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("external-oidc-auth error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
