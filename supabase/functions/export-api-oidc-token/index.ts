import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TokenRequestBody {
  discoveryUrl?: string;
  clientId?: string;
  clientSecret?: string;
  grantType?: "client_credentials" | "authorization_code" | "custom";
  customGrantType?: string;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isValidDiscoveryUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && url.includes("/.well-known");
  } catch {
    return false;
  }
};

const resolveGrantType = (body: TokenRequestBody): string => {
  if (body.grantType === "custom") {
    if (!isNonEmptyString(body.customGrantType)) {
      throw new Error("Custom grant type value is required when grantType is 'custom'");
    }
    return body.customGrantType.trim();
  }
  return body.grantType || "client_credentials";
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as TokenRequestBody;

    if (!isNonEmptyString(body.discoveryUrl)) {
      return new Response(
        JSON.stringify({ error: "discoveryUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!isValidDiscoveryUrl(body.discoveryUrl)) {
      return new Response(
        JSON.stringify({ error: "discoveryUrl must be a valid HTTP/HTTPS URL containing '/.well-known' (e.g. /.well-known/openid-configuration)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!isNonEmptyString(body.clientId) || !isNonEmptyString(body.clientSecret)) {
      return new Response(
        JSON.stringify({ error: "clientId and clientSecret are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let grantType: string;
    try {
      grantType = resolveGrantType(body);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : "Invalid grant type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Step 1: fetch the discovery document and resolve token_endpoint.
    const discoveryResponse = await fetch(body.discoveryUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!discoveryResponse.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to load discovery document (${discoveryResponse.status})`, step: "discovery" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let discoveryBody: unknown;
    try {
      discoveryBody = await discoveryResponse.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Discovery document response was not valid JSON", step: "discovery" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tokenEndpoint =
      discoveryBody && typeof discoveryBody === "object" && !Array.isArray(discoveryBody)
        ? (discoveryBody as Record<string, unknown>).token_endpoint
        : undefined;

    if (!isNonEmptyString(tokenEndpoint)) {
      return new Response(
        JSON.stringify({ error: "Discovery document does not contain a token_endpoint", step: "discovery", discoveryDocument: discoveryBody }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Step 2: request the access token from the resolved token endpoint.
    const form = new URLSearchParams();
    form.set("grant_type", grantType);
    form.set("client_id", body.clientId);
    form.set("client_secret", body.clientSecret);

    const tokenResponse = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
    });

    const tokenResponseText = await tokenResponse.text();
    let tokenResponseBody: unknown;
    try {
      tokenResponseBody = JSON.parse(tokenResponseText);
    } catch {
      tokenResponseBody = { rawResponse: tokenResponseText };
    }

    return new Response(
      JSON.stringify({
        ok: tokenResponse.ok,
        status: tokenResponse.status,
        tokenEndpoint,
        data: tokenResponseBody,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("export-api-oidc-token error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
