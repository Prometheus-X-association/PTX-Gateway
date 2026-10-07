import { adminClient, type Principal, loadWorkflow, checkWorkflowAccess } from "./workflowAccess.ts";
import { interactionUrl, validateInteractionSettings } from "./workflowInteraction.ts";
import { compileWorkflow, encrypt, hash, HttpError, object, redact, WORKFLOW_COMPILER_VERSION } from "./workflowSecurity.ts";

export const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-organization-id, idempotency-key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
export const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
export async function readBody(request: Request, maxBytes = 16 * 1024 * 1024) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); throw new HttpError(413, "Workflow request exceeds the size limit."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
export async function createRun(admin: ReturnType<typeof adminClient>, principal: Principal, body: Record<string, any>, source: "api" | "dashboard" | "webhook", idempotencyKey?: string, webhook?: { id: string; deliveryId: string }) {
  const workflowId = String(body.workflowId || "");
  checkWorkflowAccess(principal, workflowId);
  const { workflow: savedWorkflow, llm } = await loadWorkflow(admin, principal.orgId, workflowId);
  const workflow = compileWorkflow(savedWorkflow);
  const execution = object(workflow.execution);
  // The organization chat switch controls dashboard execution, not external triggers.
  if (source === "dashboard" && !llm.enabled) throw new HttpError(403, "Result-page agent chat is disabled.");
  if (source === "api" && !execution.apiEnabled) throw new HttpError(403, "API execution is disabled for this workflow.");
  if (source === "webhook" && !execution.webhookEnabled) throw new HttpError(403, "Webhook execution is disabled for this workflow.");
  if (source === "dashboard" && !execution.backendEnabled) throw new HttpError(403, "Backend execution is disabled for this workflow.");
  if (principal.publicToken && (source !== "dashboard" || !body.targetResourceId || !workflow.targetResources?.includes(body.targetResourceId))) throw new HttpError(403, "Workflow is not available for this result page.");
  validateInteractionSettings(workflow);
  if (idempotencyKey && idempotencyKey.length > 200) throw new HttpError(400, "Idempotency key is too long.");
  const trigger = workflow.graph.nodes.find((node: any) => node.type === "trigger");
  const input = { resultData: Object.hasOwn(body, "input") ? body.input : body.resultData ?? null, userMessage: body.userMessage ?? trigger.data.defaultPrompt ?? "Run workflow", docText: body.docText ?? null,
    attachments: body.attachments ?? [], conversationHistory: body.conversationHistory ?? "" };
  if (typeof input.userMessage !== "string" || input.userMessage.length > 100_000 || (input.docText !== null && (typeof input.docText !== "string" || input.docText.length > 2_000_000)) || typeof input.conversationHistory !== "string" || input.conversationHistory.length > 100_000) throw new HttpError(400, "Invalid workflow text input.");
  if (!Array.isArray(input.attachments) || input.attachments.length > 10) throw new HttpError(400, "At most ten attachments are allowed.");
  for (const file of input.attachments) if (typeof file.name !== "string" || file.name.length > 255 || !/\.(pdf|txt|md|markdown|csv|json|jsonl|xml|html?|ya?ml|doc|docx|xls|xlsx)$/i.test(file.name) || typeof file.mimeType !== "string" || file.mimeType.length > 255 || !Number.isInteger(file.size) || file.size < 0 || file.size > 10 * 1024 * 1024 || typeof file.base64 !== "string" || !file.base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64) || Math.floor(file.base64.length * 0.75) > 10 * 1024 * 1024) throw new HttpError(400, "Invalid workflow attachment.");
  if ((trigger.data.inputSources ?? ["result", "document"]).length === 0) throw new HttpError(400, "Trigger has no input source.");
  const requestHash = await hash(JSON.stringify(input));
  if (idempotencyKey) {
    const { data: existing, error } = await admin.from("workflow_runs").select("id,status,request_hash,organization_id,interaction_expires_at").eq("organization_id", principal.orgId).eq("caller_id", principal.callerId).eq("workflow_id", workflowId).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (error) throw error;
    if (existing) {
      if (existing.request_hash !== requestHash) throw new HttpError(409, "Idempotency key was already used with different input.");
      return { runId: existing.id, status: existing.status, interactionUrl: await interactionUrl(existing), duplicate: true };
    }
  }
  const { revisionHistory: _revisionHistory, ...executionWorkflow } = workflow;
  const { data: run, error } = await admin.from("workflow_runs").insert({ organization_id: principal.orgId, workflow_id: workflowId, workflow_name: workflow.name,
    caller_id: principal.callerId, caller_user_id: principal.userId ?? null, trigger_source: source, webhook_id: webhook?.id ?? null, delivery_id: webhook?.deliveryId ?? null,
    idempotency_key: idempotencyKey ?? null, request_hash: requestHash, input,
    snapshot: { compilerVersion: WORKFLOW_COMPILER_VERSION, ciphertext: await encrypt({ compilerVersion: WORKFLOW_COMPILER_VERSION, workflow: executionWorkflow, llm: { ...llm, workflows: [executionWorkflow] } }) },
    run_state_ciphertext: await encrypt({}), state_version: 0,
    interaction_expires_at: new Date(Date.now() + Number(execution.notifications?.interactionTtlHours ?? 168) * 3600_000).toISOString(),
    timeout_seconds: null }).select("id,status,organization_id,interaction_expires_at").single();
  if (error?.code === "23505" && idempotencyKey) {
    const { data: existing } = await admin.from("workflow_runs").select("id,status,request_hash,organization_id,interaction_expires_at").eq("organization_id", principal.orgId).eq("caller_id", principal.callerId).eq("workflow_id", workflowId).eq("idempotency_key", idempotencyKey).single();
    if (existing?.request_hash === requestHash) return { runId: existing.id, status: existing.status, interactionUrl: await interactionUrl(existing), duplicate: true };
    throw new HttpError(409, "Idempotency key conflict.");
  }
  if (error?.code === "P0001" && String(error.message || "").startsWith("Workflow quota exceeded:")) throw new HttpError(429, error.message);
  if (error) throw error;
  return { runId: run.id, status: run.status, interactionUrl: await interactionUrl(run) };
}
export function publicRun(run: any) {
  return { id: run.id, organizationId: run.organization_id, workflowId: run.workflow_id, workflowName: run.workflow_name, triggerSource: run.trigger_source,
    webhookId: run.webhook_id || (run.trigger_source === "webhook" ? run.caller_id.replace(/^webhook:/, "") : null), deliveryId: run.delivery_id, status: run.status, currentNodeId: run.current_node_id, lastNodeId: run.last_node_id, failedNodeId: run.failed_node_id,
    stopReason: run.stop_reason, output: run.output, renderAs: run.render_as,
    waiting: run.waiting ? { nodeId: run.waiting.nodeId, question: redact(run.waiting.question), inputType: run.waiting.inputType, options: run.waiting.options } : null,
    eventWait: run.event_wait ? { nodeId: run.event_wait.nodeId, eventType: run.event_wait.eventType, signalName: run.event_wait.signalName } : null,
    waitingVersion: run.waiting_version, waitingExpiresAt: run.waiting_expires_at, reminderCount: run.reminder_count, reminderLimit: run.reminder_limit,
    executionMs: run.execution_ms, createdAt: run.created_at, startedAt: run.started_at, finishedAt: run.finished_at, updatedAt: run.updated_at };
}
