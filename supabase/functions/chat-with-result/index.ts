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
  outputInstructions?: string;
  mcpServerIds?: string[];
  mcpToolFilter?: Record<string, string[]>;
  providerIds?: string[];
  agentProviders?: LlmProvider[];
  defaultPrompts?: string[];
  enabled?: boolean;
}

interface LlmInsightsConfig {
  enabled?: boolean;
  providers?: LlmProvider[];
  chatSystemPrompt?: string;
  mcpServers?: McpServerConfig[];
  predefinedPrompts?: string[];
  agents?: LlmAgent[];
  // legacy flat fields
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
}

interface ChatRequest {
  messages: Array<{ role: string; content: string }>;
  result?: unknown;
  org_execution_token?: string;
  agentId?: string;
  /** Inline agent: system prompt provided directly, bypassing agent lookup */
  systemPrompt?: string;
  /** Inline agent: expected output format */
  outputType?: "text" | "json" | "html" | "mixed";
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
    ? globalAll.filter((p) => p.id && (agent.providerIds ?? []).includes(p.id))
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
    const baseUrl = (p.apiBaseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
    if (!apiKey || !model) continue;
    const url = baseUrl.endsWith("/chat/completions")
      ? baseUrl
      : `${baseUrl}/chat/completions`;
    try {
      const body: Record<string, unknown> = { model, temperature: 0.7, messages };
      if (tools && tools.length > 0) body.tools = tools;
      if (jsonMode && !tools?.length) body.response_format = { type: "json_object" };
      const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
  messages: ChatMessage[]
): AsyncGenerator<string> {
  const errors: string[] = [];
  for (const p of providers) {
    const apiKey = p.apiKey?.trim();
    const model = p.model?.trim();
    const baseUrl = (p.apiBaseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
    if (!apiKey || !model) continue;
    const url = baseUrl.endsWith("/chat/completions")
      ? baseUrl
      : `${baseUrl}/chat/completions`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
): Promise<{ tools: DiscoveredMcpTool[]; session: McpSession }> => {
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
    return { tools: [], session: { protocolVersion: "2024-11-05" } };
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

  const defaultChatPrompt =
    "You are a data analyst assistant. The user is viewing a result dataset. Answer questions clearly and concisely.";
  const systemPromptBase =
    body.systemPrompt?.trim() ||          // inline agent override
    activeAgent?.systemPrompt?.trim() ||
    llmConfig.chatSystemPrompt?.trim() ||
    defaultChatPrompt;

  // Inject result context.
  // Two modes:
  //   1. Hybrid mode: { __doc_context: true, result: unknown, docChunks: [...] }
  //      Full result JSON + relevant document passages from the RAG worker
  //   2. Full mode: raw resultData — clip at 40K chars
  type DocContextPayload = {
    __doc_context: true;
    result: unknown;
    docText?: string;                              // full document (small docs)
    docChunks?: Array<{ path: string; text: string }>; // RAG chunks (large docs)
  };
  const isDocContextPayload = (x: unknown): x is DocContextPayload =>
    typeof x === "object" && x !== null && (x as Record<string, unknown>).__doc_context === true;

  const clipJson = (v: unknown, limit = 40000): string => {
    const s = JSON.stringify(v, null, 2);
    return s.length > limit ? `${s.slice(0, limit)}\n...<truncated>` : s;
  };

  let contextBlock: string | null = null;
  if (body.result !== undefined) {
    if (isDocContextPayload(body.result)) {
      const resultStr = clipJson(body.result.result);
      const parts: string[] = [`\n---\nResult dataset (JSON):\n${resultStr}`];

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

      contextBlock = parts.join("");
    } else {
      // No document context — full result JSON only
      contextBlock = `\n---\nResult dataset (JSON):\n${clipJson(body.result)}`;
    }
  }

  // Append output instructions as a dedicated section
  const outputInstructions = activeAgent?.outputInstructions?.trim();
  const systemContent = [
    systemPromptBase,
    contextBlock,
    outputInstructions ? `\n## Output Format\n${outputInstructions}` : null,
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
  const providers = activeAgent
    ? resolveAgentProviders(activeAgent, llmConfig)
    : resolveProviders(llmConfig);
  if (providers.length === 0) return sendError("No LLM providers configured", 400);

  // Discover MCP tools — filter to agent's assigned servers if agent specifies them
  const agentMcpIds = activeAgent?.mcpServerIds;
  const mcpServers = (llmConfig.mcpServers || []).filter((s) => {
    if (!s.enabled || !s.url?.trim()) return false;
    if (agentMcpIds && agentMcpIds.length > 0) return agentMcpIds.includes(s.id || "");
    return true;
  });
  const allTools: OpenAITool[] = [];
  const mcpToolBindings = new Map<string, McpToolBinding>();
  const usedToolNames = new Set<string>();
  serverLoop: for (const [serverIndex, server] of mcpServers.entries()) {
    const discovery = await discoverMcpTools(server);
    const allowedNames = activeAgent?.mcpToolFilter?.[server.id ?? ""];
    const filtered = allowedNames && allowedNames.length > 0
      ? discovery.tools.filter((tool) => allowedNames.includes(tool.rawName))
      : discovery.tools;
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
        const isJsonAgent = activeAgent?.expectedOutput === "json";
        let completed = false;

        // Without MCP tools, stream once. The previous implementation first made
        // a discarded non-streaming call and then repeated it as a stream.
        if (allTools.length === 0) {
          for await (const token of streamLlm(providers, loopMessages)) {
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
            sendText(message.content || "");
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

            const result = await callMcpTool(mcpToolBindings, toolName, args);
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
            isJsonAgent,
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
