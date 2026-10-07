export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const encoder = new TextEncoder();
export const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
export async function hash(value: string) { return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value))); }
export async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
export function equal(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
const unbase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
export function randomSecret() { return base64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
async function encryptionKey() {
  const configured = Deno.env.get("WORKFLOW_SECRETS_KEY");
  if (!configured) throw new HttpError(503, "WORKFLOW_SECRETS_KEY is not configured.");
  const bytes = unbase64(configured);
  if (bytes.length !== 32) throw new HttpError(503, "WORKFLOW_SECRETS_KEY must contain 32 base64-encoded bytes.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
type WorkflowKeyClient = { from: (table: string) => any; rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };
interface OrganizationKeyRecord { id: string; organization_id: string; key_version: number; wrapped_key_ciphertext?: string | null; key_material?: string | null; status: string; activated_at?: string }
const organizationKeyCache = new Map<string, Promise<CryptoKey>>();
const keyAad = (organizationId: string, keyId: string, version: number) => encoder.encode(`ptx-workflow-org-key:${organizationId}:${keyId}:${version}`);
const dataAad = (organizationId: string, keyId: string) => encoder.encode(`ptx-workflow-data:${organizationId}:${keyId}`);
async function importAesKey(bytes: Uint8Array) { return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]); }
async function unwrapOrganizationKey(record: OrganizationKeyRecord) {
  const cacheKey = `${record.organization_id}:${record.id}`;
  let cached = organizationKeyCache.get(cacheKey);
  if (!cached) {
    if (organizationKeyCache.size >= 512) organizationKeyCache.delete(organizationKeyCache.keys().next().value!);
    cached = (async () => {
      if (record.key_material) {
        const bytes = unbase64(record.key_material);
        if (bytes.length !== 32) throw new HttpError(503, "Organization encryption key is invalid.");
        return importAesKey(bytes);
      }
      const [iv, ciphertext] = String(record.wrapped_key_ciphertext || "").split(".");
      if (!iv || !ciphertext) throw new HttpError(503, "Organization encryption key is invalid.");
      const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(iv), additionalData: keyAad(record.organization_id, record.id, record.key_version) }, await encryptionKey(), unbase64(ciphertext));
      return importAesKey(new Uint8Array(bytes));
    })();
    organizationKeyCache.set(cacheKey, cached);
    cached.catch(() => organizationKeyCache.delete(cacheKey));
  }
  return cached;
}
async function organizationKeyRecord(client: WorkflowKeyClient, organizationId: string, keyId?: string): Promise<OrganizationKeyRecord> {
  const { data, error } = await client.rpc("workflow_organization_key_material", { p_organization_id: organizationId, p_key_id: keyId ?? null });
  if (error) throw error;
  if (data) return data as OrganizationKeyRecord;
  if (keyId) throw new HttpError(503, "The organization encryption key required by this workflow is unavailable.");
  return createOrganizationKey(client, organizationId, null, "initialized");
}
export async function createOrganizationKey(client: WorkflowKeyClient, organizationId: string, actorUserId: string | null, reason = "rotated"): Promise<OrganizationKeyRecord> {
  const { data, error } = await client.rpc("activate_workflow_organization_vault_key", { p_organization_id: organizationId, p_actor_user_id: actorUserId, p_reason: reason });
  if (error) throw error;
  return data as OrganizationKeyRecord;
}
export async function encrypt(value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), encoder.encode(JSON.stringify(value)));
  return `${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}
export async function decrypt(value: string) {
  const [iv, ciphertext] = value.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(iv) }, await encryptionKey(), unbase64(ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
}
export async function encryptForOrganization(client: WorkflowKeyClient, organizationId: string, value: unknown) {
  const record = await organizationKeyRecord(client, organizationId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: dataAad(organizationId, record.id) }, await unwrapOrganizationKey(record), encoder.encode(JSON.stringify(value)));
  return `wok1.${record.id}.${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}
