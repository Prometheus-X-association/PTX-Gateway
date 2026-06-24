import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOCAL_SUPABASE_URL_FALLBACK = "http://kong:8000";
const LOCAL_SUPABASE_ANON_KEY_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SUPABASE_SERVICE_ROLE_KEY_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const getSupabaseUrl = (): string =>
  Deno.env.get("SUPABASE_URL") || LOCAL_SUPABASE_URL_FALLBACK;
const getSupabaseAnonKey = (): string =>
  Deno.env.get("SUPABASE_ANON_KEY") || LOCAL_SUPABASE_ANON_KEY_FALLBACK;
const getSupabaseServiceRoleKey = (): string =>
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || LOCAL_SUPABASE_SERVICE_ROLE_KEY_FALLBACK;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ─── base64url / crypto helpers ────────────────────────────────────────────

const base64UrlEncodeBytes = (bytes: Uint8Array): string => {
  let str = "";
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const base64UrlEncodeString = (value: string): string =>
  base64UrlEncodeBytes(new TextEncoder().encode(value));

const randomToken = (byteLength: number): string => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
};

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const verifyPkce = async (codeVerifier: string, codeChallenge: string, method: string): Promise<boolean> => {
  if (method === "plain") return codeVerifier === codeChallenge;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return base64UrlEncodeBytes(new Uint8Array(digest)) === codeChallenge;
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const escapeForScriptTag = (json: string): string => json.replace(/</g, "\\u003C");

const htmlResponse = (html: string, status = 200): Response =>
  new Response(html, { status, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });

interface SigningKeyMaterial {
  kid: string;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}

const generateSigningKey = async (): Promise<SigningKeyMaterial> => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  const kid = randomToken(8);
  const privateJwkRaw = (await crypto.subtle.exportKey("jwk", keyPair.privateKey)) as JsonWebKey;
  const publicJwkRaw = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey;

  const privateJwk: JsonWebKey = { ...privateJwkRaw, alg: "RS256", kid, use: "sig" };
  const publicJwk: JsonWebKey = {
    kty: publicJwkRaw.kty,
    n: publicJwkRaw.n,
    e: publicJwkRaw.e,
    alg: "RS256",
    use: "sig",
    kid,
  };

  return { kid, privateJwk, publicJwk };
};

const signJwt = async (
  privateJwk: JsonWebKey,
  kid: string,
  claims: Record<string, unknown>,
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const header = { alg: "RS256", typ: "JWT", kid };
  const signingInput = `${base64UrlEncodeString(JSON.stringify(header))}.${base64UrlEncodeString(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
};

// ─── auth / org helpers ─────────────────────────────────────────────────────

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

  if (roleError || !roleRow?.role) return null;
  return { userId };
};

const buildIssuerUrl = (publicBaseUrl: string, orgSlug: string): string =>
  `${publicBaseUrl}/functions/v1/oidc-provider/${orgSlug}`;

const buildSharedIssuerUrl = (publicBaseUrl: string, slug: string): string =>
  `${publicBaseUrl}/functions/v1/oidc-provider/shared/${slug}`;

// SUPABASE_URL (used for this function's own internal Supabase client calls) is the
// internal Docker-network address in local dev (e.g. http://kong:8000) and is NOT
// reachable by external OIDC clients. The issuer/token_endpoint/jwks_uri fields and
// the JWT "iss" claim must instead use whatever externally-facing host the caller
// actually used to reach this function.
//
// The raw "host" header is unreliable here: in this project's local Supabase stack,
// by the time the request reaches the edge runtime it has already been rewritten to
// the runtime container's own internal address (e.g.
// "supabase_edge_runtime_<ref>:8081"), not the original client-facing host. Reverse
// proxies like Kong instead preserve the original host in "x-forwarded-host" /
// "x-forwarded-proto", so prefer those. As a final, fully reliable override for any
// environment, an explicit OIDC_PUBLIC_BASE_URL secret always wins if set.
const resolvePublicBaseUrl = (req: Request, fallback: string): string => {
  const configured = Deno.env.get("OIDC_PUBLIC_BASE_URL");
  if (configured) return configured.replace(/\/+$/, "");

  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost || req.headers.get("host");
  if (!host || host.includes("supabase_edge_runtime")) return fallback;

  const scheme = req.headers.get("x-forwarded-proto")
    || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${scheme}://${host}`;
};

// An issuer is either a single organization's own private discovery URL, or
// a shared discovery URL multiple organizations have joined and can attach
// clients to. Both have their own independent signing key.
type IssuerScope = { kind: "org"; id: string } | { kind: "shared"; id: string };

const getSigningKeyForScope = async (
  adminClient: ReturnType<typeof createClient>,
  scope: IssuerScope,
): Promise<{ kid: string; private_key_jwk: JsonWebKey } | null> => {
  if (scope.kind === "org") {
    const { data } = await adminClient
      .from("oidc_provider_keys")
      .select("kid, private_key_jwk")
      .eq("organization_id", scope.id)
      .maybeSingle();
    return data as { kid: string; private_key_jwk: JsonWebKey } | null;
  }
  const { data } = await adminClient
    .from("oidc_shared_issuer_keys")
    .select("kid, private_key_jwk")
    .eq("shared_issuer_id", scope.id)
    .maybeSingle();
  return data as { kid: string; private_key_jwk: JsonWebKey } | null;
};

const getPublicKeyForScope = async (
  adminClient: ReturnType<typeof createClient>,
  scope: IssuerScope,
): Promise<JsonWebKey | null> => {
  if (scope.kind === "org") {
    const { data } = await adminClient
      .from("oidc_provider_keys")
      .select("public_key_jwk")
      .eq("organization_id", scope.id)
      .maybeSingle();
    return (data?.public_key_jwk as JsonWebKey | undefined) ?? null;
  }
  const { data } = await adminClient
    .from("oidc_shared_issuer_keys")
    .select("public_key_jwk")
    .eq("shared_issuer_id", scope.id)
    .maybeSingle();
  return (data?.public_key_jwk as JsonWebKey | undefined) ?? null;
};

