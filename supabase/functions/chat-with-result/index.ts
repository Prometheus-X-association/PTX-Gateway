import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-organization-id",
};

const LOCAL_SUPABASE_URL_FALLBACK = "http://kong:8000";
const LOCAL_SUPABASE_ANON_KEY_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SUPABASE_SERVICE_ROLE_KEY_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const LOCAL_SUPABASE_JWT_FALLBACK =
  "super-secret-jwt-token-with-at-least-32-characters-long";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface LlmProvider {
  id?: string;
  name?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
  enabled?: boolean;
  providerType?: "openai" | "anthropic" | "gemini" | "openai_compatible";
}

interface LlmAttachment {
  name: string;
  mimeType: string;
  size: number;
  base64: string;
}

interface McpServerConfig {
  id?: string;
  name?: string;
  url?: string;
  apiKey?: string;
  enabled?: boolean;
}

interface McpSession {
  sessionId?: string;
  protocolVersion: string;
}

interface McpResponse {
  json: Record<string, unknown>;
  sessionId?: string;
}

interface DiscoveredMcpTool {
  rawName: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface McpToolBinding {
  server: McpServerConfig;
  session: McpSession;
  rawName: string;
}

interface LlmAgent {
  id?: string;
  name?: string;
  systemPrompt?: string;
  expectedOutput?: string;
  fallbackOutput?: "text" | "json" | "html" | "mixed";
  outputInstructions?: string;
  mcpServerIds?: string[];
  mcpToolFilter?: Record<string, string[]>;
  providerIds?: string[];
  agentProviders?: LlmProvider[];
  defaultPrompts?: string[];
  skillIds?: string[];
  enabled?: boolean;
  resultContextMode?: "full" | "chunked";
  resultChunkSize?: number;
}

interface AgentSkillInputField {
  key?: string;
  label?: string;
  type?: string;
  description?: string;
  required?: boolean;
  defaultValue?: string;
}

interface AgentSkillReference {
  name?: string;
  description?: string;
  content?: string;
}

interface AgentSkill {
  id?: string;
  name?: string;
  description?: string;
  objective?: string;
  instructions?: string;
  requiredInputs?: AgentSkillInputField[];
  outputTemplate?: string;
  outputType?: "text" | "json" | "html" | "mixed";
  references?: AgentSkillReference[];
  enabled?: boolean;
  version?: number;
}

interface LlmInsightsConfig {
  enabled?: boolean;
  providers?: LlmProvider[];
  chatSystemPrompt?: string;
  mcpServers?: McpServerConfig[];
  predefinedPrompts?: string[];
  agents?: LlmAgent[];
  skills?: AgentSkill[];
  // legacy flat fields
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
}

interface ChatRequest {
  messages: Array<{ role: string; content: string }>;
  result?: unknown;
  /** Immediate input received from the previous workflow node. */
  inputData?: unknown;
  /** Workflow/node IDs let inline workflow providers be resolved server-side. */
  workflowId?: string;
  nodeId?: string;
  org_execution_token?: string;
  agentId?: string;
  /** Inline agent: system prompt provided directly, bypassing agent lookup */
  systemPrompt?: string;
  /** Inline agent: expected output format */
  outputType?: "auto" | "text" | "json" | "html" | "mixed";
  /** Inline agent: format used when no assigned skill activates. */
  fallbackOutputType?: "text" | "json" | "html" | "mixed";
  /** Skills attached to an inline workflow agent. Saved agents use their configured skillIds. */
  skillIds?: string[];
  /** Inline agent: global provider IDs in priority order. */
  providerIds?: string[];
  /** Inline agent: node-specific providers tried before selected global providers. */
  agentProviders?: LlmProvider[];
  /** Original file bytes for provider-native document input. */
  attachment?: LlmAttachment;
}

interface ExecutionTokenPayload {
  typ: string;
  org_id: string;
  exp: number;
}

// ─── Auth helpers (mirrored from llm-insights) ────────────────────────────────

const textEncoder = new TextEncoder();

const fromBase64Url = (input: string): string => {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
  return atob(padded);
};

const sign = async (data: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, textEncoder.encode(data));
  let str = "";
  new Uint8Array(sig).forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const verify = async (
  data: string,
  signature: string,
  secret: string
): Promise<boolean> => (await sign(data, secret)) === signature;

const resolveAuthenticatedOrgContext = async (
  supabaseUrl: string,
  supabaseAnonKey: string,
  authHeader: string,
  requestedOrgId: string | null
): Promise<{ orgId: string } | null> => {
  try {
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return null;
    if (requestedOrgId) {
      const { data: member } = await client
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .eq("organization_id", requestedOrgId)
        .eq("status", "active")
        .maybeSingle();
      if (member) return { orgId: requestedOrgId };
    }
    const { data: membership } = await client
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    return membership ? { orgId: membership.organization_id } : null;
  } catch {
    return null;
  }
};

const resolvePublicOrgContext = async (
  token: string | undefined,
  secret: string
): Promise<{ orgId: string } | null> => {
  if (!token) return null;
  try {
    const [header, payload, signature] = token.split(".");
    if (!header || !payload || !signature) return null;
    const valid = await verify(`${header}.${payload}`, signature, secret);
    if (!valid) return null;
    const decoded = JSON.parse(fromBase64Url(payload)) as ExecutionTokenPayload;
    if (decoded.typ !== "execute" || !decoded.org_id) return null;
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return { orgId: decoded.org_id };
  } catch {
    return null;
  }
};

// ─── Provider helpers ─────────────────────────────────────────────────────────

const resolveProviders = (cfg: LlmInsightsConfig): LlmProvider[] => {
  if (Array.isArray(cfg.providers) && cfg.providers.length > 0) {
    return cfg.providers.filter((p) => p.enabled !== false);
  }
  if (cfg.apiKey?.trim()) {
    return [{
      apiBaseUrl: cfg.apiBaseUrl || "https://api.openai.com/v1",
      apiKey: cfg.apiKey,
      model: cfg.model || "gpt-4o-mini",
      enabled: true,
    }];
  }
  return [];
};

// Resolve providers for a specific agent:
//   1. Agent-specific providers come first (highest priority)
//   2. Then global providers filtered to agent's providerIds selection
//   3. If no providerIds set, all global providers are used as fallback
const resolveAgentProviders = (agent: LlmAgent, cfg: LlmInsightsConfig): LlmProvider[] => {
  const agentSpecific = (agent.agentProviders ?? []).filter((p) => p.enabled !== false);
  const globalAll = resolveProviders(cfg);
  const globalSelected = (agent.providerIds ?? []).length > 0
    ? (agent.providerIds ?? [])
        .map((id) => globalAll.find((p) => p.id === id))
        .filter((p): p is LlmProvider => Boolean(p))
    : globalAll;
  return [...agentSpecific, ...globalSelected];
};

const providerErrorDetail = (raw: string): string => {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const error = parsed.error;
    if (error && typeof error === "object") {
      const value = error as Record<string, unknown>;
      const message = typeof value.message === "string" ? value.message : "";
      const code = typeof value.code === "string" ? value.code : "";
      return [code, message].filter(Boolean).join(": ").slice(0, 600);
    }
  } catch { /* use plain-text response below */ }
  return raw.replace(/\s+/g, " ").trim().slice(0, 600);
};

