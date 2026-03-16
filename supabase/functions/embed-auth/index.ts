import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type IssueBody = {
  action: "issue";
  org_slug: string;
  origin: string;
  ttl_seconds?: number;
  token_type?: "temporary" | "persistent";
  label?: string;
};

type ValidateBody = {
  action: "validate";
  org_slug: string;
  token: string;
  parent_origin?: string;
};

type RevokePersistentBody = {
  action: "revoke_persistent";
  org_slug: string;
  token_id: string;
};

type Body = IssueBody | ValidateBody | RevokePersistentBody;

type PersistentTokenEntry = {
  id: string;
  label: string;
  origin: string;
  token_hash: string;
  created_at: string;
  revoked_at?: string | null;
};

const textEncoder = new TextEncoder();

const toBase64Url = (input: Uint8Array | string): string => {
  const bytes = typeof input === "string" ? textEncoder.encode(input) : input;
  let str = "";
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

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
  return toBase64Url(new Uint8Array(signature));
};

const verify = async (data: string, signature: string, secret: string): Promise<boolean> => {
  const expected = await sign(data, secret);
  return expected === signature;
};

const sha256Hex = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const parseOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const randomId = () => crypto.randomUUID();

const randomToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `ptxp_${toBase64Url(bytes)}`;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getEmbedSettings = (settings: unknown): Record<string, unknown> => {
  const root = asRecord(settings);
  return asRecord(root.embed);
};

const getPersistentTokens = (embedSettings: Record<string, unknown>): PersistentTokenEntry[] => {
  const raw = embedSettings.persistent_tokens;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => asRecord(item))
    .map((item) => ({
      id: String(item.id || ""),
      label: String(item.label || "Persistent Token"),
      origin: String(item.origin || ""),
      token_hash: String(item.token_hash || ""),
      created_at: String(item.created_at || ""),
      revoked_at: item.revoked_at ? String(item.revoked_at) : null,
    }))
    .filter((item) => item.id && item.origin && item.token_hash);
};

