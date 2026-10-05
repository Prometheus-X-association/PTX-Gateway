import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient, authorize, checkRunAccess, loadWorkflow } from "../_shared/workflowAccess.ts";
import { createRun, cors, json, publicRun, readBody } from "../_shared/workflowRuns.ts";
import { interactionUrl, resumeRun } from "../_shared/workflowInteraction.ts";
import { encrypt, hash, HttpError, object, randomSecret, validateWebhookMapping } from "../_shared/workflowSecurity.ts";

export const handleWorkflowRequest = async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    if (!["GET", "POST"].includes(request.method)) throw new HttpError(405, "Method not allowed.");
    const url = new URL(request.url);
    let body: Record<string, any>;
    if (request.method === "GET") body = Object.fromEntries(url.searchParams);
    else { try { body = object(JSON.parse(String(await readBody(request)) || "{}")); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "Invalid JSON body."); } }
    const admin = adminClient();
    const principal = await authorize(request, body, admin);
    const action = body.action || "start";
    if (request.method === "GET" && !["get", "steps", "notifications", "list", "webhooks", "keys"].includes(action)) throw new HttpError(405, "Use POST for this action.");
    if (action === "start") {
      const source = principal.keyId ? "api" : body.source === "dashboard" ? "dashboard" : "api";
      return json({ ok: true, ...await createRun(admin, principal, body, source, request.headers.get("idempotency-key") || undefined) }, 202);
    }
    if (action === "list") {
      let query = admin.from("workflow_runs").select("*").eq("organization_id", principal.orgId).order("created_at", { ascending: false }).limit(50);
      if (!principal.isAdmin) query = query.eq("caller_id", principal.callerId);
      if (body.workflowId) query = query.eq("workflow_id", body.workflowId);
      if (principal.workflowIds) query = query.in("workflow_id", principal.workflowIds);
      const { data, error } = await query;
      if (error) throw error;
      return json({ ok: true, runs: (data ?? []).map(publicRun) });
    }
    if (["get", "steps", "notifications", "cancel", "resume"].includes(action)) {
      const { data: run, error } = await admin.from("workflow_runs").select("*").eq("organization_id", principal.orgId).eq("id", body.runId).maybeSingle();
      if (error) throw error;
      if (!run) throw new HttpError(404, "Run was not found.");
      checkRunAccess(principal, run);
      if (action === "get") return json({ ok: true, run: { ...publicRun(run), interactionUrl: await interactionUrl(run) } });
      if (action === "steps") {
        const { data, error } = await admin.from("workflow_run_steps").select("*").eq("organization_id", principal.orgId).eq("run_id", run.id).gt("sequence", Math.max(0, Number(body.after) || 0)).order("sequence").limit(200);
        if (error) throw error;
        return json({ ok: true, steps: data });
      }
      if (action === "notifications") {
        const { data, error } = await admin.from("workflow_notifications").select("id,event_type,status,attempts,last_error,created_at,delivered_at,available_at").eq("organization_id", principal.orgId).eq("run_id", run.id).order("created_at").limit(200);
        if (error) throw error;
        return json({ ok: true, notifications: data });
      }
      if (action === "cancel") {
        if (!["queued", "running", "waiting_for_input"].includes(run.status)) throw new HttpError(409, "Run has already finished.");
        const patch = run.status === "running" ? { cancel_requested: true } : { cancel_requested: true, status: "cancelled", finished_at: new Date().toISOString(), stop_reason: "Cancelled by caller." };
        const { data, error } = await admin.from("workflow_runs").update({ ...patch, updated_at: new Date().toISOString() }).eq("organization_id", principal.orgId).eq("id", run.id).eq("status", run.status).select("id").maybeSingle();
        if (error) throw error;
        if (!data) throw new HttpError(409, "Run status changed; refresh and retry.");
        return json({ ok: true });
      }
      return json(await resumeRun(admin, run, body), 202);
    }
    if (!principal.isAdmin) throw new HttpError(403, "Organization admin permission is required.");
    if (["webhooks", "create_webhook", "update_webhook", "rotate_webhook", "delete_webhook"].includes(action)) {
      if (action === "webhooks") {
        const { data, error } = await admin.from("workflow_webhooks").select("id,name,workflow_id,enabled,input_mapping,created_at").eq("organization_id", principal.orgId).eq("workflow_id", body.workflowId).order("created_at");
        if (error) throw error;
        return json({ ok: true, webhooks: data });
      }
      if (action === "create_webhook") {
        await loadWorkflow(admin, principal.orgId, String(body.workflowId));
        validateWebhookMapping(object(body.inputMapping));
        const secret = randomSecret();
        const { data, error } = await admin.from("workflow_webhooks").insert({ organization_id: principal.orgId, workflow_id: body.workflowId, name: String(body.name || "Webhook").slice(0, 100), secret_ciphertext: await encrypt(secret), input_mapping: object(body.inputMapping) }).select("id").single();
        if (error) throw error;
        return json({ ok: true, id: data.id, secret }, 201);
      }
      if (action === "delete_webhook") {
        const { error } = await admin.from("workflow_webhooks").delete().eq("organization_id", principal.orgId).eq("id", body.webhookId);
        if (error) throw error;
        return json({ ok: true });
      }
      const secret = action === "rotate_webhook" ? randomSecret() : null;
      if (body.inputMapping) validateWebhookMapping(object(body.inputMapping));
      const patch = secret ? { secret_ciphertext: await encrypt(secret) } : { enabled: body.enabled !== false, ...(body.name ? { name: String(body.name).slice(0, 100) } : {}), ...(body.inputMapping ? { input_mapping: object(body.inputMapping) } : {}) };
      const { data, error } = await admin.from("workflow_webhooks").update(patch).eq("organization_id", principal.orgId).eq("id", body.webhookId).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(404, "Webhook was not found.");
      return json({ ok: true, secret });
    }
    if (action === "keys") {
      const { data, error } = await admin.from("workflow_api_keys").select("id,name,workflow_ids,enabled,expires_at,created_at").eq("organization_id", principal.orgId);
      if (error) throw error;
      return json({ ok: true, keys: data });
    }
    if (action === "create_key") {
      if (!Array.isArray(body.workflowIds) || !body.workflowIds.length) throw new HttpError(400, "Select at least one workflow.");
      for (const id of body.workflowIds) await loadWorkflow(admin, principal.orgId, id);
      if (body.expiresAt && (!Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= Date.now())) throw new HttpError(400, "Expiry must be in the future.");
      const key = `wfk_${randomSecret()}`;
      const { data, error } = await admin.from("workflow_api_keys").insert({ organization_id: principal.orgId, name: String(body.name || "Integration").slice(0, 100), workflow_ids: body.workflowIds, key_hash: await hash(key), expires_at: body.expiresAt || null }).select("id").single();
      if (error) throw error;
      return json({ ok: true, id: data.id, key }, 201);
    }
    if (action === "revoke_key") {
      const { error } = await admin.from("workflow_api_keys").update({ enabled: false }).eq("organization_id", principal.orgId).eq("id", body.keyId);
      if (error) throw error;
      return json({ ok: true });
    }
    throw new HttpError(400, "Unknown workflow action.");
  } catch (error) {
    if (!(error instanceof HttpError)) console.error("Workflow API failed", error);
    return json({ ok: false, error: error instanceof HttpError ? error.message : "Workflow operation failed." }, error instanceof HttpError ? error.status : 500);
  }
};

serve(handleWorkflowRequest);