const providerFamily = (provider: LlmProvider): NonNullable<LlmProvider["providerType"]> => {
  if (provider.providerType) return provider.providerType;
  const url = (provider.apiBaseUrl ?? "").toLowerCase();
  if (url.includes("anthropic.com")) return "anthropic";
  if (url.includes("generativelanguage.googleapis.com")) return "gemini";
  if (url.includes("api.openai.com")) return "openai";
  return "openai_compatible";
};

const conversationText = (messages: ChatMessage[]): string => messages
  .filter((message) => message.role !== "system")
  .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
  .join("\n\n");

// Non-streaming LLM call — returns full message (used in tool-use loop)
const callLlmOnce = async (
  providers: LlmProvider[],
  messages: ChatMessage[],
  tools?: OpenAITool[],
  jsonMode?: boolean
): Promise<{ message: ChatMessage; providerName: string }> => {
  const errors: string[] = [];
  for (const p of providers) {
    const apiKey = p.apiKey?.trim();
    const model = p.model?.trim();
    const family = providerFamily(p);
    const baseUrl = (p.apiBaseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
    if ((!apiKey && family !== "openai_compatible") || !model) continue;
    const url = baseUrl.endsWith("/chat/completions")
      ? baseUrl
      : `${baseUrl}/chat/completions`;
    try {
      if (family === "anthropic") {
        const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
        const anthropicMessages = messages.filter((message) => message.role !== "system").map((message) => {
          if (message.role === "assistant" && message.tool_calls?.length) {
            return {
              role: "assistant",
              content: [
                ...(message.content ? [{ type: "text", text: message.content }] : []),
                ...message.tool_calls.map((call) => {
                  let input: unknown = {};
                  try { input = JSON.parse(call.function.arguments); } catch { input = {}; }
                  return { type: "tool_use", id: call.id, name: call.function.name, input };
                }),
              ],
            };
          }
          if (message.role === "tool") {
            return { role: "user", content: [{ type: "tool_result", tool_use_id: message.tool_call_id, content: message.content }] };
          }
          return { role: message.role === "assistant" ? "assistant" : "user", content: message.content };
        });
        const anthropicUrl = baseUrl.endsWith("/messages") ? baseUrl : `${baseUrl}/messages`;
        const resp = await fetch(anthropicUrl, {
          method: "POST",
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
          body: JSON.stringify({
            model, max_tokens: 4096, system, messages: anthropicMessages,
            ...(tools?.length ? { tools: tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters })) } : {}),
          }),
          signal: AbortSignal.timeout(90_000),
        });
        const raw = await resp.text();
        if (!resp.ok) { errors.push(`${p.name || model}: ${resp.status} — ${providerErrorDetail(raw)}`); continue; }
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const blocks = Array.isArray(parsed.content) ? parsed.content as Array<Record<string, unknown>> : [];
        const text = blocks.filter((block) => block.type === "text").map((block) => String(block.text || "")).join("\n");
        const toolCalls: ToolCall[] = blocks.filter((block) => block.type === "tool_use").map((block) => ({
          id: String(block.id || crypto.randomUUID()),
          type: "function" as const,
          function: { name: String(block.name || ""), arguments: JSON.stringify(block.input ?? {}) },
        }));
        return { message: { role: "assistant", content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, providerName: p.name || model };
      }

      if (family === "gemini") {
        const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
        const geminiContents = messages.filter((message) => message.role !== "system").map((message) => {
          if (message.role === "assistant" && message.tool_calls?.length) {
            return {
              role: "model",
              parts: [
                ...(message.content ? [{ text: message.content }] : []),
                ...message.tool_calls.map((call) => {
                  let args: unknown = {};
                  try { args = JSON.parse(call.function.arguments); } catch { args = {}; }
                  return { functionCall: { name: call.function.name, args } };
                }),
              ],
            };
          }
          if (message.role === "tool") {
            return { role: "user", parts: [{ functionResponse: { name: message.name || "tool", response: { result: message.content } } }] };
          }
          return { role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] };
        });
        const geminiUrl = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const resp = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] }, contents: geminiContents,
            ...(tools?.length ? { tools: [{ functionDeclarations: tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters })) }] } : {}),
          }),
          signal: AbortSignal.timeout(90_000),
        });
        const raw = await resp.text();
        if (!resp.ok) { errors.push(`${p.name || model}: ${resp.status} — ${providerErrorDetail(raw)}`); continue; }
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const candidates = parsed.candidates as Array<Record<string, unknown>> | undefined;
        const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
        const parts = Array.isArray(content?.parts) ? content.parts as Array<Record<string, unknown>> : [];
        const text = parts.filter((part) => typeof part.text === "string").map((part) => String(part.text)).join("\n");
        const toolCalls: ToolCall[] = parts.filter((part) => part.functionCall && typeof part.functionCall === "object").map((part) => {
          const call = part.functionCall as Record<string, unknown>;
          return { id: crypto.randomUUID(), type: "function" as const, function: { name: String(call.name || ""), arguments: JSON.stringify(call.args ?? {}) } };
        });
        return { message: { role: "assistant", content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, providerName: p.name || model };
      }

      const body: Record<string, unknown> = { model, temperature: 0.7, messages };
      if (tools && tools.length > 0) body.tools = tools;
      if (jsonMode && !tools?.length) body.response_format = { type: "json_object" };
      const resp = await fetch(url, {
        method: "POST",
        headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      const raw = await resp.text();
      if (!resp.ok) {
        const detail = providerErrorDetail(raw);
        errors.push(`${p.name || model}: ${resp.status}${detail ? ` — ${detail}` : ""}`);
        continue;
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const choice = (parsed.choices as Array<Record<string, unknown>> | undefined)?.[0];
      const msg = choice?.message as ChatMessage | undefined;
      if (!msg) { errors.push(`${p.name || model}: empty response`); continue; }
      return { message: msg, providerName: p.name || model };
    } catch (e) {
      errors.push(`${p.name || model}: ${String(e)}`);
    }
  }
  throw new Error(`All providers failed: ${errors.join("; ")}`);
};

