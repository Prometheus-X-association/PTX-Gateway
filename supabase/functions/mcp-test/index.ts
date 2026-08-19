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

async function readFirstSseEvent(body: ReadableStream<Uint8Array>): Promise<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  try {
    for (let i = 0; i < 50; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      const match = raw.match(/^data:\s*(.+)$/m);
      if (match) {
        try { return JSON.parse(match[1]); } catch { return null; }
      }
    }
  } finally {
    reader.cancel().catch(() => {/* ignore */});
  }
  return null;
}

async function callMcp(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ json: unknown; error?: string }> {
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

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("event-stream")) {
    const parsed = await readFirstSseEvent(res.body!);
    return { json: parsed };
  }

  try {
    return { json: await res.json() };
  } catch {
    return { json: null, error: "Invalid JSON in response" };
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

  // Step 2: tools/list
  const toolsResult = await callMcp(body.url, mcpHeaders, {
    jsonrpc: "2.0", id: 2, method: "tools/list", params: {},
  });

  let tools: McpTool[] = [];
  let toolsError: string | undefined;

  if (toolsResult.error) {
    toolsError = `initialize succeeded but tools/list failed: ${toolsResult.error}`;
  } else {
    const toolsJson = toolsResult.json as { result?: { tools?: McpTool[] } } | null;
    tools = toolsJson?.result?.tools ?? [];
  }

  return jsonResponse({
    ok: true,
    latencyMs: Math.round(performance.now() - t0),
    serverInfo,
    tools,
    ...(toolsError ? { error: toolsError } : {}),
  });
});