export async function decryptForOrganization(client: WorkflowKeyClient, organizationId: string, value: string) {
  if (!value.startsWith("wok1.")) return decrypt(value);
  const parts = value.split(".");
  if (parts.length !== 4) throw new HttpError(400, "Invalid organization-encrypted workflow data.");
  const [, keyId, iv, ciphertext] = parts;
  const record = await organizationKeyRecord(client, organizationId, keyId);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(iv), additionalData: dataAad(organizationId, keyId) }, await unwrapOrganizationKey(record), unbase64(ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
}
export function redact(value: unknown, secrets: string[] = [], depth = 0): unknown {
  if (depth > 8) return "[depth limit]";
  if (typeof value === "string") {
    let text = value;
    for (const secret of secrets) if (secret.length >= 6) text = text.split(secret).join("[redacted]");
    text = text.replace(/(Bearer|Basic)\s+[^\s"']+/gi, "$1 [redacted]");
    return text.length > 4000 ? text.slice(0, 4000) + "… [truncated]" : text;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, secrets, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 60).map(([key, item]) => [key,
    /secret|password|token|authorization|api.?key|base64|cookie/i.test(key) ? "[redacted]" : redact(item, secrets, depth + 1)]));
  return value ?? null;
}
export function collectSecrets(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const header = /authorization|api.?key|token|secret/i.test(String(record.key || record.name || "")) && typeof record.value === "string" ? [record.value] : [];
  return [...header, ...Object.entries(value).flatMap(([key, item]) => /secret|password|token|api.?key/i.test(key) && typeof item === "string" ? [item] : collectSecrets(item))];
}
/** Redact final results without truncating business data or array lengths. */
export function sanitizeOutput(value: unknown, secrets: string[] = []): any {
  if (typeof value === "string") {
    let text = value;
    for (const secret of secrets) if (secret) text = text.split(secret).join("[redacted]");
    return text.replace(/(Bearer|Basic)\s+[^\s"']+/gi, "$1 [redacted]");
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeOutput(item, secrets));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /secret|password|token|authorization|api.?key|cookie/i.test(key) ? "[redacted]" : sanitizeOutput(item, secrets)]));
  return value ?? null;
}
export function selectPath(value: unknown, path: string) {
  let current: any = value;
  for (const key of path.replace(/^\$\.?/, "").replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new HttpError(400, "Invalid input path.");
    current = current && typeof current === "object" && Object.hasOwn(current, key) ? current[key] : undefined;
  }
  return current;
}
export function mapWebhookInput(payload: unknown, mapping: Record<string, unknown>) {
  validateWebhookMapping(mapping);
  const permitted = new Set(["input", "userMessage", "docText", "conversationHistory"]);
  if (!Object.keys(mapping).length) return { input: payload };
  const result: Record<string, unknown> = {};
  for (const [target, path] of Object.entries(mapping)) {
    if (!permitted.has(target) || typeof path !== "string") throw new HttpError(400, "Webhook mapping supports input, userMessage, docText and conversationHistory paths.");
    const value = selectPath(payload, path);
    if (value === undefined) throw new HttpError(400, `Webhook input path ${path} was not found.`);
    result[target] = value;
  }
  return result;
}
export function validateWebhookMapping(mapping: Record<string, unknown>) {
  for (const [target, path] of Object.entries(mapping)) {
    if (!["input", "userMessage", "docText", "conversationHistory"].includes(target) || typeof path !== "string" || path.length > 500 || /(?:^|\.)(?:__proto__|prototype|constructor)(?:\.|$)/.test(path)) throw new HttpError(400, "Invalid webhook input mapping.");
  }
}
export function validateGraph(workflow: any) {
  const nodes = workflow?.graph?.nodes;
  const edges = workflow?.graph?.edges;
  if (!Array.isArray(nodes) || !Array.isArray(edges) || !nodes.length || nodes.length > 200 || edges.length > 1000) throw new HttpError(400, "Invalid workflow graph size.");
  const validId = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 200 && /^[A-Za-z0-9_.:-]+$/.test(value);
  const ids = new Set(nodes.map((node: any) => node.id));
  const allowed = new Set(["trigger", "document_context", "retrieval", "user_input", "event", "agent", "api", "plugin", "condition", "router", "parallel", "join", "output"]);
  const stateFields = workflow.state?.fields ?? [];
  if (!Array.isArray(stateFields) || stateFields.length > 100) throw new HttpError(400, "Workflow state supports at most 100 fields.");
  const stateKeys = new Set<string>();
  const stateTypes = new Set(["string", "number", "boolean", "object", "array", "any", "artifact"]);
  const reducers = new Set(["replace", "merge", "append", "append_unique", "sum", "min", "max", "first"]);
  const safeStatePath = /^(?!scratch(?:\.|$))[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/;
  const defaultMatches = (type: string, value: unknown) => value === undefined || type === "any"
    || (type === "string" && typeof value === "string") || (type === "number" && typeof value === "number" && Number.isFinite(value))
    || (type === "boolean" && typeof value === "boolean") || (type === "array" && Array.isArray(value))
    || (type === "object" && Boolean(value) && typeof value === "object" && !Array.isArray(value));
  for (const field of stateFields) {
    if (!field || typeof field !== "object" || typeof field.key !== "string" || !safeStatePath.test(field.key) || field.key.split(".").some((part: string) => ["__proto__", "prototype", "constructor"].includes(part)) || field.key.length > 200 || stateKeys.has(field.key)) throw new HttpError(400, "Workflow state keys must be unique safe dotted paths outside reserved and unsafe namespaces.");
    stateKeys.add(field.key);
    if (!stateTypes.has(field.type) || (field.reducer !== undefined && !reducers.has(field.reducer))) throw new HttpError(400, `Invalid workflow state definition for ${field.key}.`);
    if (field.maxBytes !== undefined && (!Number.isInteger(field.maxBytes) || field.maxBytes < 1 || field.maxBytes > 5 * 1024 * 1024)) throw new HttpError(400, `Invalid workflow state size for ${field.key}.`);
    if (!defaultMatches(field.type, field.defaultValue)) throw new HttpError(400, `Default value does not match the type of workflow state ${field.key}.`);
    if (field.reducer === "append_unique" && (typeof field.identityPath !== "string" || !field.identityPath || field.identityPath.length > 200)) throw new HttpError(400, `Workflow state ${field.key} requires an identity path.`);
    if (["append", "append_unique"].includes(field.reducer) && field.type !== "array") throw new HttpError(400, `Workflow state ${field.key} must be an array for ${field.reducer}.`);
    if (field.reducer === "merge" && field.type !== "object" && field.type !== "any") throw new HttpError(400, `Workflow state ${field.key} must be an object for merge.`);
    if (["sum", "min", "max"].includes(field.reducer) && field.type !== "number") throw new HttpError(400, `Workflow state ${field.key} must be numeric for ${field.reducer}.`);
    if (field.type === "artifact" && field.reducer !== undefined && !["replace", "first"].includes(field.reducer)) throw new HttpError(400, `Workflow artifact state ${field.key} supports replace or first reducers only.`);
    for (const permission of [field.allowedReaders, field.allowedWriters]) if (permission !== undefined && (!Array.isArray(permission) || permission.length > 200 || permission.some((id: unknown) => !validId(id) || !ids.has(id)))) throw new HttpError(400, `Workflow state ${field.key} has invalid node permissions.`);
    if (field.allowInAgentPrompt !== undefined && typeof field.allowInAgentPrompt !== "boolean") throw new HttpError(400, `Invalid agent visibility for workflow state ${field.key}.`);
    if (field.allowInApiRequest !== undefined && typeof field.allowInApiRequest !== "boolean") throw new HttpError(400, `Invalid API visibility for workflow state ${field.key}.`);
  }
  let graphBytes = 0; try { graphBytes = encoder.encode(JSON.stringify(workflow.graph)).byteLength; } catch { throw new HttpError(400, "Workflow graph must be JSON-serializable."); }
  if (graphBytes > 5 * 1024 * 1024) throw new HttpError(400, "Workflow graph exceeds the 5 MB configuration limit.");
  if (ids.size !== nodes.length || nodes.filter((node: any) => node.type === "trigger").length !== 1 || !nodes.some((node: any) => node.type === "output")) throw new HttpError(400, "Workflow needs unique node IDs, one trigger, and an output node.");
  const sideEffects = new Set(["read_only", "idempotent", "non_idempotent"]);
  for (const node of nodes) {
    if (!validId(node.id) || !allowed.has(node.type) || !object(node.data)) throw new HttpError(400, "Invalid workflow node.");
    const data = object(node.data);
    if (node.stateReads !== undefined && (!Array.isArray(node.stateReads) || node.stateReads.length > 100)) throw new HttpError(400, `Invalid state reads on node ${node.id}.`);
    if (node.stateWrites !== undefined && (!Array.isArray(node.stateWrites) || node.stateWrites.length > 100)) throw new HttpError(400, `Invalid state writes on node ${node.id}.`);
    for (const read of node.stateReads ?? []) {
      const dynamic = workflow.state?.allowDynamicScratch && typeof read?.key === "string" && read.key.startsWith("scratch.");
      if (!read || typeof read.key !== "string" || (!stateKeys.has(read.key) && !dynamic) || (read.alias !== undefined && (typeof read.alias !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(read.alias))) || (read.artifactMode !== undefined && !["reference", "content"].includes(read.artifactMode))) throw new HttpError(400, `Invalid state read on node ${node.id}.`);
      const field = stateFields.find((item: any) => item.key === read.key);
      if (read.artifactMode === "content" && field?.type !== "artifact") throw new HttpError(400, `Node ${node.id} requests artifact content from non-artifact state ${read.key}.`);
      if (field?.allowedReaders?.length && !field.allowedReaders.includes(node.id)) throw new HttpError(400, `Node ${node.id} is not allowed to read workflow state ${read.key}.`);
      if (node.type === "agent" && field && (field.allowInAgentPrompt ?? !field.sensitive) !== true) throw new HttpError(400, `Agent node ${node.id} cannot receive workflow state ${read.key}.`);
      if (node.type === "api" && field && (field.allowInApiRequest ?? !field.sensitive) !== true) throw new HttpError(400, `API node ${node.id} cannot receive workflow state ${read.key}.`);
    }
    for (const write of node.stateWrites ?? []) {
      const dynamic = workflow.state?.allowDynamicScratch && typeof write?.key === "string" && write.key.startsWith("scratch.");
      if (!write || typeof write.key !== "string" || (!stateKeys.has(write.key) && !dynamic) || (write.reducer !== undefined && !reducers.has(write.reducer)) || (write.sourcePath !== undefined && (typeof write.sourcePath !== "string" || write.sourcePath.length > 500 || /(?:^|\.)(?:__proto__|prototype|constructor)(?:\.|$)/.test(write.sourcePath)))) throw new HttpError(400, `Invalid state write on node ${node.id}.`);
      const field = stateFields.find((item: any) => item.key === write.key);
      if (field?.allowedWriters?.length && !field.allowedWriters.includes(node.id)) throw new HttpError(400, `Node ${node.id} is not allowed to write workflow state ${write.key}.`);
      const reducer = write.reducer ?? field?.reducer ?? "replace";
      if (["append", "append_unique"].includes(reducer) && field && field.type !== "array") throw new HttpError(400, `Node ${node.id} uses an array reducer for non-array state ${write.key}.`);
      if (reducer === "merge" && field && !["object", "any"].includes(field.type)) throw new HttpError(400, `Node ${node.id} merges non-object state ${write.key}.`);
      if (["sum", "min", "max"].includes(reducer) && field && field.type !== "number") throw new HttpError(400, `Node ${node.id} uses a numeric reducer for non-numeric state ${write.key}.`);
    }
    if (data.label !== undefined && (typeof data.label !== "string" || data.label.length > 500)) throw new HttpError(400, `Invalid label on node ${node.id}.`);
    for (const field of ["code", "expression", "transformCode", "promptOverride", "inlineSystemPrompt", "question", "body"]) if (data[field] !== undefined && (typeof data[field] !== "string" || data[field].length > 100_000)) throw new HttpError(400, `Invalid ${field} on node ${node.id}.`);
    if (["agent", "api"].includes(node.type)) {
      if (data.timeoutSeconds !== undefined && (!Number.isFinite(data.timeoutSeconds) || data.timeoutSeconds < 1 || data.timeoutSeconds > 600)) throw new HttpError(400, `Invalid timeout on node ${node.id}.`);
      if (data.sideEffectClass !== undefined && !sideEffects.has(data.sideEffectClass)) throw new HttpError(400, `Invalid side-effect class on node ${node.id}.`);
      const retry = object(data.retryPolicy);
      if (Object.keys(retry).length) {
        if ((data.sideEffectClass ?? (node.type === "api" && data.method === "GET" ? "read_only" : "non_idempotent")) === "non_idempotent") throw new HttpError(400, `Non-idempotent node ${node.id} cannot enable retries.`);
        if (retry.maxAttempts !== undefined && (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1 || retry.maxAttempts > 10)) throw new HttpError(400, `Invalid retry attempts on node ${node.id}.`);
        if (retry.initialDelayMs !== undefined && (!Number.isFinite(retry.initialDelayMs) || retry.initialDelayMs < 0 || retry.initialDelayMs > 60_000)) throw new HttpError(400, `Invalid retry delay on node ${node.id}.`);
        if (retry.maxDelayMs !== undefined && (!Number.isFinite(retry.maxDelayMs) || retry.maxDelayMs < 0 || retry.maxDelayMs > 300_000)) throw new HttpError(400, `Invalid retry maximum delay on node ${node.id}.`);
      }
    }
    if (node.type === "agent" && data.mode !== "inline" && (typeof data.agentId !== "string" || !data.agentId.trim())) throw new HttpError(400, `Existing-agent node ${node.id} has no agent selected.`);
    if (node.type === "api" && (!['GET','POST','PUT','PATCH','DELETE'].includes(data.method) || typeof data.url !== "string" || !/^https?:\/\//i.test(data.url) || data.url.length > 4000)) throw new HttpError(400, `Invalid API configuration on node ${node.id}.`);
    if (node.type === "user_input" && (!['text','yes_no','select'].includes(data.inputType) || typeof data.question !== "string" || !data.question.trim())) throw new HttpError(400, `Invalid user-input configuration on node ${node.id}.`);
    if (node.type === "event") {
      if (!['state_changed','external_signal'].includes(String(data.eventType))) throw new HttpError(400, `Invalid event type on node ${node.id}.`);
      if (data.eventType === "external_signal" && (typeof data.signalName !== "string" || !/^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(data.signalName))) throw new HttpError(400, `Invalid external signal name on node ${node.id}.`);
      if (data.eventType === "state_changed") {
        if (typeof data.stateKey !== "string" || !stateKeys.has(data.stateKey)) throw new HttpError(400, `State event node ${node.id} references unknown state.`);
        const field = stateFields.find((item: any) => item.key === data.stateKey);
        if (field?.allowedReaders?.length && !field.allowedReaders.includes(node.id)) throw new HttpError(400, `Node ${node.id} is not allowed to observe workflow state ${data.stateKey}.`);
      }
    }
    if (["plugin", "retrieval"].includes(node.type) && typeof data.code !== "string") throw new HttpError(400, `Node ${node.id} requires JavaScript code.`);
    if (node.type === "condition" && typeof data.expression !== "string") throw new HttpError(400, `Condition ${node.id} requires an expression.`);
    if (node.type === "parallel" && (!Number.isInteger(data.maxConcurrency) || data.maxConcurrency < 1 || data.maxConcurrency > 32 || !["fail_fast", "all_settled"].includes(String(data.failurePolicy)))) throw new HttpError(400, `Parallel node ${node.id} has invalid concurrency or failure policy.`);
    if (node.type === "join" && (typeof data.parallelNodeId !== "string" || !ids.has(data.parallelNodeId) || !["all", "all_settled", "any", "quorum"].includes(String(data.mode)) || (data.mode === "quorum" && (!Number.isInteger(data.quorum) || data.quorum < 1 || data.quorum > 32)))) throw new HttpError(400, `Join node ${node.id} has invalid parallel-group settings.`);
  }
  const sources = nodes.find((node: any) => node.type === "trigger").data.inputSources;
  if (sources !== undefined && (!Array.isArray(sources) || !sources.length || sources.some((source: unknown) => !["input", "result", "document", "user_upload"].includes(String(source))))) throw new HttpError(400, "Invalid workflow input sources.");
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (!validId(edge.id) || edgeIds.has(edge.id) || !ids.has(edge.source) || !ids.has(edge.target)) throw new HttpError(400, "Workflow connection is invalid or references an unknown node.");
    edgeIds.add(edge.id);
    if (edge.dataPath !== undefined && (typeof edge.dataPath !== "string" || edge.dataPath.length > 500 || /(?:^|\.)(?:__proto__|prototype|constructor)(?:\.|$)/.test(edge.dataPath))) throw new HttpError(400, `Invalid data path on connection ${edge.id}.`);
    const source = nodes.find((node: any) => node.id === edge.source);
    if (source.type === "condition" && !/^(true|false)(?:-(?:top|right|bottom|left))?$/.test(edge.sourceHandle || "")) throw new HttpError(400, `Condition connection ${edge.id} needs a true or false branch.`);
    if (source.type === "router" && !/^route-.+/.test(edge.sourceHandle || "")) throw new HttpError(400, `Router connection ${edge.id} needs a route handle.`);
  }
  const trigger = nodes.find((node: any) => node.type === "trigger");
  const reachable = new Set<string>([trigger.id]);
  const queue = [trigger.id];
  while (queue.length) {
    const sourceId = queue.shift();
    for (const edge of edges.filter((item: any) => item.source === sourceId)) if (!reachable.has(edge.target)) { reachable.add(edge.target); queue.push(edge.target); }
  }
  const unreachable = nodes.filter((node: any) => !reachable.has(node.id));
  if (unreachable.length) throw new HttpError(400, `Workflow contains unreachable nodes: ${unreachable.slice(0, 5).map((node: any) => node.id).join(", ")}.`);
  if (!nodes.some((node: any) => node.type === "output" && reachable.has(node.id))) throw new HttpError(400, "Workflow has no reachable output node.");
  // Parallel blocks are deliberately structured. Each direct branch is a
  // linear, disjoint safe path ending at one explicit Join. This gives the
  // worker real concurrency without making crash recovery replay an unknown
  // non-idempotent action or merge shared state in completion order.
  for (const parallel of nodes.filter((node: any) => node.type === "parallel")) {
    const outgoing = edges.filter((edge: any) => edge.source === parallel.id);
    const joins = nodes.filter((node: any) => node.type === "join" && node.data.parallelNodeId === parallel.id);
    if (outgoing.length < 2 || joins.length !== 1) throw new HttpError(400, `Parallel node ${parallel.id} needs at least two branches and exactly one matching Join node.`);
    const join = joins[0]; const branchNodes = new Set<string>();
    for (const branch of outgoing) {
      let current = branch.target; const seen = new Set<string>();
      while (current !== join.id) {
        if (seen.has(current)) throw new HttpError(400, `Parallel branch from ${parallel.id} contains a cycle.`);
        seen.add(current);
        if (branchNodes.has(current)) throw new HttpError(400, `Parallel branches from ${parallel.id} merge before Join ${join.id}.`);
        branchNodes.add(current);
        const node = nodes.find((item: any) => item.id === current);
        if (!node || ["trigger", "document_context", "user_input", "event", "condition", "router", "parallel", "join", "output"].includes(node.type)) throw new HttpError(400, `Parallel branch ${parallel.id} contains unsupported node ${current}; use safe agent, API, retrieval, or JavaScript nodes before the Join.`);
        const sideEffect = node.type === "api" ? (node.data.sideEffectClass ?? (node.data.method === "GET" ? "read_only" : "non_idempotent")) : node.type === "agent" ? (node.data.sideEffectClass ?? "non_idempotent") : "pure";
        if (sideEffect === "non_idempotent") throw new HttpError(400, `Parallel branch node ${current} must be read-only or idempotent for durable crash recovery.`);
        if ((node.stateWrites ?? []).length) throw new HttpError(400, `Parallel branch node ${current} cannot write shared state; merge branch outputs at Join ${join.id}.`);
        const next = edges.filter((edge: any) => edge.source === current);
        if (next.length !== 1) throw new HttpError(400, `Parallel branch node ${current} must have one connection leading toward Join ${join.id}.`);
        current = next[0].target;
      }
    }
    const incoming = edges.filter((edge: any) => edge.target === join.id);
    if (incoming.length !== outgoing.length) throw new HttpError(400, `Join ${join.id} must receive exactly one connection from every branch of ${parallel.id}.`);
    if (join.data.mode === "quorum" && join.data.quorum > outgoing.length) throw new HttpError(400, `Join ${join.id} quorum cannot exceed its branch count.`);
  }
  const canReach = (source: string, target: string) => {
    const seen = new Set<string>([source]); const pending = [source];
    while (pending.length) { const current = pending.shift()!; for (const edge of edges.filter((item: any) => item.source === current)) { if (edge.target === target) return true; if (!seen.has(edge.target)) { seen.add(edge.target); pending.push(edge.target); } } }
    return false;
  };
  for (const eventNode of nodes.filter((node: any) => node.type === "event" && node.data.eventType === "state_changed")) {
    const writers = nodes.filter((node: any) => (node.stateWrites ?? []).some((write: any) => write.key === eventNode.data.stateKey));
    if (!writers.some((writer: any) => canReach(writer.id, eventNode.id))) throw new HttpError(400, `State event node ${eventNode.id} needs an upstream writer for ${eventNode.data.stateKey}.`);
  }
  for (const field of stateFields) {
    const writers = nodes.filter((node: any) => (node.stateWrites ?? []).some((write: any) => write.key === field.key && (write.reducer ?? field.reducer ?? "replace") === "replace"));
    for (let left = 0; left < writers.length; left++) for (let right = left + 1; right < writers.length; right++) {
      if (!canReach(writers[left].id, writers[right].id) && !canReach(writers[right].id, writers[left].id)) throw new HttpError(400, `Parallel nodes ${writers[left].id} and ${writers[right].id} both replace workflow state ${field.key}; choose a reducer or serialize the writers.`);
    }
  }
  const hosts = workflow.execution?.allowedOutboundHosts;
  if (hosts !== undefined && (!Array.isArray(hosts) || hosts.length > 100 || hosts.some((host: unknown) => typeof host !== "string" || host.length > 253 || !/^(?:\*\.)?[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(host)))) throw new HttpError(400, "Invalid outbound hostname allowlist.");
}

export const WORKFLOW_COMPILER_VERSION = 2;
export function compileWorkflow(workflow: any) {
  const compiled = structuredClone(workflow);
  compiled.state = { fields: [], allowDynamicScratch: false, ...compiled.state };
  compiled.graph.nodes = compiled.graph.nodes.map((node: any) => {
    const data = { label: node.data?.label || node.type, ...node.data };
    if (node.type === "agent") { data.timeoutSeconds ??= 120; data.sideEffectClass ??= "non_idempotent"; }
    if (node.type === "api") { data.timeoutSeconds ??= 20; data.sideEffectClass ??= data.method === "GET" ? "read_only" : "non_idempotent"; }
    if (node.type === "user_input") { data.responseTimeoutHours ??= 48; data.reminderIntervalHours ??= 12; data.maxReminders ??= 3; }
    if (node.type === "parallel") { data.maxConcurrency ??= 4; data.failurePolicy ??= "fail_fast"; }
    if (node.type === "join") { data.mode ??= "all"; }
    return { ...node, data };
  });
  compiled.graph.edges = compiled.graph.edges.map((edge: any) => ({ ...edge, ...(typeof edge.dataPath === "string" ? { dataPath: edge.dataPath.trim() || undefined } : {}) }));
  compiled.compilerVersion = WORKFLOW_COMPILER_VERSION;
  validateGraph(compiled);
  return compiled;
}
