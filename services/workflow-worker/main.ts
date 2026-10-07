import { adminClient } from "../../supabase/functions/_shared/workflowAccess.ts";
import { collectSecrets, decryptForOrganization, encryptForOrganization, hash, hmac, redact, sanitizeOutput } from "../../supabase/functions/_shared/workflowSecurity.ts";
import { executeWorkflow, type ParallelBranchResult } from "../../supabase/functions/_shared/workflowExecutor.ts";
import { runRequest } from "../../supabase/functions/_shared/workflowHttp.ts";
import { waitPolicy } from "../../supabase/functions/_shared/workflowInteraction.ts";
import { maintainInteractions, maintainRetention } from "./interactions.ts";
import { executeJavascript } from "./sandbox.ts";

const admin = adminClient();
const internalSecret = Deno.env.get("WORKFLOW_INTERNAL_SECRET");
const functionsUrl = Deno.env.get("WORKFLOW_FUNCTIONS_URL") || `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
if (!internalSecret || !anonKey) throw new Error("Configure WORKFLOW_INTERNAL_SECRET and SUPABASE_ANON_KEY.");
// High-capacity deployments may use more slots, but horizontal replicas are
// normally safer than placing hundreds of long-lived LLM calls in one process.
const slots = Math.max(1, Math.min(256, Math.floor(Number(Deno.env.get("WORKFLOW_WORKER_CONCURRENCY")) || 4)));
const active = new Set<Promise<void>>();
const workerId = crypto.randomUUID();
const workerStartedAt = new Date().toISOString();
let stopping = false;
Deno.addSignalListener("SIGTERM", () => { stopping = true; });
Deno.addSignalListener("SIGINT", () => { stopping = true; });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function executeRun(run: any) {
  const decryptOrganization = (value: string) => decryptForOrganization(admin, run.organization_id, value);
  const encryptOrganization = (value: unknown) => encryptForOrganization(admin, run.organization_id, value);
  const abort = new AbortController();
  let timedOut = false;
  let cancelled = false;
  let leaseLost = false;
  let secrets: string[] = [];
  let sequence = 0;
  let stepId: string | null = null;
  let pendingStep: { status: string; output: unknown; finalOutput: unknown; error: unknown; durationMs: number; attemptCount: number; nodeType: string; renderAs?: string } | null = null;
  let terminalCommitted = false;
  let latestRunState: Record<string, unknown> = {};
  let stateDirty = false;
  let pendingChangedKeys: string[] = [];
  let stateVersion = Number(run.state_version ?? 0);
  let currentNode: string | null = null;
  let pendingSignals: Array<{ id: string; name: string; ciphertext: string; receivedAt: string }> = Array.isArray(run.pending_signals) ? structuredClone(run.pending_signals) : [];
  let consumedSignalIds: string[] = [];
  const parallelBranchResults: Record<string, ParallelBranchResult> = {};
  const segmentStarted = Date.now();
  const elapsed = () => Number(run.execution_ms ?? 0) + Date.now() - segmentStarted;
  const leaseQuery = () => admin.from("workflow_runs").update({ updated_at: new Date().toISOString() }).eq("id", run.id).eq("organization_id", run.organization_id).eq("lease_token", run.lease_token).eq("status", "running").gt("lease_expires_at", new Date().toISOString());
  async function patch(values: Record<string, unknown>) {
    const { data, error } = await admin.from("workflow_runs").update({ ...values, updated_at: new Date().toISOString() }).eq("id", run.id).eq("organization_id", run.organization_id).eq("lease_token", run.lease_token).eq("status", "running").gt("lease_expires_at", new Date().toISOString()).select("id").maybeSingle();
    if (error) throw error;
    if (!data) { leaseLost = true; abort.abort(); throw new Error("Workflow lease was lost."); }
  }
  let heartbeatBusy = false;
  const heartbeat = setInterval(async () => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    try {
      const { data, error } = await leaseQuery().select("cancel_requested").maybeSingle();
      if (error) throw error;
      if (!data) { leaseLost = true; abort.abort(); return; }
      if (data.cancel_requested) { cancelled = true; abort.abort(); return; }
      await patch({ lease_expires_at: new Date(Date.now() + 60_000).toISOString(), execution_ms: elapsed() });
    } catch { leaseLost = true; abort.abort(); }
    finally { heartbeatBusy = false; }
  }, 5000);
  // Null means no whole-run deadline. Honor deadlines on already accepted legacy runs.
  const deadline = run.timeout_seconds == null ? undefined : setTimeout(() => { timedOut = true; abort.abort(); },
    Math.max(1, run.timeout_seconds * 1000 - Number(run.execution_ms ?? 0)));
  try {
    const { workflow, llm } = await decryptOrganization(run.snapshot.ciphertext);
    const { data: durableBranches, error: durableBranchError } = await admin.from("workflow_parallel_branches").select("activation_id,branch_id,status,result_ciphertext").eq("organization_id", run.organization_id).eq("run_id", run.id).in("status", ["succeeded", "failed"]);
    if (durableBranchError) throw durableBranchError;
    for (const branch of durableBranches ?? []) if (branch.result_ciphertext) parallelBranchResults[`${branch.activation_id}:${branch.branch_id}`] = await decryptOrganization(branch.result_ciphertext) as ParallelBranchResult;
    const initialRunState = run.run_state_ciphertext ? await decryptOrganization(run.run_state_ciphertext) : {};
    if (!initialRunState || typeof initialRunState !== "object" || Array.isArray(initialRunState)) throw new Error("Encrypted workflow run state is invalid.");
    latestRunState = initialRunState as Record<string, unknown>;
    const signals = await Promise.all(pendingSignals.map(async (signal) => ({
      id: String(signal.id), name: String(signal.name), receivedAt: String(signal.receivedAt), payload: await decryptOrganization(String(signal.ciphertext)),
    })));
    const sensitiveStatePaths: string[] = (workflow.state?.fields ?? []).filter((field: any) => field.sensitive).map((field: any) => String(field.key));
    const sensitiveStateStrings = () => sensitiveStatePaths.flatMap((path) => {
      let value: unknown = latestRunState;
      for (const part of path.split(".")) value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
      if (typeof value === "string") return [value];
      return value === undefined ? [] : [JSON.stringify(value)];
    }).filter((value) => value.length >= 6);
    secrets = collectSecrets(llm);
    const { data: last, error: stepError } = await admin.from("workflow_run_steps").select("sequence").eq("organization_id", run.organization_id).eq("run_id", run.id).order("sequence", { ascending: false }).limit(1).maybeSingle();
    if (stepError) throw stepError;
    sequence = last?.sequence ?? 0;
    const input = run.input;
    const result = await executeWorkflow(workflow.graph, {
      runId: run.id, triggerSource: run.trigger_source,
      workflowId: run.workflow_id, resultData: input.resultData, userMessage: input.userMessage, docText: input.docText,
      hasDocument: Boolean(input.docText || input.attachments?.length), conversationHistory: input.conversationHistory,
      organizationId: run.organization_id, orgExecutionToken: null, supabaseUrl: Deno.env.get("SUPABASE_URL")!, signal: abort.signal,
      checkpoint: run.checkpoint ?? undefined, resume: run.waiting && run.resume_answer ? { waiting: run.waiting, answer: run.resume_answer } : undefined,
      stateDefinition: workflow.state, runState: initialRunState as Record<string, unknown>,
      signals,
      parallelBranchResults,
      stopOnError: true, executeJavascript: (request) => executeJavascript(request, abort.signal),
      onStepStart: async (nodeId, value, execution) => {
        if (abort.signal.aborted) throw new DOMException("Aborted", "AbortError");
        currentNode = nodeId;
        await patch({ current_node_id: nodeId, current_operation_id: execution.operationId, current_side_effect_class: execution.sideEffectClass });
        const node = workflow.graph.nodes.find((item: any) => item.id === nodeId);
        const { data, error } = await admin.from("workflow_run_steps").insert({ organization_id: run.organization_id, run_id: run.id, sequence: ++sequence,
          node_id: nodeId, node_name: node.data.label || node.type, node_type: node.type, status: "running", input_summary: redact(value, secrets),
          state_read_keys: [...new Set([...(node.stateReads ?? []).map((read: any) => read.key), ...(node.type === "event" && node.data.eventType === "state_changed" ? [node.data.stateKey] : [])])], attempt: execution.attempt, operation_id: execution.operationId, side_effect_class: execution.sideEffectClass }).select("id").single();
        if (error) throw error;
        stepId = data.id;
      },
      onStepDone: async (step) => {
        const waiting = ["user_input", "event"].includes(step.nodeType) && step.output && typeof step.output === "object" && (step.output as any).waiting;
        const redactionSecrets = [...secrets, ...sensitiveStateStrings()];
        pendingStep = { status: step.error ? "failed" : waiting ? "waiting" : "succeeded", output: redact(step.output, redactionSecrets), finalOutput: sanitizeOutput(step.output, redactionSecrets),
          error: step.error ? redact(step.error, redactionSecrets) : null, durationMs: Math.max(0, Math.round(step.durationMs ?? 0)), attemptCount: step.attemptCount ?? 1,
          nodeType: step.nodeType, renderAs: step.renderAs };
      },
      onArtifactCreate: async (nodeId, stateKey, value) => {
        const serialized = JSON.stringify(value); const size = new TextEncoder().encode(serialized).byteLength;
        if (size > 25 * 1024 * 1024) throw new Error("Workflow artifact exceeds the 25 MB limit.");
        const sha256 = await hash(serialized);
        const { data, error } = await admin.from("workflow_run_artifacts").insert({ organization_id: run.organization_id, run_id: run.id, node_id: nodeId, state_key: stateKey,
          content_type: "application/json", size_bytes: size, sha256, ciphertext: await encryptOrganization(value) }).select("id").single();
        if (error) throw error;
        return { __workflowArtifact: true, id: data.id, contentType: "application/json", size, sha256 };
      },
      onArtifactRead: async (reference) => {
        const { data, error } = await admin.from("workflow_run_artifacts").select("ciphertext,sha256,size_bytes").eq("organization_id", run.organization_id).eq("run_id", run.id).eq("id", reference.id).maybeSingle();
        if (error) throw error;
        if (!data || data.sha256 !== reference.sha256 || data.size_bytes !== reference.size) throw new Error("Workflow artifact is missing or its metadata does not match state.");
        return await decryptOrganization(data.ciphertext);
      },
      onStateChange: async (state, changedKeys) => { latestRunState = state; stateDirty = true; pendingChangedKeys = [...new Set([...pendingChangedKeys, ...changedKeys])]; },
      onSignalConsumed: async (signalId) => {
        pendingSignals = pendingSignals.filter((signal) => signal.id !== signalId);
        consumedSignalIds.push(signalId);
      },
      onParallelBranchStart: async (activationId, branchId, nodeIds) => {
        const { error } = await admin.rpc("start_workflow_parallel_branch", { p_run_id: run.id, p_organization_id: run.organization_id, p_lease_token: run.lease_token,
          p_activation_id: activationId, p_branch_id: branchId, p_node_ids: nodeIds });
        if (error) throw error;
      },
      onParallelBranchDone: async (activationId, branch) => {
        const { error } = await admin.rpc("complete_workflow_parallel_branch", { p_run_id: run.id, p_organization_id: run.organization_id, p_lease_token: run.lease_token,
          p_activation_id: activationId, p_branch_id: branch.id, p_status: branch.status, p_result_ciphertext: await encryptOrganization(branch), p_node_ids: branch.steps.map((step) => step.nodeId) });
        if (error) throw error;
        parallelBranchResults[`${activationId}:${branch.id}`] = structuredClone(branch);
      },
      onCheckpoint: async (checkpoint) => {
        if (!stepId || !pendingStep) throw new Error("Workflow checkpoint has no completed step to commit.");
        const terminalOutput = pendingStep.nodeType === "output" && pendingStep.status === "succeeded" && checkpoint.pending.length === 0;
        const { data, error } = await admin.rpc("commit_workflow_run_node", { p_run_id: run.id, p_organization_id: run.organization_id, p_lease_token: run.lease_token,
          p_expected_state_version: stateVersion, p_checkpoint: checkpoint, p_step_id: stepId, p_step_status: pendingStep.status,
          p_step_output: pendingStep.output, p_step_error: pendingStep.error, p_step_duration_ms: pendingStep.durationMs, p_step_attempt_count: pendingStep.attemptCount,
          p_selected_routes: (checkpoint.selectedEdges ?? []).map((edge) => ({ nodeId: edge.target, edgeId: edge.id, branch: edge.sourceHandle })),
          p_changed_keys: pendingChangedKeys,
          p_pending_signals: pendingSignals,
          p_consumed_signal_ids: consumedSignalIds,
          p_state_ciphertext: stateDirty ? await encryptOrganization(latestRunState) : null,
          p_terminal_status: terminalOutput ? "succeeded" : null,
          p_final_output: terminalOutput ? pendingStep.finalOutput : null,
          p_render_as: terminalOutput ? pendingStep.renderAs ?? "auto" : null,
          p_stop_reason: terminalOutput ? `Workflow completed at output node "${currentNode}".` : null });
        if (error) throw error;
        if (terminalOutput) terminalCommitted = true;
        stateVersion = Number(data); stateDirty = false; pendingChangedKeys = []; consumedSignalIds = []; pendingStep = null;
      },
      onApiRequest: async (_nodeId, config, value, execution, state) => {
        const response = await runRequest(config, value, input.resultData, input.userMessage, abort.signal, execution as unknown as Record<string, unknown>, workflow.execution?.allowedOutboundHosts, state);
        if (!response.ok) throw Object.assign(new Error(response.error || "API node failed."), { status: response.status, retryAfterMs: response.retryAfterMs });
        return response.output;
      },
      onAgentStep: async (nodeId, config, prompt, previous) => {
        const context = config.includeDocument && config.documentDelivery !== "native_file" && input.docText
          ? { __doc_context: true, ...(config.includeResultData ? { result: input.resultData } : {}), docText: input.docText }
          : config.includeResultData ? input.resultData : undefined;
        const { _acc: ignored, ...rest } = previous && typeof previous === "object" && !Array.isArray(previous) ? previous as Record<string, unknown> : {};
        void ignored;
        const timeoutSeconds = Math.max(1, Math.min(600, Number(config.timeoutSeconds) || 120));
        let response: Response;
        try {
          response = await fetch(`${functionsUrl}/chat-with-result`, { method: "POST", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutSeconds * 1000)]),
          headers: { "Content-Type": "application/json", apikey: anonKey!, "x-organization-id": run.organization_id,
            "x-workflow-run-id": run.id, "x-workflow-lease": run.lease_token, "x-workflow-signature": await hmac(internalSecret!, `${run.id}.${run.lease_token}`) },
          body: JSON.stringify({ messages: [{ role: "user", content: prompt }], workflowId: run.workflow_id, nodeId, mode: "run", result: context,
            inputData: previous && typeof previous === "object" && !Array.isArray(previous) ? rest : previous,
            attachments: config.includeDocument && config.documentDelivery !== "text" ? input.attachments : [],
            resultContextMode: config.resultContextMode, resultChunkSize: config.resultChunkSize }) });
        } catch (error) {
          if (!abort.signal.aborted && error instanceof DOMException && error.name === "TimeoutError") throw new Error(`Agent node execution exceeded ${timeoutSeconds} seconds.`);
          throw error;
        }
        if (!response.ok || !response.body) throw Object.assign(new Error((await response.json().catch(() => ({}))).error || `Agent returned HTTP ${response.status}`), { status: response.status });
        const reader = response.body.getReader(); const decoder = new TextDecoder();
        let buffer = ""; let text = ""; let completed = false;
        function consume(line: string) {
          if (!line.startsWith("data:")) return;
          let event: any; try { event = JSON.parse(line.slice(5).trim()); } catch { return; }
          if (event.type === "error") throw new Error(event.message || "Agent failed.");
          if (event.type === "reset") text = "";
          if (event.type === "token") text += event.content || "";
          if (event.type === "done") completed = true;
        }
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n"); buffer = lines.pop() || "";
            for (const line of lines) consume(line);
          }
          consume(buffer);
          if (!completed) throw new Error("Agent stream ended before completion.");
          return text;
        } finally { await reader.cancel().catch(() => {}); }
      },
    });
    if (leaseLost) return;
    if (terminalCommitted) return;
    if (result.aborted || abort.signal.aborted) throw new DOMException("Execution interrupted", "AbortError");
    if (result.error) throw new Error(result.error);
    if (result.waiting) {
      await patch({ status: "waiting_for_input", execution_ms: elapsed(), waiting: { ...result.waiting, policy: waitPolicy(workflow.graph.nodes.find((node: any) => node.id === result.waiting!.nodeId).data), question: sanitizeOutput(result.waiting.question, secrets), options: sanitizeOutput(result.waiting.options, secrets) }, resume_answer: null, stop_reason: redact(result.stopReason, secrets), lease_token: null, lease_expires_at: null });
      return;
    }
    if (result.eventWait) {
      await patch({ status: "waiting_for_event", execution_ms: elapsed(), event_wait: result.eventWait, stop_reason: redact(result.stopReason, secrets), lease_token: null, lease_expires_at: null });
      return;
    }
    const output = [...result.results].reverse().find((step) => step.nodeType === "output");
    const endedAtOutput = result.results.at(-1)?.nodeType === "output";
    // Final output is private run data; the API applies redaction before returning it.
    await patch({ status: endedAtOutput ? "succeeded" : "incomplete", output: sanitizeOutput(output?.output ?? null, secrets), render_as: output?.renderAs ?? "auto",
      stop_reason: redact(result.stopReason, secrets), current_node_id: null, waiting: null, event_wait: null, resume_answer: null,
      execution_ms: elapsed(), finished_at: new Date().toISOString(), lease_token: null, lease_expires_at: null });
  } catch (error) {
    if (leaseLost) return;
    const status = timedOut ? "timed_out" : cancelled ? "cancelled" : "failed";
    const reason = timedOut ? "Workflow execution deadline exceeded." : cancelled ? "Cancelled by caller." : error instanceof Error ? error.message : String(error);
    try {
      if (stepId) await admin.from("workflow_run_steps").update({ status: status === "failed" ? "failed" : status, error: redact(reason, secrets), finished_at: new Date().toISOString() }).eq("id", stepId).eq("organization_id", run.organization_id).eq("status", "running");
      await patch({ status, execution_ms: elapsed(), failed_node_id: status === "cancelled" ? null : currentNode, stop_reason: redact(reason, secrets), finished_at: new Date().toISOString(), lease_token: null, lease_expires_at: null });
    } catch (persistError) { console.error(JSON.stringify({ event: "workflow_finalize_failed", runId: run.id, organizationId: run.organization_id, error: String(persistError) })); }
  } finally { clearInterval(heartbeat); clearTimeout(deadline); }
}

// This scheduler continues even when all graph execution slots are occupied.
let maintenanceBusy = false;
async function maintenance() {
  if (maintenanceBusy || stopping) return;
  maintenanceBusy = true;
  try { await maintainInteractions(admin); await maintainRetention(admin); }
  catch (error) { console.error(JSON.stringify({ event: "workflow_maintenance_failed", workerId, error: String(error) })); }
  finally { maintenanceBusy = false; }
}
const maintenanceTimer = setInterval(() => { void maintenance(); }, 1000);
void maintenance();
let heartbeatBusyGlobal = false;
async function workerHeartbeat() {
  if (heartbeatBusyGlobal) return;
  heartbeatBusyGlobal = true;
  try { await admin.from("workflow_worker_heartbeats").upsert({ worker_id: workerId, active_runs: active.size, capacity: slots, version: "1", started_at: workerStartedAt, last_seen_at: new Date().toISOString() }); }
  catch (error) { console.error(JSON.stringify({ event: "workflow_worker_heartbeat_failed", workerId, error: String(error) })); }
  finally { heartbeatBusyGlobal = false; }
}
const workerHeartbeatTimer = setInterval(() => { void workerHeartbeat(); }, 5000);
void workerHeartbeat();
console.info(JSON.stringify({ event: "workflow_worker_ready", workerId, capacity: slots }));
while (!stopping) {
  if (active.size >= slots) { await Promise.race(active); continue; }
  const { data, error } = await admin.rpc("claim_workflow_run", {});
  if (error) { console.error(JSON.stringify({ event: "workflow_claim_failed", workerId, error: error.message })); await sleep(2000); continue; }
  const run = data?.[0];
  if (!run) { await sleep(1000); continue; }
  const task = executeRun(run).catch((error) => console.error(JSON.stringify({ event: "workflow_worker_error", workerId, runId: run.id, organizationId: run.organization_id, error: String(error) }))).finally(() => active.delete(task));
  active.add(task);
}
clearInterval(maintenanceTimer);
clearInterval(workerHeartbeatTimer);
await Promise.allSettled(active);
while (maintenanceBusy) await sleep(100);
try { await admin.from("workflow_worker_heartbeats").delete().eq("worker_id", workerId); } catch { /* stale heartbeats expire from health views */ }
