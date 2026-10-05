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
  const allowed = new Set(["trigger", "document_context", "retrieval", "user_input", "agent", "api", "plugin", "condition", "router", "output"]);
  if (!Array.isArray(nodes) || !Array.isArray(edges) || !nodes.length || nodes.length > 200 || edges.length > 1000) throw new HttpError(400, "Invalid workflow graph size.");
  const ids = new Set(nodes.map((node: any) => node.id));
  if (ids.size !== nodes.length || nodes.filter((node: any) => node.type === "trigger").length !== 1 || !nodes.some((node: any) => node.type === "output")) throw new HttpError(400, "Workflow needs unique node IDs, one trigger, and an output node.");
  for (const node of nodes) if (typeof node.id !== "string" || !allowed.has(node.type) || !node.data) throw new HttpError(400, "Invalid workflow node.");
  const sources = nodes.find((node: any) => node.type === "trigger").data.inputSources;
  if (sources !== undefined && (!Array.isArray(sources) || !sources.length || sources.some((source: unknown) => !["result", "document", "user_upload"].includes(String(source))))) throw new HttpError(400, "Invalid workflow input sources.");
  for (const edge of edges) if (!ids.has(edge.source) || !ids.has(edge.target)) throw new HttpError(400, "Workflow connection references an unknown node.");
}