// Streaming LLM call — yields token strings, returns when done
async function* streamLlm(
  providers: LlmProvider[],
  messages: ChatMessage[],
  attachment?: LlmAttachment,
): AsyncGenerator<string> {
  const errors: string[] = [];
  for (const p of providers) {
    const apiKey = p.apiKey?.trim();
    const model = p.model?.trim();
    const family = providerFamily(p);
    const baseUrl = (p.apiBaseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
    if ((!apiKey && family !== "openai_compatible") || !model) continue;
    const url = baseUrl.endsWith("/chat/completions")
      ? baseUrl
      : `${baseUrl}/chat/completions`;
    try {
      if (family === "anthropic") {
        const supportedText = attachment ? (/^(text\/|application\/(json|xml))/.test(attachment.mimeType) || /\.(txt|md|csv|json|xml|ya?ml|html?)$/i.test(attachment.name)) : false;
        const isPdf = attachment ? (attachment.mimeType === "application/pdf" || /\.pdf$/i.test(attachment.name)) : false;
        if (attachment && !supportedText && !isPdf) {
          errors.push(`${p.name || model}: Anthropic does not accept ${attachment.name} as a document block; DOC/DOCX/XLS/XLSX require conversion`);
          continue;
        }
        const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
        const source = attachment && isPdf
          ? { type: "base64", media_type: "application/pdf", data: attachment.base64 }
          : attachment ? { type: "text", media_type: "text/plain", data: new TextDecoder().decode(Uint8Array.from(atob(attachment.base64), (char) => char.charCodeAt(0))) } : null;
        const content = [...(source ? [{ type: "document", source }] : []), { type: "text", text: conversationText(messages) || "Respond to the user." }];
        const anthropicUrl = baseUrl.endsWith("/messages") ? baseUrl : `${baseUrl}/messages`;
        const resp = await fetch(anthropicUrl, {
          method: "POST",
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
          body: JSON.stringify({ model, max_tokens: 4096, stream: true, system, messages: [{ role: "user", content }] }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!resp.ok || !resp.body) { const raw = await resp.text().catch(() => ""); errors.push(`${p.name || model}: ${resp.status} — ${providerErrorDetail(raw)}`); continue; }
        const reader = resp.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
        while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; for (const line of lines) { if (!line.startsWith("data:")) continue; try { const event = JSON.parse(line.slice(5)) as Record<string, unknown>; const delta = event.delta as Record<string, unknown> | undefined; if (event.type === "content_block_delta" && typeof delta?.text === "string") yield delta.text; } catch { /* ignore */ } } }
        return;
      }

      if (family === "gemini") {
        const geminiUrl = `${baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
        const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
        const resp = await fetch(geminiUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [...(attachment ? [{ inlineData: { mimeType: attachment.mimeType, data: attachment.base64 } }] : []), { text: conversationText(messages) || "Respond to the user." }] }] }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!resp.ok || !resp.body) { const raw = await resp.text().catch(() => ""); errors.push(`${p.name || model}: ${resp.status} — ${providerErrorDetail(raw)}`); continue; }
        const reader = resp.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
        while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; for (const line of lines) { if (!line.startsWith("data:")) continue; try { const event = JSON.parse(line.slice(5)) as Record<string, unknown>; const candidates = event.candidates as Array<Record<string, unknown>> | undefined; const content = candidates?.[0]?.content as Record<string, unknown> | undefined; const parts = content?.parts as Array<Record<string, unknown>> | undefined; for (const part of parts ?? []) if (typeof part.text === "string") yield part.text; } catch { /* ignore */ } } }
        return;
      }

      if (attachment && (family === "openai" || family === "openai_compatible")) {
        const responsesUrl = baseUrl.endsWith("/responses") ? baseUrl : `${baseUrl}/responses`;
        const instructions = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
        const resp = await fetch(responsesUrl, {
          method: "POST", headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), "Content-Type": "application/json" },
          body: JSON.stringify({ model, instructions, stream: true, input: [{ role: "user", content: [{ type: "input_file", filename: attachment.name, file_data: `data:${attachment.mimeType};base64,${attachment.base64}` }, { type: "input_text", text: conversationText(messages) || "Analyze the attached document." }] }] }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!resp.ok || !resp.body) { const raw = await resp.text().catch(() => ""); errors.push(`${p.name || model}: ${resp.status} — ${providerErrorDetail(raw)}`); continue; }
        const reader = resp.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
        while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; for (const line of lines) { if (!line.startsWith("data:")) continue; try { const event = JSON.parse(line.slice(5)) as Record<string, unknown>; if (event.type === "response.output_text.delta" && typeof event.delta === "string") yield event.delta; } catch { /* ignore */ } } }
        return;
      }

      const resp = await fetch(url, {
        method: "POST",
        headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ model, temperature: 0.7, messages, stream: true }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!resp.ok || !resp.body) {
        const raw = await resp.text().catch(() => "");
        const detail = providerErrorDetail(raw);
        errors.push(`${p.name || model}: ${resp.status}${detail ? ` — ${detail}` : ""}`);
        continue;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const json = trimmed.slice(5).trim();
          if (json === "[DONE]") return;
          try {
            const chunk = JSON.parse(json) as Record<string, unknown>;
            const delta = (
              (chunk.choices as Array<Record<string, unknown>> | undefined)?.[0]
                ?.delta as Record<string, unknown> | undefined
            )?.content;
            if (typeof delta === "string" && delta) yield delta;
          } catch { /* skip malformed chunks */ }
        }
      }
      return; // success — don't try next provider
    } catch (e) {
      errors.push(`${p.name || model}: ${String(e)}`);
    }
  }
  throw new Error(`All providers failed for streaming: ${errors.join("; ")}`);
}

// ─── MCP helpers ──────────────────────────────────────────────────────────────

const mcpPost = async (
  server: McpServerConfig,
  method: string,
  params: Record<string, unknown> = {},
  id: number = 1,
  session?: McpSession,
): Promise<McpResponse> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (server.apiKey?.trim()) headers.Authorization = `Bearer ${server.apiKey}`;
  if (session?.sessionId) headers["Mcp-Session-Id"] = session.sessionId;
  if (session?.protocolVersion) headers["MCP-Protocol-Version"] = session.protocolVersion;

  const resp = await fetch(server.url!, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(30_000),
  });

  const responseSessionId = resp.headers.get("mcp-session-id") || session?.sessionId;
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`MCP ${server.name}: HTTP ${resp.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
  }

  const contentType = resp.headers.get("content-type") || "";

  if (contentType.includes("text/event-stream")) {
    // Streamable HTTP: read until result event
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const parsed = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
          if (parsed.id === id) return { json: parsed, sessionId: responseSessionId };
        } catch { /* skip */ }
      }
    }
    throw new Error(`MCP ${server.name}: no result received`);
  }

  return {
    json: (await resp.json()) as Record<string, unknown>,
    sessionId: responseSessionId,
  };
};

const mcpNotifyInitialized = async (
  server: McpServerConfig,
  session: McpSession,
): Promise<void> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": session.protocolVersion,
  };
  if (server.apiKey?.trim()) headers.Authorization = `Bearer ${server.apiKey}`;
  if (session.sessionId) headers["Mcp-Session-Id"] = session.sessionId;

  const resp = await fetch(server.url!, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`MCP ${server.name}: initialized notification failed (${resp.status})${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
  await resp.body?.cancel().catch(() => {/* ignore */});
};

const discoverMcpTools = async (
  server: McpServerConfig,
): Promise<{ tools: DiscoveredMcpTool[]; session: McpSession; error?: string }> => {
  try {
    // Initialize session
    const initialized = await mcpPost(server, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ptx-gateway", version: "1.0" },
    }, 0);

    const initResult = initialized.json.result as Record<string, unknown> | undefined;
    const session: McpSession = {
      sessionId: initialized.sessionId,
      protocolVersion: typeof initResult?.protocolVersion === "string"
        ? initResult.protocolVersion
        : "2024-11-05",
    };
    await mcpNotifyInitialized(server, session);

    const response = await mcpPost(server, "tools/list", {}, 1, session);
    const tools = (response.json.result as Record<string, unknown>)?.tools as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(tools)) return { tools: [], session };

    return {
      tools: tools.map((t) => ({
        rawName: String(t.name || ""),
        description: String(t.description || ""),
        parameters: (t.inputSchema as Record<string, unknown>) || { type: "object", properties: {} },
      })),
      session,
    };
  } catch (error) {
    console.warn(`MCP discovery failed for ${server.name || server.url}:`, String(error));
    return { tools: [], session: { protocolVersion: "2024-11-05" }, error: error instanceof Error ? error.message : String(error) };
  }
};

const providerToolName = (
  serverIndex: number,
  rawName: string,
  usedNames: Set<string>,
): string => {
  // OpenAI-compatible APIs require function names to match [A-Za-z0-9_-]
  // and be at most 64 characters. MCP itself permits broader names.
  const safeRawName = rawName.replace(/[^A-Za-z0-9_-]/g, "_") || "tool";
  const prefix = `mcp${serverIndex + 1}__`;
  const base = `${prefix}${safeRawName}`.slice(0, 64);
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    const marker = `_${suffix++}`;
    candidate = `${base.slice(0, 64 - marker.length)}${marker}`;
  }
  usedNames.add(candidate);
  return candidate;
};

const callMcpTool = async (
  bindings: Map<string, McpToolBinding>,
  providerName: string,
  args: unknown
): Promise<string> => {
  const binding = bindings.get(providerName);
  if (!binding) return `Tool binding "${providerName}" not found`;
  try {
    const response = await mcpPost(
      binding.server,
      "tools/call",
      { name: binding.rawName, arguments: args },
      2,
      binding.session,
    );
    const content = (response.json.result as Record<string, unknown>)?.content;
    let result: string;
    if (Array.isArray(content)) {
      result = content
        .map((c) =>
          typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text"
            ? String((c as Record<string, unknown>).text || "")
            : JSON.stringify(c)
        )
        .join("\n");
    } else {
      result = JSON.stringify(response.json.result ?? response.json);
    }
    const maxResultChars = 60_000;
    return result.length > maxResultChars
      ? `${result.slice(0, maxResultChars)}\n...[MCP result truncated]`
      : result;
  } catch (e) {
    return `Tool call failed: ${String(e)}`;
  }
};

// ─── SSE helpers ──────────────────────────────────────────────────────────────

const toObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const formatAgentSkill = (skill: AgentSkill): string => {
  const requiredInputs = Array.isArray(skill.requiredInputs) && skill.requiredInputs.length > 0
    ? skill.requiredInputs.map((field) =>
        `- ${field.key || field.label || "input"} (${field.type || "text"}${field.required === false ? ", optional" : ", required"}): ${field.description || ""}${field.defaultValue ? ` Default: ${field.defaultValue}` : ""}`
      ).join("\n")
    : "- No explicit input contract.";
  const references = Array.isArray(skill.references) && skill.references.length > 0
    ? skill.references.map((reference) =>
        `### Reference: ${reference.name || "Untitled"}\n${reference.description || ""}\n${reference.content || ""}`
      ).join("\n\n")
    : "";
  return `# Agent Skill: ${skill.name || skill.id} (v${skill.version || 1})\nActivation: ${skill.description || ""}\nObjective: ${skill.objective || ""}\nOutput type: ${skill.outputType || "text"}\n\n## Required information\n${requiredInputs}\n\n## Procedure\n${skill.instructions || ""}\n\n## Output template\n${skill.outputTemplate || ""}${references ? `\n\n## Supporting resources\n${references}` : ""}`.slice(0, 40_000);
};

