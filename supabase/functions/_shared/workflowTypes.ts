// Agentic workflow graph — persisted inside llmInsights.workflows[] in global_configs.

export type NodeType = "trigger" | "document_context" | "retrieval" | "user_input" | "event" | "agent" | "api" | "plugin" | "condition" | "router" | "parallel" | "join" | "output";

// ─── Node data payloads ───────────────────────────────────────────────────────

export interface TriggerNodeData {
  label: string;
  triggerType: "manual" | "on_load";
  /**
   * `input` is arbitrary request data from an API/webhook. `result` is the
   * result-page dataset (also a legacy alias for external request data).
   * Documents can be supplied by a request or selected/uploaded in the gateway.
   */
  inputSources?: Array<"input" | "result" | "document" | "user_upload">;
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

export interface RetrievalNodeData {
  label: string;
  /**
   * Keeps large data outside the LLM prompt, then lets this node retrieve a
   * compact subset for downstream agent nodes.
   */
  source: "result" | "prev_output" | "node_output";
  /** Used when source = "node_output". */
  sourceNodeId?: string;
  /** Optional query template. Supports {{userMessage}} and {{prevOutput}}. */
  query?: string;
  /** Maximum records the retrieval tool should return by default. */
  maxItems: number;
  /** JS body receiving input and tools; must return the compact context to pass onward. */
  code: string;
  description?: string;
  inputSchema?: string;
  outputSchema?: string;
}

export interface UserInputNodeData {
  responseTimeoutHours?: number;
  reminderIntervalHours?: number;
  maxReminders?: number;
  label: string;
  question: string;
  answerKey: string;
  inputType: "text" | "yes_no" | "select";
  /** Optional newline-separated options for select inputs. */
  options?: string;
  /** Optional helper text shown in the admin builder. */
  description?: string;
  inputSchema?: string;
  outputSchema?: string;
}

export interface EventNodeData {
  label: string;
  /** State events are satisfied by an upstream write; external signals durably pause the run. */
  eventType: "state_changed" | "external_signal";
  stateKey?: string;
  signalName?: string;
  description?: string;
  inputSchema?: string;
  outputSchema?: string;
}

export interface WorkflowRetryPolicy {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoff?: "fixed" | "exponential";
  retryOn?: Array<"timeout" | "network" | "429" | "5xx">;
}

export interface AgentNodeData {
  label: string;
  /** Backend execution deadline for this node in seconds (1-600). */
  timeoutSeconds?: number;
  /** Agents default to non-idempotent because assigned tools may have side effects. */
  sideEffectClass?: "read_only" | "idempotent" | "non_idempotent";
  retryPolicy?: WorkflowRetryPolicy;
  /** "existing" = pick from saved agents; "inline" = define agent here */
  mode: "existing" | "inline";
  // ── existing mode ──
  agentId?: string;
  // ── inline mode ──
  inlineName?: string;
  inlineSystemPrompt?: string;
  inlineOutputType?: "auto" | "text" | "json" | "html" | "mixed";
  inlineFallbackOutputType?: "text" | "json" | "html" | "mixed";
  /** Global LLM provider IDs selected for this node, in priority order. Empty/undefined follows the live global provider list. */
  providerIds?: string[];
  /** Providers defined directly on this inline agent node, tried before selected global providers. */
  agentProviders?: Array<{
    id: string;
    name: string;
    providerType: "openai" | "anthropic" | "gemini" | "openai_compatible";
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    enabled: boolean;
  }>;
  /** Skills attached to this node. Existing agents combine these with their saved skills. */
  skillIds?: string[];
  /** MCP servers granted directly to this node. Existing agents combine these with their saved MCP servers. */
  mcpServerIds?: string[];
  /** Optional per-server MCP tool allow-list. Missing/empty entries allow every tool on the selected server. */
  mcpToolFilter?: Record<string, string[]>;
  /** When set, the node output contract wins over saved-agent and skill output preferences. */
  nodeOutputType?: "text" | "json" | "html" | "mixed";
  /** Node-specific output contract/instructions, including custom formats. */
  nodeOutputInstructions?: string;
  /** Whether the chat must have an uploaded document before this node can run. */
  requiresDocument?: boolean;
  /**
   * Whether this agent can use the document/file attached by the end user in
   * the result-page chat. Undefined inherits the workflow trigger setting.
   */
  useUploadedDocument?: boolean;
  /** Controls whether this node can see the global result dataset or only the uploaded document. */
  contextMode?: "combined" | "document_only";
  /** Result data, uploaded document text, and immediate node input delivery. Undefined inherits the saved agent, or full for inline agents. */
  resultContextMode?: "full" | "chunked";
  /** Characters per ordered chunk (2,000–50,000). */
  resultChunkSize?: number;
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
  /** Backend execution deadline for this node in seconds (1-600). */
  timeoutSeconds?: number;
  /** GET defaults to read-only; all other methods default to non-idempotent. */
  sideEffectClass?: "read_only" | "idempotent" | "non_idempotent";
  retryPolicy?: WorkflowRetryPolicy;
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

export type RouterRuleOperator =
  | "contains"
  | "equals"
  | "not_equals"
  | "starts_with"
  | "ends_with"
  | "exists"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal";

export interface RouterRule {
  /** Stable connection key. The label may be renamed without breaking edges. */
  id: string;
  label: string;
  operator: RouterRuleOperator;
  value?: string;
}

export interface RouterNodeData {
  label: string;
  /** Optional dot/bracket path within prevOutput. Empty evaluates the complete value. */
  inputPath?: string;
  /** all_matches fans out to every match; first_match stops after the first match. */
  matchMode: "all_matches" | "first_match";
  caseSensitive?: boolean;
  rules: RouterRule[];
  fallbackLabel?: string;
  inputSchema?: string;
  outputSchema?: string;
}

/** Starts every directly connected branch as one durable, replay-safe composite step. */
export interface ParallelNodeData {
  label: string;
  /** Bounds work started by this run independently of worker-wide capacity. */
  maxConcurrency: number;
  /** fail_fast rejects the group; all_settled passes branch errors to the Join node. */
  failurePolicy: "fail_fast" | "all_settled";
  inputSchema?: string;
  outputSchema?: string;
}

export interface JoinNodeData {
  label: string;
  /** Stable ID of the Parallel node whose branches converge here. */
  parallelNodeId: string;
  mode: "all" | "all_settled" | "any" | "quorum";
  /** Used only by quorum. */
  quorum?: number;
  inputSchema?: string;
  outputSchema?: string;
}

export interface OutputNodeData {
  label: string;
  /** How to render the final output in chat */
  renderAs: "auto" | "html" | "json" | "text" | "update_result";
  /** When renderAs = "update_result", optional JS expression to transform prevOutput into result data */
  transformCode?: string;
  inputSchema?: string;
  outputSchema?: string;
}

export type AnyNodeData =
  | TriggerNodeData
  | DocumentContextNodeData
  | RetrievalNodeData
  | UserInputNodeData
  | EventNodeData
  | AgentNodeData
  | ApiNodeData
  | PluginNodeData
  | ConditionNodeData
  | RouterNodeData
  | ParallelNodeData
  | JoinNodeData
  | OutputNodeData;

// ─── Graph primitives ─────────────────────────────────────────────────────────

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: AnyNodeData;
  stateReads?: WorkflowStateRead[];
  stateWrites?: WorkflowStateWrite[];
}

export interface WorkflowStateRead {
  key: string;
  /** Optional name used in projected agent/API/plugin context. */
  alias?: string;
  required?: boolean;
  artifactMode?: "reference" | "content";
}
export interface WorkflowArtifactReference {
  __workflowArtifact: true;
  id: string;
  contentType: string;
  size: number;
  sha256: string;
}
export interface WorkflowStateWrite {
  key: string;
  /** Safe path inside the node output; empty selects the complete output. */
  sourcePath?: string;
  /** Optional node-level override; otherwise the field reducer is used. */
  reducer?: WorkflowStateReducer;
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

export type WorkflowStateValueType = "string" | "number" | "boolean" | "object" | "array" | "any" | "artifact";
export type WorkflowStateReducer = "replace" | "merge" | "append" | "append_unique" | "sum" | "min" | "max" | "first";
export interface WorkflowStateField {
  /** Safe dotted path, for example customer.profile or research.results. */
  key: string;
  type: WorkflowStateValueType;
  required?: boolean;
  defaultValue?: unknown;
  sensitive?: boolean;
  allowedReaders?: string[];
  allowedWriters?: string[];
  allowInAgentPrompt?: boolean;
  allowInApiRequest?: boolean;
  maxBytes?: number;
  reducer?: WorkflowStateReducer;
  /** Required by append_unique and evaluated inside array entries. */
  identityPath?: string;
}
export interface WorkflowStateDefinition {
  fields: WorkflowStateField[];
  /** Dynamic values are restricted to state.scratch.* and remain size bounded. */
  allowDynamicScratch?: boolean;
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
  /** Typed, execution-scoped shared state. */
  state?: WorkflowStateDefinition;
  createdAt?: string;
  /** Soft-delete timestamp. Recycled workflows are purged after 30 days. */
  deletedAt?: string;
  /** Remembers whether a recycled workflow was active so restore can reinstate it. */
  deletedPreviousEnabled?: boolean;
  /** Monotonic saved revision number. */
  revision?: number;
  /** Immutable saved snapshots used for audit and read-only historical viewing. */
  revisionHistory?: WorkflowRevision[];
  lastSavedAt?: string;
  lastSavedBy?: WorkflowRevisionActor;
  execution?: { apiEnabled?: boolean; webhookEnabled?: boolean; backendEnabled?: boolean; allowedOutboundHosts?: string[]; notifications?: { url?: string; secret?: string; returnUrl?: string; interactionTtlHours?: number; maxAttempts?: number } };
}

export interface WorkflowRevisionActor {
  userId?: string;
  email?: string;
  name?: string;
}

export interface WorkflowRevision {
  id: string;
  version: number;
  savedAt: string;
  savedBy: WorkflowRevisionActor;
  changes: string[];
  snapshot: Omit<WorkflowConfig, "revisionHistory">;
}

// ─── Runtime types ────────────────────────────────────────────────────────────

export interface WorkflowStepResult {
  nodeId: string;
  nodeType: NodeType;
  output: unknown;
  input?: unknown;
  error?: string;
  durationMs?: number;
  attemptCount?: number;
  /** Only set for output nodes — carries the renderAs setting for final display routing */
  renderAs?: OutputNodeData["renderAs"];
}

export interface WorkflowWaitingState {
  workflowId?: string;
  /** Unique version for this occurrence of a waiting node. Required by backend resumes. */
  waitingVersion?: string;
  nodeId: string;
  question: string;
  answerKey: string;
  inputType: UserInputNodeData["inputType"];
  options?: string[];
  input: unknown;
  nodeOutputs: Record<string, unknown>;
}

export interface WorkflowSignal {
  id: string;
  name: string;
  payload: unknown;
  receivedAt: string;
}

export interface WorkflowEventWait {
  nodeId: string;
  eventType: "external_signal";
  signalName: string;
}
