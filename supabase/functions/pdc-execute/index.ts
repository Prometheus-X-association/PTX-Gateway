import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-organization-id',
};

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const executeTokenSecret = Deno.env.get("PDC_EXECUTE_TOKEN_SECRET");
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

    const { data: activeConfig, error: configError } = await adminClient
      .from("dataspace_configs")
      .select("id, pdc_url")
      .eq("organization_id", orgContext.orgId)
      .eq("is_active", true)
      .maybeSingle();

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

    const { data: secretRow } = await adminClient
      .from("organization_pdc_secrets")
      .select("bearer_token")
      .eq("organization_id", orgContext.orgId)
      .maybeSingle();

    const bearerToken = secretRow?.bearer_token || legacyGlobalToken;
    if (!bearerToken) {
      console.error("No PDC bearer token configured for organization:", orgContext.orgId);
      return new Response(
        JSON.stringify({ error: "PDC service not configured for this organization. Contact administrator." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("PDC Execute - Org:", orgContext.orgId);
    console.log("PDC Execute - URL:", activeConfig.pdc_url);

    // Create headers for the PDC request using server-side token
    const pdcHeaders: HeadersInit = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearerToken}`,
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
