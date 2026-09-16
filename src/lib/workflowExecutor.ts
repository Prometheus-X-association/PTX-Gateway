import type { AgentWorkflow, WorkflowNode, WorkflowStepResult, OutputNodeData, WorkflowEdge } from "@/types/workflow";
import type { AgentNodeData, PluginNodeData, ConditionNodeData, TriggerNodeData } from "@/types/workflow";
import { executeSandboxedJavascript } from "@/lib/workflowSandbox";

export interface InlineAgentConfig {
  systemPrompt: string;
  outputType: "auto" | "text" | "json" | "html" | "mixed";
  fallbackOutputType: "text" | "json" | "html" | "mixed";
  skillIds?: string[];
}

export interface ExecutorContext {
  resultData: unknown;
  docText: string | null;
  userMessage: string;
  organizationId: string | null;
  orgExecutionToken: string | null;
  supabaseUrl: string;
  onAgentStep: (
    nodeId: string,
    agentConfig: { agentId?: string; inline?: InlineAgentConfig },
    prompt: string,
    prevOutput: unknown,
  ) => Promise<string>;
  onStepDone: (step: WorkflowStepResult) => void;
  onStepStart?: (nodeId: string, input: unknown) => void;
  /** Test/debug runs can stop immediately at the first failed node. */
  stopOnError?: boolean;
  signal?: AbortSignal;
}

// ─── Sandboxed JS eval ────────────────────────────────────────────────────────