interface OidcClientRow {
  id: string;
  client_id: string;
  client_secret: string;
  name: string;
  audience: string | null;
  token_expiry_seconds: number;
  is_active: boolean;
  redirect_uris: string[];
}

const findClientForScope = async (
  adminClient: ReturnType<typeof createClient>,
  scope: IssuerScope,
  clientId: string,
): Promise<OidcClientRow | null> => {
  let query = adminClient
    .from("oidc_provider_clients")
    .select("id, client_id, client_secret, name, audience, token_expiry_seconds, is_active, redirect_uris")
    .eq("client_id", clientId);
  query = scope.kind === "org"
    ? query.eq("organization_id", scope.id).is("shared_issuer_id", null)
    : query.eq("shared_issuer_id", scope.id);
  const { data } = await query.maybeSingle();
  return data as OidcClientRow | null;
};

// ─── public OIDC endpoints (discovery / jwks / token) ──────────────────────

const handleDiscovery = (issuer: string): Response =>
  jsonResponse({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    grant_types_supported: ["client_credentials", "authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256", "plain"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  });

const handleJwks = async (
  adminClient: ReturnType<typeof createClient>,
  scope: IssuerScope,
): Promise<Response> => {
  const publicKey = await getPublicKeyForScope(adminClient, scope);
  return jsonResponse({ keys: publicKey ? [publicKey] : [] });
};

const extractTokenParams = async (req: Request): Promise<Record<string, string>> => {
  const contentType = req.headers.get("content-type") || "";
  const params: Record<string, string> = {};

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") params[key] = value;
    }
  } else if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    if (isRecord(body)) {
      for (const [key, value] of Object.entries(body)) {
        if (typeof value === "string") params[key] = value;
      }
    }
  } else {
    const text = await req.text();
    const searchParams = new URLSearchParams(text);
    for (const [key, value] of searchParams.entries()) {
      params[key] = value;
    }
  }

  const basicAuth = req.headers.get("authorization");
  if ((!params.client_id || !params.client_secret) && basicAuth?.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = atob(basicAuth.slice(6).trim());
      const separatorIndex = decoded.indexOf(":");
      if (separatorIndex >= 0) {
        params.client_id = params.client_id || decoded.slice(0, separatorIndex);
        params.client_secret = params.client_secret || decoded.slice(separatorIndex + 1);
      }
    } catch {
      // ignore malformed basic auth header
    }
  }

  return params;
};

const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

const issueAccessToken = async (
  adminClient: ReturnType<typeof createClient>,
  scope: IssuerScope,
  issuer: string,
  clientRow: OidcClientRow,
  sub: string,
  tokenScope?: string | null,
): Promise<{ accessToken: string; expirySeconds: number } | null> => {
  const keyRow = await getSigningKeyForScope(adminClient, scope);
  if (!keyRow) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expirySeconds = clientRow.token_expiry_seconds || 3600;
  const claims: Record<string, unknown> = {
    iss: issuer,
    sub,
    aud: clientRow.audience || issuer,
    iat: nowSeconds,
    exp: nowSeconds + expirySeconds,
    jti: randomToken(12),
  };
  if (tokenScope) claims.scope = tokenScope;

  const accessToken = await signJwt(keyRow.private_key_jwk, keyRow.kid, claims);
  return { accessToken, expirySeconds };
};

const handleClientCredentialsGrant = async (
  params: Record<string, string>,
  adminClient: ReturnType<typeof createClient>,
  scope: IssuerScope,
  issuer: string,
): Promise<Response> => {
  const { client_id: clientId, client_secret: clientSecret } = params;
  if (!clientId || !clientSecret) {
    return jsonResponse({ error: "invalid_request", error_description: "client_id and client_secret are required" }, 400);
  }

  const clientRow = await findClientForScope(adminClient, scope, clientId);
  if (!clientRow || !clientRow.is_active || clientSecret !== clientRow.client_secret) {
    return jsonResponse({ error: "invalid_client" }, 401);
  }

  const issued = await issueAccessToken(adminClient, scope, issuer, clientRow, clientRow.client_id);
  if (!issued) {
    return jsonResponse({ error: "server_error", error_description: "No signing key configured for this issuer" }, 500);
  }

  return jsonResponse({ access_token: issued.accessToken, token_type: "Bearer", expires_in: issued.expirySeconds });
};

