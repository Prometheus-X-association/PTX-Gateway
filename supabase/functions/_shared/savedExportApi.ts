import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};

export const executionTokenOrg = async (token: string, secret: string): Promise<string | null> => {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) return null;
    const payload = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    if (payload.typ !== "pdc_exec" || typeof payload.exp !== "number" || payload.exp <= Date.now() / 1000) return null;
    return typeof payload.org_id === "string" && /^[0-9a-f-]{36}$/i.test(payload.org_id) ? payload.org_id : null;
  } catch {
    return null;
  }
};

export const resolveSavedExportApi = async (req: Request): Promise<{ url: string; authorization: string | null }> => {
  const secret = Deno.env.get("PDC_EXECUTE_TOKEN_SECRET") || Deno.env.get("SUPABASE_INTERNAL_JWT_SECRET") || "super-secret-jwt-token-with-at-least-32-characters-long";
  const orgId = await executionTokenOrg(req.headers.get("x-org-execution-token") || "", secret);
  if (!orgId) throw new Error("Invalid or expired organization execution token");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) throw new Error("Export service is not configured");
  const client = createClient(supabaseUrl, serviceKey);
  const [{ data: org }, { data: global, error }] = await Promise.all([
    client.from("organizations").select("id").eq("id", orgId).eq("is_active", true).maybeSingle(),
    client.from("global_configs").select("features").eq("organization_id", orgId).maybeSingle(),
  ]);
  if (!org || error) throw new Error("Organization export settings unavailable");
  const resultPage = asRecord(asRecord(global?.features).resultPage);
  const apis = Array.isArray(resultPage.exportApiConfigs) ? resultPage.exportApiConfigs.map(asRecord) : [];
  const api = apis.find((item) => item.id === req.headers.get("x-export-api-id") && item.is_active !== false);
  if (!api) throw new Error("Export endpoint is unavailable or inactive");
  const targets = Array.isArray(api.target_resources) ? api.target_resources : [];
  if (!targets.includes(req.headers.get("x-export-target"))) throw new Error("Export endpoint is not connected to this service or service chain");
  if (typeof api.url !== "string") throw new Error("Export endpoint has no URL");
  const url = new URL(api.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid export endpoint URL");
  for (const param of Array.isArray(api.params) ? api.params.map(asRecord) : []) {
    if (typeof param.key === "string" && param.key.trim()) url.searchParams.append(param.key, String(param.value ?? ""));
  }
  let authorization = typeof api.authorization === "string" ? api.authorization : null;
  const oidc = asRecord(api.oidc);
  if (oidc.enabled) {
    const clients = Array.isArray(resultPage.oidcClients) ? resultPage.oidcClients.map(asRecord) : [];
    const credentials = clients.find((item) => item.id === api.oidc_client_id) || oidc;
    const response = await fetch(`${supabaseUrl}/functions/v1/export-api-oidc-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      body: JSON.stringify({
        discoveryUrl: credentials.discoveryUrl,
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        grantType: credentials.grantType,
        customGrantType: credentials.customGrantType,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const token = await response.json();
    if (!response.ok || !token.ok || typeof token.data?.access_token !== "string") throw new Error("Export OIDC token request failed");
    authorization = token.data.access_token;
  }
  return { url: url.toString(), authorization };
};
