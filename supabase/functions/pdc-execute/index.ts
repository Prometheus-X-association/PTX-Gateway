import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-organization-id',
};

const LOCAL_SUPABASE_URL_FALLBACK = "http://kong:8000";
const LOCAL_SUPABASE_ANON_KEY_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SUPABASE_SERVICE_ROLE_KEY_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const LOCAL_SUPABASE_JWT_FALLBACK = "super-secret-jwt-token-with-at-least-32-characters-long";

interface PdcExecuteRequest {
  org_execution_token?: string;
  payload: {
    contract: string;
    purposeId: string;
    resourceId: string;
    resources: Array<{
      resource: string;
      params?: { query: Array<Record<string, string>> };
    }>;
    purposes: Array<{
      resource: string;
      params?: { query: Array<Record<string, string>> };
    }>;
  };
}

interface ExecutionTokenPayload {
  typ: string;
  org_id: string;
  org_slug?: string;
  cfg_id?: string;
  iat?: number;
  exp: number;
}

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

const textEncoder = new TextEncoder();

/**
 * Validate PDC URL format (must be valid HTTPS URL)
 */
function isValidPdcUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    // Only allow HTTPS for security
    return parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toExternalOidcConfig(value: unknown): ExternalOidcConfig | null {
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
}

const fromBase64Url = (input: string): string => {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
  return atob(padded);
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
  const signatureBytes = new Uint8Array(signature);
  let str = "";
  signatureBytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const verify = async (data: string, signature: string, secret: string): Promise<boolean> => {
  const expected = await sign(data, secret);
  return expected === signature;
};

const isUuid = (value: string | null): value is string =>
  !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const getSupabaseUrl = (): string | null =>
  Deno.env.get("SUPABASE_URL") || LOCAL_SUPABASE_URL_FALLBACK;

const getSupabaseAnonKey = (): string | null =>
  Deno.env.get("SUPABASE_ANON_KEY") || LOCAL_SUPABASE_ANON_KEY_FALLBACK;

const getSupabaseServiceRoleKey = (): string | null =>
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || LOCAL_SUPABASE_SERVICE_ROLE_KEY_FALLBACK;

const getExecutionTokenSecret = (): string | null =>
  Deno.env.get("PDC_EXECUTE_TOKEN_SECRET") ||
  Deno.env.get("SUPABASE_INTERNAL_JWT_SECRET") ||
  LOCAL_SUPABASE_JWT_FALLBACK;

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

const issueOidcAccessToken = async (config: ExternalOidcConfig, clientSecret: string): Promise<string> => {
  if (!config.clientId) {
    throw new Error("External OIDC is enabled but client ID is missing");
  }

  const tokenEndpoint = await resolveOidcTokenEndpoint(config);
  const authMethod = config.clientAuthMethod || "client_secret_basic";
  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");

  if (config.scope) form.set("scope", config.scope);
  if (config.audience) form.set("audience", config.audience);
  if (config.resource) form.set("resource", config.resource);

  for (const [key, value] of Object.entries(parseAdditionalTokenParams(config.additionalTokenParams))) {
    form.set(key, value);
  }

  const headers: HeadersInit = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  if (authMethod === "client_secret_post") {
    form.set("client_id", config.clientId);
    form.set("client_secret", clientSecret);
  } else {
    const basicToken = btoa(`${config.clientId}:${clientSecret}`);
    headers.Authorization = `Basic ${basicToken}`;
  }

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers,
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
    throw new Error(
      `External OIDC token request failed (${response.status}): ${
        isRecord(responseBody) && isNonEmptyString(responseBody.error_description)
          ? responseBody.error_description
          : response.statusText
      }`
    );
  }

  if (!isRecord(responseBody) || !isNonEmptyString(responseBody.access_token)) {
    throw new Error("External OIDC token response does not contain access_token");
  }

  return responseBody.access_token.trim();
};