const requireAdminAccess = async (
  requesterClient: ReturnType<typeof createClient>,
  orgId: string,
  userId: string
) => {
  const { data: roleData, error: roleError } = await requesterClient
    .from("user_roles")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .in("role", ["admin", "super_admin"])
    .maybeSingle();

  return !roleError && !!roleData;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const embedSecret = Deno.env.get("EMBED_TOKEN_SECRET");

    if (!supabaseUrl || !supabaseAnonKey || !embedSecret) {
      return new Response(
        JSON.stringify({ error: "Server not configured: missing required env vars" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = (await req.json()) as Body;

    if (body.action === "validate") {
      const { org_slug, token, parent_origin } = body;
      if (!org_slug || !token) {
        return new Response(JSON.stringify({ ok: false, error: "Missing org_slug or token" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const orgClient = createClient(supabaseUrl, supabaseAnonKey);
      const { data: org, error: orgError } = await orgClient
        .from("organizations")
        .select("id, slug, settings, is_active")
        .eq("slug", org_slug.toLowerCase())
        .eq("is_active", true)
        .maybeSingle();

      if (orgError || !org) {
        return new Response(JSON.stringify({ ok: false, error: "Organization not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const embedSettings = getEmbedSettings(org.settings);
      const embedEnabled = embedSettings.embed_enabled !== false;
      if (!embedEnabled) {
        return new Response(JSON.stringify({ ok: false, error: "Embed is disabled for this organization" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const normalizedParent = parent_origin ? parseOrigin(parent_origin) : null;

      const parts = token.split(".");
      if (parts.length === 3) {
        const [headerB64, payloadB64, signatureB64] = parts;
        const dataToVerify = `${headerB64}.${payloadB64}`;
        const validSig = await verify(dataToVerify, signatureB64, embedSecret);
        if (!validSig) {
          return new Response(JSON.stringify({ ok: false, error: "Invalid token signature" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const payload = JSON.parse(fromBase64Url(payloadB64)) as {
          org_slug: string;
          org_id: string;
          origin: string;
          exp: number;
          token_type?: "temporary";
        };

        if (payload.org_slug !== org_slug || payload.org_id !== org.id) {
          return new Response(JSON.stringify({ ok: false, error: "Token org mismatch" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (Date.now() >= payload.exp * 1000) {
          return new Response(JSON.stringify({ ok: false, error: "Token expired" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (normalizedParent && normalizedParent !== payload.origin) {
          return new Response(JSON.stringify({ ok: false, error: "Parent origin not allowed" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(
          JSON.stringify({ ok: true, organization_id: payload.org_id, origin: payload.origin, token_type: "temporary" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tokenHash = await sha256Hex(token);
      const persistentTokens = getPersistentTokens(embedSettings);
      const matched = persistentTokens.find((t) => !t.revoked_at && t.token_hash === tokenHash);

      if (!matched) {
        return new Response(JSON.stringify({ ok: false, error: "Invalid persistent token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (normalizedParent && normalizedParent !== matched.origin) {
        return new Response(JSON.stringify({ ok: false, error: "Parent origin not allowed" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          ok: true,
          organization_id: org.id,
          origin: matched.origin,
          token_type: "persistent",
          token_id: matched.id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const requesterClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: authError } = await requesterClient.auth.getUser();
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "revoke_persistent") {
      const orgSlug = body.org_slug?.toLowerCase().trim();
      const tokenId = body.token_id?.trim();
      if (!orgSlug || !tokenId) {
        return new Response(JSON.stringify({ error: "Missing org_slug or token_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: org, error: orgError } = await requesterClient
        .from("organizations")
        .select("id, slug, settings")
        .eq("slug", orgSlug)
        .single();
      if (orgError || !org) {
        return new Response(JSON.stringify({ error: "Organization not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const isAdmin = await requireAdminAccess(requesterClient, org.id, userData.user.id);
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const settings = asRecord(org.settings);
      const embed = getEmbedSettings(settings);
      const persistentTokens = getPersistentTokens(embed);
      const updatedTokens = persistentTokens.map((token) =>
        token.id === tokenId ? { ...token, revoked_at: new Date().toISOString() } : token
      );

      const merged = {
        ...settings,
        embed: {
          ...embed,
          persistent_tokens: updatedTokens,
        },
      };

      const { error: updateError } = await requesterClient
        .from("organizations")
        .update({ settings: merged })
        .eq("id", org.id);
      if (updateError) {
        return new Response(JSON.stringify({ error: "Failed to revoke token" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action !== "issue") {
      return new Response(JSON.stringify({ error: "Unsupported action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orgSlug = body.org_slug?.toLowerCase().trim();
    const targetOrigin = parseOrigin(body.origin || "");
    const tokenType = body.token_type ?? "temporary";
    const ttl = Math.max(60, Math.min(body.ttl_seconds ?? 3600, 86400));

    if (!orgSlug || !targetOrigin) {
      return new Response(JSON.stringify({ error: "Invalid org_slug or origin" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: org, error: orgError } = await requesterClient
      .from("organizations")
      .select("id, slug, settings")
      .eq("slug", orgSlug)
      .single();

    if (orgError || !org) {
      return new Response(JSON.stringify({ error: "Organization not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isAdmin = await requireAdminAccess(requesterClient, org.id, userData.user.id);
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const settings = asRecord(org.settings);
    const embed = getEmbedSettings(settings);
    const embedEnabled = embed.embed_enabled !== false;
    const allowedOrigins = Array.isArray(embed.allowed_origins)
      ? embed.allowed_origins.map(String)
      : [];

    if (!embedEnabled) {
      return new Response(JSON.stringify({ error: "Embed is disabled for this organization" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!allowedOrigins.includes(targetOrigin)) {
      return new Response(JSON.stringify({ error: "Origin is not registered in allowed list" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (tokenType === "temporary") {
      const payload = {
        org_slug: org.slug,
        org_id: org.id,
        origin: targetOrigin,
        token_type: "temporary" as const,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + ttl,
      };

      const header = { alg: "HS256", typ: "JWT" };
      const headerB64 = toBase64Url(JSON.stringify(header));
      const payloadB64 = toBase64Url(JSON.stringify(payload));
      const signatureB64 = await sign(`${headerB64}.${payloadB64}`, embedSecret);
      const token = `${headerB64}.${payloadB64}.${signatureB64}`;

      return new Response(
        JSON.stringify({
          ok: true,
          token,
          token_type: "temporary",
          expires_at: new Date(payload.exp * 1000).toISOString(),
          origin: targetOrigin,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const plainToken = randomToken();
    const tokenHash = await sha256Hex(plainToken);
    const tokenId = randomId();
    const persistentTokens = getPersistentTokens(embed);
    const entry: PersistentTokenEntry = {
      id: tokenId,
      label: body.label?.trim() || "Persistent Token",
      origin: targetOrigin,
      token_hash: tokenHash,
      created_at: new Date().toISOString(),
      revoked_at: null,
    };

    const merged = {
      ...settings,
      embed: {
        ...embed,
        persistent_tokens: [...persistentTokens, entry],
      },
    };

    const { error: updateError } = await requesterClient
      .from("organizations")
      .update({ settings: merged })
      .eq("id", org.id);

    if (updateError) {
      return new Response(JSON.stringify({ error: "Failed to persist token" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        token: plainToken,
        token_id: tokenId,
        token_type: "persistent",
        origin: targetOrigin,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
