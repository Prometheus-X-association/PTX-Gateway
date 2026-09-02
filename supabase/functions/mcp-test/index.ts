import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-organization-id",
};

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpTestRequest {
  url: string;
  apiKey?: string;
  organizationId?: string;
}

interface McpTestResponse {
  ok: boolean;
  latencyMs?: number;
  tools?: McpTool[];
  serverInfo?: { name?: string; version?: string };
  error?: string;
  hint?: string;
}

function jsonResponse(body: McpTestResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function readSseResponse(
  body: ReadableStream<Uint8Array>,
  expectedId: string | number | null,
): Promise<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      const lines = raw.split("\n");
      raw = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const parsed = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
          if (expectedId === null || parsed.id === expectedId) return parsed;
        } catch { /* wait for the next valid data event */ }
      }
    }
  } finally {
    reader.cancel().catch(() => {/* ignore */});
  }
  return null;
}

function requestId(body: unknown): string | number | null {
  if (!body || typeof body !== "object") return null;
  const id = (body as Record<string, unknown>).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function jsonRpcError(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const error = (json as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  const code = typeof value.code === "number" || typeof value.code === "string"
    ? String(value.code)
    : "";
  const message = typeof value.message === "string" ? value.message : "Unknown JSON-RPC error";
  return [code, message].filter(Boolean).join(": ");
}

async function callMcp(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ json: unknown; sessionId?: string; error?: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    return { json: null, error: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      json: null,
      error: `HTTP ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`,
    };
  }

  const sessionId = res.headers.get("mcp-session-id") || undefined;

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("event-stream")) {
    const parsed = await readSseResponse(res.body!, requestId(body));
    if (parsed === null) {
      return { json: null, sessionId, error: "SSE stream ended without a matching JSON-RPC response" };
    }
    const rpcError = jsonRpcError(parsed);
    if (rpcError) return { json: parsed, sessionId, error: `JSON-RPC ${rpcError}` };
    return { json: parsed, sessionId };
  }

  try {
    const json = await res.json();
    const rpcError = jsonRpcError(json);
    if (rpcError) return { json, sessionId, error: `JSON-RPC ${rpcError}` };
    return { json, sessionId };
  } catch {
    return { json: null, error: "Invalid JSON in response" };
  }
}

async function sendMcpNotification(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<string | undefined> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return `HTTP ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`;
    }
    // Notifications commonly return 202 with no response body.
    await res.body?.cancel().catch(() => {/* ignore */});
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ ok: false, error: "Server not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ ok: false, error: "Missing Authorization header" }, 401);
  }

  // Verify the caller is a logged-in user
  const requesterClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: authError } = await requesterClient.auth.getUser();
  if (authError || !userData?.user) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  // Verify admin role within their org
  const orgId = req.headers.get("x-organization-id");
  if (orgId) {
    const { data: roleData } = await requesterClient
      .from("user_roles")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", userData.user.id)
      .in("role", ["admin", "super_admin"])
      .maybeSingle();
    if (!roleData) {
      return jsonResponse({ ok: false, error: "Admin role required" }, 403);
    }
  }

  let body: McpTestRequest;
  try {
    body = await req.json() as McpTestRequest;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request body" }, 400);
  }

  if (!body.url?.trim()) {
    return jsonResponse({ ok: false, error: "No URL provided" }, 400);
  }

  const mcpHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (body.apiKey?.trim()) {
    mcpHeaders["Authorization"] = `Bearer ${body.apiKey.trim()}`;
  }

  const t0 = performance.now();

  // Step 1: initialize
  const initResult = await callMcp(body.url, mcpHeaders, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "PTX-Gateway", version: "1.0" },
    },
  });

  if (initResult.error) {
    const hint = initResult.error.includes("404")
      ? "The URL path may be wrong — try adding /mcp or /sse suffix."
      : initResult.error.includes("401") || initResult.error.includes("403")
      ? "Check your API key."
      : initResult.error.includes("ECONNREFUSED") || initResult.error.includes("Failed to fetch")
      ? "Server is unreachable. Check the URL and make sure the server is running."
      : undefined;
    return jsonResponse({ ok: false, latencyMs: Math.round(performance.now() - t0), error: initResult.error, hint });
  }

  const initJson = initResult.json as { result?: { serverInfo?: { name?: string; version?: string } } } | null;
  const serverInfo = initJson?.result?.serverInfo;

  // Streamable HTTP servers bind subsequent requests to the session created by
  // initialize. They may also require the negotiated protocol version header.
  const protocolVersion = (initResult.json as { result?: { protocolVersion?: string } } | null)
    ?.result?.protocolVersion || "2024-11-05";
  const sessionHeaders = { ...mcpHeaders, "MCP-Protocol-Version": protocolVersion };
  if (initResult.sessionId) sessionHeaders["Mcp-Session-Id"] = initResult.sessionId;

  const notificationError = await sendMcpNotification(body.url, sessionHeaders, {
    jsonrpc: "2.0", method: "notifications/initialized", params: {},
  });
  if (notificationError) {
    return jsonResponse({
      ok: false,
      latencyMs: Math.round(performance.now() - t0),
      serverInfo,
      error: `initialize succeeded but notifications/initialized failed: ${notificationError}`,
    });
  }

  // Step 2: tools/list. Follow cursors so the admin sees the complete catalog.
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const toolsResult = await callMcp(body.url, sessionHeaders, {
      jsonrpc: "2.0",
      id: 2 + page,
      method: "tools/list",
      params: cursor ? { cursor } : {},
    });

    if (toolsResult.error) {
      return jsonResponse({
        ok: false,
        latencyMs: Math.round(performance.now() - t0),
        serverInfo,
        tools,
        error: `initialize succeeded but tools/list failed: ${toolsResult.error}`,
      });
    }

    const toolsJson = toolsResult.json as {
      result?: { tools?: McpTool[]; nextCursor?: string };
    } | null;
    if (!Array.isArray(toolsJson?.result?.tools)) {
      return jsonResponse({
        ok: false,
        latencyMs: Math.round(performance.now() - t0),
        serverInfo,
        tools,
        error: "initialize succeeded but tools/list returned no tools array",
      });
    }
    tools.push(...toolsJson.result.tools);
    cursor = typeof toolsJson.result.nextCursor === "string" && toolsJson.result.nextCursor
      ? toolsJson.result.nextCursor
      : undefined;
    if (!cursor) break;
  }

  return jsonResponse({
    ok: true,
    latencyMs: Math.round(performance.now() - t0),
    serverInfo,
    tools,
  });
});
