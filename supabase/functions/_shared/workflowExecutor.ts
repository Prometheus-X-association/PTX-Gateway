import type { AgentWorkflow, WorkflowNode, WorkflowStepResult, OutputNodeData, WorkflowEdge, WorkflowWaitingState, WorkflowStateDefinition, WorkflowArtifactReference, WorkflowEventWait, WorkflowSignal } from "./workflowTypes.ts";
import type { AgentNodeData, ApiNodeData, PluginNodeData, ConditionNodeData, RouterNodeData, RouterRule, TriggerNodeData, DocumentContextNodeData, RetrievalNodeData, UserInputNodeData, EventNodeData, WorkflowRetryPolicy } from "./workflowTypes.ts";
export interface SandboxRequest { operation: "plugin" | "condition" | "transform" | "retrieval"; code: string; input: unknown; state?: Record<string, unknown>; nodeOutputs?: Record<string, unknown>; timeoutMs?: number }
type Sandbox = (request: SandboxRequest) => Promise<unknown>;

export interface InlineAgentConfig {
  systemPrompt: string;
  outputType: "auto" | "text" | "json" | "html" | "mixed";
  fallbackOutputType: "text" | "json" | "html" | "mixed";
  skillIds?: string[];
  providerIds?: string[];
  agentProviders?: AgentNodeData["agentProviders"];
}

export interface WorkflowAgentOverrides {
  skillIds?: string[];
  mcpServerIds?: string[];
  mcpToolFilter?: Record<string, string[]>;
  nodeOutputType?: "text" | "json" | "html" | "mixed";
  nodeOutputInstructions?: string;
}

export interface WorkflowCheckpoint {
  pending: Array<{ nodeId: string; fromEdge?: WorkflowEdge }>;
  nodeOutputs: Record<string, unknown>;
  visits: Record<string, number>;
  selectedEdges?: WorkflowEdge[];
  documentContext: Pick<DocumentContextNodeData, "source" | "delivery" | "reuseScope"> | null;
  changedStateKeys?: string[];
}

export interface ExecutorContext {
  runId?: string;
  triggerSource?: "dashboard" | "api" | "webhook";
  checkpoint?: WorkflowCheckpoint;
  stateDefinition?: WorkflowStateDefinition;
  runState?: Record<string, unknown>;
  onStateChange?: (state: Record<string, unknown>, changedKeys: string[], nodeId: string) => void | Promise<void>;
  signals?: WorkflowSignal[];
  onSignalConsumed?: (signalId: string, nodeId: string) => void | Promise<void>;
  onArtifactCreate?: (nodeId: string, stateKey: string, value: unknown) => Promise<WorkflowArtifactReference>;
  onArtifactRead?: (reference: WorkflowArtifactReference) => Promise<unknown>;
  onCheckpoint?: (checkpoint: WorkflowCheckpoint) => Promise<void>;
  executeJavascript: Sandbox;
  documentContext?: Pick<DocumentContextNodeData, "source" | "delivery" | "reuseScope">;
  onDocumentContext?: (context: Pick<DocumentContextNodeData, "source" | "delivery" | "reuseScope">) => void;
  workflowId?: string;
  resultData: unknown;
  docText: string | null;
  hasDocument?: boolean;
  userMessage: string;
  conversationHistory?: string;
  organizationId: string | null;
  orgExecutionToken: string | null;
  supabaseUrl: string;
  onAgentStep: (
    nodeId: string,
    agentConfig: { timeoutSeconds?: number; sideEffectClass?: NodeSideEffectClass; operationId?: string; resultContextMode?: "full" | "chunked"; resultChunkSize?: number; agentId?: string; inline?: InlineAgentConfig; overrides?: WorkflowAgentOverrides; contextMode?: "combined" | "document_only"; includeResultData: boolean; includeDocument: boolean; documentDelivery?: "automatic" | "text" | "native_file" },
    prompt: string,
    prevOutput: unknown,
  ) => Promise<string>;
  onApiRequest: (nodeId: string, config: ApiNodeData, prevOutput: unknown, execution?: NodeExecutionMetadata, state?: Record<string, unknown>) => Promise<unknown>;
  onStepDone: (step: WorkflowStepResult) => void | Promise<void>;
  onStepStart?: (nodeId: string, input: unknown, execution: NodeExecutionMetadata) => void | Promise<void>;
  stopAfterNodeId?: string;
  /** Test/debug runs can start at one node instead of the trigger. */
  startNodeId?: string;
  /** Edge used to compute the starting node input when startNodeId is not the trigger. */
  startFromEdge?: WorkflowEdge;
  /** Outputs from earlier debug steps, used when starting from a selected node. */
  initialNodeOutputs?: Record<string, unknown>;
  /** Test/debug runs can provide the selected node input directly. */
  startInput?: unknown;
  resume?: {
    waiting: WorkflowWaitingState;
    answer: string;
  };
  /** Test/debug runs can stop immediately at the first failed node. */
  stopOnError?: boolean;
  signal?: AbortSignal;
}

export type NodeSideEffectClass = "pure" | "read_only" | "idempotent" | "non_idempotent";
export interface NodeExecutionMetadata { visit: number; attempt: number; sideEffectClass: NodeSideEffectClass; operationId: string }