// Build a deterministic, compact structural index before asking the model to
// reason over raw JSON. This is especially useful for older/smaller models that
// struggle to infer hierarchy and exact collection sizes from serialized data.
const describeJsonStructure = (value: unknown, parsedFromString = false): string => {

  type PathStat = {
    types: Set<string>;
    occurrences: number;
    keys: Set<string>;
    arrayInstances: number;
    arrayItems: number;
    minLength?: number;
    maxLength?: number;
  };
  const paths = new Map<string, PathStat>();
  const totals = { objects: 0, arrays: 0, fields: 0, arrayItems: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0 };
  const seen = new WeakSet<object>();
  const MAX_VALUES = 100_000;
  const MAX_PATHS = 300;
  let visited = 0;
  let maxDepth = 0;
  let truncated = false;

  const valueType = (item: unknown): string => item === null ? "null" : Array.isArray(item) ? "array" : typeof item;
  const childPath = (path: string, key: string): string => /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
  const statFor = (path: string): PathStat | null => {
    const existing = paths.get(path);
    if (existing) return existing;
    if (paths.size >= MAX_PATHS) return null;
    const created: PathStat = { types: new Set(), occurrences: 0, keys: new Set(), arrayInstances: 0, arrayItems: 0 };
    paths.set(path, created);
    return created;
  };

  const visit = (item: unknown, path: string, depth: number) => {
    if (visited >= MAX_VALUES) { truncated = true; return; }
    visited += 1;
    maxDepth = Math.max(maxDepth, depth);
    const type = valueType(item);
    const stat = statFor(path);
    if (stat) { stat.types.add(type); stat.occurrences += 1; }

    if (Array.isArray(item)) {
      totals.arrays += 1;
      totals.arrayItems += item.length;
      if (stat) {
        stat.arrayInstances += 1;
        stat.arrayItems += item.length;
        stat.minLength = stat.minLength === undefined ? item.length : Math.min(stat.minLength, item.length);
        stat.maxLength = stat.maxLength === undefined ? item.length : Math.max(stat.maxLength, item.length);
      }
      if (seen.has(item)) return;
      seen.add(item);
      for (const child of item) {
        if (truncated) break;
        visit(child, `${path}[]`, depth + 1);
      }
      return;
    }

    if (item && typeof item === "object") {
      totals.objects += 1;
      const record = item as Record<string, unknown>;
      const keys = Object.keys(record);
      totals.fields += keys.length;
      if (stat) keys.forEach((key) => stat.keys.add(key));
      if (seen.has(item)) return;
      seen.add(item);
      for (const key of keys) {
        if (truncated) break;
        visit(record[key], childPath(path, key), depth + 1);
      }
      return;
    }

    if (item === null) totals.nulls += 1;
    else if (typeof item === "string") totals.strings += 1;
    else if (typeof item === "number") totals.numbers += 1;
    else if (typeof item === "boolean") totals.booleans += 1;
  };

  visit(value, "$", 0);
  const rows = [...paths.entries()].map(([path, stat]) => {
    const details: string[] = [`type=${[...stat.types].join("|")}`, `occurrences=${stat.occurrences}`];
    if (stat.arrayInstances > 0) {
      details.push(`array_instances=${stat.arrayInstances}`, `total_items=${stat.arrayItems}`);
      details.push(stat.minLength === stat.maxLength ? `length=${stat.minLength}` : `length_range=${stat.minLength}..${stat.maxLength}`);
    }
    if (stat.keys.size > 0) {
      const keys = [...stat.keys];
      details.push(`fields=${keys.length}`, `keys=[${keys.slice(0, 30).join(", ")}${keys.length > 30 ? ", …" : ""}]`);
    }
    return `- ${path}: ${details.join("; ")}`;
  });

  return [
    "## Structured Data Map (machine-derived)",
    "Use this map to understand hierarchy and exact counts. `$` is the root; `[]` means each repeated array element. Paths preserve parent-child relationships. Do not estimate array sizes from the raw text when an explicit length is listed here.",
    parsedFromString ? "The input arrived as text but contained valid JSON, so it was parsed for this map." : null,
    `Summary: root_type=${valueType(value)}; object_instances=${totals.objects}; array_instances=${totals.arrays}; object_fields_total=${totals.fields}; array_items_total=${totals.arrayItems}; primitive_values={strings:${totals.strings}, numbers:${totals.numbers}, booleans:${totals.booleans}, nulls:${totals.nulls}}; max_depth=${maxDepth}; scanned_values=${visited}${truncated ? ` (scan capped at ${MAX_VALUES}; later counts may be partial)` : " (complete scan)"}.`,
    "### Path index",
    ...rows,
    paths.size >= MAX_PATHS ? `- … path index capped at ${MAX_PATHS} unique paths; raw data remains below.` : null,
  ].filter(Boolean).join("\n").slice(0, 16_000);
};

