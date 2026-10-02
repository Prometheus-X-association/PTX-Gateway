import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
export const hashToken = async (token: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))).map(b => b.toString(16).padStart(2, "0")).join("");
export async function validBrowserSession(client: SupabaseClient, orgId: string, token?: string, sessionId?: string) {
  let query = client.from("gateway_browser_sessions").select("id, expires_at, gateway_browser_credentials!inner(username, revoked, valid_from, expires_at)").eq("organization_id", orgId);
  if (token) query = query.eq("token_hash", await hashToken(token));
  else if (sessionId) query = query.eq("id", sessionId);
  else return null;
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  const credential = data.gateway_browser_credentials as unknown as { username: string; revoked: boolean; valid_from: string | null; expires_at: string | null };
  const now = Date.now();
  if (Date.parse(data.expires_at) <= now || credential.revoked || (credential.valid_from && Date.parse(credential.valid_from) > now) || (credential.expires_at && Date.parse(credential.expires_at) <= now)) return null;
  return { id: data.id, username: credential.username, expires_at: data.expires_at };
}

// Called after signature/expiry verification on every endpoint accepting processing tokens.
export async function executionAccessAllowed(client: SupabaseClient, payload: { org_id: string; access_kind?: string; browser_session_id?: string }) {
  const { data: org, error } = await client.from("organizations").select("settings, is_active").eq("id", payload.org_id).maybeSingle();
  if (error || !org?.is_active) return false;
  if (payload.access_kind === "browser" && !await validBrowserSession(client, payload.org_id, undefined, payload.browser_session_id)) return false;
  return org.settings?.private_browser_access_enabled !== true || payload.access_kind === "embed" || payload.access_kind === "browser";
}