const handleAuthorizationCodeGrant = async (
  params: Record<string, string>,
  adminClient: ReturnType<typeof createClient>,
  scope: IssuerScope,
  issuer: string,
): Promise<Response> => {
  const { client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, code_verifier: codeVerifier } = params;
  if (!clientId || !clientSecret || !code || !redirectUri) {
    return jsonResponse({ error: "invalid_request", error_description: "client_id, client_secret, code, and redirect_uri are required" }, 400);
  }

  const clientRow = await findClientForScope(adminClient, scope, clientId);
  if (!clientRow || !clientRow.is_active || clientSecret !== clientRow.client_secret) {
    return jsonResponse({ error: "invalid_client" }, 401);
  }

  const codeHash = await sha256Hex(code);
  const { data: codeRow } = await adminClient
    .from("oidc_provider_auth_codes")
    .select("id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at, used_at")
    .eq("code_hash", codeHash)
    .eq("client_row_id", clientRow.id)
    .maybeSingle();

  if (!codeRow || codeRow.used_at || new Date(codeRow.expires_at).getTime() < Date.now()) {
    return jsonResponse({ error: "invalid_grant", error_description: "Authorization code is invalid, expired, or already used" }, 400);
  }
  if (codeRow.redirect_uri !== redirectUri) {
    return jsonResponse({ error: "invalid_grant", error_description: "redirect_uri does not match the authorization request" }, 400);
  }
  if (codeRow.code_challenge) {
    const valid = isNonEmptyString(codeVerifier)
      && (await verifyPkce(codeVerifier, codeRow.code_challenge, codeRow.code_challenge_method || "S256"));
    if (!valid) {
      return jsonResponse({ error: "invalid_grant", error_description: "code_verifier does not match" }, 400);
    }
  }

  // Single-use: mark consumed before issuing tokens so a retried/replayed code always fails.
  await adminClient.from("oidc_provider_auth_codes").update({ used_at: new Date().toISOString() }).eq("id", codeRow.id);

  const issued = await issueAccessToken(adminClient, scope, issuer, clientRow, codeRow.user_id, codeRow.scope);
  if (!issued) {
    return jsonResponse({ error: "server_error", error_description: "No signing key configured for this issuer" }, 500);
  }

  const refreshToken = randomToken(32);
  await adminClient.from("oidc_provider_refresh_tokens").insert({
    client_row_id: clientRow.id,
    user_id: codeRow.user_id,
    token_hash: await sha256Hex(refreshToken),
    scope: codeRow.scope,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS).toISOString(),
  });

  return jsonResponse({
    access_token: issued.accessToken,
    token_type: "Bearer",
    expires_in: issued.expirySeconds,
    refresh_token: refreshToken,
  });
};

const handleRefreshTokenGrant = async (
  params: Record<string, string>,
  adminClient: ReturnType<typeof createClient>,
  scope: IssuerScope,
  issuer: string,
): Promise<Response> => {
  const { client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken } = params;
  if (!clientId || !clientSecret || !refreshToken) {
    return jsonResponse({ error: "invalid_request", error_description: "client_id, client_secret, and refresh_token are required" }, 400);
  }

  const clientRow = await findClientForScope(adminClient, scope, clientId);
  if (!clientRow || !clientRow.is_active || clientSecret !== clientRow.client_secret) {
    return jsonResponse({ error: "invalid_client" }, 401);
  }

  const tokenHash = await sha256Hex(refreshToken);
  const { data: tokenRow } = await adminClient
    .from("oidc_provider_refresh_tokens")
    .select("id, user_id, scope, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .eq("client_row_id", clientRow.id)
    .maybeSingle();

  if (!tokenRow || tokenRow.revoked_at || new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return jsonResponse({ error: "invalid_grant", error_description: "Refresh token is invalid, expired, or revoked" }, 400);
  }

  const issued = await issueAccessToken(adminClient, scope, issuer, clientRow, tokenRow.user_id, tokenRow.scope);
  if (!issued) {
    return jsonResponse({ error: "server_error", error_description: "No signing key configured for this issuer" }, 500);
  }

  // Rotate: issue a new refresh token and revoke the one that was just used.
  const newRefreshToken = randomToken(32);
  await adminClient.from("oidc_provider_refresh_tokens").insert({
    client_row_id: clientRow.id,
    user_id: tokenRow.user_id,
    token_hash: await sha256Hex(newRefreshToken),
    scope: tokenRow.scope,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS).toISOString(),
  });
  await adminClient.from("oidc_provider_refresh_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", tokenRow.id);

  return jsonResponse({
    access_token: issued.accessToken,
    token_type: "Bearer",
    expires_in: issued.expirySeconds,
    refresh_token: newRefreshToken,
  });
};

const handleToken = async (
  req: Request,
  adminClient: ReturnType<typeof createClient>,
  scope: IssuerScope,
  issuer: string,
): Promise<Response> => {
  const params = await extractTokenParams(req);

  switch (params.grant_type) {
    case "client_credentials":
      return await handleClientCredentialsGrant(params, adminClient, scope, issuer);
    case "authorization_code":
      return await handleAuthorizationCodeGrant(params, adminClient, scope, issuer);
    case "refresh_token":
      return await handleRefreshTokenGrant(params, adminClient, scope, issuer);
    default:
      return jsonResponse({ error: "unsupported_grant_type" }, 400);
  }
};

// ─── /authorize: self-contained login + consent page ───────────────────────
// authorization_code is backed by PTX Gateway's own Supabase Auth users (the
// same accounts that log into the gateway/admin panel) -- there is no
// separate identity system for this flow. The page below loads supabase-js
// from a CDN and signs the user in directly against this same Supabase
// project, then posts the resulting session token back to this function to
// mint the authorization code.

const renderAuthorizeErrorPage = (message: string): Response =>
  htmlResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Authorization Error</title></head>
<body style="font-family:system-ui;max-width:480px;margin:80px auto;text-align:center;color:#1f2937;">
  <h2 style="color:#b91c1c;">Authorization request rejected</h2>
  <p>${escapeHtml(message)}</p>