export function nodeSideEffectClass(node: WorkflowNode): NodeSideEffectClass {
  if (node.type === "api") {
    const data = node.data as ApiNodeData;
    return data.sideEffectClass ?? (data.method === "GET" ? "read_only" : "non_idempotent");
  }
  if (node.type === "agent") return (node.data as AgentNodeData).sideEffectClass ?? "non_idempotent";
  return "pure";
}

const retryDelay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
  const onAbort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
});

const retryableError = (error: unknown, retryOn: NonNullable<WorkflowRetryPolicy["retryOn"]>) => {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = Number(record.status) || Number(String((error as Error)?.message || "").match(/HTTP\s+(\d{3})/i)?.[1]);
  const name = String(record.name || "");
  const message = String((error as Error)?.message || error || "");
  if (retryOn.includes("429") && status === 429) return true;
  if (retryOn.includes("5xx") && status >= 500 && status <= 599) return true;
  if (retryOn.includes("timeout") && (name === "TimeoutError" || /timed?\s*out|deadline|exceeded .*seconds/i.test(message))) return true;
  return retryOn.includes("network") && (error instanceof TypeError || /network|fetch failed|connection|stream ended/i.test(message));
};

async function withRetry<T>(operation: () => Promise<T>, policy: WorkflowRetryPolicy | undefined, sideEffectClass: NodeSideEffectClass, signal?: AbortSignal): Promise<{ value: T; attempts: number }> {
  const safeToRetry = sideEffectClass === "read_only" || sideEffectClass === "idempotent";
  const defaultAttempts = safeToRetry ? 3 : 1;
  const maxAttempts = safeToRetry ? Math.max(1, Math.min(10, Math.floor(policy?.maxAttempts ?? defaultAttempts))) : 1;
  const retryOn: NonNullable<WorkflowRetryPolicy["retryOn"]> = policy?.retryOn?.length
    ? policy.retryOn
    : ["timeout", "network", "429", "5xx"];
  const initial = Math.max(0, Math.min(60_000, Math.floor(policy?.initialDelayMs ?? 1000)));
  const maximum = Math.max(initial, Math.min(300_000, Math.floor(policy?.maxDelayMs ?? 30_000)));
  for (let attempt = 1; ; attempt++) {
    try { return { value: await operation(), attempts: attempt }; }
    catch (error) {
      if (attempt >= maxAttempts || !retryableError(error, retryOn)) throw Object.assign(error instanceof Error ? error : new Error(String(error)), { workflowAttemptCount: attempt });
      const advised = Number(error && typeof error === "object" ? (error as Record<string, unknown>).retryAfterMs : 0);
      const base = policy?.backoff === "fixed" ? initial : Math.min(maximum, initial * 2 ** (attempt - 1));
      const jittered = Math.min(maximum, Math.max(base, advised || 0)) * (0.8 + Math.random() * 0.4);
      await retryDelay(jittered, signal);
    }
  }
}

// ─── Sandboxed JS eval ────────────────────────────────────────────────────────

