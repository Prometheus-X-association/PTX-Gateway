import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-organization-id",
};

const LOCAL_SUPABASE_URL_FALLBACK = "http://kong:8000";
const LOCAL_SUPABASE_ANON_KEY_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SUPABASE_SERVICE_ROLE_KEY_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const LOCAL_SUPABASE_JWT_FALLBACK = "super-secret-jwt-token-with-at-least-32-characters-long";

interface LlmInsightsRequest {
  action?: "status" | "generate";
  org_execution_token?: string;
  result?: unknown;
  prompt_context?: string;
}

interface ExecutionTokenPayload {
  typ: string;
  org_id: string;
  exp: number;
}

interface LlmInsightsConfig {
  enabled?: boolean;
  provider?: "openai" | "custom";
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
  promptTemplate?: string;
}

type SupportedChartType =
  | "bar"
  | "line"
  | "area"
  | "scatter"
  | "pie"
  | "radial"
  | "treemap"
  | "network"
  | "map";

const textEncoder = new TextEncoder();

const isUuid = (value: string | null): value is string =>
  !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

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
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(data));
  const signatureBytes = new Uint8Array(signature);
  let str = "";
  signatureBytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const verify = async (data: string, signature: string, secret: string): Promise<boolean> => {
  const expected = await sign(data, secret);
  return expected === signature;
};

const resolveAuthenticatedOrgContext = async (
  supabaseUrl: string,
  supabaseAnonKey: string,
  authHeader: string,
  requestedOrgId: string | null
): Promise<{ orgId: string } | null> => {
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: authError } = await userClient.auth.getUser();
  if (authError || !userData?.user?.id) return null;

  const userId = userData.user.id;

  if (requestedOrgId && isUuid(requestedOrgId)) {
    const { data: membership, error: membershipError } = await userClient
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId)
      .eq("organization_id", requestedOrgId)
      .eq("status", "active")
      .maybeSingle();

    if (!membershipError && membership?.organization_id) {
      return { orgId: membership.organization_id };
    }
  }

  const { data: membership, error: membershipError } = await userClient
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership?.organization_id) return null;
  return { orgId: membership.organization_id };
};

const resolvePublicOrgContext = async (
  token: string | undefined,
  executeTokenSecret: string
): Promise<{ orgId: string } | null> => {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const dataToVerify = `${headerB64}.${payloadB64}`;
  const validSig = await verify(dataToVerify, signatureB64, executeTokenSecret);
  if (!validSig) return null;

  let payload: ExecutionTokenPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadB64)) as ExecutionTokenPayload;
  } catch {
    return null;
  }

  if (payload.typ !== "pdc_exec" || !isUuid(payload.org_id)) return null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!payload.exp || nowSeconds >= payload.exp) return null;

  return { orgId: payload.org_id };
};

const toObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const parseJsonFromText = (raw: string): unknown => {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  return JSON.parse(candidate);
};

const extractForcedChartType = (context: string): SupportedChartType | null => {
  const text = context.toLowerCase();

  if (/\b(bar[-\s]*chart|bar[-\s]*graph|barchart|histogram)\b/.test(text)) return "bar";
  if (/\b(line\s*chart|line\s*graph|time\s*series)\b/.test(text)) return "line";
  if (/\b(area[-\s]*chart|area[-\s]*graph)\b/.test(text)) return "area";
  if (/\b(scatter|dot[-\s]*plot|bubble[-\s]*chart)\b/.test(text)) return "scatter";
  if (/\b(pie[-\s]*chart|donut[-\s]*chart|doughnut[-\s]*chart)\b/.test(text)) return "pie";
  if (/\b(radial|radar\s*chart|polar\s*chart)\b/.test(text)) return "radial";
  if (/\b(tree\s*map|treemap|hierarchy|hierarchical)\b/.test(text)) return "treemap";
  if (/\b(network|graph\s*network|node[-\s]*link|relationship\s*graph)\b/.test(text)) return "network";
  if (/\b(map|geo\s*map|geospatial|choropleth)\b/.test(text)) return "map";

  return null;
};

const toFiniteNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const deriveDataFromAlternateStructures = (
  type: SupportedChartType,
  data: unknown[],
  nodes: unknown[],
  links: unknown[],
  hierarchy: Record<string, unknown> | undefined,
): unknown[] => {
  if (data.length > 0) return data;

  if (links.length > 0) {
    const normalizedLinks = links
      .map((link) => {
        if (!link || typeof link !== "object" || Array.isArray(link)) return null;
        const row = link as Record<string, unknown>;
        const source = String(row.source ?? row.from ?? row.parent ?? "");
        const target = String(row.target ?? row.to ?? row.child ?? "");
        const value = Math.max(1, toFiniteNumber(row.value));
        if (!source || !target) return null;
        return { category: `${source} -> ${target}`, value };
      })
      .filter((item): item is { category: string; value: number } => !!item);
    if (normalizedLinks.length > 0) return normalizedLinks;
  }

  if (nodes.length > 0) {
    const normalizedNodes = nodes
      .map((node, idx) => {
        if (!node || typeof node !== "object" || Array.isArray(node)) return null;
        const row = node as Record<string, unknown>;
        const label = String(row.name ?? row.label ?? row.id ?? `Node ${idx + 1}`);
        const value = Math.max(1, toFiniteNumber(row.value ?? row.weight ?? 1));
        return { category: label, value };
      })
      .filter((item): item is { category: string; value: number } => !!item);
    if (normalizedNodes.length > 0) return normalizedNodes;
  }

  if (hierarchy && typeof hierarchy === "object") {
    const maybeChildren = (hierarchy as Record<string, unknown>).children;
    if (Array.isArray(maybeChildren) && maybeChildren.length > 0) {
      const normalized = maybeChildren
        .map((item, idx) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const row = item as Record<string, unknown>;
          const label = String(row.name ?? `Item ${idx + 1}`);
          const value = Math.max(1, toFiniteNumber(row.value ?? row.val ?? 1));
          return { category: label, value };
        })
        .filter((item): item is { category: string; value: number } => !!item);
      if (normalized.length > 0) return normalized;
    }
  }

  if (type === "map") return [];
  return [];
};

const normalizeInsightsPayload = (raw: unknown, forcedType?: SupportedChartType | null): Record<string, unknown> => {
  const obj = toObject(raw);
  const summary = typeof obj.summary === "string" ? obj.summary : "";
  const insights = Array.isArray(obj.insights) ? obj.insights.map(String) : [];
  const visualization = toObject(obj.visualization);
  const data = Array.isArray(visualization.data) ? visualization.data : [];
  const nodes = Array.isArray(visualization.nodes) ? visualization.nodes : [];
  const links = Array.isArray(visualization.links) ? visualization.links : [];
  const hierarchy =
    visualization.hierarchy && typeof visualization.hierarchy === "object" && !Array.isArray(visualization.hierarchy)
      ? visualization.hierarchy
      : undefined;
  const type = typeof visualization.type === "string" ? visualization.type.toLowerCase() : "bar";
  const allowedTypes = new Set(["bar", "line", "area", "scatter", "pie", "radial", "treemap", "network", "map"]);
  const normalizedType = forcedType ? forcedType : (allowedTypes.has(type) ? type : "bar");
  const normalizedData = deriveDataFromAlternateStructures(
    normalizedType as SupportedChartType,
    data,
    nodes,
    links,
    hierarchy,
  );

  return {
    summary,
    insights,
    visualization: {
      type: normalizedType,
      title: typeof visualization.title === "string" ? visualization.title : "AI Suggested Visualization",
      xKey: typeof visualization.xKey === "string" ? visualization.xKey : "x",
      yKey: typeof visualization.yKey === "string" ? visualization.yKey : "y",
      categoryKey: typeof visualization.categoryKey === "string" ? visualization.categoryKey : undefined,
      valueKey: typeof visualization.valueKey === "string" ? visualization.valueKey : undefined,
      latKey: typeof visualization.latKey === "string" ? visualization.latKey : undefined,
      lngKey: typeof visualization.lngKey === "string" ? visualization.lngKey : undefined,
      sourceKey: typeof visualization.sourceKey === "string" ? visualization.sourceKey : undefined,
      targetKey: typeof visualization.targetKey === "string" ? visualization.targetKey : undefined,
      data: normalizedData,
      nodes,
      links,
      hierarchy,
    },
  };
};

const getSupabaseUrl = (): string | null =>
  Deno.env.get("SUPABASE_URL") || LOCAL_SUPABASE_URL_FALLBACK;

const getSupabaseAnonKey = (): string | null =>
  Deno.env.get("SUPABASE_ANON_KEY") || LOCAL_SUPABASE_ANON_KEY_FALLBACK;

const getSupabaseServiceRoleKey = (): string | null =>
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || LOCAL_SUPABASE_SERVICE_ROLE_KEY_FALLBACK;

