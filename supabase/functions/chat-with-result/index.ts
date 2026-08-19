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

interface LlmAgent {
  id?: string;
  name?: string;
  systemPrompt?: string;
  expectedOutput?: string;
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

// Non-streaming LLM call — returns full message (used in tool-use loop)
const callLlmOnce = async (
  providers: LlmProvider[],
  messages: ChatMessage[],
  tools?: OpenAITool[]
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
      const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await resp.text();
      if (!resp.ok) { errors.push(`${p.name || model}: ${resp.status}`); continue; }
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
      });
      if (!resp.ok || !resp.body) {
        errors.push(`${p.name || model}: ${resp.status}`);
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
  id: number = 1
): Promise<Record<string, unknown>> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (server.apiKey?.trim()) headers.Authorization = `Bearer ${server.apiKey}`;

  const resp = await fetch(server.url!, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

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
          if (parsed.id === id) return parsed;
        } catch { /* skip */ }
      }
    }
    throw new Error(`MCP ${server.name}: no result received`);
  }

  return (await resp.json()) as Record<string, unknown>;
};

const discoverMcpTools = async (server: McpServerConfig): Promise<OpenAITool[]> => {
  try {
    // Initialize session
    await mcpPost(server, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ptx-gateway", version: "1.0" },
    }, 0);

    const result = await mcpPost(server, "tools/list", {}, 1);
    const tools = (result.result as Record<string, unknown>)?.tools as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(tools)) return [];

    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: `${server.id || "mcp"}__${String(t.name || "")}`,
        description: String(t.description || ""),
        parameters: (t.inputSchema as Record<string, unknown>) || { type: "object", properties: {} },
      },
    }));
  } catch {
    return [];
  }
};

const callMcpTool = async (
  servers: McpServerConfig[],
  qualifiedName: string,
  args: unknown
): Promise<string> => {
  const [serverId, ...nameParts] = qualifiedName.split("__");
  const toolName = nameParts.join("__");
  const server = servers.find((s) => (s.id || "mcp") === serverId);
  if (!server) return `Tool server "${serverId}" not found`;
  try {
    const result = await mcpPost(server, "tools/call", { name: toolName, arguments: args }, 2);
    const content = (result.result as Record<string, unknown>)?.content;
    if (Array.isArray(content)) {
      return content
        .map((c) =>
          typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text"
            ? String((c as Record<string, unknown>).text || "")
            : JSON.stringify(c)
        )
        .join("\n");
    }
    return JSON.stringify(result.result ?? result);
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
    "You are a data analyst assistant. The user is viewing a result dataset. Answer questions clearly and concisely. When asked for a chart or visualization, return a self-contained HTML snippet using Apache ECharts from CDN (https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js) inside a single <div> with inline styles and a <script> block.";
  const systemPromptBase =
    activeAgent?.systemPrompt?.trim() ||
    llmConfig.chatSystemPrompt?.trim() ||
    defaultChatPrompt;

  // Inject result context into system message
  const resultJson = body.result !== undefined
    ? JSON.stringify(body.result, null, 2)
    : null;
  const clippedResult = resultJson && resultJson.length > 40000
    ? `${resultJson.slice(0, 40000)}\n...<truncated>`
    : resultJson;
  const systemContent = clippedResult
    ? `${systemPromptBase}\n\n---\nResult dataset (JSON):\n${clippedResult}`
    : systemPromptBase;

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
  let allTools: OpenAITool[] = [];
  for (const server of mcpServers) {
    const tools = await discoverMcpTools(server);
    const allowedNames = activeAgent?.mcpToolFilter?.[server.id ?? ""];
    const filtered = allowedNames && allowedNames.length > 0
      ? tools.filter((t) => {
          // qualified name is `${serverId}__${toolName}`
          const rawName = t.function.name.replace(/^[^_]+__/, "");
          return allowedNames.includes(rawName);
        })
      : tools;
    allTools = [...allTools, ...filtered];
  }

  // SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        // Tool-use loop (non-streaming) — max 5 iterations
        let loopMessages = [...history];
        const MAX_ITERATIONS = 5;

        for (let i = 0; i < MAX_ITERATIONS; i++) {
          const hasTools = allTools.length > 0;
          const { message } = await callLlmOnce(
            providers,
            loopMessages,
            hasTools ? allTools : undefined
          );

          // No tool calls — final text response, stream it
          if (!message.tool_calls || message.tool_calls.length === 0) {
            // Append assistant placeholder, stream final response
            loopMessages.push({
              role: "assistant",
              content: message.content || "",
            });

            // If we got here from a tool loop, re-request with stream
            if (i > 0) {
              // Already have a final message content — send it token-by-token
              const text = message.content || "";
              const chunkSize = 4;
              for (let j = 0; j < text.length; j += chunkSize) {
                send({ type: "token", content: text.slice(j, j + chunkSize) });
              }
            } else {
              // First turn, no tools used — stream directly from LLM
              for await (const token of streamLlm(providers, loopMessages.slice(0, -1))) {
                send({ type: "token", content: token });
              }
            }
            break;
          }

          // Has tool calls — execute them
          loopMessages.push({ role: "assistant", content: message.content || "", tool_calls: message.tool_calls });

          for (const tc of message.tool_calls) {
            const toolName = tc.function.name;
            send({ type: "tool_call", name: toolName });
            let args: unknown;
            try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }

            const result = await callMcpTool(mcpServers, toolName, args);
            send({ type: "tool_result", name: toolName, result: result.slice(0, 500) });

            loopMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              name: toolName,
              content: result,
            });
          }
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