async function runPlugin(
  code: string,
  input: { result: unknown; docText: string | null; prevOutput: unknown },
  nodeOutputs: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await executeSandboxedJavascript({ operation: "plugin", code, input, nodeOutputs });
  } catch (e) {
    throw new Error(`Plugin error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function evalCondition(expression: string, prevOutput: unknown): Promise<boolean> {
  return Boolean(await executeSandboxedJavascript({ operation: "condition", code: expression, input: prevOutput }));
}

async function runTransform(code: string, prevOutput: unknown): Promise<unknown> {
  try {
    return await executeSandboxedJavascript({ operation: "transform", code, input: prevOutput });
  } catch {
    return prevOutput;
  }
}

// ─── Main executor ────────────────────────────────────────────────────────────

const MAX_NODE_VISITS = 500; // safety cap for loop iterations

export interface WorkflowResult {
  results: WorkflowStepResult[];
  /** true when the run was intentionally aborted by the user */
  aborted: boolean;
  error?: string;
  stopReason?: string;
}

const selectDataPath = (value: unknown, path?: string): unknown => {
  const normalized = path?.trim().replace(/^\$\.?/, "");
  if (!normalized) return value;
  const parts = normalized.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const parseStructuredAgentOutput = (value: string): unknown => {
  const fenced = value.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = (fenced ? fenced[1] : value).trim();
  if (!candidate.startsWith("{") && !candidate.startsWith("[")) return value;
  try { return JSON.parse(candidate); } catch { return value; }
};

export async function executeWorkflow(
  workflow: AgentWorkflow,
  ctx: ExecutorContext,
): Promise<WorkflowResult> {
  const { nodes, edges } = workflow;

  const trigger = nodes.find((n) => n.type === "trigger");
  if (!trigger) throw new Error("Workflow has no trigger node");

  const results: WorkflowStepResult[] = [];
  const outputByNodeId = new Map<string, unknown>();
  const conditionResults = new Map<string, boolean>();
  let stopReason: string | undefined;
  let fatalStop = false;
  // Track visits per node to detect infinite loops
  const nodeVisitCount = new Map<string, number>();

  /**
   * processNode — walks the graph from nodeId.
   * fromEdge: the edge that triggered this call. When provided, prevOutput is read
   * from that specific edge's source, which correctly handles back-edges in loops.
   */
  const processNode = async (nodeId: string, fromEdge?: WorkflowEdge): Promise<void> => {
    if (ctx.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (fatalStop) return;

    const visits = (nodeVisitCount.get(nodeId) ?? 0) + 1;
    if (visits > MAX_NODE_VISITS) throw new Error(`Node "${nodeId}" exceeded max iterations (${MAX_NODE_VISITS})`);
    nodeVisitCount.set(nodeId, visits);

    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // When called via a specific edge (including back-edges), use that edge's source output.
    // When called as the first node (trigger), prevOutput is null.
    const sourceOutput = fromEdge ? (outputByNodeId.get(fromEdge.source) ?? null) : null;
    const prevOutput = fromEdge ? selectDataPath(sourceOutput, fromEdge.dataPath) : null;
    ctx.onStepStart?.(node.id, prevOutput);
    const startedAt = performance.now();

    let output: unknown = prevOutput;
    let error: string | undefined;

    try {
      if (fromEdge?.dataPath?.trim() && prevOutput === undefined) {
        throw new Error(`Connection data path "${fromEdge.dataPath}" was not found in the output of node "${fromEdge.source}".`);
      }
      if (node.type === "trigger") {
        const d = node.data as TriggerNodeData;
        output = { triggerType: d.triggerType, userMessage: ctx.userMessage, data: ctx.resultData };

      } else if (node.type === "agent") {
        const d = node.data as AgentNodeData;
        const prevStr = prevOutput === null ? "" : typeof prevOutput === "string" ? prevOutput : JSON.stringify(prevOutput, null, 2);
        const rawPrompt = d.promptOverride?.trim() || ctx.userMessage;
        const prompt = rawPrompt
          .replace(/\{\{prevOutput\}\}/g, prevStr)
          // {{prevOutput.fieldName}} — inject a single field from the prevOutput object
          .replace(/\{\{prevOutput\.([^}]+)\}\}/g, (_m, key) => {
            if (prevOutput && typeof prevOutput === "object") {
              const val = (prevOutput as Record<string, unknown>)[key as string];
              return val !== undefined ? String(val) : "";
            }
            return "";
          });
        const agentConfig =
          d.mode === "inline"
            ? { inline: {
                systemPrompt: d.inlineSystemPrompt ?? "",
                outputType: d.inlineOutputType ?? "text",
                fallbackOutputType: d.inlineFallbackOutputType ?? "text",
                skillIds: d.skillIds ?? [],
              } }
            : { agentId: d.agentId };
        const agentOutput = await ctx.onAgentStep(node.id, agentConfig, prompt, d.passPrevOutput ? prevOutput : null);
        // Preserve structured responses as actual objects/arrays so downstream
        // nodes and edge data paths can address fields deterministically.
        output = parseStructuredAgentOutput(agentOutput);

      } else if (node.type === "plugin") {
        const d = node.data as PluginNodeData;
        output = await runPlugin(d.code, {
          result: ctx.resultData,
          docText: ctx.docText,
          prevOutput,
        }, Object.fromEntries(outputByNodeId));

      } else if (node.type === "condition") {
        const d = node.data as ConditionNodeData;
        if ((d.loopStart !== undefined || d.loopEnd !== undefined) && prevOutput && typeof prevOutput === "object") {
          const state = prevOutput as Record<string, unknown>;
          const allItems = Array.isArray(state.items) ? state.items : [];
          const start = d.loopStart ?? 0;
          const end = d.loopEnd !== undefined ? d.loopEnd + 1 : allItems.length;
          const sliced = allItems.slice(start, end);
          output = { ...state, items: sliced, _loopRange: `${start}:${sliced.length}` };
        } else {
          output = prevOutput;
        }
        let result = await evalCondition(d.expression, output);
        // Belt-and-suspenders: enforce loop limit via index even if items weren't re-sliced.
        // maxLoopIndex = number of iterations allowed - 1 (relative to slice start).
        if (result && d.loopEnd !== undefined && output && typeof output === "object") {
          const idx = (output as Record<string, unknown>).index;
          const maxIdx = d.loopEnd - (d.loopStart ?? 0);
          if (typeof idx === "number" && idx > maxIdx) result = false;
        }
        conditionResults.set(node.id, result);

      } else if (node.type === "output") {
        const d = node.data as OutputNodeData;
        if (d.renderAs === "update_result" && d.transformCode?.trim()) {
          output = await runTransform(d.transformCode, prevOutput);
        } else {
          output = prevOutput;
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      if (e instanceof Error && e.name === "AbortError") throw e;
      error = e instanceof Error ? e.message : String(e);
      output = null;
    }

    outputByNodeId.set(node.id, output);
    const stepResult: WorkflowStepResult = {
      nodeId: node.id, nodeType: node.type, input: prevOutput, output, error,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      ...(node.type === "output" ? { renderAs: (node.data as OutputNodeData).renderAs } : {}),
    };
    results.push(stepResult);
    ctx.onStepDone(stepResult);

    if (error && ctx.stopOnError) {
      stopReason = `Stopped at "${String(node.data.label || node.id)}": ${error}`;
      fatalStop = true;
      return;
    }

    // Follow outgoing edges. For condition nodes, only follow the matching branch.
    const outEdges = edges.filter((e) => {
      if (e.source !== node.id) return false;
      const branch = e.sourceHandle === "true" || e.sourceHandle?.startsWith("true-")
        ? true
        : e.sourceHandle === "false" || e.sourceHandle?.startsWith("false-")
          ? false
          : undefined;
      if (branch !== undefined) {
        return conditionResults.get(node.id) === branch;
      }
      return true;
    });

    if (outEdges.length === 0 && node.type !== "output") {
      stopReason = node.type === "condition"
        ? `Condition "${String(node.data.label || node.id)}" evaluated to ${conditionResults.get(node.id) ? "true" : "false"}, but that branch has no connection.`
        : `Flow ended at "${String(node.data.label || node.id)}" because it has no outgoing connection.`;
    }

    for (const edge of outEdges) {
      await processNode(edge.target, edge);
    }
  };

  let aborted = false;
  let error: string | undefined;

  try {
    await processNode(trigger.id);
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError" || err.message?.includes("AbortError")) {
      aborted = true;
    } else {
      error = err.message ?? String(e);
    }
  }

  if (aborted) stopReason = "Test run was stopped by the user.";
  if (error) stopReason = `Execution failed: ${error}`;
  if (!stopReason && results.some((result) => result.nodeType === "output")) stopReason = "Workflow completed at an output node.";
  return { results, aborted, error, stopReason };
}

export function getWorkflowFinalOutput(results: WorkflowStepResult[]): {
  text: string;
  renderAs: OutputNodeData["renderAs"];
} {
  const outputStep = [...results].reverse().find((r) => r.nodeType === "output");
  const renderAs: OutputNodeData["renderAs"] = outputStep?.renderAs ?? "auto";

  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    if (r.nodeType === "output" || r.nodeType === "agent") {
      return {
        text: typeof r.output === "string" ? r.output : JSON.stringify(r.output, null, 2),
        renderAs,
      };
    }
  }
  return { text: "", renderAs: "auto" };
}