const refreshAuthorizationCodeAccessToken = async ({
  config,
  clientSecret,
  refreshToken,
}: {
  config: ExternalOidcConfig;
  clientSecret: string;
  refreshToken: string;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  tokenType: string | null;
  scope: string | null;
  expiresAt: string | null;
  subject: string | null;
}> => {
  if (!config.clientId) {
    throw new Error("External OIDC client ID is missing");
  }

  const tokenEndpoint = await resolveOidcTokenEndpoint(config);
  const authMethod = config.clientAuthMethod || "client_secret_basic";
  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", refreshToken);

  if (config.scope) form.set("scope", config.scope);
  if (config.audience) form.set("audience", config.audience);
  if (config.resource) form.set("resource", config.resource);

  for (const [key, value] of Object.entries(parseAdditionalTokenParams(config.additionalTokenParams))) {
    if (!form.has(key)) {
      form.set(key, value);
    }
  }

  const headers: HeadersInit = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  if (authMethod === "client_secret_post") {
    form.set("client_id", config.clientId);
    form.set("client_secret", clientSecret);
  } else {
    const basicToken = btoa(`${config.clientId}:${clientSecret}`);
    headers.Authorization = `Basic ${basicToken}`;
  }

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers,
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
    throw new Error(
      `External OIDC refresh failed (${response.status}): ${
        isRecord(responseBody) && isNonEmptyString(responseBody.error_description)
          ? responseBody.error_description
          : response.statusText
      }`
    );
  }

  if (!isRecord(responseBody) || !isNonEmptyString(responseBody.access_token)) {
    throw new Error("External OIDC refresh response does not contain access_token");
  }

  let subject: string | null = null;
  if (isNonEmptyString(responseBody.id_token)) {
    const parts = responseBody.id_token.split(".");
    if (parts.length >= 2) {
      try {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
        const payload = JSON.parse(atob(padded));
        if (isRecord(payload)) {
          subject =
            (isNonEmptyString(payload.sub) && payload.sub) ||
            (isNonEmptyString(payload.email) && payload.email) ||
            null;
        }
      } catch {
        subject = null;
      }
    }
  }

  return {
    accessToken: responseBody.access_token.trim(),
    refreshToken: isNonEmptyString(responseBody.refresh_token) ? responseBody.refresh_token.trim() : refreshToken,
    idToken: isNonEmptyString(responseBody.id_token) ? responseBody.id_token.trim() : null,
    tokenType: isNonEmptyString(responseBody.token_type) ? responseBody.token_type.trim() : "Bearer",
    scope: isNonEmptyString(responseBody.scope) ? responseBody.scope.trim() : config.scope ?? null,
    expiresAt:
      typeof responseBody.expires_in === "number"
        ? new Date(Date.now() + responseBody.expires_in * 1000).toISOString()
        : null,
    subject,
  };
};

const resolveAuthenticatedOrgContext = async (
  supabaseUrl: string,
  supabaseAnonKey: string,
  authHeader: string,
  requestedOrgId: string | null
): Promise<{ orgId: string } | null> => {
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: authError } = await userClient.auth.getUser();
  if (authError || !userData?.user?.id) return null;

  const userId = userData.user.id;

  if (requestedOrgId && isUuid(requestedOrgId)) {
    const { data: membership, error: membershipError } = await userClient
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId)
      .eq("organization_id", requestedOrgId)
      .eq("status", "active")
      .maybeSingle();

    if (!membershipError && membership?.organization_id) {
      return { orgId: membership.organization_id };
    }
  }

  const { data: membership, error: membershipError } = await userClient
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership?.organization_id) {
    return null;
  }

  return { orgId: membership.organization_id };
};