async function runPlugin(
  executeSandboxedJavascript: Sandbox,
  code: string,
  input: { result: unknown; input?: unknown; docText: string | null; prevOutput: unknown; state: Record<string, unknown> },
  nodeOutputs: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await executeSandboxedJavascript({ operation: "plugin", code, input, nodeOutputs });
  } catch (e) {
    throw new Error(`Plugin error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function runRetrieval(
  executeSandboxedJavascript: Sandbox,
  data: RetrievalNodeData,
  input: {
    source: RetrievalNodeData["source"];
    sourceData: unknown;
    result: unknown;
    docText: string | null;
    prevOutput: unknown;
    userMessage: string;
    query: string;
    maxItems: number;
    state: Record<string, unknown>;
  },
): Promise<unknown> {
  try {
    return await executeSandboxedJavascript({ operation: "retrieval", code: data.code, input, timeoutMs: 2_500 });
  } catch (e) {
    throw new Error(`Retrieval tool error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function evalCondition(executeSandboxedJavascript: Sandbox, expression: string, prevOutput: unknown, state: Record<string, unknown>): Promise<boolean> {
  return Boolean(await executeSandboxedJavascript({ operation: "condition", code: expression, input: prevOutput, state }));
}

async function runTransform(executeSandboxedJavascript: Sandbox, code: string, prevOutput: unknown, state: Record<string, unknown>): Promise<unknown> {
  try {
    return await executeSandboxedJavascript({ operation: "transform", code, input: prevOutput, state });
  } catch (error) {
    throw new Error(`Output transform failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ─── Main executor ────────────────────────────────────────────────────────────

const MAX_NODE_VISITS = 500; // safety cap for loop iterations
const MAX_TOTAL_NODE_VISITS = 10_000;
export const MAX_NODE_OUTPUT_BYTES = 5 * 1024 * 1024;
export const MAX_CHECKPOINT_BYTES = 20 * 1024 * 1024;
const MAX_DATA_DEPTH = 50;
const MAX_DATA_ENTRIES = 100_000;

/** Reject values that cannot be safely serialized, persisted, and restored. */
export function validateSerializableData(value: unknown, label: string, maxBytes: number): void {
  const ancestors = new WeakSet<object>();
  let entries = 0;
  const visit = (item: unknown, depth: number): void => {
    if (depth > MAX_DATA_DEPTH) throw new Error(`${label} exceeds the maximum nesting depth (${MAX_DATA_DEPTH}).`);
    if (typeof item === "bigint" || typeof item === "function" || typeof item === "symbol") throw new Error(`${label} contains a non-serializable value.`);
    if (!item || typeof item !== "object") return;
    if (ancestors.has(item)) throw new Error(`${label} contains a circular reference.`);
    ancestors.add(item);
    const values = Array.isArray(item) ? item : Object.values(item as Record<string, unknown>);
    entries += values.length;
    if (entries > MAX_DATA_ENTRIES) throw new Error(`${label} exceeds the maximum item count (${MAX_DATA_ENTRIES}).`);
    for (const child of values) visit(child, depth + 1);
    ancestors.delete(item);
  };
  visit(value, 0);
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { throw new Error(`${label} is not JSON-serializable.`); }
  if (serialized === undefined) throw new Error(`${label} is not JSON-serializable.`);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > maxBytes) throw new Error(`${label} exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`);
}

export interface WorkflowResult {
  results: WorkflowStepResult[];
  /** true when the run was intentionally aborted by the user */
  aborted: boolean;
  error?: string;
  stopReason?: string;
  waiting?: WorkflowWaitingState;
  eventWait?: WorkflowEventWait;
  state: Record<string, unknown>;
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

const assertSafePath = (path: string) => {
  const parts = path.replace(/^\$\.?/, "").replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  if (!parts.length || parts.some((part) => ["__proto__", "prototype", "constructor"].includes(part))) throw new Error(`Unsafe workflow state path "${path}".`);
  return parts;
};
const setDataPath = (target: Record<string, unknown>, path: string, value: unknown) => {
  const parts = assertSafePath(path); let current = target;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = structuredClone(value);
};
const workflowStateTypeMatches = (type: string, value: unknown) => type === "any" || value === undefined
  || (type === "string" && typeof value === "string") || (type === "number" && typeof value === "number" && Number.isFinite(value))
  || (type === "boolean" && typeof value === "boolean") || (type === "array" && Array.isArray(value))
  || ((type === "object" || type === "artifact") && Boolean(value) && typeof value === "object" && !Array.isArray(value));
const reduceStateValue = (current: unknown, incoming: unknown, reducer: string, identityPath?: string): unknown => {
  if (reducer === "first") return current === undefined ? incoming : current;
  if (reducer === "merge") return { ...(current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {}), ...(incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming as Record<string, unknown> : {}) };
  if (reducer === "append" || reducer === "append_unique") {
    const combined = [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [incoming])];
    if (reducer === "append") return combined;
    const seen = new Set<string>();
    return combined.filter((item) => { const identity = selectDataPath(item, identityPath); const key = JSON.stringify(identity); if (identity === undefined || seen.has(key)) return false; seen.add(key); return true; });
  }
  if (reducer === "sum") return Number(current ?? 0) + Number(incoming ?? 0);
  if (reducer === "min") return current === undefined ? incoming : Math.min(Number(current), Number(incoming));
  if (reducer === "max") return current === undefined ? incoming : Math.max(Number(current), Number(incoming));
  return incoming;
};
const isArtifactReference = (value: unknown): value is WorkflowArtifactReference => Boolean(value && typeof value === "object" && (value as Record<string, unknown>).__workflowArtifact === true && typeof (value as Record<string, unknown>).id === "string");
const stateProjection = async (state: Record<string, unknown>, node: WorkflowNode, definition: WorkflowStateDefinition | undefined, readArtifact: (reference: WorkflowArtifactReference) => Promise<unknown>) => {
  const projected: Record<string, unknown> = {};
  for (const read of node.stateReads ?? []) {
    const field = definition?.fields.find((item) => item.key === read.key);
    if (field?.allowedReaders?.length && !field.allowedReaders.includes(node.id)) throw new Error(`Node "${node.id}" is not allowed to read workflow state "${read.key}".`);
    if (node.type === "agent" && field && (field.allowInAgentPrompt ?? !field.sensitive) !== true) throw new Error(`Agent node "${node.id}" cannot receive workflow state "${read.key}".`);
    if (node.type === "api" && field && (field.allowInApiRequest ?? !field.sensitive) !== true) throw new Error(`API node "${node.id}" cannot receive workflow state "${read.key}".`);
    let value = selectDataPath(state, read.key);
    if (value === undefined) { if (read.required) throw new Error(`Required workflow state "${read.key}" is not available.`); continue; }
    if (read.artifactMode === "content") {
      if (!isArtifactReference(value)) throw new Error(`Workflow state "${read.key}" is not an artifact reference.`);
      value = await readArtifact(value);
    }
    setDataPath(projected, read.alias || read.key, value);
  }
  return projected;
};
const interpolateState = (template: string, state: Record<string, unknown>) => template.replace(/\{\{\s*state\.([^}]+)\s*\}\}/g, (_match, path) => {
  const value = selectDataPath(state, String(path).trim());
  return value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
});

const parseStructuredAgentOutput = (value: string): unknown => {
  const fenced = value.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = (fenced ? fenced[1] : value).trim();
  if (!candidate.startsWith("{") && !candidate.startsWith("[")) return value;
  try { return JSON.parse(candidate); } catch { return value; }
};

const routerRuleMatches = (input: unknown, rule: RouterRule, caseSensitive: boolean): boolean => {
  if (rule.operator === "exists") return input !== undefined && input !== null && input !== "";

  const values = Array.isArray(input) ? input : [input];
  const expectedRaw = rule.value ?? "";
  const normalize = (value: unknown) => {
    const text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
    return caseSensitive ? text : text.toLocaleLowerCase();
  };
  const expected = normalize(expectedRaw);

  return values.some((value) => {
    const actual = normalize(value);
    switch (rule.operator) {
      case "contains": return actual.includes(expected);
      case "equals": return actual === expected;
      case "not_equals": return actual !== expected;
      case "starts_with": return actual.startsWith(expected);
      case "ends_with": return actual.endsWith(expected);
      case "greater_than": return Number(value) > Number(expectedRaw);
      case "greater_than_or_equal": return Number(value) >= Number(expectedRaw);
      case "less_than": return Number(value) < Number(expectedRaw);
      case "less_than_or_equal": return Number(value) <= Number(expectedRaw);
      default: return false;
    }
  });
};

export async function executeWorkflow(
  workflow: AgentWorkflow,
  ctx: ExecutorContext,
): Promise<WorkflowResult> {
  const { nodes, edges } = workflow;

  const trigger = nodes.find((n) => n.type === "trigger");
  if (!trigger) throw new Error("Workflow has no trigger node");
  const triggerData = trigger.data as TriggerNodeData;
  const inputSources = triggerData.inputSources ?? ["result", "document"];
  if (inputSources.length === 0) throw new Error("Workflow trigger has no input source selected");
  const includeRequestData = inputSources.includes("input");
  const includeResultData = includeRequestData || inputSources.includes("result");
  const includeDocument = inputSources.includes("document") || inputSources.includes("user_upload");

  const results: WorkflowStepResult[] = [];
  const localArtifacts = new Map<string, unknown>();
  const digest = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const createArtifact = ctx.onArtifactCreate ?? (async (_nodeId: string, _stateKey: string, value: unknown) => {
    const serialized = JSON.stringify(value); const id = crypto.randomUUID(); localArtifacts.set(id, structuredClone(value));
    return { __workflowArtifact: true as const, id, contentType: "application/json", size: new TextEncoder().encode(serialized).byteLength, sha256: await digest(serialized) };
  });
  const readArtifact = ctx.onArtifactRead ?? (async (reference: WorkflowArtifactReference) => {
    if (!localArtifacts.has(reference.id)) throw new Error(`Workflow artifact "${reference.id}" is unavailable.`);
    return structuredClone(localArtifacts.get(reference.id));
  });
  const runState: Record<string, unknown> = structuredClone(ctx.runState ?? {});
  for (const field of ctx.stateDefinition?.fields ?? []) if (field.defaultValue !== undefined && selectDataPath(runState, field.key) === undefined) setDataPath(runState, field.key, field.defaultValue);
  const outputByNodeId = new Map<string, unknown>();
  if (ctx.initialNodeOutputs) {
    Object.entries(ctx.initialNodeOutputs).forEach(([nodeId, value]) => outputByNodeId.set(nodeId, value));
  }
  if (ctx.resume?.waiting.nodeOutputs) {
    Object.entries(ctx.resume.waiting.nodeOutputs).forEach(([nodeId, value]) => outputByNodeId.set(nodeId, value));
  }
  if (ctx.checkpoint) Object.entries(ctx.checkpoint.nodeOutputs).forEach(([id, value]) => outputByNodeId.set(id, value));
  const conditionResults = new Map<string, boolean>();
  const routerResults = new Map<string, Set<string>>();
  let resolvedDocumentContext: Pick<DocumentContextNodeData, "source" | "delivery" | "reuseScope"> | null = ctx.checkpoint?.documentContext ?? ctx.documentContext ?? null;
  let stopReason: string | undefined;
  let waiting: WorkflowWaitingState | undefined;
  let eventWait: WorkflowEventWait | undefined;
  const changedStateKeys = new Set(ctx.checkpoint?.changedStateKeys ?? []);
  const availableSignals = [...(ctx.signals ?? [])];
  let fatalStop = false;
  let resumeAnswerConsumed = false;
  // Track visits per node to detect infinite loops
  const nodeVisitCount = new Map<string, number>(Object.entries(ctx.checkpoint?.visits ?? {}));
  let nextEdges: WorkflowEdge[] = [];

  /**
   * processNode — walks the graph from nodeId.
   * fromEdge: the edge that triggered this call. When provided, prevOutput is read
   * from that specific edge's source, which correctly handles back-edges in loops.
   */
  const processNode = async (nodeId: string, fromEdge?: WorkflowEdge): Promise<void> => {
    if (ctx.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (fatalStop) return;

    const visits = (nodeVisitCount.get(nodeId) ?? 0) + 1;
    nodeVisitCount.set(nodeId, visits);

    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const sideEffectClass = nodeSideEffectClass(node);
    const operationId = `${ctx.runId ?? "local"}.${node.id}.${visits}`;
    const execution: NodeExecutionMetadata = { visit: visits, attempt: visits, sideEffectClass, operationId };
    const projectedState = await stateProjection(runState, node, ctx.stateDefinition, readArtifact);

    // When called via a specific edge (including back-edges), use that edge's source output.
    // When called as the first node (trigger), prevOutput is null.
    const sourceOutput = fromEdge ? (outputByNodeId.get(fromEdge.source) ?? null) : null;
    const hasDirectStartInput = !fromEdge && !ctx.resume && ctx.startNodeId === nodeId && "startInput" in ctx;
    const prevOutput = fromEdge
      ? selectDataPath(sourceOutput, fromEdge.dataPath)
      : hasDirectStartInput
        ? ctx.startInput
      : ctx.resume?.waiting.nodeId === nodeId
        ? ctx.resume.waiting.input
        : null;
    await ctx.onStepStart?.(node.id, prevOutput, execution);
    const startedAt = performance.now();

    let output: unknown = prevOutput;
    let error: string | undefined;
    let attemptCount = 1;

    try {
      if (visits > MAX_NODE_VISITS) throw new Error(`Node "${nodeId}" exceeded max iterations (${MAX_NODE_VISITS})`);
      if ([...nodeVisitCount.values()].reduce((sum, count) => sum + count, 0) > MAX_TOTAL_NODE_VISITS) throw new Error(`Workflow exceeded ${MAX_TOTAL_NODE_VISITS} total node visits.`);
      if (fromEdge?.dataPath?.trim() && prevOutput === undefined) {
        throw new Error(`Connection data path "${fromEdge.dataPath}" was not found in the output of node "${fromEdge.source}".`);
      }
      if (node.type === "trigger") {
        const d = node.data as TriggerNodeData;
        output = {
          triggerType: d.triggerType,
          ...(ctx.triggerSource ? { triggerSource: ctx.triggerSource } : {}),
          ...(ctx.runId ? { runId: ctx.runId } : {}),
          userMessage: ctx.userMessage,
          ...(ctx.conversationHistory ? { conversationHistory: ctx.conversationHistory } : {}),
          ...(includeResultData ? { data: ctx.resultData } : {}),
          ...(includeRequestData ? { input: ctx.resultData } : {}),
          ...(includeDocument ? { document: { available: ctx.hasDocument ?? Boolean(ctx.docText), text: ctx.docText ?? undefined } } : {}),
        };

      } else if (node.type === "document_context") {
        const d = node.data as DocumentContextNodeData;
        const available = ctx.hasDocument ?? Boolean(ctx.docText);
        if (!available) throw new Error("No uploaded document is available for this Document Context node.");
        if (d.delivery === "text" && !ctx.docText?.trim()) {
          throw new Error("Document Context is set to source text, but this upload has no readable text.");
        }
        resolvedDocumentContext = { source: d.source, delivery: d.delivery, reuseScope: "workflow_run" };
        ctx.onDocumentContext?.(resolvedDocumentContext);
        output = {
          ...(prevOutput && typeof prevOutput === "object" && !Array.isArray(prevOutput) ? prevOutput as Record<string, unknown> : {}),
          contextType: "document",
          documentContext: {
            source: d.source,
            delivery: d.delivery,
            reuseScope: "workflow_run",
            available: true,
            textAvailable: Boolean(ctx.docText?.trim()),
          },
          // The source text is held once in this workflow-run context. Native
          // files remain available to document-capable providers through the
          // agent's document input, rather than being copied into node data.
          ...(d.delivery !== "native_file" && ctx.docText ? { text: ctx.docText } : {}),
        };

      } else if (node.type === "retrieval") {
        const d = node.data as RetrievalNodeData;
        const sourceData = d.source === "prev_output"
          ? prevOutput
          : d.source === "node_output" && d.sourceNodeId
            ? outputByNodeId.get(d.sourceNodeId)
            : ctx.resultData;
        const prevStr = prevOutput === null ? "" : typeof prevOutput === "string" ? prevOutput : JSON.stringify(prevOutput, null, 2);
        const query = interpolateState((d.query?.trim() || "{{userMessage}}")
          .replace(/\{\{userMessage\}\}/g, ctx.userMessage)
          .replace(/\{\{prevOutput\}\}/g, prevStr), projectedState);
        output = await runRetrieval(ctx.executeJavascript, d, {
          source: d.source,
          sourceData,
          result: includeResultData ? ctx.resultData : undefined,
          docText: includeDocument ? ctx.docText : null,
          prevOutput,
          userMessage: ctx.userMessage,
          query,
          maxItems: d.maxItems || 25,
          state: projectedState,
        });

      } else if (node.type === "user_input") {
        const d = node.data as UserInputNodeData;
        const options = d.options?.split(/\r?\n/).map((option) => option.trim()).filter(Boolean);
        const canUseResumeAnswer = !resumeAnswerConsumed && ctx.resume?.waiting.nodeId === node.id;
        const resumeAnswer = canUseResumeAnswer ? ctx.resume!.answer.trim() : "";
        const prevStr = prevOutput === null ? "" : typeof prevOutput === "string" ? prevOutput : JSON.stringify(prevOutput, null, 2);
        const question = interpolateState((d.question || "Please provide the next input.")
          .replace(/\{\{prevOutput\}\}/g, prevStr)
          .replace(/\{\{prevOutput\.([^}]+)\}\}/g, (_m, key) => {
            const value = selectDataPath(prevOutput, String(key));
            if (Array.isArray(value)) return value.join(", ");
            if (value && typeof value === "object") return JSON.stringify(value);
            return value === undefined || value === null ? "" : String(value);
          }), projectedState);
        const normalize = (value: string) => value.trim().toLocaleLowerCase();
        if (!resumeAnswer) {
          output = {
            waiting: true,
            question,
            answerKey: d.answerKey,
            inputType: d.inputType,
            ...(options?.length ? { options } : {}),
          };
          waiting = {
            workflowId: ctx.workflowId,
            nodeId: node.id,
            question,
            answerKey: d.answerKey,
            inputType: d.inputType,
            ...(options?.length ? { options } : {}),
            input: prevOutput,
            nodeOutputs: Object.fromEntries(outputByNodeId),
          };
          stopReason = `Waiting for user input at "${String(d.label || node.id)}".`;
          fatalStop = true;
        } else if (d.inputType === "yes_no" && !["yes", "y", "no", "n"].includes(normalize(resumeAnswer))) {
          output = {
            waiting: true,
            question: `${question}\n\nPlease answer yes or no.`,
            answerKey: d.answerKey,
            inputType: d.inputType,
          };
          waiting = {
            workflowId: ctx.workflowId,
            nodeId: node.id,
            question: `${question}\n\nPlease answer yes or no.`,
            answerKey: d.answerKey,
            inputType: d.inputType,
            input: prevOutput,
            nodeOutputs: Object.fromEntries(outputByNodeId),
          };
          stopReason = `Waiting for a valid yes/no answer at "${String(d.label || node.id)}".`;
          fatalStop = true;
        } else if (d.inputType === "select" && options?.length && !options.some((option) => normalize(option) === normalize(resumeAnswer))) {
          output = {
            waiting: true,
            question: `${question}\n\nPlease choose one of: ${options.join(", ")}`,
            answerKey: d.answerKey,
            inputType: d.inputType,
            options,
          };
          waiting = {
            workflowId: ctx.workflowId,
            nodeId: node.id,
            question: `${question}\n\nPlease choose one of: ${options.join(", ")}`,
            answerKey: d.answerKey,
            inputType: d.inputType,
            options,
            input: prevOutput,
            nodeOutputs: Object.fromEntries(outputByNodeId),
          };
          stopReason = `Waiting for a valid selection at "${String(d.label || node.id)}".`;
          fatalStop = true;
        } else {
          if (canUseResumeAnswer) resumeAnswerConsumed = true;
          const value = d.inputType === "yes_no"
            ? ["yes", "y"].includes(normalize(resumeAnswer))
            : resumeAnswer;
          output = {
            ...(prevOutput && typeof prevOutput === "object" && !Array.isArray(prevOutput) ? prevOutput as Record<string, unknown> : { previous: prevOutput }),
            [d.answerKey || "answer"]: value,
            userAnswer: resumeAnswer,
          };
        }

      } else if (node.type === "event") {
        const d = node.data as EventNodeData;
        if (d.eventType === "state_changed") {
          const key = String(d.stateKey || "");
          if (!changedStateKeys.has(key)) throw new Error(`Workflow state event "${key}" has not occurred before node "${node.id}".`);
          const field = ctx.stateDefinition?.fields.find((item) => item.key === key);
          if (field?.allowedReaders?.length && !field.allowedReaders.includes(node.id)) throw new Error(`Node "${node.id}" is not allowed to observe workflow state "${key}".`);
          // The event is metadata-only. Emitting the value here would bypass
          // downstream state-read declarations and field reader permissions.
          output = { eventType: "state_changed", key, previous: prevOutput };
          changedStateKeys.delete(key);
        } else {
          const signalName = String(d.signalName || "");
          const index = availableSignals.findIndex((signal) => signal.name === signalName);
          if (index < 0) {
            output = { waiting: true, eventType: "external_signal", signalName };
            eventWait = { nodeId: node.id, eventType: "external_signal", signalName };
            stopReason = `Waiting for external signal "${signalName}" at "${String(d.label || node.id)}".`;
            fatalStop = true;
          } else {
            const [signal] = availableSignals.splice(index, 1);
            await ctx.onSignalConsumed?.(signal.id, node.id);
            output = { eventType: "external_signal", signalName, signalId: signal.id, receivedAt: signal.receivedAt, payload: signal.payload, previous: prevOutput };
          }
        }

      } else if (node.type === "agent") {
        const d = node.data as AgentNodeData;
        if (d.mode !== "inline" && !d.agentId?.trim()) {
          throw new Error("Select an existing agent for this workflow node before running it.");
        }
        const contextMode = d.contextMode ?? (
          /using only (?:the )?(?:uploaded|attached|raw) document/i.test(`${d.mode === "inline" ? d.inlineSystemPrompt ?? "" : ""}\n${d.promptOverride ?? ""}`)
            ? "document_only"
            : "combined"
        );
        const prevStr = prevOutput === null ? "" : typeof prevOutput === "string" ? prevOutput : JSON.stringify(prevOutput, null, 2);
        const rawPrompt = d.promptOverride?.trim() || ctx.userMessage;
        const promptBase = interpolateState(rawPrompt
          .replace(/\{\{prevOutput\}\}/g, prevStr)
          // {{prevOutput.fieldName}} — inject a single field from the prevOutput object
          .replace(/\{\{prevOutput\.([^}]+)\}\}/g, (_m, key) => {
            if (prevOutput && typeof prevOutput === "object") {
              const val = (prevOutput as Record<string, unknown>)[key as string];
              return val !== undefined ? String(val) : "";
            }
            return "";
          }), projectedState);
        const prompt = Object.keys(projectedState).length ? `${promptBase}\n\nWorkflow execution state:\n${JSON.stringify(projectedState, null, 2)}` : promptBase;
        // A node can opt into the file the end user attaches in chat even when
        // the trigger itself is configured around result data only. Existing
        // workflows keep inheriting the trigger setting.
        const agentIncludesDocument = d.useUploadedDocument ?? includeDocument;
        const documentDelivery = resolvedDocumentContext?.delivery ?? "automatic";
        const overrides = {
          skillIds: d.skillIds ?? [],
          mcpServerIds: d.mcpServerIds ?? [],
          mcpToolFilter: d.mcpToolFilter ?? {},
          nodeOutputType: d.nodeOutputType,
          nodeOutputInstructions: d.nodeOutputInstructions ?? (d.nodeOutputType && d.outputSchema ? `Match this expected output schema exactly: ${d.outputSchema}` : undefined),
        };
        const agentConfig =
          d.mode === "inline"
            ? { inline: {
                systemPrompt: d.inlineSystemPrompt ?? "",
                outputType: d.inlineOutputType ?? "text",
                fallbackOutputType: d.inlineFallbackOutputType ?? "text",
                skillIds: d.skillIds ?? [],
                providerIds: d.providerIds ?? [],
                agentProviders: d.agentProviders ?? [],
              }, overrides, timeoutSeconds: d.timeoutSeconds, sideEffectClass, operationId, resultContextMode: d.resultContextMode, resultChunkSize: d.resultChunkSize, contextMode, includeResultData: includeResultData && contextMode !== "document_only", includeDocument: agentIncludesDocument, documentDelivery }
            : { agentId: d.agentId, overrides, timeoutSeconds: d.timeoutSeconds, sideEffectClass, operationId, resultContextMode: d.resultContextMode, resultChunkSize: d.resultChunkSize, contextMode, includeResultData: includeResultData && contextMode !== "document_only", includeDocument: agentIncludesDocument, documentDelivery };
        const attempted = await withRetry(() => ctx.onAgentStep(node.id, agentConfig, prompt, d.passPrevOutput ? prevOutput : null), d.retryPolicy, sideEffectClass, ctx.signal);
        attemptCount = attempted.attempts;
        const agentOutput = attempted.value;
        // Preserve structured responses as actual objects/arrays so downstream
        // nodes and edge data paths can address fields deterministically.
        const parsedAgentOutput = parseStructuredAgentOutput(agentOutput);
        if (d.nodeOutputType === "json" && typeof parsedAgentOutput === "string") {
          throw new Error(`Agent node "${d.label || node.id}" did not satisfy its required JSON output contract.`);
        }
        output = d.nodeOutputType === "text" || d.nodeOutputType === "html"
          ? agentOutput
          : parsedAgentOutput;

      } else if (node.type === "api") {
        const d = node.data as ApiNodeData;
        const attempted = await withRetry(() => ctx.onApiRequest(node.id, d, prevOutput, execution, projectedState), d.retryPolicy, sideEffectClass, ctx.signal);
        attemptCount = attempted.attempts;
        output = attempted.value;

      } else if (node.type === "plugin") {
        const d = node.data as PluginNodeData;
        output = await runPlugin(ctx.executeJavascript, d.code, {
          result: includeResultData ? ctx.resultData : undefined,
          ...(includeRequestData ? { input: ctx.resultData } : {}),
          docText: includeDocument ? ctx.docText : null,
          prevOutput,
          state: projectedState,
        }, Object.fromEntries(outputByNodeId));

      } else if (node.type === "condition") {
        const d = node.data as ConditionNodeData;
        if (
          (d.loopStart !== undefined || d.loopEnd !== undefined) &&
          prevOutput &&
          typeof prevOutput === "object" &&
          !("_loopRange" in prevOutput)
        ) {
          const state = prevOutput as Record<string, unknown>;
          const allItems = Array.isArray(state.items) ? state.items : [];
          const start = d.loopStart ?? 0;
          const end = d.loopEnd !== undefined ? d.loopEnd + 1 : allItems.length;
          const sliced = allItems.slice(start, end);
          output = { ...state, items: sliced, _loopRange: `${start}:${sliced.length}` };
        } else {
          output = prevOutput;
        }
        let result = await evalCondition(ctx.executeJavascript, d.expression, output, projectedState);
        // Belt-and-suspenders: enforce loop limit via index even if items weren't re-sliced.
        // maxLoopIndex = number of iterations allowed - 1 (relative to slice start).
        if (result && d.loopEnd !== undefined && output && typeof output === "object") {
          const idx = (output as Record<string, unknown>).index;
          const maxIdx = d.loopEnd - (d.loopStart ?? 0);
          if (typeof idx === "number" && idx > maxIdx) result = false;
        }
        conditionResults.set(node.id, result);

      } else if (node.type === "router") {
        const d = node.data as RouterNodeData;
        output = prevOutput;
        const selectedInput = d.inputPath?.startsWith("state.") ? selectDataPath(projectedState, d.inputPath.slice(6)) : selectDataPath(prevOutput, d.inputPath);
        const matchingRuleIds: string[] = [];
        for (const rule of d.rules ?? []) {
          if (routerRuleMatches(selectedInput, rule, Boolean(d.caseSensitive))) {
            matchingRuleIds.push(rule.id);
            if (d.matchMode === "first_match") break;
          }
        }
        routerResults.set(node.id, new Set(matchingRuleIds.length > 0 ? matchingRuleIds : ["fallback"]));

      } else if (node.type === "output") {
        const d = node.data as OutputNodeData;
        if (d.renderAs === "update_result" && d.transformCode?.trim()) {
          output = await runTransform(ctx.executeJavascript, d.transformCode, prevOutput, projectedState);
        } else {
          output = prevOutput;
        }
      }
      validateSerializableData(output, `Node "${String(node.data.label || node.id)}" output`, MAX_NODE_OUTPUT_BYTES);
      if (!(waiting?.nodeId === node.id)) {
        const changedKeys: string[] = [];
        for (const write of node.stateWrites ?? []) {
          const value = selectDataPath(output, write.sourcePath);
          if (write.sourcePath?.trim() && value === undefined) throw new Error(`State output path "${write.sourcePath}" was not found on node "${node.id}".`);
          const field = ctx.stateDefinition?.fields.find((item) => item.key === write.key);
          if (field?.allowedWriters?.length && !field.allowedWriters.includes(node.id)) throw new Error(`Node "${node.id}" is not allowed to write workflow state "${write.key}".`);
          const reducer = write.reducer ?? field?.reducer ?? "replace";
          const storedValue = field?.type === "artifact" ? await createArtifact(node.id, write.key, value) : value;
          const reduced = reduceStateValue(selectDataPath(runState, write.key), storedValue, reducer, field?.identityPath);
          if (field && !workflowStateTypeMatches(field.type, reduced)) throw new Error(`State value written by node "${node.id}" does not match ${write.key} (${field.type}).`);
          validateSerializableData(reduced, `Workflow state "${write.key}"`, field?.maxBytes ?? 512 * 1024);
          setDataPath(runState, write.key, reduced); changedKeys.push(write.key); changedStateKeys.add(write.key);
        }
        if (changedKeys.length) { validateSerializableData(runState, "Workflow execution state", MAX_CHECKPOINT_BYTES); await ctx.onStateChange?.(structuredClone(runState), changedKeys, node.id); }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      if (e instanceof Error && e.name === "AbortError") throw e;
      attemptCount = Number(e && typeof e === "object" ? (e as Record<string, unknown>).workflowAttemptCount : 0) || attemptCount;
      error = e instanceof Error ? e.message : String(e);
      output = null;
    }

    outputByNodeId.set(node.id, output);
    const stepResult: WorkflowStepResult = {
      nodeId: node.id, nodeType: node.type, input: prevOutput, output, error,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      attemptCount,
      ...(node.type === "output" ? { renderAs: (node.data as OutputNodeData).renderAs } : {}),
    };
    results.push(stepResult);
    await ctx.onStepDone(stepResult);

    if (fatalStop && (waiting || eventWait)) {
      return;
    }
    if (error && ctx.stopOnError) {
      stopReason = `Stopped at "${String(node.data.label || node.id)}": ${error}`;
      fatalStop = true;
      return;
    }
    if (node.type === "output") {
      stopReason = `Workflow completed at output node "${String(node.data.label || node.id)}".`;
      return;
    }
    if (ctx.stopAfterNodeId === node.id) {
      stopReason = `Stopped after node "${String(node.data.label || node.id)}".`;
      return;
    }

    // Follow outgoing edges. Conditions select one boolean branch; routers can fan out.
    const outEdges = edges.filter((e) => {
      if (e.source !== node.id) return false;
      if (node.type === "router") {
        const handle = e.sourceHandle ?? "";
        const routeId = handle.startsWith("route-")
          ? handle.slice("route-".length).replace(/-(top|right|bottom|left)$/, "")
          : undefined;
        return routeId ? routerResults.get(node.id)?.has(routeId) === true : false;
      }
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

    if (outEdges.length === 0) {
      stopReason = node.type === "condition"
        ? `Condition "${String(node.data.label || node.id)}" evaluated to ${conditionResults.get(node.id) ? "true" : "false"}, but that branch has no connection.`
        : node.type === "router"
          ? `Router "${String(node.data.label || node.id)}" matched ${[...(routerResults.get(node.id) ?? [])].join(", ") || "no routes"}, but no matching branch has a connection.`
          : `Flow ended at "${String(node.data.label || node.id)}" because it has no outgoing connection.`;
    }

    nextEdges = outEdges;
  };

  let aborted = false;
  let error: string | undefined;

  try {
    const startNodeId = ctx.resume?.waiting.nodeId ?? ctx.startNodeId ?? trigger.id;
    const startFromEdge = ctx.resume ? undefined : ctx.startFromEdge;
    const pending = ctx.checkpoint?.pending.slice() ?? [{ nodeId: startNodeId, fromEdge: startFromEdge }];
    while (pending.length && !fatalStop) {
      const current = pending.shift()!;
      nextEdges = [];
      await processNode(current.nodeId, current.fromEdge);
      pending.unshift(...nextEdges.map((edge) => ({ nodeId: edge.target, fromEdge: edge })));
      if (waiting || eventWait) pending.unshift(current);
      const checkpoint = { pending, selectedEdges: nextEdges, nodeOutputs: Object.fromEntries(outputByNodeId), visits: Object.fromEntries(nodeVisitCount), documentContext: resolvedDocumentContext, changedStateKeys: [...changedStateKeys] };
      validateSerializableData(checkpoint, "Workflow checkpoint", MAX_CHECKPOINT_BYTES);
      await ctx.onCheckpoint?.(checkpoint);
    }
    const failed = results.find((step) => step.error);
    if (failed && ctx.stopOnError) error = failed.error;
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError" || err.message?.includes("AbortError")) {
      aborted = true;
    } else {
      error = err.message ?? String(e);
    }
  }

  if (aborted) stopReason = "Test run was stopped by the user.";
  if (error && !fatalStop) stopReason = `Execution failed: ${error}`;
  if (!stopReason && results.some((result) => result.nodeType === "output")) stopReason = "Workflow completed at an output node.";
  return { results, aborted, error, stopReason, waiting, eventWait, state: runState };
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