</body></html>`,
    400,
  );

interface AuthorizePageConfig {
  postUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

const renderAuthorizePage = (config: AuthorizePageConfig): Response => {
  const configJson = escapeForScriptTag(JSON.stringify(config));
  return htmlResponse(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sign in to authorize ${escapeHtml(config.clientName)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; margin: 0; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 10px 30px rgba(15,23,42,0.12); padding: 32px; width: 360px; }
  h1 { font-size: 18px; margin: 0 0 8px; color: #0f172a; }
  p.sub { color: #64748b; font-size: 13px; margin: 0 0 20px; }
  label { display: block; font-size: 12px; color: #334155; margin-bottom: 4px; }
  input { width: 100%; box-sizing: border-box; padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 8px; margin-bottom: 14px; font-size: 14px; }
  button { width: 100%; padding: 10px; border: 0; border-radius: 8px; background: #0f172a; color: #fff; font-weight: 600; cursor: pointer; font-size: 14px; }
  button:hover { background: #1e293b; }
  button:disabled { opacity: 0.6; cursor: default; }
  .error { color: #b91c1c; font-size: 13px; margin: 10px 0 0; }
  .approve-name { font-weight: 700; }
</style>
</head>
<body>
  <div class="card" id="card"><h1>Loading...</h1></div>
  <script src="https://esm.sh/@supabase/supabase-js@2?bundle"></script>
  <script>
    const CONFIG = ${configJson};
    const card = document.getElementById("card");

    function renderLogin(onLoggedIn) {
      card.innerHTML =
        '<h1>Sign in to PTX Gateway</h1>' +
        '<p class="sub">Sign in to authorize <span class="approve-name"></span> to access your account.</p>' +
        '<label>Email</label><input id="email" type="email" autocomplete="username" />' +
        '<label>Password</label><input id="password" type="password" autocomplete="current-password" />' +
        '<button id="signin">Sign In</button>' +
        '<p class="error" id="loginError"></p>';
      card.querySelector(".approve-name").textContent = CONFIG.clientName;
      card.querySelector("#signin").addEventListener("click", async () => {
        const button = card.querySelector("#signin");
        button.disabled = true;
        const email = card.querySelector("#email").value.trim();
        const password = card.querySelector("#password").value;
        const { data, error } = await window.__supabase.auth.signInWithPassword({ email, password });
        button.disabled = false;
        if (error || !data || !data.session) {
          card.querySelector("#loginError").textContent = error ? error.message : "Sign in failed";
          return;
        }
        onLoggedIn(data.session.access_token);
      });
    }

    function renderApprove(accessToken) {
      card.innerHTML =
        '<h1>Authorize access</h1>' +
        '<p class="sub"><span class="approve-name"></span> wants to access your PTX Gateway account.</p>' +
        '<button id="approve">Authorize</button>' +
        '<p class="error" id="approveError"></p>';
      card.querySelector(".approve-name").textContent = CONFIG.clientName;
      card.querySelector("#approve").addEventListener("click", async () => {
        const button = card.querySelector("#approve");
        button.disabled = true;
        try {
          const response = await fetch(CONFIG.postUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + accessToken },
            body: JSON.stringify({
              client_id: CONFIG.clientId,
              redirect_uri: CONFIG.redirectUri,
              state: CONFIG.state,
              scope: CONFIG.scope,
              code_challenge: CONFIG.codeChallenge,
              code_challenge_method: CONFIG.codeChallengeMethod,
            }),
          });
          const json = await response.json();
          if (!response.ok || !json.redirect_to) {
            card.querySelector("#approveError").textContent = json.error_description || json.error || "Authorization failed";
            button.disabled = false;
            return;
          }
          window.location.href = json.redirect_to;
        } catch (err) {
          card.querySelector("#approveError").textContent = "Authorization failed";
          button.disabled = false;
        }
      });
    }

    (async () => {
      const { createClient } = window.supabase;
      window.__supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
      const { data } = await window.__supabase.auth.getSession();
      if (data && data.session && data.session.access_token) {
        renderApprove(data.session.access_token);
      } else {
        renderLogin((accessToken) => renderApprove(accessToken));
      }
    })();
  </script>
</body>
</html>`);
};

const handleAuthorizeGet = async (
  req: Request,
  adminClient: ReturnType<typeof createClient>,
  scope: IssuerScope,
  issuer: string,
  publicBaseUrl: string,
  supabaseAnonKey: string,
): Promise<Response> => {
  const url = new URL(req.url);
  const responseType = url.searchParams.get("response_type");
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state") || "";
  const reqScope = url.searchParams.get("scope") || "";
  const codeChallenge = url.searchParams.get("code_challenge") || "";
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") || "S256";

  if (responseType !== "code") {
    return renderAuthorizeErrorPage("Only response_type=code is supported.");
  }
  if (!clientId || !redirectUri) {
    return renderAuthorizeErrorPage("client_id and redirect_uri are required.");
  }

  const clientRow = await findClientForScope(adminClient, scope, clientId);
  if (!clientRow || !clientRow.is_active) {
    return renderAuthorizeErrorPage("Unknown or inactive client.");
  }
  if (!Array.isArray(clientRow.redirect_uris) || !clientRow.redirect_uris.includes(redirectUri)) {
    return renderAuthorizeErrorPage("redirect_uri is not registered for this client.");
  }

  return renderAuthorizePage({
    postUrl: `${issuer}/authorize`,
    supabaseUrl: publicBaseUrl,
    supabaseAnonKey,
    clientId,
    clientName: clientRow.name || clientId,
    redirectUri,
    state,
    scope: reqScope,
    codeChallenge,
    codeChallengeMethod,
  });
};

const AUTH_CODE_LIFETIME_MS = 5 * 60 * 1000;