const getExecutionTokenSecret = (): string | null =>
  Deno.env.get("PDC_EXECUTE_TOKEN_SECRET") ||
  Deno.env.get("SUPABASE_INTERNAL_JWT_SECRET") ||
  LOCAL_SUPABASE_JWT_FALLBACK;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = getSupabaseUrl();
    const supabaseAnonKey = getSupabaseAnonKey();
    const supabaseServiceRoleKey = getSupabaseServiceRoleKey();
    const executeTokenSecret = getExecutionTokenSecret();

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !executeTokenSecret) {
      return new Response(JSON.stringify({ error: "Server not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as LlmInsightsRequest;
    if (body.result === undefined || body.result === null) {
      return new Response(JSON.stringify({ error: "Missing result payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    const requestedOrgId = req.headers.get("x-organization-id");

    let orgContext: { orgId: string } | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      orgContext = await resolveAuthenticatedOrgContext(
        supabaseUrl,
        supabaseAnonKey,
        authHeader,
        requestedOrgId
      );
    }

    if (!orgContext) {
      orgContext = await resolvePublicOrgContext(body.org_execution_token, executeTokenSecret);
    }

    if (!orgContext) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: missing or invalid organization execution context" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: globalConfig, error: globalError } = await adminClient
      .from("global_configs")
      .select("features")
      .eq("organization_id", orgContext.orgId)
      .maybeSingle();

    if (globalError || !globalConfig) {
      return new Response(JSON.stringify({ error: "Global config not found for organization" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const features = toObject(globalConfig.features);
    const llmConfig = toObject(features.llmInsights) as LlmInsightsConfig;
    const apiKey = llmConfig.apiKey?.trim();
    const model = llmConfig.model?.trim();

    if (body.action === "status") {
      return new Response(
        JSON.stringify({
          ok: true,
          enabled: Boolean(llmConfig.enabled),
          configured: Boolean(apiKey && model),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!llmConfig.enabled) {
      return new Response(JSON.stringify({ error: "LLM insights are disabled in LLM Settings" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = llmConfig.apiBaseUrl?.trim() || "https://api.openai.com/v1";

    if (!apiKey || !model) {
      return new Response(JSON.stringify({ error: "LLM API key or model is missing in LLM Settings" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const completionUrl = baseUrl.endsWith("/chat/completions")
      ? baseUrl
      : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

    const resultJson = JSON.stringify(body.result, null, 2);
    const clippedJson = resultJson.length > 30000 ? `${resultJson.slice(0, 30000)}\n...<truncated>` : resultJson;

    const promptTemplate = llmConfig.promptTemplate?.trim() ||
      "Analyze the JSON data and return JSON only. Required keys: summary (string), insights (string[]), visualization (object). Choose the best visualization type from: 'bar'|'line'|'area'|'scatter'|'pie'|'radial'|'treemap'|'network'|'map'. Provide compatible structure: data[] for cartesian/pie/radial, nodes[]+links[] for network, hierarchy object for treemap, and data[] with lat/lng for map. Keep labels concise and chart-friendly; limit to at most 12 major points and aggregate extras as 'Other'. User can switch to another compatible chart type in UI.";
    const basePrompt = promptTemplate.includes("{{json}}")
      ? promptTemplate.replace(/\{\{json\}\}/g, clippedJson)
      : `${promptTemplate}\n\nJSON:\n${clippedJson}`;
    const contextText = typeof body.prompt_context === "string" ? body.prompt_context.trim() : "";
    const forcedChartType = contextText ? extractForcedChartType(contextText) : null;
    const chartSelectionRule = forcedChartType
      ? `Force visualization.type to "${forcedChartType}". Do not choose any other type.`
      : "Choose the best visualization.type from the supported list based on data fitness.";
    const userPrompt = contextText
      ? `${basePrompt}\n\nAdditional domain context from gateway configuration:\n${contextText}`
      : basePrompt;

    const llmResponse = await fetch(completionUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              `You are a data analyst. Return valid JSON only. Required shape: { summary: string, insights: string[], visualization: { type: 'bar'|'line'|'area'|'scatter'|'pie'|'radial'|'treemap'|'network'|'map', title: string, xKey?: string, yKey?: string, categoryKey?: string, valueKey?: string, latKey?: string, lngKey?: string, sourceKey?: string, targetKey?: string, data?: object[], nodes?: object[], links?: object[], hierarchy?: object } }. ${chartSelectionRule} Use structure that matches chosen type. Keep labels concise and aggregate long tails as 'Other'.`,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
      }),
    });

    const rawText = await llmResponse.text();
    if (!llmResponse.ok) {
      return new Response(
        JSON.stringify({ error: `LLM request failed: ${llmResponse.status} ${rawText}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let content = "";
    try {
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      content = String(
        ((parsed.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as Record<string, unknown> | undefined)?.content || ""
      );
    } catch {
      content = rawText;
    }

    let insightPayload: unknown;
    try {
      insightPayload = parseJsonFromText(content);
    } catch {
      insightPayload = { summary: content, insights: [], visualization: { type: "bar", title: "No chart", data: [] } };
    }

    return new Response(
      JSON.stringify({
        ok: true,
        insight: normalizeInsightsPayload(insightPayload, forcedChartType),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("llm-insights error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
