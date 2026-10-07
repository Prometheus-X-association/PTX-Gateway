import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hash, hmac, equal, HttpError, object } from "./workflowSecurity.ts";

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new HttpError(503, "Workflow backend is not configured.");
  return createClient(url, key, { auth: { persistSession: false } });
}
export interface Principal { orgId: string; callerId: string; userId?: string; isAdmin: boolean; keyId?: string; workflowIds?: string[]; publicToken?: boolean }
export async function authorize(request: Request, body: Record<string, any>, admin: ReturnType<typeof adminClient>): Promise<Principal> {
  const requested = request.headers.get("x-organization-id") || body.organizationId;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer?.startsWith("wfk_")) {
    const { data: key, error } = await admin.from("workflow_api_keys").select("*").eq("key_hash", await hash(bearer)).eq("enabled", true).maybeSingle();
    if (error || !key || (key.expires_at && Date.parse(key.expires_at) <= Date.now())) throw new HttpError(401, "Invalid workflow API key.");
    if (requested && requested !== key.organization_id) throw new HttpError(403, "Organization mismatch.");
    return { orgId: key.organization_id, callerId: `key:${key.id}`, keyId: key.id, isAdmin: false, workflowIds: key.workflow_ids };
  }
  if (bearer) {
    const { data: { user }, error } = await admin.auth.getUser(bearer);
    if ((error || !user) && !body.org_execution_token) throw new HttpError(401, "Invalid user token.");
    if (user && !error) {
      if (!requested) throw new HttpError(400, "Organization ID is required.");
      const { data: member } = await admin.from("organization_members").select("organization_id").eq("organization_id", requested).eq("user_id", user.id).eq("status", "active").maybeSingle();
      if (!member) throw new HttpError(403, "Active organization membership is required.");
      const { data: role } = await admin.from("user_roles").select("role").eq("organization_id", requested).eq("user_id", user.id).in("role", ["admin", "super_admin"]).maybeSingle();
      return { orgId: requested, callerId: `user:${user.id}`, userId: user.id, isAdmin: Boolean(role) };
    }
  }
  // Existing public result-page execution tokens retain access to visible workflows.
  const token = body.org_execution_token;
  const secret = Deno.env.get("PDC_EXECUTE_TOKEN_SECRET") || Deno.env.get("SUPABASE_INTERNAL_JWT_SECRET");
  if (typeof token === "string" && secret) {
    const parts = token.split(".");
    if (parts.length === 3) {
      const signature = await hmac(secret, `${parts[0]}.${parts[1]}`);
      const bytes = Uint8Array.from(signature.match(/../g)!, (pair) => parseInt(pair, 16));
      const expected = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      if (equal(expected, parts[2])) {
        let payload: any;
        try { payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { throw new HttpError(401, "Invalid execution token."); }
        if (payload.typ === "pdc_exec" && payload.org_id && payload.exp > Date.now() / 1000 && (!requested || requested === payload.org_id)) {
          const session = body.workflow_session_id;
          if (typeof session !== "string" || !/^[a-zA-Z0-9-]{64,100}$/.test(session)) throw new HttpError(401, "A private workflow session ID is required.");
          return { orgId: payload.org_id, callerId: `public:${await hash(`${payload.org_id}.${session}`)}`, isAdmin: false, publicToken: true };
        }
      }
    }
  }
  throw new HttpError(401, "Workflow authentication is required.");
}
export async function loadWorkflow(admin: ReturnType<typeof adminClient>, orgId: string, workflowId: string) {
  const { data, error } = await admin.from("global_configs").select("features").eq("organization_id", orgId).maybeSingle();
  if (error) throw error;
  const llm = object(object(data?.features).llmInsights);
  const workflow = (Array.isArray(llm.workflows) ? llm.workflows : []).find((item: any) => item.id === workflowId && item.enabled !== false && !item.deletedAt);
  if (!workflow) throw new HttpError(404, "Enabled workflow was not found in this organization.");
  return { workflow, llm };
}
export function checkWorkflowAccess(principal: Principal, workflowId: string) {
  if (principal.workflowIds && !principal.workflowIds.includes(workflowId)) throw new HttpError(403, "API key does not allow this workflow.");
}
export function checkRunAccess(principal: Principal, run: any) {
  checkWorkflowAccess(principal, run.workflow_id);
  if (run.organization_id !== principal.orgId || (!principal.isAdmin && run.caller_id !== principal.callerId)) throw new HttpError(404, "Run was not found.");
}
export async function authenticatedWorkerRun(request: Request, admin: ReturnType<typeof adminClient>) {
  const runId = request.headers.get("x-workflow-run-id");
  if (!runId) return null;
  const lease = request.headers.get("x-workflow-lease");
  const supplied = request.headers.get("x-workflow-signature") || "";
  const secret = Deno.env.get("WORKFLOW_INTERNAL_SECRET");
  if (!secret || !lease || !equal(await hmac(secret, `${runId}.${lease}`), supplied)) throw new HttpError(401, "Invalid workflow worker authentication.");
  const { data: run, error } = await admin.from("workflow_runs").select("*").eq("id", runId).eq("lease_token", lease).eq("status", "running").maybeSingle();
  if (error || !run || run.cancel_requested || Date.parse(run.lease_expires_at) <= Date.now()) throw new HttpError(409, "Workflow lease is no longer active.");
  return run;
}