const handleAuthorizePost = async (
  req: Request,
  supabaseUrl: string,
  supabaseAnonKey: string,
  adminClient: ReturnType<typeof createClient>,
  scope: IssuerScope,
): Promise<Response> => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "invalid_request", error_description: "Missing user session" }, 401);
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: authError } = await userClient.auth.getUser();
  if (authError || !userData?.user?.id) {
    return jsonResponse({ error: "invalid_request", error_description: "Invalid or expired session" }, 401);
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isRecord(body)) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const clientId = isNonEmptyString(body.client_id) ? body.client_id : null;
  const redirectUri = isNonEmptyString(body.redirect_uri) ? body.redirect_uri : null;
  const state = isNonEmptyString(body.state) ? body.state : "";
  const reqScope = isNonEmptyString(body.scope) ? body.scope : "";
  const codeChallenge = isNonEmptyString(body.code_challenge) ? body.code_challenge : null;
  const codeChallengeMethod = isNonEmptyString(body.code_challenge_method) ? body.code_challenge_method : "S256";

  if (!clientId || !redirectUri) {
    return jsonResponse({ error: "invalid_request", error_description: "client_id and redirect_uri are required" }, 400);
  }

  const clientRow = await findClientForScope(adminClient, scope, clientId);
  if (!clientRow || !clientRow.is_active) {
    return jsonResponse({ error: "invalid_client" }, 400);
  }
  if (!Array.isArray(clientRow.redirect_uris) || !clientRow.redirect_uris.includes(redirectUri)) {
    return jsonResponse({ error: "invalid_request", error_description: "redirect_uri is not registered for this client" }, 400);
  }

  const code = randomToken(32);
  const { error: insertError } = await adminClient.from("oidc_provider_auth_codes").insert({
    client_row_id: clientRow.id,
    user_id: userData.user.id,
    redirect_uri: redirectUri,
    code_hash: await sha256Hex(code),
    code_challenge: codeChallenge,
    code_challenge_method: codeChallenge ? codeChallengeMethod : null,
    scope: reqScope || null,
    expires_at: new Date(Date.now() + AUTH_CODE_LIFETIME_MS).toISOString(),
  });

  if (insertError) {
    return jsonResponse({ error: "server_error", error_description: "Failed to issue authorization code" }, 500);
  }

  const redirectTo = `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}code=${encodeURIComponent(code)}`
    + (state ? `&state=${encodeURIComponent(state)}` : "");

  return jsonResponse({ redirect_to: redirectTo });
};

// ─── authenticated admin actions ───────────────────────────────────────────

type AdminAction =
  | "get_or_create_key"
  | "rotate_key"
  | "list_clients"
  | "create_client"
  | "update_client"
  | "regenerate_secret"
  | "toggle_client"
  | "delete_client"
  | "check_shared_issuer_slug"
  | "create_shared_issuer"
  | "join_shared_issuer"
  | "leave_shared_issuer"
  | "delete_shared_issuer"
  | "list_shared_issuers"
  | "rotate_shared_issuer_key";

interface AdminRequestBody {
  action: AdminAction;
  organizationId: string;
  name?: string;
  clientId?: string;
  audience?: string;
  tokenExpirySeconds?: number;
  id?: string;
  isActive?: boolean;
  slug?: string;
  sharedIssuerId?: string | null;
  redirectUris?: string[];
}

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_.-]{3,100}$/;
const SHARED_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

const sanitizeRedirectUris = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const uris: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    const trimmed = entry.trim();
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    } catch {
      return null;
    }
    uris.push(trimmed);
  }
  return uris;
};

