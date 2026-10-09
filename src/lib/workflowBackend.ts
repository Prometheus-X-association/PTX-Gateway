import { supabase } from "@/integrations/supabase/client";
import type { BrowserExecutorContext } from "@/lib/workflowExecutor";
import type { WorkflowConfig, WorkflowEventWait, WorkflowStepResult, WorkflowWaitingState } from "@/types/workflow";
import type { WorkflowResult } from "../../supabase/functions/_shared/workflowExecutor.ts";

export interface BackendWorkflowRun {
  id: string; workflowId: string; workflowName: string; status: string; triggerSource: string;
  currentNodeId?: string; lastNodeId?: string; failedNodeId?: string; stopReason?: string;
  interactionUrl?: string; waitingVersion?: string; waitingExpiresAt?: string; reminderCount?: number; reminderLimit?: number;
  output?: unknown; renderAs?: string; createdAt: string; startedAt?: string; finishedAt?: string;
  webhookId?: string; deliveryId?: string;
  waiting?: { nodeId: string; question: string; inputType: string; options?: string[] };
  eventWait?: WorkflowEventWait;
}
export interface BackendWorkflowStep {
  id: string; sequence: number; node_id: string; node_name: string; node_type: string;
  status: string; duration_ms?: number; error?: string; input_summary?: unknown; output_summary?: unknown; selected_routes?: unknown;
}
export interface WorkflowBackendHealth { workers: Array<{ workerId: string; activeRuns: number; capacity: number; version: string; lastSeenAt: string }>; queueDepth: number; oldestQueuedAt?: string; runningRuns: number; waitingRuns: number; manualReviewRuns: number; expiredLeases: number; notificationBacklog: number }
export interface WorkflowBackendState {
  state: Record<string, unknown>;
  stateVersion: number;
  sensitiveKeys: string[];
  events: Array<{ state_version: number; node_id: string; changed_keys: string[]; created_at: string }>;
  signalEvents: Array<{ id: string; signal_name: string; received_at: string; consumed_at?: string; consumed_by_node_id?: string }>;
}
let memoryPublicSessionId: string | undefined;

export async function workflowBackend(action: string, organizationId: string | undefined, body: Record<string, unknown> = {}, executionToken?: string | null) {
  let publicSessionId: string | undefined;
  if (executionToken) {
    publicSessionId = memoryPublicSessionId || storedBackendRun("ptx-workflow-public-session") || undefined;
    if (!publicSessionId) { publicSessionId = `${crypto.randomUUID()}${crypto.randomUUID()}`; storeRun("ptx-workflow-public-session", publicSessionId); }
    memoryPublicSessionId = publicSessionId;
  }
  const { data, error } = await supabase.functions.invoke("workflow-runs", {
    headers: organizationId ? { "x-organization-id": organizationId } : {},
    body: { ...body, action, ...(executionToken ? { org_execution_token: executionToken, workflow_session_id: publicSessionId } : {}) },
  });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message || "Workflow backend request failed.");
  }
  if (!data?.ok) throw new Error(data?.error || "Workflow backend request failed.");
  return data;
}

export const backendRunStorageKey = (organizationId: string | null | undefined, workflowId: string, contextId?: string | null) => `ptx-workflow-run:${organizationId}:${workflowId}:${contextId || "result"}`;
export function storedBackendRun(key: string) { try { return sessionStorage.getItem(key); } catch { return null; } }
function storeRun(key: string, value: string | null) { try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch { /* optional reconnection */ } }
const isMissingRunError = (error: unknown) => error instanceof Error && /run was not found/i.test(error.message);

