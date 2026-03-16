import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type InviteBody = {
  organization_id: string;
  email: string;
  role?: "super_admin" | "admin" | "user";
  redirect_to?: string;
};

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const allowedRoles = new Set(["super_admin", "admin", "user"]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return new Response(JSON.stringify({ ok: false, error: "Server not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const requesterClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: authError } = await requesterClient.auth.getUser();
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as InviteBody;
    const organizationId = body.organization_id?.trim();
    const email = body.email?.trim().toLowerCase();
    const role = (body.role || "user").trim();
    const redirectTo = body.redirect_to?.trim() || `${Deno.env.get("SITE_URL") || "http://localhost:5173"}/`;

    if (!organizationId || !email || !isValidEmail(email)) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid organization_id or email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!allowedRoles.has(role)) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid role" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleData, error: roleError } = await requesterClient
      .from("user_roles")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", userData.user.id)
      .in("role", ["admin", "super_admin"])
      .maybeSingle();

    if (roleError || !roleData) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden: admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: org, error: orgError } = await serviceClient
      .from("organizations")
      .select("id")
      .eq("id", organizationId)
      .maybeSingle();

    if (orgError || !org) {
      return new Response(JSON.stringify({ ok: false, error: "Organization not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existingProfile } = await serviceClient
      .from("profiles")
      .select("user_id")
      .ilike("email", email)
      .maybeSingle();

    if (existingProfile?.user_id) {
      await serviceClient
        .from("organization_members")
        .upsert({
          organization_id: organizationId,
          user_id: existingProfile.user_id,
          invited_by: userData.user.id,
          status: "active",
        }, { onConflict: "organization_id,user_id" });

      await serviceClient
        .from("user_roles")
        .upsert({
          organization_id: organizationId,
          user_id: existingProfile.user_id,
          role,
        }, { onConflict: "user_id,organization_id" });
    }

    const { error: invitationError } = await serviceClient
      .from("organization_invitations")
      .upsert(
        {
          organization_id: organizationId,
          email,
          role,
          invited_by: userData.user.id,
          status: "pending",
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          accepted_at: null,
        },
        { onConflict: "organization_id,email" }
      );

    if (invitationError) {
      return new Response(JSON.stringify({ ok: false, error: invitationError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        invited_org_id: organizationId,
      },
    });

    if (inviteError) {
      if (/already.*registered|already.*exists/i.test(inviteError.message || "")) {
        return new Response(
          JSON.stringify({
            ok: true,
            message: "User already exists and was added to the organization",
            email_sent: false,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ ok: false, error: inviteError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Invitation sent",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
