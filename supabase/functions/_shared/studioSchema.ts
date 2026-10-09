/** Shared persistence contract; only allowlisted component properties reach published pages. */
export type StudioKind = "application" | "page" | "canvas" | "chat";
export interface StudioElement {
  id: string;
  type: "heading" | "text" | "json-input" | "workflow-button" | "result" | "html" | "chat" | "knowledge" | "legacy-gateway";
  label: string;
  content?: string;
  workflowId?: string;
  chatId?: string;
  knowledgeId?: string;
  knowledgeView?: "document" | "skill" | "mapping" | "job";
  enabled?: boolean;
  binding?: string;
  css?: string;
  javascript?: string;
  responsive?: { mobile: number; tablet: number; desktop: number };
  appearance?: { padding: number; radius: number; color: string; background: string; align: "left" | "center" | "right"; minHeight: number };

}
export interface StudioDefinition {
  schemaVersion: 1;
  title: string;
  description: string;
  elements: StudioElement[];
  pageIds: string[];
  layout: "tabs" | "grid";
  targetResourceId: string;
  agentIds: string[];
  workflowIds: string[];
  prompts: string[];
  allowedOrigins: string[];
  allowEmbedding: boolean;
}
const kinds: StudioKind[] = ["application", "page", "canvas", "chat"];
export function studioKind(value: unknown): StudioKind {
  if (!kinds.includes(value as StudioKind)) throw new Error("Invalid Studio item type.");
  return value as StudioKind;
}
export function studioSlug(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value)) throw new Error("Use a slug of 1–80 lowercase letters, digits or hyphens.");
  return value;
}
export function studioUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid Studio identifier.");
  return value;
}
function text(value: unknown, maximum: number, fallback = ""): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > maximum) throw new Error(`Text must be at most ${maximum} characters.`);
  return value;
}
function strings(value: unknown, maximum: number, length: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`Expected at most ${maximum} entries.`);
  return value.map((entry) => text(entry, length));
}
function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`Expected an integer from ${min} to ${max}.`);
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a settings object.");
  return value as Record<string, unknown>;
}
function color(value: unknown): string {
  const result = text(value, 9);
  if (result && !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(result)) throw new Error("Colors must be #RRGGBB or #RRGGBBAA.");
  return result;
}
export function validateStudioDefinition(kind: StudioKind, raw: unknown): StudioDefinition {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("A page definition object is required.");
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== 1) throw new Error("Unsupported Studio schema version.");
  const title = text(value.title, 160).trim();
  if (!title) throw new Error("A title is required.");
  const elements: StudioElement[] = [];
  if (kind === "page") {
    if (!Array.isArray(value.elements) || value.elements.length > 100) throw new Error("A page requires an element list of at most 100 items.");
    const ids = new Set<string>();
    for (const rawElement of value.elements) {
      if (!rawElement || typeof rawElement !== "object" || Array.isArray(rawElement)) throw new Error("Invalid page element.");
      const element = rawElement as Record<string, unknown>;
      const id = text(element.id, 80);
      if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error("Element IDs must be unique letters, digits, underscores or hyphens.");
      ids.add(id);
      if (!["heading", "text", "json-input", "workflow-button", "result", "html", "chat", "knowledge", "legacy-gateway"].includes(String(element.type))) throw new Error("Unsupported page element.");
      const type = element.type as StudioElement["type"];
      const next: StudioElement = { id, type, label: text(element.label, 160), content: text(element.content, 100_000) };
      if (type === "workflow-button") {
        next.workflowId = text(element.workflowId, 200);
        if (!next.workflowId && element.enabled !== false) throw new Error("Workflow buttons require a workflow ID.");
      }
      if (type === "chat") next.chatId = !element.chatId && element.enabled === false ? "" : studioUuid(element.chatId);
      if (type === "knowledge") {
        next.knowledgeId = studioUuid(element.knowledgeId);
        if (!["document", "skill", "mapping", "job"].includes(String(element.knowledgeView))) throw new Error("Knowledge components require a valid view.");
        next.knowledgeView = element.knowledgeView as StudioElement["knowledgeView"];
      }
      if (element.enabled !== undefined) {
        if (typeof element.enabled !== "boolean") throw new Error("Element activation must be a boolean.");
        next.enabled = element.enabled;
      }
      if (element.binding !== undefined) {
        next.binding = text(element.binding, 300);
        if (next.binding && (!/^(result|input)(\.[a-zA-Z0-9_-]+)*$/.test(next.binding) || next.binding.split(".").some((part) => ["__proto__", "prototype", "constructor"].includes(part)))) throw new Error("Bindings must be result or input followed by safe dot-separated property names.");
      }
      if (type === "html") { next.css = text(element.css, 100_000); next.javascript = text(element.javascript, 100_000); }
      if (element.responsive !== undefined) {
        const sizes = record(element.responsive);
        next.responsive = { mobile: boundedNumber(sizes.mobile, 12, 1, 12), tablet: boundedNumber(sizes.tablet, 12, 1, 12), desktop: boundedNumber(sizes.desktop, 12, 1, 12) };
      }
      if (element.appearance !== undefined) {
        const style = record(element.appearance);
        if (style.align !== undefined && !["left", "center", "right"].includes(String(style.align))) throw new Error("Invalid text alignment.");
        next.appearance = { padding: boundedNumber(style.padding, 0, 0, 64), radius: boundedNumber(style.radius, 0, 0, 48), minHeight: boundedNumber(style.minHeight, 0, 0, 1600), color: color(style.color), background: color(style.background), align: (style.align || "left") as "left" | "center" | "right" };
      }
      elements.push(next);
    }
    if (elements.filter((element) => element.type === "json-input").length > 1) throw new Error("Pages support one shared JSON input in this schema version.");
  }
  const allowedOrigins = kind === "chat" ? strings(value.allowedOrigins, 30, 500).map((entry) => {
    const url = new URL(entry);
    if (url.hostname.includes("*") || !["https:", "http:"].includes(url.protocol) || url.origin !== entry || (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Embed origins must be exact HTTPS origins (HTTP localhost is allowed for development).");
    return url.origin;
  }) : [];
  const pageIds = kind === "canvas" ? strings(value.pageIds, 30, 36).map(studioUuid) : [];
  if (new Set(pageIds).size !== pageIds.length) throw new Error("A canvas cannot contain duplicate pages.");
  return { schemaVersion: 1, title, description: text(value.description, 2000), elements, pageIds,
    layout: value.layout === "grid" ? "grid" : "tabs", targetResourceId: kind === "chat" ? text(value.targetResourceId, 200) : "",
    agentIds: kind === "chat" ? strings(value.agentIds, 100, 200) : [],
    workflowIds: kind === "chat" ? strings(value.workflowIds, 100, 200) : [],
    prompts: kind === "chat" ? strings(value.prompts, 30, 2000) : [], allowedOrigins,
    allowEmbedding: kind === "chat" && value.allowEmbedding === true };
}
