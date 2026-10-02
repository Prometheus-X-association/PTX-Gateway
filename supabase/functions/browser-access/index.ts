import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashToken, validBrowserSession } from "../_shared/browser-access.ts";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
serve(async req => {
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const { data: org } = await client.from("organizations").select("id, settings").eq("slug", String(body.org_slug || "").toLowerCase()).eq("is_active", true).maybeSingle();
    if (!org) return reply({ error: "Organization not found" }, 404);
    const audit = async (event: string, username?: string) => {
      // Exclude query strings/fragments, which can contain tokens and other secrets.
      const safeUrl = (value: unknown) => { try { const u = new URL(String(value)); return u.origin + u.pathname; } catch { return null; } };
      const { error } = await client.from("gateway_browser_access_logs").insert({ organization_id: org.id, username: username?.slice(0, 100), event, ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null, user_agent: req.headers.get("user-agent")?.slice(0, 1000), url: safeUrl(body.url), referrer: safeUrl(body.referrer) });
      if (error) throw error;
    };
    if (["list", "save", "delete", "revoke", "logs"].includes(body.action)) {
      const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
      const { data: auth } = await client.auth.getUser(token || "");
      if (!auth.user) return reply({ error: "Unauthorized" }, 401);
      const { data: role } = await client.from("user_roles").select("role").eq("user_id", auth.user.id).eq("organization_id", org.id).eq("role", "super_admin").maybeSingle();
      const { data: member } = await client.from("organization_members").select("organization_id").eq("user_id", auth.user.id).eq("organization_id", org.id).eq("status", "active").maybeSingle();
      if (!role || !member) return reply({ error: "Organization super admin required" }, 403);
      if (body.action === "list" || body.action === "logs") {
        const table = body.action === "logs" ? "gateway_browser_access_logs" : "gateway_browser_credentials";
        const columns = body.action === "logs" ? "*" : "id, username, valid_from, expires_at, revoked, created_at";
        const { data, error } = await client.from(table).select(columns).eq("organization_id", org.id).order("created_at", { ascending: false }).limit(body.action === "logs" ? 1000 : 500);
        if (error) throw error;
        return reply({ ok: true, items: data });
      }
      let auditUsername = body.username;
      if (body.id) {
        const { data: existing } = await client.from("gateway_browser_credentials").select("username").eq("organization_id", org.id).eq("id", body.id).maybeSingle();
        if (!existing) return reply({ error: "Credential not found" }, 404);
        auditUsername = existing.username;
      }
      if (body.action === "save") {
        const username = String(body.username || "").trim();
        if (!username || username.length > 100) return reply({ error: "Username must contain 1–100 characters" }, 400);
        const changes: Record<string, unknown> = { username, valid_from: body.valid_from || null, expires_at: body.expires_at || null };
        for (const field of ["valid_from", "expires_at"]) if (changes[field] && !Number.isFinite(Date.parse(String(changes[field])))) return reply({ error: "Invalid access date" }, 400);
        if (changes.valid_from && changes.expires_at && Date.parse(String(changes.valid_from)) >= Date.parse(String(changes.expires_at))) return reply({ error: "Access end must be after start" }, 400);
        if (body.password || !body.id) {
          if (typeof body.password !== "string" || body.password.length < 12 || new TextEncoder().encode(body.password).length > 72) return reply({ error: "Password must have at least 12 characters and at most 72 bytes" }, 400);
          const { data: hash, error } = await client.rpc("gateway_hash_password", { password: body.password });
          if (error) throw error;
          changes.password_hash = hash;
        }
        const result = body.id ? await client.from("gateway_browser_credentials").update(changes).eq("organization_id", org.id).eq("id", body.id).select("id").single() : await client.from("gateway_browser_credentials").insert({ ...changes, organization_id: org.id }).select("id").single();
        if (result.error) throw result.error;
      } else {
        if (!body.id) return reply({ error: "Credential ID required" }, 400);
        const query = body.action === "delete" ? client.from("gateway_browser_credentials").delete() : client.from("gateway_browser_credentials").update({ revoked: body.revoked !== false });
        const { error } = await query.eq("organization_id", org.id).eq("id", body.id).select("id").single();
        if (error) throw error;
      }
      if (body.id) { const { error } = await client.from("gateway_browser_sessions").delete().eq("organization_id", org.id).eq("credential_id", body.id); if (error) throw error; }
      await audit(`credential_${body.action}`, body.action === "save" ? body.username : auditUsername);
      return reply({ ok: true });
    }
    if (body.action === "logout") {
      if (body.token) { const { error } = await client.from("gateway_browser_sessions").delete().eq("organization_id", org.id).eq("token_hash", await hashToken(body.token)); if (error) throw error; }
      await audit("logout");
      return reply({ ok: true });
    }
    if (body.action !== "check" && body.action !== "login") return reply({ error: "Unsupported action" }, 400);
    if (body.action === "check") {
      if (org.settings?.private_browser_access_enabled !== true) return reply({ ok: true, required: false });
      const session = await validBrowserSession(client, org.id, body.token);
      if (body.log_visit) await audit(session ? "access_granted" : "access_denied", session?.username);
      return reply({ ok: !!session, required: true });
    }
    const username = String(body.username || "").trim();
    if (!username || username.length > 100 || typeof body.password !== "string") return reply({ error: "Invalid credentials or access is unavailable" }, 401);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    let attempts = client.from("gateway_browser_access_logs").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("event", "login_failed").gte("created_at", new Date(Date.now() - 15 * 60_000).toISOString());
    attempts = ip ? attempts.eq("ip_address", ip) : attempts.eq("username", username.slice(0, 100));
    const { count, error: countError } = await attempts;
    if (countError) throw countError;
    if ((count || 0) >= 10) return reply({ error: "Too many attempts. Try again in 15 minutes." }, 429);
    const { data: credential } = await client.from("gateway_browser_credentials").select("*").eq("organization_id", org.id).eq("username", username).maybeSingle();
    const now = Date.now();
    let valid = false;
    if (credential && typeof body.password === "string" && new TextEncoder().encode(body.password).length <= 72) {
      const { data, error } = await client.rpc("gateway_check_password", { password: body.password, hash: credential.password_hash });
      if (error) throw error;
      valid = data === true && !credential.revoked && (!credential.valid_from || Date.parse(credential.valid_from) <= now) && (!credential.expires_at || Date.parse(credential.expires_at) > now);
    }
    if (!valid) { await audit("login_failed", username); return reply({ error: "Invalid credentials or access is unavailable" }, 401); }
    const token = crypto.randomUUID() + crypto.randomUUID();
    const expires = Math.min(now + 8 * 3600_000, credential.expires_at ? Date.parse(credential.expires_at) : Infinity);
    const { error } = await client.from("gateway_browser_sessions").insert({ organization_id: org.id, credential_id: credential.id, token_hash: await hashToken(token), expires_at: new Date(expires).toISOString() });
    if (error) throw error;
    await audit("login_success", username);
    return reply({ ok: true, token });
  } catch (error) {
    console.error("browser-access:", error);
    return reply({ error: "Unable to complete access request" }, 500);
  }
});
