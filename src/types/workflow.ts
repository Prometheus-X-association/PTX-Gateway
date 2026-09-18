// Agentic workflow graph — persisted inside llmInsights.workflows[] in global_configs.

export type NodeType = "trigger" | "document_context" | "agent" | "api" | "plugin" | "condition" | "output";

// ─── Node data payloads ───────────────────────────────────────────────────────

export interface TriggerNodeData {
  label: string;
  triggerType: "manual" | "on_load";
  /**
   * Data made available to this workflow. `document` is the document selected
   * during the gateway process; `user_upload` lets the result-page chat ask for
   * a document when no gateway document is available.
   */
  inputSources?: Array<"result" | "document" | "user_upload">;
  /** Pre-written prompt shown in the chat input when this workflow is selected */
  defaultPrompt?: string;
  /** What this node produces — shown in the canvas as documentation */
  outputSchema?: string;
}

export interface DocumentContextNodeData {
  label: string;
  /** The context is resolved once for a workflow run and reused downstream. */
  source: "trigger_document" | "chat_upload_or_trigger";
  /** Preserve source text when available; otherwise retain native file context for capable providers. */
  delivery: "automatic" | "text" | "native_file";
  reuseScope: "workflow_run";
  inputSchema?: string;
  outputSchema?: string;
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
  inlineOutputType?: "auto" | "text" | "json" | "html" | "mixed";
  inlineFallbackOutputType?: "text" | "json" | "html" | "mixed";
  /** Skills attached directly to an inline workflow agent. Existing agents inherit their saved skills. */
  skillIds?: string[];
  /** Whether the chat must have an uploaded document before this node can run. */
  requiresDocument?: boolean;
  /**
   * Whether this agent can use the document/file attached by the end user in
   * the result-page chat. Undefined inherits the workflow trigger setting.
   */
  useUploadedDocument?: boolean;
  /** Controls whether this node can see the global result dataset or only the uploaded document. */
  contextMode?: "combined" | "document_only";
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

export interface ApiKeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface ApiNodeData {
  label: string;
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  queryParams: ApiKeyValue[];
  headers: ApiKeyValue[];
  authType: "none" | "bearer" | "basic" | "api_key";
  bearerToken?: string;
  basicUsername?: string;
  basicPassword?: string;
  apiKeyName?: string;
  apiKeyValue?: string;
  apiKeyLocation?: "header" | "query";
  bodyType: "none" | "json" | "text" | "form_urlencoded";
  body?: string;
  responseType: "auto" | "json" | "text";
  /** Dot/bracket path within the parsed response body to emit, e.g. data.items[0]. */
  outputPath?: string;
  inputSchema?: string;
  outputSchema?: string;
  /** Set on public-safe workflow copies when credentials exist only server-side. */
  hasStoredCredentials?: boolean;
}

export interface ConditionNodeData {
  label: string;
  /** JS expression evaluated on prevOutput; truthy → "true" handle */
  expression: string;
  inputSchema?: string;
  /** 0-based start index for loop slicing — applied by the executor on first condition entry */
  loopStart?: number;
  /** 0-based inclusive end index for loop slicing — empty means last item */
  loopEnd?: number;
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
  | DocumentContextNodeData
  | AgentNodeData
  | ApiNodeData
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
  targetHandle?: string;
  label?: string;
  type?: "default" | "straight" | "smoothstep" | "step";
  /** Optional dot/bracket path selecting which part of the source output reaches the target. */
  dataPath?: string;
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
  /** Result-page services/service chains where this workflow is offered. Empty means hidden everywhere. */
  targetResources?: string[];
  graph: AgentWorkflow;
  createdAt?: string;
}

// ─── Runtime types ────────────────────────────────────────────────────────────

export interface WorkflowStepResult {
  nodeId: string;
  nodeType: NodeType;
  output: unknown;
  input?: unknown;
  error?: string;
  durationMs?: number;
  /** Only set for output nodes — carries the renderAs setting for final display routing */
  renderAs?: OutputNodeData["renderAs"];
}
