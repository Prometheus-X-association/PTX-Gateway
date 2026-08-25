import type { AgentWorkflow, WorkflowNode, WorkflowStepResult, OutputNodeData, WorkflowEdge } from "@/types/workflow";
import type { AgentNodeData, PluginNodeData, ConditionNodeData, TriggerNodeData } from "@/types/workflow";

export interface InlineAgentConfig {
  systemPrompt: string;
  outputType: "text" | "json" | "html" | "mixed";
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
  signal?: AbortSignal;
}

// ─── Sandboxed JS eval ────────────────────────────────────────────────────────

function runPlugin(code: string, input: { result: unknown; docText: string | null; prevOutput: unknown }): unknown {
  try {
    // eslint-disable-next-line no-new-func
    return new Function("input", `"use strict";\n${code}`)(input);
  } catch (e) {
    throw new Error(`Plugin error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function evalCondition(expression: string, prevOutput: unknown): boolean {
  try {
    // eslint-disable-next-line no-new-func
    return Boolean(new Function("prevOutput", `"use strict"; return !!(${expression});`)(prevOutput));
  } catch {
    return false;
  }
}

function runTransform(code: string, prevOutput: unknown): unknown {
  try {
    // eslint-disable-next-line no-new-func
    return new Function("prevOutput", `"use strict";\n${code}`)(prevOutput);
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
}

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
  // Track visits per node to detect infinite loops
  const nodeVisitCount = new Map<string, number>();

  /**
   * processNode — walks the graph from nodeId.
   * fromEdge: the edge that triggered this call. When provided, prevOutput is read
   * from that specific edge's source, which correctly handles back-edges in loops.
   */
  const processNode = async (nodeId: string, fromEdge?: WorkflowEdge): Promise<void> => {
    if (ctx.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const visits = (nodeVisitCount.get(nodeId) ?? 0) + 1;
    if (visits > MAX_NODE_VISITS) throw new Error(`Node "${nodeId}" exceeded max iterations (${MAX_NODE_VISITS})`);
    nodeVisitCount.set(nodeId, visits);

    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // When called via a specific edge (including back-edges), use that edge's source output.
    // When called as the first node (trigger), prevOutput is null.
    const prevOutput = fromEdge ? (outputByNodeId.get(fromEdge.source) ?? null) : null;

    let output: unknown = prevOutput;
    let error: string | undefined;

    try {
      if (node.type === "trigger") {
        const d = node.data as TriggerNodeData;
        output = { triggerType: d.triggerType, userMessage: ctx.userMessage };

      } else if (node.type === "agent") {
        const d = node.data as AgentNodeData;
        const prevStr = prevOutput === null ? "" : typeof prevOutput === "string" ? prevOutput : JSON.stringify(prevOutput, null, 2);
        const rawPrompt = d.promptOverride?.trim() || ctx.userMessage;
        const prompt = rawPrompt.replace(/\{\{prevOutput\}\}/g, prevStr);
        const agentConfig =
          d.mode === "inline"
            ? { inline: { systemPrompt: d.inlineSystemPrompt ?? "", outputType: d.inlineOutputType ?? "text" } }
            : { agentId: d.agentId };
        output = await ctx.onAgentStep(node.id, agentConfig, prompt, d.passPrevOutput ? prevOutput : null);

      } else if (node.type === "plugin") {
        const d = node.data as PluginNodeData;
        output = runPlugin(d.code, { result: ctx.resultData, docText: ctx.docText, prevOutput });

      } else if (node.type === "condition") {
        const d = node.data as ConditionNodeData;
        // If loop range is configured on this node, enforce it by re-slicing items
        // on every visit. This is the authoritative enforcer — no agent cooperation needed.
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
        const result = evalCondition(d.expression, output);
        conditionResults.set(node.id, result);

      } else if (node.type === "output") {
        const d = node.data as OutputNodeData;
        if (d.renderAs === "update_result" && d.transformCode?.trim()) {
          output = runTransform(d.transformCode, prevOutput);
        } else {
          output = prevOutput;
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      output = null;
    }

    outputByNodeId.set(node.id, output);
    const stepResult: WorkflowStepResult = {
      nodeId: node.id, nodeType: node.type, output, error,
      ...(node.type === "output" ? { renderAs: (node.data as OutputNodeData).renderAs } : {}),
    };
    results.push(stepResult);
    ctx.onStepDone(stepResult);

    // Follow outgoing edges. For condition nodes, only follow the matching branch.
    const outEdges = edges.filter((e) => {
      if (e.source !== node.id) return false;
      if (e.sourceHandle === "true" || e.sourceHandle === "false") {
        return conditionResults.get(node.id) === (e.sourceHandle === "true");
      }
      return true;
    });

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

  return { results, aborted, error };
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