const isSharedIssuerMember = async (
  adminClient: ReturnType<typeof createClient>,
  sharedIssuerId: string,
  organizationId: string,
): Promise<boolean> => {
  const { data } = await adminClient
    .from("oidc_shared_issuer_members")
    .select("id")
    .eq("shared_issuer_id", sharedIssuerId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return Boolean(data);
};

const isUniqueViolation = (error: { code?: string } | null): boolean => error?.code === "23505";

const handleAdminAction = async (
  req: Request,
  supabaseUrl: string,
  supabaseAnonKey: string,
  adminClient: ReturnType<typeof createClient>,
): Promise<Response> => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const body = (await req.json().catch(() => null)) as AdminRequestBody | null;
  if (!body?.organizationId || typeof body.organizationId !== "string") {
    return jsonResponse({ error: "organizationId is required" }, 400);
  }

  const authResult = await requireOrgAdmin(supabaseUrl, supabaseAnonKey, authHeader, body.organizationId);
  if (!authResult) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  const { organizationId } = body;

  switch (body.action) {
    case "get_or_create_key": {
      const { data: existing } = await adminClient
        .from("oidc_provider_keys")
        .select("kid, created_at")
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (existing) {
        return jsonResponse({ data: existing });
      }

      const generated = await generateSigningKey();
      const { data: inserted, error } = await adminClient
        .from("oidc_provider_keys")
        .insert({
          organization_id: organizationId,
          kid: generated.kid,
          private_key_jwk: generated.privateJwk,
          public_key_jwk: generated.publicJwk,
        })
        .select("kid, created_at")
        .single();

      if (error) {
        return jsonResponse({ error: "Failed to generate signing key" }, 500);
      }
      return jsonResponse({ data: inserted });
    }

    case "rotate_key": {
      const generated = await generateSigningKey();
      const { data: rotated, error } = await adminClient
        .from("oidc_provider_keys")
        .upsert(
          {
            organization_id: organizationId,
            kid: generated.kid,
            private_key_jwk: generated.privateJwk,
            public_key_jwk: generated.publicJwk,
            created_at: new Date().toISOString(),
          },
          { onConflict: "organization_id" },
        )
        .select("kid, created_at")
        .single();

      if (error) {
        return jsonResponse({ error: "Failed to rotate signing key" }, 500);
      }
      return jsonResponse({ data: rotated });
    }

    case "list_clients": {
      const { data, error } = await adminClient
        .from("oidc_provider_clients")
        .select("id, name, client_id, client_secret, shared_issuer_id, redirect_uris, audience, token_expiry_seconds, is_active, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      if (error) {
        return jsonResponse({ error: "Failed to list OIDC provider clients" }, 500);
      }
      return jsonResponse({ data });
    }

    case "create_client": {
      if (!isNonEmptyString(body.name)) {
        return jsonResponse({ error: "name is required" }, 400);
      }

      let clientId = `ptx_${randomToken(12)}`;
      if (isNonEmptyString(body.clientId)) {
        const trimmed = body.clientId.trim();
        if (!CLIENT_ID_PATTERN.test(trimmed)) {
          return jsonResponse({ error: "Client ID must be 3-100 characters and contain only letters, numbers, '.', '_' or '-'" }, 400);
        }
        clientId = trimmed;
      }

      if (isNonEmptyString(body.sharedIssuerId)) {
        const isMember = await isSharedIssuerMember(adminClient, body.sharedIssuerId, organizationId);
        if (!isMember) {
          return jsonResponse({ error: "Your organization has not joined this shared issuer" }, 403);
        }
      }

      const redirectUris = body.redirectUris !== undefined ? sanitizeRedirectUris(body.redirectUris) : [];
      if (redirectUris === null) {
        return jsonResponse({ error: "Redirect URIs must be valid http(s) URLs" }, 400);
      }

      const clientSecret = randomToken(32);

      const { data: inserted, error } = await adminClient
        .from("oidc_provider_clients")
        .insert({
          organization_id: organizationId,
          name: body.name.trim(),
          client_id: clientId,
          client_secret: clientSecret,
          shared_issuer_id: isNonEmptyString(body.sharedIssuerId) ? body.sharedIssuerId : null,
          redirect_uris: redirectUris,
          audience: isNonEmptyString(body.audience) ? body.audience.trim() : null,
          token_expiry_seconds:
            typeof body.tokenExpirySeconds === "number" && body.tokenExpirySeconds > 0
              ? Math.round(body.tokenExpirySeconds)
              : 3600,
          created_by: authResult.userId,
        })
        .select("id, name, client_id, client_secret, shared_issuer_id, redirect_uris, audience, token_expiry_seconds, is_active, created_at")
        .single();

      if (error) {
        if (isUniqueViolation(error)) {
          return jsonResponse({ error: "Client ID is already in use" }, 409);
        }
        return jsonResponse({ error: "Failed to create OIDC provider client" }, 500);
      }

      return jsonResponse({ data: inserted });
    }

    case "update_client": {
      if (!isNonEmptyString(body.id)) {
        return jsonResponse({ error: "id is required" }, 400);
      }

      const updates: Record<string, unknown> = {};

      if (body.name !== undefined) {
        if (!isNonEmptyString(body.name)) {
          return jsonResponse({ error: "name cannot be empty" }, 400);
        }
        updates.name = body.name.trim();
      }

      if (body.clientId !== undefined) {
        if (!isNonEmptyString(body.clientId)) {
          return jsonResponse({ error: "Client ID cannot be empty" }, 400);
        }
        const trimmed = body.clientId.trim();
        if (!CLIENT_ID_PATTERN.test(trimmed)) {
          return jsonResponse({ error: "Client ID must be 3-100 characters and contain only letters, numbers, '.', '_' or '-'" }, 400);
        }
        updates.client_id = trimmed;
      }

      if (body.audience !== undefined) {
        updates.audience = isNonEmptyString(body.audience) ? body.audience.trim() : null;
      }

      if (body.tokenExpirySeconds !== undefined) {
        updates.token_expiry_seconds =
          typeof body.tokenExpirySeconds === "number" && body.tokenExpirySeconds > 0
            ? Math.round(body.tokenExpirySeconds)
            : 3600;
      }

      if (body.redirectUris !== undefined) {
        const redirectUris = sanitizeRedirectUris(body.redirectUris);
        if (redirectUris === null) {
          return jsonResponse({ error: "Redirect URIs must be valid http(s) URLs" }, 400);
        }
        updates.redirect_uris = redirectUris;
      }

      if (body.sharedIssuerId !== undefined) {
        if (isNonEmptyString(body.sharedIssuerId)) {
          const isMember = await isSharedIssuerMember(adminClient, body.sharedIssuerId, organizationId);
          if (!isMember) {
            return jsonResponse({ error: "Your organization has not joined this shared issuer" }, 403);
          }
          updates.shared_issuer_id = body.sharedIssuerId;
        } else {
          updates.shared_issuer_id = null;
        }
      }

      if (Object.keys(updates).length === 0) {
        return jsonResponse({ error: "No fields to update" }, 400);
      }

      const { data: updated, error } = await adminClient
        .from("oidc_provider_clients")
        .update(updates)
        .eq("id", body.id)
        .eq("organization_id", organizationId)
        .select("id, name, client_id, client_secret, shared_issuer_id, redirect_uris, audience, token_expiry_seconds, is_active, created_at")
        .single();

      if (error) {
        if (isUniqueViolation(error)) {
          return jsonResponse({ error: "Client ID is already in use" }, 409);
        }
        return jsonResponse({ error: "Failed to update client" }, 500);
      }

      return jsonResponse({ data: updated });
    }

    case "regenerate_secret": {
      if (!isNonEmptyString(body.id)) {
        return jsonResponse({ error: "id is required" }, 400);
      }

      const clientSecret = randomToken(32);

      const { data: updated, error } = await adminClient
        .from("oidc_provider_clients")
        .update({ client_secret: clientSecret })
        .eq("id", body.id)
        .eq("organization_id", organizationId)
        .select("id, name, client_id, client_secret, shared_issuer_id, redirect_uris, audience, token_expiry_seconds, is_active, created_at")
        .single();

      if (error) {
        return jsonResponse({ error: "Failed to regenerate client secret" }, 500);
      }

      return jsonResponse({ data: updated });
    }

    case "toggle_client": {
      if (!isNonEmptyString(body.id) || typeof body.isActive !== "boolean") {
        return jsonResponse({ error: "id and isActive are required" }, 400);
      }

      const { data: updated, error } = await adminClient
        .from("oidc_provider_clients")
        .update({ is_active: body.isActive })
        .eq("id", body.id)
        .eq("organization_id", organizationId)
        .select("id, name, client_id, client_secret, shared_issuer_id, redirect_uris, audience, token_expiry_seconds, is_active, created_at")
        .single();

      if (error) {
        return jsonResponse({ error: "Failed to update client status" }, 500);
      }
      return jsonResponse({ data: updated });
    }

    case "delete_client": {
      if (!isNonEmptyString(body.id)) {
        return jsonResponse({ error: "id is required" }, 400);
      }

      const { error } = await adminClient
        .from("oidc_provider_clients")
        .delete()
        .eq("id", body.id)
        .eq("organization_id", organizationId);

      if (error) {
        return jsonResponse({ error: "Failed to delete client" }, 500);
      }
      return jsonResponse({ data: { deleted: true } });
    }

    case "check_shared_issuer_slug": {
      if (!isNonEmptyString(body.slug)) {
        return jsonResponse({ error: "slug is required" }, 400);
      }
      const trimmed = body.slug.trim().toLowerCase();
      if (!SHARED_SLUG_PATTERN.test(trimmed)) {
        return jsonResponse({ data: { available: false, reason: "Slug must be 3-50 lowercase letters, numbers, or hyphens" } });
      }

      const { data: existing } = await adminClient
        .from("oidc_shared_issuers")
        .select("id")
        .eq("slug", trimmed)
        .maybeSingle();

      return jsonResponse({ data: { available: !existing } });
    }

    case "create_shared_issuer": {
      if (!isNonEmptyString(body.name)) {
        return jsonResponse({ error: "name is required" }, 400);
      }
      if (!isNonEmptyString(body.slug)) {
        return jsonResponse({ error: "slug is required" }, 400);
      }
      const slug = body.slug.trim().toLowerCase();
      if (!SHARED_SLUG_PATTERN.test(slug)) {
        return jsonResponse({ error: "Slug must be 3-50 lowercase letters, numbers, or hyphens" }, 400);
      }

      const { data: existing } = await adminClient
        .from("oidc_shared_issuers")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (existing) {
        return jsonResponse({ error: "Slug is already in use" }, 409);
      }

      const { data: issuer, error: issuerError } = await adminClient
        .from("oidc_shared_issuers")
        .insert({
          slug,
          name: body.name.trim(),
          created_by_organization_id: organizationId,
          created_by: authResult.userId,
        })
        .select("id, slug, name, created_by_organization_id, created_at")
        .single();

      if (issuerError || !issuer) {
        if (isUniqueViolation(issuerError)) {
          return jsonResponse({ error: "Slug is already in use" }, 409);
        }
        return jsonResponse({ error: "Failed to create shared issuer" }, 500);
      }

      const generated = await generateSigningKey();
      const { error: keyError } = await adminClient
        .from("oidc_shared_issuer_keys")
        .insert({
          shared_issuer_id: issuer.id,
          kid: generated.kid,
          private_key_jwk: generated.privateJwk,
          public_key_jwk: generated.publicJwk,
        });

      if (keyError) {
        await adminClient.from("oidc_shared_issuers").delete().eq("id", issuer.id);
        return jsonResponse({ error: "Failed to generate signing key for shared issuer" }, 500);
      }

      await adminClient.from("oidc_shared_issuer_members").insert({
        shared_issuer_id: issuer.id,
        organization_id: organizationId,
        joined_by: authResult.userId,
      });

      return jsonResponse({ data: issuer });
    }

    case "join_shared_issuer": {
      if (!isNonEmptyString(body.slug)) {
        return jsonResponse({ error: "slug is required" }, 400);
      }
      const slug = body.slug.trim().toLowerCase();

      const { data: issuer } = await adminClient
        .from("oidc_shared_issuers")
        .select("id, slug, name, created_by_organization_id, created_at")
        .eq("slug", slug)
        .maybeSingle();

      if (!issuer) {
        return jsonResponse({ error: "No shared issuer found with that slug" }, 404);
      }

      const alreadyMember = await isSharedIssuerMember(adminClient, issuer.id, organizationId);
      if (!alreadyMember) {
        const { error: joinError } = await adminClient.from("oidc_shared_issuer_members").insert({
          shared_issuer_id: issuer.id,
          organization_id: organizationId,
          joined_by: authResult.userId,
        });
        if (joinError && !isUniqueViolation(joinError)) {
          return jsonResponse({ error: "Failed to join shared issuer" }, 500);
        }
      }

      return jsonResponse({ data: issuer });
    }

    case "leave_shared_issuer": {
      if (!isNonEmptyString(body.id)) {
        return jsonResponse({ error: "id is required" }, 400);
      }

      const { count } = await adminClient
        .from("oidc_provider_clients")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("shared_issuer_id", body.id);

      if (count && count > 0) {
        return jsonResponse({ error: `Reassign or delete ${count} client(s) using this shared issuer before leaving` }, 409);
      }

      const { error } = await adminClient
        .from("oidc_shared_issuer_members")
        .delete()
        .eq("shared_issuer_id", body.id)
        .eq("organization_id", organizationId);

      if (error) {
        return jsonResponse({ error: "Failed to leave shared issuer" }, 500);
      }
      return jsonResponse({ data: { left: true } });
    }

    case "delete_shared_issuer": {
      if (!isNonEmptyString(body.id)) {
        return jsonResponse({ error: "id is required" }, 400);
      }

      const { data: issuer } = await adminClient
        .from("oidc_shared_issuers")
        .select("id, created_by_organization_id")
        .eq("id", body.id)
        .maybeSingle();

      if (!issuer) {
        return jsonResponse({ error: "Shared issuer not found" }, 404);
      }
      if (issuer.created_by_organization_id !== organizationId) {
        return jsonResponse({ error: "Only the organization that created this shared issuer can delete it" }, 403);
      }

      // Cascades: oidc_shared_issuer_keys and oidc_shared_issuer_members rows are
      // deleted; any oidc_provider_clients referencing it fall back to shared_issuer_id
      // = NULL (their own organization's private issuer) rather than being deleted.
      const { error } = await adminClient
        .from("oidc_shared_issuers")
        .delete()
        .eq("id", body.id);

      if (error) {
        return jsonResponse({ error: "Failed to delete shared issuer" }, 500);
      }
      return jsonResponse({ data: { deleted: true } });
    }

    case "list_shared_issuers": {
      const { data, error } = await adminClient
        .from("oidc_shared_issuer_members")
        .select("shared_issuer:oidc_shared_issuers(id, slug, name, created_by_organization_id, created_at)")
        .eq("organization_id", organizationId);

      if (error) {
        return jsonResponse({ error: "Failed to list shared issuers" }, 500);
      }

      const issuers = (data || [])
        .map((row) => (row as { shared_issuer: unknown }).shared_issuer)
        .filter(Boolean);

      return jsonResponse({ data: issuers });
    }

    case "rotate_shared_issuer_key": {
      if (!isNonEmptyString(body.id)) {
        return jsonResponse({ error: "id is required" }, 400);
      }

      const { data: issuer } = await adminClient
        .from("oidc_shared_issuers")
        .select("id, created_by_organization_id")
        .eq("id", body.id)
        .maybeSingle();

      if (!issuer) {
        return jsonResponse({ error: "Shared issuer not found" }, 404);
      }
      if (issuer.created_by_organization_id !== organizationId) {
        return jsonResponse({ error: "Only the organization that created this shared issuer can rotate its key" }, 403);
      }

      const generated = await generateSigningKey();
      const { data: rotated, error } = await adminClient
        .from("oidc_shared_issuer_keys")
        .upsert(
          {
            shared_issuer_id: issuer.id,
            kid: generated.kid,
            private_key_jwk: generated.privateJwk,
            public_key_jwk: generated.publicJwk,
            created_at: new Date().toISOString(),
          },
          { onConflict: "shared_issuer_id" },
        )
        .select("kid, created_at")
        .single();

      if (error) {
        return jsonResponse({ error: "Failed to rotate shared issuer key" }, 500);
      }
      return jsonResponse({ data: rotated });
    }

    default:
      return jsonResponse({ error: "Unsupported action" }, 400);
  }
};