export async function executeBackendWorkflow(config: WorkflowConfig, ctx: BrowserExecutorContext, attachments: unknown[], targetResourceId?: string | null, contextId?: string | null, studioChatId?: string): Promise<WorkflowResult> {
  const call = (action: string, body: Record<string, unknown>) => workflowBackend(action, ctx.organizationId ?? undefined, body, ctx.orgExecutionToken);
  const key = backendRunStorageKey(ctx.organizationId, config.id, contextId);
  const resumeRunId = (ctx.resume?.waiting as WorkflowWaitingState & { runId?: string })?.runId;
  const storedRunId = storedBackendRun(key);
  let runId = resumeRunId || storedRunId || undefined;
  // Session storage can outlive database resets, retention cleanup, or a
  // replaced workflow deployment. Validate a reconnect target once and start
  // cleanly when that durable run no longer exists.
  if (!resumeRunId && storedRunId) {
    try { await call("get", { runId: storedRunId }); }
    catch (error) {
      if (!isMissingRunError(error)) throw error;
      storeRun(key, null);
      runId = undefined;
    }
  }
  if (!runId) {
    const started = await call("start", { source: "dashboard", workflowId: config.id, input: ctx.resultData, userMessage: ctx.userMessage, docText: ctx.docText,
      conversationHistory: ctx.conversationHistory, attachments, targetResourceId, studio_chat_id: studioChatId });
    runId = started.runId;
    storeRun(key, runId!);
  }
  if (ctx.resume) {
    if (!ctx.resume.waiting.waitingVersion) throw new Error("The workflow question version is missing. Refresh the run before answering.");
    await call("resume", { runId, nodeId: ctx.resume.waiting.nodeId, waitingVersion: ctx.resume.waiting.waitingVersion, answer: ctx.resume.answer });
  }
  const results: WorkflowStepResult[] = [];
  let after = 0;
  let cancellation: Promise<unknown> | undefined;
  const cancel = () => { cancellation ??= call("cancel", { runId }); void cancellation.catch(() => {}); };
  ctx.signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (ctx.signal?.aborted) {
        cancel();
        try { await cancellation; } catch {
          const { run } = await call("get", { runId });
          if (["queued", "running", "waiting_for_input", "waiting_for_event"].includes(run.status)) throw new Error("Cancellation could not be confirmed. The backend run may still be active.");
        }
        storeRun(key, null);
        return { results, aborted: true, stopReason: "Cancellation requested.", state: {} };
      }
      const { run } = await call("get", { runId }) as { run: BackendWorkflowRun };
      let page: BackendWorkflowStep[];
      do {
        const trace = await call("steps", { runId, after });
        page = trace.steps;
        for (const step of page) {
          if (step.status === "running") break;
          const converted: WorkflowStepResult = { nodeId: step.node_id, nodeType: step.node_type as WorkflowStepResult["nodeType"], input: step.input_summary,
            output: step.output_summary, error: step.error, durationMs: step.duration_ms };
          results.push(converted); after = step.sequence;
          if (!converted.error) await ctx.onStepDone(converted);
        }
      } while (page.length === 200 && page.at(-1)?.sequence === after);
      if (run.status === "waiting_for_input" && run.waiting) return { results, aborted: false, stopReason: run.stopReason, state: {},
        waiting: { ...run.waiting, runId, workflowId: config.id, waitingVersion: run.waitingVersion, answerKey: "answer", input: null, nodeOutputs: {} } as WorkflowWaitingState };
      if (run.status === "waiting_for_event" && run.eventWait) return { results, aborted: false, stopReason: run.stopReason, state: {}, eventWait: run.eventWait };
      if (!["queued", "running"].includes(run.status)) {
        storeRun(key, null);
        if (run.status === "succeeded") results.push({ nodeId: run.lastNodeId || "backend-output", nodeType: "output", output: run.output, renderAs: run.renderAs as WorkflowStepResult["renderAs"] });
        return { results, aborted: run.status === "cancelled", error: run.status === "succeeded" || run.status === "cancelled" ? undefined : run.stopReason || `Workflow ${run.status}`, stopReason: run.stopReason, state: {} };
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
  } catch (error) {
    if (isMissingRunError(error)) storeRun(key, null);
    throw error;
  } finally { ctx.signal?.removeEventListener("abort", cancel); }
}