const resolvePublicOrgContext = async (
  token: string | undefined,
  executeTokenSecret: string
): Promise<{ orgId: string; configId?: string } | null> => {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const dataToVerify = `${headerB64}.${payloadB64}`;
  const validSig = await verify(dataToVerify, signatureB64, executeTokenSecret);
  if (!validSig) return null;

  let payload: ExecutionTokenPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadB64)) as ExecutionTokenPayload;
  } catch {
    return null;
  }

  if (payload.typ !== "pdc_exec" || !isUuid(payload.org_id)) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!payload.exp || nowSeconds >= payload.exp) {
    return null;
  }

  return { orgId: payload.org_id, configId: payload.cfg_id };
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = getSupabaseUrl();
    const supabaseAnonKey = getSupabaseAnonKey();
    const supabaseServiceRoleKey = getSupabaseServiceRoleKey();
    const executeTokenSecret = getExecutionTokenSecret();
    const legacyGlobalToken = Deno.env.get("PDC_BEARER_TOKEN");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !executeTokenSecret) {
      return new Response(
        JSON.stringify({ error: "Server not configured: missing required env vars" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const requestData: PdcExecuteRequest = await req.json();
    const { payload, org_execution_token } = requestData;

    if (!payload) {
      return new Response(
        JSON.stringify({ error: 'Missing payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authHeader = req.headers.get("Authorization");
    const requestedOrgId = req.headers.get("x-organization-id");

    let orgContext: { orgId: string; configId?: string } | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      orgContext = await resolveAuthenticatedOrgContext(
        supabaseUrl,
        supabaseAnonKey,
        authHeader,
        requestedOrgId
      );
    }

    if (!orgContext) {
      orgContext = await resolvePublicOrgContext(org_execution_token, executeTokenSecret);
    }

    if (!orgContext) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: missing or invalid organization execution context" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const [{ data: activeConfig, error: configError }, { data: globalConfig }, { data: secretRow }] = await Promise.all([
      adminClient
        .from("dataspace_configs")
        .select("id, pdc_url")
        .eq("organization_id", orgContext.orgId)
        .eq("is_active", true)
        .maybeSingle(),
      adminClient
        .from("global_configs")
        .select("features")
        .eq("organization_id", orgContext.orgId)
        .maybeSingle(),
      adminClient
        .from("organization_pdc_secrets")
        .select("bearer_token, oidc_client_secret, external_oidc_access_token, external_oidc_refresh_token, external_oidc_expires_at")
        .eq("organization_id", orgContext.orgId)
        .maybeSingle(),
    ]);

    if (configError || !activeConfig) {
      return new Response(
        JSON.stringify({ error: "No active PDC configuration found for organization" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (orgContext.configId && orgContext.configId !== activeConfig.id) {
      return new Response(
        JSON.stringify({ error: "Execution context expired. Please retry from the organization gateway." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!isValidPdcUrl(activeConfig.pdc_url)) {
      console.warn("Invalid PDC URL format:", activeConfig.pdc_url);
      return new Response(
        JSON.stringify({ error: "Invalid PDC URL. Must be a valid HTTPS URL." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const features = isRecord(globalConfig?.features) ? globalConfig.features : {};
    const externalOidc = toExternalOidcConfig(features.externalOidc);
    let outboundAccessToken: string | null = null;

    if (externalOidc?.enabled) {
      if (externalOidc.grantType === "authorization_code") {
        const expiresAt = secretRow?.external_oidc_expires_at ? new Date(secretRow.external_oidc_expires_at).getTime() : null;
        const isExpired = expiresAt !== null && Date.now() >= expiresAt - 60_000;

        if (secretRow?.external_oidc_access_token && !isExpired) {
          outboundAccessToken = secretRow.external_oidc_access_token;
        } else if (secretRow?.external_oidc_refresh_token && secretRow?.oidc_client_secret) {
          const refreshed = await refreshAuthorizationCodeAccessToken({
            config: externalOidc,
            clientSecret: secretRow.oidc_client_secret,
            refreshToken: secretRow.external_oidc_refresh_token,
          });

          outboundAccessToken = refreshed.accessToken;

          await adminClient
            .from("organization_pdc_secrets")
            .update({
              external_oidc_access_token: refreshed.accessToken,
              external_oidc_refresh_token: refreshed.refreshToken,
              external_oidc_id_token: refreshed.idToken,
              external_oidc_token_type: refreshed.tokenType,
              external_oidc_scope: refreshed.scope,
              external_oidc_subject: refreshed.subject,
              external_oidc_expires_at: refreshed.expiresAt,
            })
            .eq("organization_id", orgContext.orgId);
        } else {
          return new Response(
            JSON.stringify({ error: "External OIDC authorization-code session is not connected for this organization." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        if (!secretRow?.oidc_client_secret) {
          return new Response(
            JSON.stringify({ error: "External OIDC is enabled but no client secret is configured for this organization." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        outboundAccessToken = await issueOidcAccessToken(externalOidc, secretRow.oidc_client_secret);
      }
    } else {
      outboundAccessToken = secretRow?.bearer_token || legacyGlobalToken;
      if (!outboundAccessToken) {
        console.error("No PDC bearer token configured for organization:", orgContext.orgId);
        return new Response(
          JSON.stringify({ error: "PDC service not configured for this organization. Contact administrator." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    console.log("PDC Execute - Org:", orgContext.orgId);
    console.log("PDC Execute - URL:", activeConfig.pdc_url);

    // Create headers for the PDC request using server-side token
    const pdcHeaders: HeadersInit = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${outboundAccessToken}`,
    };

    // Make the POST request to PDC with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 1 minute timeout

    try {
      const response = await fetch(activeConfig.pdc_url, {
        method: 'POST',
        headers: pdcHeaders,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      let responseBody: unknown;
      
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = { rawText: responseText };
      }

      console.log('PDC Execute - Response Status:', response.status);
      console.log('PDC Execute - Response Body:', JSON.stringify(responseBody, null, 2));

      return new Response(
        JSON.stringify({
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          content: responseBody,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return new Response(
          JSON.stringify({ 
            error: 'PDC request timed out',
            content: { success: false, error: 'Request timed out' }
          }),
          { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw fetchError;
    }
  } catch (error: unknown) {
    console.error('PDC Execute error:', error);
    const errorMessage = error instanceof Error ? error.message : 'PDC execution failed';
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        content: { success: false, error: errorMessage }
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