// ─── routing ────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = getSupabaseUrl();
    const supabaseAnonKey = getSupabaseAnonKey();
    const supabaseServiceRoleKey = getSupabaseServiceRoleKey();
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
    const publicBaseUrl = resolvePublicBaseUrl(req, supabaseUrl);

    const url = new URL(req.url);
    const marker = "/oidc-provider/";
    const markerIndex = url.pathname.indexOf(marker);
    const rest = markerIndex >= 0 ? url.pathname.slice(markerIndex + marker.length) : "";
    const segments = rest.split("/").filter(Boolean);

    if (segments[0] === "admin") {
      return await handleAdminAction(req, supabaseUrl, supabaseAnonKey, adminClient);
    }

    if (segments[0] === "shared") {
      const sharedSlug = segments[1];
      if (!sharedSlug) {
        return jsonResponse({ error: "Not found" }, 404);
      }

      const { data: sharedIssuer } = await adminClient
        .from("oidc_shared_issuers")
        .select("id, slug")
        .eq("slug", sharedSlug)
        .maybeSingle();

      if (!sharedIssuer) {
        return jsonResponse({ error: "Unknown issuer" }, 404);
      }

      const issuer = buildSharedIssuerUrl(publicBaseUrl, sharedIssuer.slug);
      const scope: IssuerScope = { kind: "shared", id: sharedIssuer.id };

      if (segments[2] === ".well-known" && segments[3] === "openid-configuration") {
        return handleDiscovery(issuer);
      }
      if (segments[2] === ".well-known" && segments[3] === "jwks.json") {
        return await handleJwks(adminClient, scope);
      }
      if (segments[2] === "token" && req.method === "POST") {
        return await handleToken(req, adminClient, scope, issuer);
      }
      if (segments[2] === "authorize" && req.method === "GET") {
        return await handleAuthorizeGet(req, adminClient, scope, issuer, publicBaseUrl, supabaseAnonKey);
      }
      if (segments[2] === "authorize" && req.method === "POST") {
        return await handleAuthorizePost(req, supabaseUrl, supabaseAnonKey, adminClient, scope);
      }

      return jsonResponse({ error: "Not found" }, 404);
    }

    // All remaining routes are public and scoped by org slug: segments[0].
    const orgSlug = segments[0];
    if (!orgSlug) {
      return jsonResponse({ error: "Not found" }, 404);
    }

    const { data: org } = await adminClient
      .from("organizations")
      .select("id, slug")
      .eq("slug", orgSlug)
      .eq("is_active", true)
      .maybeSingle();

    if (!org) {
      return jsonResponse({ error: "Unknown issuer" }, 404);
    }

    const issuer = buildIssuerUrl(publicBaseUrl, org.slug);
    const scope: IssuerScope = { kind: "org", id: org.id };

    if (segments[1] === ".well-known" && segments[2] === "openid-configuration") {
      return handleDiscovery(issuer);
    }

    if (segments[1] === ".well-known" && segments[2] === "jwks.json") {
      return await handleJwks(adminClient, scope);
    }

    if (segments[1] === "token" && req.method === "POST") {
      return await handleToken(req, adminClient, scope, issuer);
    }

    if (segments[1] === "authorize" && req.method === "GET") {
      return await handleAuthorizeGet(req, adminClient, scope, issuer, publicBaseUrl, supabaseAnonKey);
    }
    if (segments[1] === "authorize" && req.method === "POST") {
      return await handleAuthorizePost(req, supabaseUrl, supabaseAnonKey, adminClient, scope);
    }

    return jsonResponse({ error: "Not found" }, 404);
  } catch (error) {
    console.error("oidc-provider error:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Internal server error" },
      500,
    );
  }
});
