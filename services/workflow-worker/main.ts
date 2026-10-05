import { adminClient } from "../../supabase/functions/_shared/workflowAccess.ts";
import { collectSecrets, decrypt, hmac, redact, sanitizeOutput } from "../../supabase/functions/_shared/workflowSecurity.ts";
import { executeWorkflow } from "../../supabase/functions/_shared/workflowExecutor.ts";
import { runRequest } from "../../supabase/functions/_shared/workflowHttp.ts";
import { executeJavascript } from "./sandbox.ts";

const admin = adminClient();
const internalSecret = Deno.env.get("WORKFLOW_INTERNAL_SECRET");
const functionsUrl = Deno.env.get("WORKFLOW_FUNCTIONS_URL") || `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
if (!internalSecret || !anonKey || !Deno.env.get("WORKFLOW_SECRETS_KEY")) throw new Error("Configure WORKFLOW_INTERNAL_SECRET, WORKFLOW_SECRETS_KEY and SUPABASE_ANON_KEY.");
const slots = Math.max(1, Math.min(32, Math.floor(Number(Deno.env.get("WORKFLOW_WORKER_CONCURRENCY")) || 4)));
const orgLimit = Math.max(1, Math.min(64, Math.floor(Number(Deno.env.get("WORKFLOW_ORGANIZATION_CONCURRENCY")) || 8)));
const active = new Set<Promise<void>>();
let stopping = false;
Deno.addSignalListener("SIGTERM", () => { stopping = true; });
Deno.addSignalListener("SIGINT", () => { stopping = true; });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function executeRun(run: any) {
  const abort = new AbortController();
  let timedOut = false;
  let cancelled = false;
  let leaseLost = false;
  let secrets: string[] = [];
  let sequence = 0;
  let stepId: string | null = null;
  let currentNode: string | null = null;
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
  const remaining = Math.max(1, run.timeout_seconds * 1000 - Number(run.execution_ms ?? 0));
  const deadline = setTimeout(() => { timedOut = true; abort.abort(); }, remaining);
  try {
    const { workflow, llm } = await decrypt(run.snapshot.ciphertext);
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
      stopOnError: true, executeJavascript: (request) => executeJavascript(request, abort.signal),
      onStepStart: async (nodeId, value) => {
        if (abort.signal.aborted) throw new DOMException("Aborted", "AbortError");
        currentNode = nodeId;
        await patch({ current_node_id: nodeId });
        const node = workflow.graph.nodes.find((item: any) => item.id === nodeId);
        const { data, error } = await admin.from("workflow_run_steps").insert({ organization_id: run.organization_id, run_id: run.id, sequence: ++sequence,
          node_id: nodeId, node_name: node.data.label || node.type, node_type: node.type, status: "running", input_summary: redact(value, secrets) }).select("id").single();
        if (error) throw error;
        stepId = data.id;
      },
      onStepDone: async (step) => {
        await patch({ last_node_id: step.nodeId, ...(step.error ? { failed_node_id: step.nodeId } : {}) });
        const waiting = step.nodeType === "user_input" && step.output && typeof step.output === "object" && (step.output as any).waiting;
        const { error } = await admin.from("workflow_run_steps").update({ status: step.error ? "failed" : waiting ? "waiting" : "succeeded", output_summary: redact(step.output, secrets),
          error: step.error ? redact(step.error, secrets) : null, duration_ms: step.durationMs, finished_at: new Date().toISOString() }).eq("id", stepId).eq("organization_id", run.organization_id);
        if (error) throw error;
      },
      onCheckpoint: async (checkpoint) => {
        await patch({ checkpoint });
        const { error } = await admin.from("workflow_run_steps").update({ selected_routes: (checkpoint.selectedEdges ?? []).map((edge) => ({ nodeId: edge.target, edgeId: edge.id, branch: edge.sourceHandle })) }).eq("id", stepId).eq("organization_id", run.organization_id);
        if (error) throw error;
      },
      onApiRequest: async (_nodeId, config, value) => {
        const response = await runRequest(config, value, input.resultData, input.userMessage, abort.signal);
        if (!response.ok) throw new Error(response.error || "API node failed.");
        return response.output;
      },
      onAgentStep: async (nodeId, config, prompt, previous) => {
        const context = config.includeDocument && config.documentDelivery !== "native_file" && input.docText
          ? { __doc_context: true, ...(config.includeResultData ? { result: input.resultData } : {}), docText: input.docText }
          : config.includeResultData ? input.resultData : undefined;
        const { _acc: ignored, ...rest } = previous && typeof previous === "object" && !Array.isArray(previous) ? previous as Record<string, unknown> : {};
        void ignored;
        const response = await fetch(`${functionsUrl}/chat-with-result`, { method: "POST", signal: abort.signal,
          headers: { "Content-Type": "application/json", apikey: anonKey!, "x-organization-id": run.organization_id,
            "x-workflow-run-id": run.id, "x-workflow-lease": run.lease_token, "x-workflow-signature": await hmac(internalSecret!, `${run.id}.${run.lease_token}`) },
          body: JSON.stringify({ messages: [{ role: "user", content: prompt }], workflowId: run.workflow_id, nodeId, mode: "run", result: context,
            inputData: previous && typeof previous === "object" && !Array.isArray(previous) ? rest : previous,
            attachments: config.includeDocument && config.documentDelivery !== "text" ? input.attachments : [],
            resultContextMode: config.resultContextMode, resultChunkSize: config.resultChunkSize }) });
        if (!response.ok || !response.body) throw new Error((await response.json().catch(() => ({}))).error || `Agent returned HTTP ${response.status}`);
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
    if (result.aborted || abort.signal.aborted) throw new DOMException("Execution interrupted", "AbortError");
    if (result.error) throw new Error(result.error);
    if (result.waiting) {
      await patch({ status: "waiting_for_input", execution_ms: elapsed(), waiting: { ...result.waiting, question: sanitizeOutput(result.waiting.question, secrets), options: sanitizeOutput(result.waiting.options, secrets) }, resume_answer: null, stop_reason: redact(result.stopReason, secrets), lease_token: null, lease_expires_at: null });
      return;
    }
    const output = [...result.results].reverse().find((step) => step.nodeType === "output");
    const endedAtOutput = result.results.at(-1)?.nodeType === "output";
    // Final output is private run data; the API applies redaction before returning it.
    await patch({ status: endedAtOutput ? "succeeded" : "incomplete", output: sanitizeOutput(output?.output ?? null, secrets), render_as: output?.renderAs ?? "auto",
      stop_reason: redact(result.stopReason, secrets), current_node_id: null, waiting: null, resume_answer: null,
      execution_ms: elapsed(), finished_at: new Date().toISOString(), lease_token: null, lease_expires_at: null });
  } catch (error) {
    if (leaseLost) return;
    const status = timedOut ? "timed_out" : cancelled ? "cancelled" : "failed";
    const reason = timedOut ? "Workflow execution deadline exceeded." : cancelled ? "Cancelled by caller." : error instanceof Error ? error.message : String(error);
    try {
      if (stepId) await admin.from("workflow_run_steps").update({ status: status === "failed" ? "failed" : status, error: redact(reason, secrets), finished_at: new Date().toISOString() }).eq("id", stepId).eq("organization_id", run.organization_id).eq("status", "running");
      await patch({ status, execution_ms: elapsed(), failed_node_id: status === "cancelled" ? null : currentNode, stop_reason: redact(reason, secrets), finished_at: new Date().toISOString(), lease_token: null, lease_expires_at: null });
    } catch (persistError) { console.error("Could not finalize workflow run", run.id, String(persistError)); }
  } finally { clearInterval(heartbeat); clearTimeout(deadline); }
}

console.info(`Workflow worker ready (${slots} concurrent runs).`);
while (!stopping) {
  if (active.size >= slots) { await Promise.race(active); continue; }
  const { data, error } = await admin.rpc("claim_workflow_run", { p_organization_limit: orgLimit });
  if (error) { console.error("Workflow claim failed", error.message); await sleep(2000); continue; }
  const run = data?.[0];
  if (!run) { await sleep(1000); continue; }
  const task = executeRun(run).catch((error) => console.error("Workflow worker error", run.id, String(error))).finally(() => active.delete(task));
  active.add(task);
}
await Promise.allSettled(active);
