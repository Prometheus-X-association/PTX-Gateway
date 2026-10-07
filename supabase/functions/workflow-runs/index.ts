import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient, authorize, checkRunAccess, loadWorkflow } from "../_shared/workflowAccess.ts";
import { createRun, cors, json, publicRun, readBody } from "../_shared/workflowRuns.ts";
import { interactionUrl, resumeRun } from "../_shared/workflowInteraction.ts";
import { decrypt, encrypt, hash, HttpError, object, randomSecret, validateWebhookMapping } from "../_shared/workflowSecurity.ts";
import { MAX_NODE_OUTPUT_BYTES, validateSerializableData } from "../_shared/workflowExecutor.ts";

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
    if (request.method === "GET" && !["get", "steps", "notifications", "state", "artifact", "list", "webhooks", "keys", "policy"].includes(action)) throw new HttpError(405, "Use POST for this action.");
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
    if (action === "health") {
      if (!principal.isAdmin) throw new HttpError(403, "Organization admin permission is required.");
      const { data, error } = await admin.rpc("workflow_health", { p_organization_id: principal.orgId });
      if (error) throw error;
      return json({ ok: true, health: data });
    }
    if (action === "policy") {
      if (!principal.isAdmin) throw new HttpError(403, "Organization admin permission is required.");
      const { data, error } = await admin.rpc("workflow_execution_policy", { p_organization_id: principal.orgId });
      if (error) {
        console.error("Workflow execution policy lookup failed", error);
        if (["PGRST202", "42883", "42P01", "42703"].includes(String(error.code))) {
          throw new HttpError(503, "Organization execution policy is unavailable. Apply the latest workflow database migrations.");
        }
        throw error;
      }
      return json({ ok: true, policy: data });
    }
    if (action === "update_policy") {
      if (!principal.isAdmin) throw new HttpError(403, "Organization admin permission is required.");
      const integer = (key: string, minimum: number, maximum: number) => {
        const value = Number(body[key]);
        if (!Number.isInteger(value) || value < minimum || value > maximum) throw new HttpError(400, `${key} must be between ${minimum.toLocaleString()} and ${maximum.toLocaleString()}.`);
        return value;
      };
      const policy = {
        max_running_runs: integer("maxRunningRuns", 1, 100_000),
        max_queued_runs: integer("maxQueuedRuns", 1, 1_000_000),
        max_outstanding_runs: integer("maxOutstandingRuns", 1, 2_000_000),
        max_caller_outstanding_runs: integer("maxCallerOutstandingRuns", 1, 1_000_000),
        max_starts_per_hour: integer("maxStartsPerHour", 1, 10_000_000),
        completed_retention_days: integer("completedRetentionDays", 1, 3650),
        failed_retention_days: integer("failedRetentionDays", 1, 3650),
      };
      if (policy.max_outstanding_runs < policy.max_running_runs + policy.max_queued_runs) throw new HttpError(400, "Outstanding runs must cover the configured running plus queued capacity.");
      if (policy.max_caller_outstanding_runs > policy.max_outstanding_runs) throw new HttpError(400, "Per-caller outstanding runs cannot exceed organization outstanding runs.");
      const { error } = await admin.from("workflow_execution_policies").upsert({ organization_id: principal.orgId, ...policy, updated_at: new Date().toISOString() });
      if (error) throw error;
      return json({ ok: true, policy: {
        maxRunningRuns: policy.max_running_runs, maxQueuedRuns: policy.max_queued_runs, maxOutstandingRuns: policy.max_outstanding_runs,
        maxCallerOutstandingRuns: policy.max_caller_outstanding_runs, maxStartsPerHour: policy.max_starts_per_hour,
        completedRetentionDays: policy.completed_retention_days, failedRetentionDays: policy.failed_retention_days,
      } });
    }
    if (["get", "steps", "notifications", "state", "artifact", "cancel", "resume", "recover", "signal"].includes(action)) {
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
      if (action === "state") {
        if (!principal.isAdmin) throw new HttpError(403, "Organization admin permission is required.");
        const current = run.run_state_ciphertext ? await decrypt(run.run_state_ciphertext) : {};
        const { workflow } = await decrypt(run.snapshot.ciphertext);
        const hidden = new Set<string>((workflow.state?.fields ?? []).filter((field: any) => field.sensitive).map((field: any) => String(field.key)));
        const inspected = structuredClone(current);
        for (const path of hidden) {
          const parts = path.split("."); let target: any = inspected;
          for (const part of parts.slice(0, -1)) target = target && typeof target === "object" ? target[part] : undefined;
          if (target && typeof target === "object" && Object.hasOwn(target, parts.at(-1)!)) target[parts.at(-1)!] = "[sensitive]";
        }
        const { data: events, error: eventError } = await admin.from("workflow_run_state_events").select("state_version,node_id,changed_keys,created_at").eq("organization_id", principal.orgId).eq("run_id", run.id).order("state_version").limit(1000);
        if (eventError) throw eventError;
        const { data: signalEvents, error: signalError } = await admin.from("workflow_run_signal_events").select("id,signal_name,received_at,consumed_at,consumed_by_node_id").eq("organization_id", principal.orgId).eq("run_id", run.id).order("received_at").limit(1000);
        if (signalError) throw signalError;
        return json({ ok: true, state: inspected, stateVersion: run.state_version ?? 0, sensitiveKeys: [...hidden], events: events ?? [], signalEvents: signalEvents ?? [] });
      }
      if (action === "artifact") {
        if (!principal.isAdmin) throw new HttpError(403, "Organization admin permission is required.");
        const { data: artifact, error: artifactError } = await admin.from("workflow_run_artifacts").select("id,node_id,state_key,content_type,size_bytes,sha256,ciphertext,created_at").eq("organization_id", principal.orgId).eq("run_id", run.id).eq("id", String(body.artifactId || "")).maybeSingle();
        if (artifactError) throw artifactError;
        if (!artifact) throw new HttpError(404, "Workflow artifact was not found.");
        const { workflow } = await decrypt(run.snapshot.ciphertext);
        if ((workflow.state?.fields ?? []).some((field: any) => field.key === artifact.state_key && field.sensitive)) throw new HttpError(403, "Sensitive workflow artifacts cannot be revealed through the operations API.");
        return json({ ok: true, artifact: { id: artifact.id, nodeId: artifact.node_id, stateKey: artifact.state_key, contentType: artifact.content_type, size: artifact.size_bytes, sha256: artifact.sha256, createdAt: artifact.created_at, value: await decrypt(artifact.ciphertext) } });
      }
      if (action === "cancel") {
        if (!["queued", "running", "waiting_for_input", "waiting_for_event"].includes(run.status)) throw new HttpError(409, "Run has already finished.");
        const patch = run.status === "running" ? { cancel_requested: true } : { cancel_requested: true, status: "cancelled", finished_at: new Date().toISOString(), stop_reason: "Cancelled by caller." };
        const { data, error } = await admin.from("workflow_runs").update({ ...patch, updated_at: new Date().toISOString() }).eq("organization_id", principal.orgId).eq("id", run.id).eq("status", run.status).select("id").maybeSingle();
        if (error) throw error;
        if (!data) throw new HttpError(409, "Run status changed; refresh and retry.");
        return json({ ok: true });
      }
      if (action === "recover") {
        if (!principal.isAdmin) throw new HttpError(403, "Organization admin permission is required.");
        if (run.status !== "manual_review" || run.current_side_effect_class !== "non_idempotent" || !run.current_node_id) throw new HttpError(409, "Run is not waiting for manual recovery.");
        const resolution = String(body.resolution || "");
        if (!['continue', 'retry', 'terminate'].includes(resolution)) throw new HttpError(400, "Choose continue, retry, or terminate.");
        let patch: Record<string, unknown>;
        if (resolution === "terminate") patch = { status: "cancelled", stop_reason: "Terminated after operator review of an uncertain external action.", finished_at: new Date().toISOString() };
        else if (resolution === "retry") patch = { status: "queued", stop_reason: "Operator confirmed retry of the uncertain external action.", finished_at: null };
        else {
          validateSerializableData(body.assumedOutput, "Assumed node output", MAX_NODE_OUTPUT_BYTES);
          const { workflow } = await decrypt(run.snapshot.ciphertext);
          const node = workflow.graph.nodes.find((item: any) => item.id === run.current_node_id);
          if (!node || !["api", "agent"].includes(node.type)) throw new HttpError(409, "The interrupted node cannot be continued manually.");
          const checkpoint = structuredClone(run.checkpoint || { pending: [], nodeOutputs: {}, visits: {}, documentContext: null });
          checkpoint.pending = (checkpoint.pending || []).filter((item: any, index: number) => !(index === 0 && item.nodeId === run.current_node_id));
          checkpoint.nodeOutputs = { ...(checkpoint.nodeOutputs || {}), [run.current_node_id]: body.assumedOutput };
          const outgoing = workflow.graph.edges.filter((edge: any) => edge.source === run.current_node_id).map((edge: any) => ({ nodeId: edge.target, fromEdge: edge }));
          checkpoint.pending.unshift(...outgoing);
          patch = { status: "queued", checkpoint, stop_reason: "Operator confirmed the external action completed and supplied its output.", finished_at: null };
        }
        const { data, error } = await admin.from("workflow_runs").update({ ...patch, current_node_id: null, current_operation_id: null, current_side_effect_class: null, updated_at: new Date().toISOString() }).eq("organization_id", principal.orgId).eq("id", run.id).eq("status", "manual_review").select("id").maybeSingle();
        if (error) throw error;
        if (!data) throw new HttpError(409, "Run status changed; refresh and retry.");
        return json({ ok: true, runId: run.id, status: patch.status });
      }
      if (action === "signal") {
        if (!principal.isAdmin && !principal.keyId) throw new HttpError(403, "Admin or workflow API-key permission is required.");
        const signalName = String(body.signalName || "");
        if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(signalName)) throw new HttpError(400, "Invalid workflow signal name.");
        validateSerializableData(body.payload ?? null, "Workflow signal payload", 256 * 1024);
        const { data: signalId, error: signalError } = await admin.rpc("signal_workflow_run", { p_run_id: run.id, p_organization_id: principal.orgId, p_signal_name: signalName, p_payload_ciphertext: await encrypt(body.payload ?? null) });
        if (signalError?.code === "P0001") throw new HttpError(409, signalError.message);
        if (signalError) throw signalError;
        return json({ ok: true, runId: run.id, signalId, status: "queued" }, 202);
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
