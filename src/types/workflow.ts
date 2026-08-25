// Agentic workflow graph — persisted inside llmInsights.workflows[] in global_configs.

export type NodeType = "trigger" | "agent" | "plugin" | "condition" | "output";

// ─── Node data payloads ───────────────────────────────────────────────────────

export interface TriggerNodeData {
  label: string;
  triggerType: "manual" | "on_load";
  /** Pre-written prompt shown in the chat input when this workflow is selected */
  defaultPrompt?: string;
  /** What this node produces — shown in the canvas as documentation */
  outputSchema?: string;
  /** 0-based start index for loop — items before this are skipped (default 0) */
  loopStart?: number;
  /** 0-based inclusive end index for loop — items after this are skipped (default: last item) */
  loopEnd?: number;
}

export interface AgentNodeData {
  label: string;
  /** "existing" = pick from saved agents; "inline" = define agent here */
  mode: "existing" | "inline";
  // ── existing mode ──
  agentId?: string;
  // ── inline mode ──
  inlineName?: string;
  inlineSystemPrompt?: string;
  inlineOutputType?: "text" | "json" | "html" | "mixed";
  // ── shared ──
  promptOverride?: string;
  passPrevOutput: boolean;
  /** Documentation: what data this node expects from the previous node */
  inputSchema?: string;
  /** Documentation: what data this node produces */
  outputSchema?: string;
}

export interface PluginNodeData {
  label: string;
  /** JS function body — receives (input: {result, docText, prevOutput}) returns any */
  code: string;
  description?: string;
  inputSchema?: string;
  outputSchema?: string;
}

export interface ConditionNodeData {
  label: string;
  /** JS expression evaluated on prevOutput; truthy → "true" handle */
  expression: string;
  inputSchema?: string;
}

export interface OutputNodeData {
  label: string;
  /** How to render the final output in chat */
  renderAs: "auto" | "html" | "json" | "text" | "update_result";
  /** When renderAs = "update_result", optional JS expression to transform prevOutput into result data */
  transformCode?: string;
  inputSchema?: string;
}

export type AnyNodeData =
  | TriggerNodeData
  | AgentNodeData
  | PluginNodeData
  | ConditionNodeData
  | OutputNodeData;

// ─── Graph primitives ─────────────────────────────────────────────────────────

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: AnyNodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

export interface AgentWorkflow {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// ─── Named workflow record ────────────────────────────────────────────────────

export interface WorkflowConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  graph: AgentWorkflow;
  createdAt?: string;
}

// ─── Runtime types ────────────────────────────────────────────────────────────

export interface WorkflowStepResult {
  nodeId: string;
  nodeType: NodeType;
  output: unknown;
  error?: string;
  /** Only set for output nodes — carries the renderAs setting for final display routing */
  renderAs?: OutputNodeData["renderAs"];
}