const describeXmlStructure = (xml: string): string | null => {
  const source = xml.trim();
  if (!/^<\?xml\b|^<[A-Za-z_][\w:.-]*(?:\s|>|\/)/.test(source)) return null;

  type XmlPathStat = { occurrences: number; attributes: Set<string>; children: Set<string> };
  const paths = new Map<string, XmlPathStat>();
  const stack: string[] = [];
  const MAX_ELEMENTS = 100_000;
  const MAX_PATHS = 300;
  let elements = 0;
  let attributes = 0;
  let maxDepth = 0;
  let root = "";
  let truncated = false;
  const tagPattern = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<\/?[A-Za-z_][\w:.-]*(?:\s[^<>]*?)?\/?>/g;

  for (const match of source.matchAll(tagPattern)) {
    const tag = match[0];
    if (tag.startsWith("<!--") || tag.startsWith("<?") || tag.startsWith("<!")) continue;
    const closing = /^<\//.test(tag);
    const selfClosing = /\/\s*>$/.test(tag);
    const nameMatch = tag.match(/^<\/?\s*([A-Za-z_][\w:.-]*)/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    if (closing) {
      const index = stack.lastIndexOf(name);
      if (index >= 0) stack.splice(index);
      continue;
    }
    if (elements >= MAX_ELEMENTS) { truncated = true; break; }
    elements += 1;
    if (!root) root = name;
    const path = `$xml/${[...stack, name].join("/")}`;
    const attributeNames = [...tag.matchAll(/\s([A-Za-z_][\w:.-]*)\s*=\s*(?:"[^"]*"|'[^']*')/g)].map((item) => item[1]);
    attributes += attributeNames.length;
    if (paths.size < MAX_PATHS || paths.has(path)) {
      const stat = paths.get(path) ?? { occurrences: 0, attributes: new Set<string>(), children: new Set<string>() };
      stat.occurrences += 1;
      attributeNames.forEach((attribute) => stat.attributes.add(attribute));
      paths.set(path, stat);
      const parentPath = stack.length > 0 ? `$xml/${stack.join("/")}` : null;
      if (parentPath && paths.has(parentPath)) paths.get(parentPath)!.children.add(name);
    }
    if (!selfClosing) {
      stack.push(name);
      maxDepth = Math.max(maxDepth, stack.length);
    }
  }

  if (!root || elements === 0) return null;
  const rows = [...paths.entries()].map(([path, stat]) => {
    const details = [`elements=${stat.occurrences}`];
    if (stat.attributes.size > 0) details.push(`attributes=[${[...stat.attributes].join(", ")}]`);
    if (stat.children.size > 0) details.push(`child_elements=[${[...stat.children].join(", ")}]`);
    return `- ${path}: ${details.join("; ")}`;
  });
  return [
    "## Structured XML Map (machine-derived)",
    "Use this map to understand XML hierarchy and repeated elements. Paths preserve parent-child relationships. Element text remains unchanged in the raw input below.",
    `Summary: format=xml; root=${root}; element_instances=${elements}; attributes_total=${attributes}; max_depth=${maxDepth}${truncated ? `; scan capped at ${MAX_ELEMENTS} elements` : "; complete scan"}.`,
    "### XML path index",
    ...rows,
    paths.size >= MAX_PATHS ? `- … path index capped at ${MAX_PATHS} unique paths; raw XML remains below.` : null,
  ].filter(Boolean).join("\n").slice(0, 16_000);
};

const describeStructuredData = (input: unknown): string | null => {
  if (Array.isArray(input) || (input !== null && typeof input === "object")) {
    const embedded: string[] = [];
    const seen = new WeakSet<object>();
    const inspectEmbedded = (value: unknown, path: string) => {
      if (embedded.length >= 8) return;
      if (typeof value === "string") {
        const trimmed = value.trim();
        let description: string | null = null;
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed) || (parsed !== null && typeof parsed === "object")) {
              description = describeJsonStructure(parsed, true);
            }
          } catch { /* unstructured text */ }
        }
        description ??= describeXmlStructure(trimmed);
        if (description) embedded.push(`### Structured subsection at ${path}\n${description.slice(0, 4_000)}`);
        return;
      }
      if (!value || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        for (const child of value) {
          if (embedded.length >= 8) break;
          inspectEmbedded(child, `${path}[]`);
        }
      } else {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          if (embedded.length >= 8) break;
          inspectEmbedded(child, `${path}.${key}`);
        }
      }
    };
    inspectEmbedded(input, "$");
    const primary = describeJsonStructure(input);
    return embedded.length > 0
      ? `${primary}\n\n## Embedded structured fields\n${embedded.join("\n\n")}`.slice(0, 24_000)
      : primary;
  }
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) || (parsed !== null && typeof parsed === "object")) {
        return describeJsonStructure(parsed, true);
      }
    } catch { /* unstructured text that resembles JSON */ }
  }
  return describeXmlStructure(trimmed);
};

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || LOCAL_SUPABASE_URL_FALLBACK;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || LOCAL_SUPABASE_ANON_KEY_FALLBACK;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || LOCAL_SUPABASE_SERVICE_ROLE_KEY_FALLBACK;
  const executeSecret = Deno.env.get("PDC_EXECUTE_TOKEN_SECRET") ||
    Deno.env.get("SUPABASE_INTERNAL_JWT_SECRET") || LOCAL_SUPABASE_JWT_FALLBACK;

  const encoder = new TextEncoder();
  const sseHeaders = {
    ...corsHeaders,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };

  const sendError = (message: string, status = 400): Response =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return sendError("Invalid JSON body");
  }
  if (body.attachment) {
    const attachment = body.attachment;
    const allowedName = /\.(pdf|txt|md|markdown|csv|json|jsonl|xml|html?|ya?ml|doc|docx|xls|xlsx)$/i.test(attachment.name || "");
    const estimatedBytes = Math.floor((attachment.base64?.length ?? 0) * 0.75);
    if (!allowedName || !attachment.base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.base64)) {
      return sendError("Unsupported or invalid document attachment", 400);
    }
    if (attachment.name.length > 255 || estimatedBytes > 10 * 1024 * 1024 || attachment.size > 10 * 1024 * 1024) {
      return sendError("Document attachments are limited to 10 MB", 413);
    }
  }

  // Auth
  const authHeader = req.headers.get("Authorization");
  const requestedOrgId = req.headers.get("x-organization-id");
  let orgContext: { orgId: string } | null = null;

  if (authHeader?.startsWith("Bearer ")) {
    orgContext = await resolveAuthenticatedOrgContext(
      supabaseUrl, supabaseAnonKey, authHeader, requestedOrgId
    );
  }
  if (!orgContext) {
    orgContext = await resolvePublicOrgContext(body.org_execution_token, executeSecret);
  }
  if (!orgContext) return sendError("Unauthorized", 401);

  // Load config
  const admin = createClient(supabaseUrl, supabaseServiceKey);
  const { data: gc } = await admin
    .from("global_configs")
    .select("features")
    .eq("organization_id", orgContext.orgId)
    .maybeSingle();

  if (!gc) return sendError("Global config not found", 400);

  const features = toObject(gc.features);
  const llmConfig = toObject(features.llmInsights) as LlmInsightsConfig;

  if (!llmConfig.enabled) return sendError("LLM insights are disabled", 400);

  // Resolve active agent first (provider resolution depends on it)
  const activeAgent = body.agentId && Array.isArray(llmConfig.agents)
    ? llmConfig.agents.find((a) => a.id === body.agentId && a.enabled !== false) ?? null
    : null;
  if (body.agentId && !activeAgent) {
    return sendError("Requested LLM agent was not found or is disabled", 400);
  }

  const defaultChatPrompt =
    "You are a data analyst assistant. The user is viewing a result dataset. Answer questions clearly and concisely.";
  const systemPromptBase =
    body.systemPrompt?.trim() ||          // inline agent override
    activeAgent?.systemPrompt?.trim() ||
    llmConfig.chatSystemPrompt?.trim() ||
    defaultChatPrompt;

  const selectedSkillIds = activeAgent?.skillIds ?? body.skillIds ?? [];
  const selectedSkills = Array.isArray(llmConfig.skills)
    ? llmConfig.skills.filter((skill) =>
        skill.enabled !== false && skill.id && selectedSkillIds.includes(skill.id)
      )
    : [];
  const skillBlock = selectedSkills.length > 0
    ? body.attachment
      ? `\n## Assigned Agent Skills\nA native document attachment is present, so the assigned playbooks are provided directly. Apply every relevant playbook to the attached file.\n\n${selectedSkills.map(formatAgentSkill).join("\n\n---\n\n")}`
      : `\n## Available Agent Skills\nThe following reusable playbooks are available. When one matches the request, call activate_agent_skill before answering. You initially see metadata only; activation loads its full procedure and references. Skills do not grant tool permissions. If several skills activate, the most recently activated skill controls the final output type.\n${selectedSkills.map((skill) => `- ${skill.id}: ${skill.name || "Agent Skill"} — ${skill.description || ""} (output: ${skill.outputType || "text"})`).join("\n")}`
    : null;

  // Inject result context.
  // Two modes:
  //   1. Hybrid mode: { __doc_context: true, result: unknown, docChunks: [...] }
  //      Full result JSON + relevant document passages from the RAG worker
  //   2. Full mode: raw resultData — clip at 40K chars
  type DocContextPayload = {
    __doc_context: true;
    result?: unknown;
    docText?: string;                              // full document (small docs)
    docChunks?: Array<{ path: string; text: string }>; // RAG chunks (large docs)
  };
  type ChunkedResultPayload = {
    __chunked_result_context: true;
    manifest?: Record<string, unknown>;
    chunks?: Array<{ index?: number; start?: number; end?: number; text?: string }>;
  };
  const isDocContextPayload = (x: unknown): x is DocContextPayload =>
    typeof x === "object" && x !== null && (x as Record<string, unknown>).__doc_context === true;
  const isChunkedResultPayload = (x: unknown): x is ChunkedResultPayload =>
    typeof x === "object" && x !== null && (x as Record<string, unknown>).__chunked_result_context === true;

  const clipJson = (v: unknown, limit = 40000): string => {
    const serialized = JSON.stringify(v, null, 2);
    const s = serialized === undefined ? String(v) : serialized;
    return s.length > limit ? `${s.slice(0, limit)}\n...<truncated>` : s;
  };

  const formatDataContext = (label: string, value: unknown): string => {
    const structure = describeStructuredData(value);
    const raw = typeof value === "string"
      ? (value.length > 40000 ? `${value.slice(0, 40000)}\n...<truncated>` : value)
      : clipJson(value);
    return structure
      ? `\n## ${label}\n${structure}\n\n### Raw ${label.toLowerCase()}\n${raw}`
      : `\n## ${label} (unstructured)\n${raw}`;
  };

  const formatChunkedResultContext = (payload: ChunkedResultPayload): string => {
    const manifest = payload.manifest && typeof payload.manifest === "object" && !Array.isArray(payload.manifest)
      ? payload.manifest
      : {};
    const chunks = Array.isArray(payload.chunks) ? payload.chunks : [];
    const manifestJson = JSON.stringify({
      ...manifest,
      totalChunks: typeof manifest.totalChunks === "number" ? manifest.totalChunks : chunks.length,
    }, null, 2);
    const chunkText = chunks
      .map((chunk, idx) => {
        const index = typeof chunk.index === "number" ? chunk.index : idx + 1;
        const start = typeof chunk.start === "number" ? chunk.start : undefined;
        const end = typeof chunk.end === "number" ? chunk.end : undefined;
        const range = start !== undefined && end !== undefined ? ` chars ${start}-${end}` : "";
        return `### Chunk ${index}/${chunks.length}${range}\n${String(chunk.text ?? "")}`;
      })
      .join("\n\n");

    return [
      "\n## Result data (chunked)",
      "The manifest describes one complete resultData payload split into ordered chunks. Treat every chunk below as part of the same dataset.",
      "",
      "### Manifest",
      manifestJson,
      "",
      "### Ordered chunks",
      chunkText || "(no chunks supplied)",
    ].join("\n");
  };

  let contextBlock: string | null = null;
  if (body.result !== undefined) {
    if (isDocContextPayload(body.result)) {
      const parts: string[] = [];

      if (body.result.result !== undefined) {
        parts.push(`\n---${isChunkedResultPayload(body.result.result)
          ? formatChunkedResultContext(body.result.result)
          : formatDataContext("Result data", body.result.result)}`);
      }

      if (body.result.docText) {
        // Full document text — no chunking needed
        const clipped = body.result.docText.length > 30000
          ? `${body.result.docText.slice(0, 30000)}\n...<truncated>`
          : body.result.docText;
        parts.push(`\n---\nUploaded document:\n${clipped}`);
      } else if (body.result.docChunks && body.result.docChunks.length > 0) {
        // RAG chunks for large documents
        const chunkStr = body.result.docChunks
          .map((c) => `[${c.path}]\n${c.text}`)
          .join("\n\n");
        parts.push(`\n---\nDocument context (relevant passages):\n${chunkStr}`);
      }

      contextBlock = parts.join("") || null;
    } else {
      // No document context — full result JSON only
      contextBlock = `\n---${isChunkedResultPayload(body.result)
        ? formatChunkedResultContext(body.result)
        : formatDataContext("Result data", body.result)}`;
    }
  }
  if (body.inputData !== undefined && body.inputData !== null) {
    const inputBlock = formatDataContext("Current node input", body.inputData);
    contextBlock = `${contextBlock ?? "\n---"}${inputBlock}`;
  }

  // Append output instructions as a dedicated section
  const outputInstructions = activeAgent?.outputInstructions?.trim();
  const configuredOutputType = body.outputType ?? activeAgent?.expectedOutput ?? "text";
  const fallbackOutputType = body.fallbackOutputType ?? activeAgent?.fallbackOutput ??
    (configuredOutputType === "auto" ? "text" : configuredOutputType);
  const outputBlock = configuredOutputType === "auto"
    ? `\n## Output Format\nUse ${fallbackOutputType} when no skill is activated. When a skill is activated, its declared output type and output template override this fallback. If multiple skills activate, the most recently activated skill wins.${outputInstructions ? `\n\nFallback instructions only:\n${outputInstructions}` : ""}`
    : (outputInstructions ? `\n## Output Format\n${outputInstructions}` : `\n## Output Format\nReturn ${configuredOutputType}.`);
  const systemContent = [
    systemPromptBase,
    skillBlock,
    contextBlock,
    outputBlock,
  ].filter(Boolean).join("\n");

  // Build message history
  const history: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...(body.messages || []).map((m) => ({
      role: m.role as ChatMessage["role"],
      content: String(m.content || ""),
    })),
  ];

  // Resolve providers — agent-specific first, then global (filtered or all)
  const savedWorkflowNodeData = (() => {
    if (!body.workflowId || !body.nodeId || !Array.isArray((llmConfig as { workflows?: unknown[] }).workflows)) return null;
    for (const rawWorkflow of (llmConfig as { workflows?: unknown[] }).workflows ?? []) {
      const workflow = toObject(rawWorkflow);
      if (String(workflow.id || "") !== body.workflowId) continue;
      const graph = toObject(workflow.graph);
      const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
      const node = nodes.map(toObject).find((item) => String(item.id || "") === body.nodeId);
      return node ? toObject(node.data) : null;
    }
    return null;
  })();
  const savedProviderIds = Array.isArray(savedWorkflowNodeData?.providerIds)
    ? savedWorkflowNodeData.providerIds.map(String)
    : undefined;
  const savedAgentProviders = Array.isArray(savedWorkflowNodeData?.agentProviders)
    ? savedWorkflowNodeData.agentProviders as LlmProvider[]
    : undefined;
  const inlineProviderAgent: LlmAgent | null = !activeAgent && (Array.isArray(savedAgentProviders) || Array.isArray(savedProviderIds) || Array.isArray(body.agentProviders) || Array.isArray(body.providerIds))
    ? {
        providerIds: Array.isArray(savedProviderIds) ? savedProviderIds : (Array.isArray(body.providerIds) ? body.providerIds.map(String) : []),
        agentProviders: Array.isArray(savedAgentProviders) ? savedAgentProviders : (Array.isArray(body.agentProviders) ? body.agentProviders : []),
      }
    : null;
  const providers = activeAgent
    ? resolveAgentProviders(activeAgent, llmConfig)
    : inlineProviderAgent
      ? resolveAgentProviders(inlineProviderAgent, llmConfig)
      : resolveProviders(llmConfig);
  if (providers.length === 0) return sendError("No LLM providers configured", 400);

  // Discover MCP tools — filter to agent's assigned servers if agent specifies them
  const agentMcpIds = activeAgent?.mcpServerIds;
  // Generic/Free Chat intentionally has no tools. MCP access is only granted
  // through a configured agent so its server and tool restrictions apply.
  const mcpServers = activeAgent ? (llmConfig.mcpServers || []).filter((s) => {
    if (!s.enabled || !s.url?.trim()) return false;
    return Boolean(agentMcpIds?.includes(s.id || ""));
  }) : [];
  const allTools: OpenAITool[] = [];
  const mcpToolBindings = new Map<string, McpToolBinding>();
  const mcpDiscoveryErrors: string[] = [];
  const usedToolNames = new Set<string>();
  if (selectedSkills.length > 0) {
    allTools.push({
      type: "function",
      function: {
        name: "activate_agent_skill",
        description: "Load the complete instructions and supporting resources for an assigned agent skill. Call this before applying the skill.",
        parameters: {
          type: "object",
          properties: {
            skill_id: {
              type: "string",
              enum: selectedSkills.map((skill) => skill.id),
              description: "The assigned skill to activate.",
            },
          },
          required: ["skill_id"],
          additionalProperties: false,
        },
      },
    });
    usedToolNames.add("activate_agent_skill");
  }
  serverLoop: for (const [serverIndex, server] of mcpServers.entries()) {
    const discovery = await discoverMcpTools(server);
    if (discovery.error) mcpDiscoveryErrors.push(`${server.name || server.url}: ${discovery.error}`);
    if (!discovery.error && discovery.tools.length === 0) mcpDiscoveryErrors.push(`${server.name || server.url}: server advertised no tools`);
    const allowedNames = activeAgent?.mcpToolFilter?.[server.id ?? ""];
    const filtered = allowedNames && allowedNames.length > 0
      ? discovery.tools.filter((tool) => allowedNames.includes(tool.rawName))
      : discovery.tools;
    if (!discovery.error && allowedNames && allowedNames.length > 0 && filtered.length === 0) {
      mcpDiscoveryErrors.push(`${server.name || server.url}: none of the selected tools are currently advertised by the server`);
    }
    for (const tool of filtered) {
      // OpenAI-compatible Chat Completions accepts at most 128 tools.
      if (allTools.length >= 128) break serverLoop;
      const name = providerToolName(serverIndex, tool.rawName, usedToolNames);
      allTools.push({
        type: "function",
        function: { name, description: tool.description, parameters: tool.parameters },
      });
      mcpToolBindings.set(name, {
        server,
        session: discovery.session,
        rawName: tool.rawName,
      });
    }
  }
  if (activeAgent && mcpServers.length > 0 && mcpToolBindings.size === 0 && mcpDiscoveryErrors.length > 0) {
    return sendError(`Assigned MCP tools are unavailable. ${mcpDiscoveryErrors.join("; ")}`, 502);
  }

  // SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const sendText = (text: string) => {
          const chunkSize = 24;
          for (let offset = 0; offset < text.length; offset += chunkSize) {
            send({ type: "token", content: text.slice(offset, offset + chunkSize) });
          }
        };

        const loopMessages = [...history];
        const MAX_ITERATIONS = 5;
        let activeOutputType = fallbackOutputType;
        let completed = false;

        // Without MCP tools, stream once. The previous implementation first made
        // a discarded non-streaming call and then repeated it as a stream.
        if (allTools.length === 0) {
          for await (const token of streamLlm(providers, loopMessages, body.attachment)) {
            send({ type: "token", content: token });
          }
          completed = true;
        }

        // Tool-use loop. Each turn either calls MCP or produces the final answer.
        for (let i = 0; !completed && i < MAX_ITERATIONS; i++) {
          const { message } = await callLlmOnce(
            providers,
            loopMessages,
            allTools,
            false,
          );

          // No tool calls — final text response, stream it
          if (!message.tool_calls || message.tool_calls.length === 0) {
            if (body.attachment) {
              for await (const token of streamLlm(providers, loopMessages, body.attachment)) {
                send({ type: "token", content: token });
              }
            } else {
              sendText(message.content || "");
            }
            completed = true;
            break;
          }

          // Has tool calls — execute them
          loopMessages.push({ role: "assistant", content: message.content || "", tool_calls: message.tool_calls });

          for (const tc of message.tool_calls) {
            const toolName = tc.function.name;
            send({ type: "tool_call", name: toolName });
            let args: unknown;
            try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }

            const result = toolName === "activate_agent_skill"
              ? (() => {
                  const skillId = typeof args === "object" && args !== null
                    ? String((args as Record<string, unknown>).skill_id || "")
                    : "";
                  const skill = selectedSkills.find((item) => item.id === skillId);
                  if (skill) {
                    activeOutputType = skill.outputType || "text";
                    send({ type: "output_type", outputType: activeOutputType });
                  }
                  return skill ? formatAgentSkill(skill) : `Assigned skill "${skillId}" was not found or is disabled.`;
                })()
              : await callMcpTool(mcpToolBindings, toolName, args);
            send({ type: "tool_result", name: toolName, result: result.slice(0, 500) });

            loopMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              name: toolName,
              content: result,
            });
          }
        }

        if (!completed) {
          // Do not silently end after the last MCP turn. Ask for a final response
          // with tools disabled so the model cannot start another tool cycle.
          const { message } = await callLlmOnce(
            providers,
            loopMessages,
            undefined,
            activeOutputType === "json",
          );
          sendText(message.content || "MCP processing completed without a final response.");
        }

        send({ type: "done" });
      } catch (e) {
        send({ type: "error", message: String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
});
