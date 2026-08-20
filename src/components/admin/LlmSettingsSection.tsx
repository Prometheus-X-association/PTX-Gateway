import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Brain, Save, Plus, Trash2, ChevronUp, ChevronDown,
  Eye, EyeOff, Server, Zap, RotateCcw, Bot, MessageSquarePlus,
  Pencil, X, ChevronsUpDown, Info, Link2, FlaskConical,
  CheckCircle2, XCircle, ChevronRight, Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LlmProvider {
  id: string;
  name: string;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

interface McpServer {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  enabled: boolean;
}

interface LlmAgent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  expectedOutput: "text" | "json" | "html" | "mixed";
  outputInstructions: string;
  mcpServerIds: string[];
  mcpToolFilter: Record<string, string[]>;
  providerIds: string[];
  agentProviders: LlmProvider[];
  defaultPrompts: string[];
  enabled: boolean;
  ragSources: "all" | "result" | "document" | "none";
  ragMode: "auto" | "chunks" | "none"; // auto = full doc if small, chunks if large
  ragTopK: number;
}

interface LlmInsightsConfig {
  enabled: boolean;
  providers: LlmProvider[];
  mcpServers: McpServer[];
  agents: LlmAgent[];
  predefinedPrompts: string[];
}

interface GlobalConfigSnapshot {
  app_name: string;
  app_version: string;
  environment: "development" | "staging" | "production";
  logging: { enabled: boolean; level: "debug" | "info" | "warn" | "error" };
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DATA_ANALYST_PROMPT =
  "You are a data analyst assistant. The user is viewing a result dataset. Answer questions clearly and concisely with insights, trends, patterns, and actionable recommendations. Structure your response with headings and bullet points for clarity.";

const CHART_BUILDER_PROMPT =
  "You are a data visualization expert. When asked for a chart, return ONLY a self-contained HTML block: a container div with id='chart' and style='height:400px', followed by a script tag loading ECharts from 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js', then an init script using document.getElementById('chart'). Output no text outside the HTML block.";

const AI_INSIGHT_PROMPT =
  "You are a business intelligence expert. For the given data, provide: 1) A concise summary paragraph, 2) 3-5 key bullet point insights, 3) A self-contained ECharts HTML visualization at the end. The visualization must be a <div id='chart' style='height:400px'></div> followed by the ECharts CDN <script> tag and an init script that calls document.getElementById('chart').";

const SWITCHABLE_CHART_PROMPT =
  "Analyze the JSON data and return JSON only. Required keys: summary (string), insights (string[]), visualization (object). Choose the best visualization type from: 'bar'|'line'|'area'|'scatter'|'pie'|'radial'|'treemap'|'network'|'map'. Provide the matching data structure: data[] for cartesian/pie/radial types, nodes[]+links[] for network, hierarchy object for treemap, data[] with lat/lng fields for map. Keep labels concise and aggregate long-tail items as 'Other'. The user can switch to another compatible chart type in the UI after generation.";

// ─── Output type options (must be before DEFAULT_AGENTS) ──────────────────────

const OUTPUT_OPTIONS: Array<{
  value: LlmAgent["expectedOutput"];
  label: string;
  description: string;
  color: string;
  defaultInstructions: string;
}> = [
  {
    value: "text",
    label: "Text",
    description: "Markdown prose — headings, bullets, bold",
    color: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
    defaultInstructions:
      "Respond in clear, well-structured markdown.\n" +
      "Use ## headings for sections, **bold** for key terms, and - bullet lists for findings.\n" +
      "Keep the response concise and actionable.",
  },
  {
    value: "json",
    label: "JSON",
    description: "Structured JSON object — parseable, schema-defined",
    color: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    defaultInstructions:
      "Return ONLY valid JSON. No markdown, no code fences, no text before or after the JSON object.\n\n" +
      "Required keys:\n" +
      '- "summary": string — one-paragraph overview\n' +
      '- "insights": string[] — 3–5 key findings as an array of strings\n' +
      '- "data": any — structured data relevant to the question',
  },
  {
    value: "html",
    label: "HTML Chart",
    description: "Self-contained ECharts HTML block rendered in an iframe",
    color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    defaultInstructions:
      "Return ONLY a self-contained HTML visualization. No text outside the HTML block.\n\n" +
      "Required structure:\n" +
      '<div id="chart" style="height:400px"></div>\n' +
      '<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>\n' +
      "<script>\n" +
      "  const chart = echarts.init(document.getElementById('chart'));\n" +
      "  chart.setOption({ /* ECharts option object */ });\n" +
      "</script>",
  },
  {
    value: "mixed",
    label: "Mixed",
    description: "Markdown analysis followed by an ECharts HTML chart",
    color: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
    defaultInstructions:
      "Structure your response in two parts:\n\n" +
      "1. **Analysis** — 2–3 paragraphs of insight plus a bullet-point summary in markdown.\n" +
      '2. **Visualization** — immediately after the text, append a self-contained ECharts HTML block starting with <div id="chart" style="height:400px">.',
  },
];

const DEFAULT_AGENTS: LlmAgent[] = [
  {
    id: "data-analyst",
    name: "Data Analyst",
    description: "General data analysis, insights, and trend identification",
    systemPrompt: DATA_ANALYST_PROMPT,
    expectedOutput: "text",
    outputInstructions: OUTPUT_OPTIONS.find((o) => o.value === "text")!.defaultInstructions,
    mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [],
    defaultPrompts: [
      "Summarize the key findings in 3 bullet points",
      "Which item has the highest value and why might that be?",
      "Are there any outliers or anomalies in this data?",
      "What trends do you see?",
    ],
    enabled: true, ragSources: "all", ragMode: "auto", ragTopK: 20,
  },
  {
    id: "chart-builder",
    name: "Chart Builder",
    description: "Creates interactive ECharts visualizations from data",
    systemPrompt: CHART_BUILDER_PROMPT,
    expectedOutput: "html",
    outputInstructions: OUTPUT_OPTIONS.find((o) => o.value === "html")!.defaultInstructions,
    mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [],
    defaultPrompts: [
      "Show me a bar chart of the top 10 results",
      "Create a pie chart of the data distribution",
      "Show a line chart of values over time",
      "Visualize the top 5 items as a horizontal bar chart",
    ],
    enabled: true, ragSources: "all", ragMode: "auto", ragTopK: 20,
  },
  {
    id: "ai-insight",
    name: "AI Insight",
    description: "Full analysis with written insights and a chart visualization",
    systemPrompt: AI_INSIGHT_PROMPT,
    expectedOutput: "mixed",
    outputInstructions: OUTPUT_OPTIONS.find((o) => o.value === "mixed")!.defaultInstructions,
    mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [],
    defaultPrompts: [
      "Generate a complete AI insight with visualization for this data",
      "Give me a business summary with a supporting chart",
      "Analyze this data and show me the most important visualization",
    ],
    enabled: true, ragSources: "all", ragMode: "auto", ragTopK: 20,
  },
  {
    id: "switchable-chart",
    name: "Switchable Chart",
    description: "Returns structured JSON with summary, insights, and a switchable chart spec",
    systemPrompt: SWITCHABLE_CHART_PROMPT,
    expectedOutput: "json",
    outputInstructions:
      'Return ONLY valid JSON. No markdown, no code fences.\n\nRequired keys:\n- "summary": string\n- "insights": string[]\n- "visualization": { "type": "bar"|"line"|"pie"|"scatter"|"area", "data": array, "labels"?: string[] }',
    mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [],
    defaultPrompts: [
      "Analyze this data and generate an interactive chart I can switch between types",
      "Generate a summary with insights and a switchable visualization",
      "What is the best chart type for this data? Show me the result",
    ],
    enabled: true, ragSources: "all", ragMode: "auto", ragTopK: 20,
  },
];

const DEFAULT_CONFIG: LlmInsightsConfig = {
  enabled: false,
  providers: [],
  mcpServers: [],
  agents: DEFAULT_AGENTS,
  predefinedPrompts: [],
};

const DEFAULT_GLOBAL_SNAPSHOT: GlobalConfigSnapshot = {
  app_name: "Data Analytics Platform",
  app_version: "1.0.0",
  environment: "production",
  logging: { enabled: true, level: "info" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => crypto.randomUUID();

const moveItem = <T,>(arr: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

const emptyProvider = (): LlmProvider => ({
  id: uid(), name: "", apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "", model: "gpt-4o-mini", enabled: true,
});

const emptyMcpServer = (): McpServer => ({
  id: uid(), name: "", url: "", apiKey: "", enabled: true,
});

const emptyAgent = (): LlmAgent => ({
  id: uid(), name: "New Agent", description: "",
  systemPrompt: "You are a helpful data assistant. Answer questions about the result data clearly and concisely.",
  expectedOutput: "text",
  outputInstructions: OUTPUT_OPTIONS.find((o) => o.value === "text")!.defaultInstructions,
  mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [], defaultPrompts: [], enabled: true,
  ragSources: "all", ragMode: "auto", ragTopK: 20,
});

const migrateFromLegacy = (raw: Record<string, unknown>): LlmInsightsConfig => {
  const hasProviders = Array.isArray(raw.providers) && (raw.providers as unknown[]).length > 0;
  const providers: LlmProvider[] = hasProviders
    ? (raw.providers as LlmProvider[]).map((p) => ({
        id: String(p.id || uid()), name: String(p.name || ""),
        apiBaseUrl: String(p.apiBaseUrl || "https://api.openai.com/v1"),
        apiKey: String(p.apiKey || ""), model: String(p.model || "gpt-4o-mini"),
        enabled: p.enabled !== false,
      }))
    : typeof raw.apiKey === "string" && raw.apiKey
    ? [{ id: uid(), name: "Default", apiBaseUrl: String(raw.apiBaseUrl || "https://api.openai.com/v1"),
        apiKey: String(raw.apiKey), model: String(raw.model || "gpt-4o-mini"), enabled: true }]
    : [];

  const mcpServers: McpServer[] = Array.isArray(raw.mcpServers)
    ? (raw.mcpServers as McpServer[]).map((s) => ({
        id: String(s.id || uid()), name: String(s.name || ""),
        url: String(s.url || ""), apiKey: String(s.apiKey || ""),
        enabled: s.enabled !== false,
      }))
    : [];

  // Migrate agents or use defaults
  let agents: LlmAgent[];
  if (Array.isArray(raw.agents) && (raw.agents as unknown[]).length > 0) {
    agents = (raw.agents as LlmAgent[]).map((a) => ({
      id: String(a.id || uid()),
      name: String(a.name || "Agent"),
      description: String(a.description || ""),
      systemPrompt: String(a.systemPrompt || ""),
      expectedOutput: (() => {
        const raw = String(a.expectedOutput ?? "text");
        if (raw === "echarts") return "html";
        if (raw === "table") return "text";
        return (["text", "json", "html", "mixed"].includes(raw) ? raw : "text") as LlmAgent["expectedOutput"];
      })(),
      outputInstructions: typeof a.outputInstructions === "string" && a.outputInstructions
        ? a.outputInstructions
        : (() => {
            const raw = String(a.expectedOutput ?? "text");
            const mapped = raw === "echarts" ? "html" : raw === "table" ? "text" : raw;
            return OUTPUT_OPTIONS.find((o) => o.value === mapped)?.defaultInstructions ?? OUTPUT_OPTIONS[0].defaultInstructions;
          })(),
      mcpServerIds: Array.isArray(a.mcpServerIds) ? (a.mcpServerIds as unknown[]).map(String) : [],
      mcpToolFilter: (a.mcpToolFilter && typeof a.mcpToolFilter === "object" && !Array.isArray(a.mcpToolFilter))
        ? Object.fromEntries(
            Object.entries(a.mcpToolFilter as Record<string, unknown>).map(([k, v]) => [
              k, Array.isArray(v) ? (v as unknown[]).map(String) : [],
            ])
          )
        : {},
      providerIds: Array.isArray(a.providerIds) ? (a.providerIds as unknown[]).map(String) : [],
      agentProviders: Array.isArray(a.agentProviders)
        ? (a.agentProviders as LlmProvider[]).map((p) => ({
            id: String(p.id || uid()), name: String(p.name || ""),
            apiBaseUrl: String(p.apiBaseUrl || "https://api.openai.com/v1"),
            apiKey: String(p.apiKey || ""), model: String(p.model || "gpt-4o-mini"),
            enabled: p.enabled !== false,
          }))
        : [],
      defaultPrompts: Array.isArray(a.defaultPrompts) ? (a.defaultPrompts as unknown[]).map(String).filter(Boolean) : [],
      enabled: a.enabled !== false,
      ragSources: (["all", "result", "document", "none"].includes(String(a.ragSources ?? "")) ? a.ragSources : "all") as LlmAgent["ragSources"],
      ragMode: (["auto", "chunks", "none"].includes(String(a.ragMode ?? "")) ? a.ragMode : "auto") as LlmAgent["ragMode"],
      ragTopK: typeof a.ragTopK === "number" && a.ragTopK > 0 ? a.ragTopK : 20,
    }));
  } else {
    // Legacy: if there's a chatSystemPrompt, create a single agent from it
    const legacyPrompt = typeof raw.chatSystemPrompt === "string" ? raw.chatSystemPrompt.trim() : "";
    const legacyPredefined = Array.isArray(raw.predefinedPrompts)
      ? (raw.predefinedPrompts as unknown[]).map(String).filter(Boolean)
      : [];
    if (legacyPrompt) {
      agents = [{
        ...DEFAULT_AGENTS[0],
        id: uid(),
        systemPrompt: legacyPrompt,
        outputInstructions: OUTPUT_OPTIONS[0].defaultInstructions,
        mcpToolFilter: {},
        providerIds: [],
        agentProviders: [],
        defaultPrompts: legacyPredefined.length > 0 ? legacyPredefined : DEFAULT_AGENTS[0].defaultPrompts,
      }, DEFAULT_AGENTS[1], DEFAULT_AGENTS[2]];
    } else {
      agents = DEFAULT_AGENTS;
    }
  }

  // Global predefined prompts (not agent-tied) — if the DB had a predefinedPrompts array
  // and agents were already migrated separately, keep it; otherwise start empty.
  const predefinedPrompts: string[] = Array.isArray(raw.predefinedPrompts) && Array.isArray(raw.agents)
    ? (raw.predefinedPrompts as unknown[]).map(String).filter(Boolean)
    : [];

  return { enabled: Boolean(raw.enabled ?? false), providers, mcpServers, agents, predefinedPrompts };
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ProviderCardProps {
  provider: LlmProvider; index: number; total: number;
  onChange: (updated: LlmProvider) => void;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}

const ProviderCard = ({ provider, index, total, onChange, onMove, onRemove }: ProviderCardProps) => {
  const [showKey, setShowKey] = useState(false);
  const label = index === 0 ? "Primary" : `Fallback ${index}`;

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card">
      <div className="flex items-center gap-2">
        <Badge variant={index === 0 ? "default" : "secondary"} className="shrink-0">{label}</Badge>
        <Input className="h-8 text-sm font-medium" placeholder="Provider name (e.g. OpenAI, Groq)"
          value={provider.name} onChange={(e) => onChange({ ...provider, name: e.target.value })} />
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={index === 0}
            onClick={() => onMove(index, index - 1)}><ChevronUp className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={index === total - 1}
            onClick={() => onMove(index, index + 1)}><ChevronDown className="h-4 w-4" /></Button>
          <Switch checked={provider.enabled} onCheckedChange={(v) => onChange({ ...provider, enabled: v })} />
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">API Base URL</Label>
          <Input className="h-8 text-xs" placeholder="https://api.openai.com/v1" value={provider.apiBaseUrl}
            onChange={(e) => onChange({ ...provider, apiBaseUrl: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Model</Label>
          <Input className="h-8 text-xs" placeholder="gpt-4o-mini" value={provider.model}
            onChange={(e) => onChange({ ...provider, model: e.target.value })} />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">API Key</Label>
          <div className="relative">
            <Input className="h-8 text-xs pr-9" type={showKey ? "text" : "password"} placeholder="sk-..."
              value={provider.apiKey} onChange={(e) => onChange({ ...provider, apiKey: e.target.value })} />
            <button type="button" className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
              onClick={() => setShowKey((v) => !v)}>
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── MCP test result types ────────────────────────────────────────────────────

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpTestResult {
  ok: boolean;
  latencyMs?: number;
  tools?: McpTool[];
  serverInfo?: { name?: string; version?: string };
  error?: string;
  hint?: string;
}

// Proxy the MCP test through the Edge Function to avoid CORS restrictions.
// The Deno runtime on the server side can reach any HTTP endpoint freely.
async function testMcpServer(
  url: string,
  apiKey: string,
  supabaseClient: typeof import("@/integrations/supabase/client").supabase,
  organizationId?: string,
): Promise<McpTestResult> {
  if (!url.trim()) return { ok: false, error: "No URL configured." };

  const { data, error } = await supabaseClient.functions.invoke("mcp-test", {
    body: { url: url.trim(), apiKey: apiKey.trim() || undefined },
    headers: organizationId ? { "x-organization-id": organizationId } : undefined,
  });

  if (error) {
    // FunctionsHttpError surfaces the function's JSON body in error.context
    const ctx = (error as { context?: { error?: string; hint?: string } }).context;
    return {
      ok: false,
      error: ctx?.error ?? error.message ?? String(error),
      hint: ctx?.hint,
    };
  }

  return data as McpTestResult;
}

// ─── MCP card ─────────────────────────────────────────────────────────────────

interface McpCardProps {
  server: McpServer; index: number;
  supabaseClient: typeof supabase;
  organizationId?: string;
  onChange: (updated: McpServer) => void;
  onRemove: () => void;
}

const McpCard = ({ server, supabaseClient, organizationId, onChange, onRemove }: McpCardProps) => {
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<McpTestResult | null>(null);
  const [showTools, setShowTools] = useState(false);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    setShowTools(false);
    const result = await testMcpServer(server.url, server.apiKey, supabaseClient, organizationId);
    setTestResult(result);
    setTesting(false);
    if (result.ok && result.tools && result.tools.length > 0) setShowTools(true);
  };

  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      {/* Header row */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <Input className="h-8 text-sm font-medium" placeholder="Server name (e.g. Analytics MCP)"
          value={server.name} onChange={(e) => onChange({ ...server, name: e.target.value })} />
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <Switch checked={server.enabled} onCheckedChange={(v) => onChange({ ...server, enabled: v })} />
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-4 pb-3">
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">MCP Endpoint URL</Label>
          <Input className="h-8 text-xs" placeholder="https://your-mcp-server.com/mcp"
            value={server.url} onChange={(e) => onChange({ ...server, url: e.target.value })} />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">API Key (optional)</Label>
          <div className="relative">
            <Input className="h-8 text-xs pr-9" type={showKey ? "text" : "password"} placeholder="Bearer token or API key"
              value={server.apiKey} onChange={(e) => onChange({ ...server, apiKey: e.target.value })} />
            <button type="button" className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
              onClick={() => setShowKey((v) => !v)}>
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Test bar */}
      <div className="border-t border-border/60 bg-muted/30 px-4 py-2.5 flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs h-7"
          disabled={testing || !server.url.trim()} onClick={runTest}>
          {testing
            ? <><Loader2 className="h-3 w-3 animate-spin" />Testing…</>
            : <><FlaskConical className="h-3 w-3" />Test Connection</>}
        </Button>

        {testResult && !testing && (
          <div className="flex items-center gap-2 text-xs min-w-0">
            {testResult.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
            )}
            {testResult.ok ? (
              <span className="text-green-600 dark:text-green-400 font-medium">
                Connected
                {testResult.serverInfo?.name && ` · ${testResult.serverInfo.name}${testResult.serverInfo.version ? ` v${testResult.serverInfo.version}` : ""}`}
                {testResult.latencyMs !== undefined && ` · ${testResult.latencyMs}ms`}
                {testResult.tools !== undefined && ` · ${testResult.tools.length} tool${testResult.tools.length === 1 ? "" : "s"}`}
              </span>
            ) : (
              <span className="text-destructive truncate">{testResult.error}</span>
            )}

            {testResult.ok && testResult.tools && testResult.tools.length > 0 && (
              <button type="button"
                className="ml-auto shrink-0 flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowTools((v) => !v)}>
                <Wrench className="h-3 w-3" />
                <span>{showTools ? "Hide" : "Show"} tools</span>
                <ChevronRight className={`h-3 w-3 transition-transform ${showTools ? "rotate-90" : ""}`} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Error hint */}
      {testResult && !testResult.ok && testResult.hint && (
        <div className="border-t border-border/60 bg-amber-50 dark:bg-amber-950/20 px-4 py-2 text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{testResult.hint}</span>
        </div>
      )}

      {/* Error detail (for partial success) */}
      {testResult?.ok && testResult.error && (
        <div className="border-t border-border/60 bg-amber-50 dark:bg-amber-950/20 px-4 py-2 text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{testResult.error}</span>
        </div>
      )}

      {/* Tools list */}
      {showTools && testResult?.tools && testResult.tools.length > 0 && (
        <div className="border-t border-border/60 px-4 py-3 space-y-2 bg-muted/20">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Discovered tools ({testResult.tools.length})
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {testResult.tools.map((tool, i) => (
              <div key={i} className="border border-border/60 rounded-md px-3 py-2 bg-background space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <Wrench className="h-3 w-3 text-primary shrink-0" />
                  <span className="text-xs font-mono font-semibold text-foreground">{tool.name}</span>
                </div>
                {tool.description && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed pl-4">{tool.description}</p>
                )}
                {tool.inputSchema && (
                  <details className="pl-4">
                    <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground select-none">
                      Input schema
                    </summary>
                    <pre className="mt-1 text-[10px] font-mono bg-muted/60 rounded p-2 overflow-x-auto text-muted-foreground">
                      {JSON.stringify(tool.inputSchema, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty tools notice */}
      {testResult?.ok && testResult.tools && testResult.tools.length === 0 && (
        <div className="border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground flex items-center gap-2">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span>Server connected but returned no tools via <code className="font-mono bg-muted px-1 rounded">tools/list</code>. It may not expose any tools yet.</span>
        </div>
      )}
    </div>
  );
};

// ─── MCP guide ────────────────────────────────────────────────────────────────

const McpGuide = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/60 rounded-lg overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
      >
        <span className="font-medium flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5 text-primary" />
          How to set up and integrate MCP servers
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-4 py-4 space-y-4 bg-background border-t border-border/60">

          {/* What is MCP */}
          <div className="space-y-1">
            <p className="font-semibold text-foreground">What is MCP?</p>
            <p className="text-muted-foreground leading-relaxed">
              Model Context Protocol (MCP) is an open standard for exposing tools and data sources to LLMs.
              Each MCP server publishes a list of callable functions — the LLM discovers them at request time
              and calls them autonomously when relevant to the user's question.
            </p>
          </div>

          {/* Connection protocol */}
          <div className="space-y-2">
            <p className="font-semibold text-foreground">Connection protocol</p>
            <div className="space-y-1 text-muted-foreground">
              <p>• Protocol: <span className="font-mono bg-muted px-1 rounded">HTTP POST</span> with <span className="font-mono bg-muted px-1 rounded">JSON-RPC 2.0</span> (Streamable HTTP)</p>
              <p>• Response: JSON or <span className="font-mono bg-muted px-1 rounded">text/event-stream</span> (SSE) — both supported automatically</p>
              <p>• Authentication: API Key is sent as <span className="font-mono bg-muted px-1 rounded">Authorization: Bearer &lt;key&gt;</span></p>
            </div>
            <div className="bg-muted/60 rounded-md p-3 font-mono leading-relaxed text-muted-foreground">
              <p className="text-foreground font-semibold mb-1 font-sans text-[10px] uppercase tracking-wide">Example server URL</p>
              <p>https://your-mcp-server.com/mcp</p>
              <p>https://analytics.internal/api/mcp</p>
              <p>http://localhost:8080/mcp  <span className="text-muted-foreground/60">(local dev)</span></p>
            </div>
          </div>

          {/* How the flow works */}
          <div className="space-y-2">
            <p className="font-semibold text-foreground">How it works during chat</p>
            <ol className="space-y-1 text-muted-foreground list-none">
              {[
                "Chat request arrives → gateway calls initialize then tools/list on each enabled server",
                "Discovered tools are passed to the LLM as callable functions",
                "LLM decides when to invoke a tool based on the conversation",
                "Gateway executes the tool call and feeds the result back to the LLM",
                "LLM uses the result to produce the final answer, which streams to the user",
                "The chat UI shows which tools were called as inline badges",
              ].map((step, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center font-bold">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Example tool */}
          <div className="space-y-2">
            <p className="font-semibold text-foreground">Example tool response from MCP server</p>
            <pre className="bg-muted/60 rounded-md p-3 font-mono text-[11px] leading-relaxed text-muted-foreground overflow-x-auto">{`{
  "tools": [
    {
      "name": "query_database",
      "description": "Run a SQL query on the analytics DB",
      "inputSchema": {
        "type": "object",
        "properties": {
          "sql": { "type": "string", "description": "SQL query to execute" }
        },
        "required": ["sql"]
      }
    }
  ]
}`}</pre>
          </div>

          {/* Compatible use cases */}
          <div className="space-y-2">
            <p className="font-semibold text-foreground">Compatible server types</p>
            <div className="grid grid-cols-2 gap-1.5 text-muted-foreground">
              {[
                ["Database / SQL", "Run queries against analytics DBs or data warehouses"],
                ["Vector / RAG", "Search knowledge bases, documentation, or embeddings"],
                ["Analytics APIs", "Fetch KPIs, reports, or aggregated metrics"],
                ["Business logic", "ERP data, product catalogs, CRM records"],
                ["File / document", "Read or search documents, PDFs, spreadsheets"],
                ["Custom tools", "Any internal API wrapped in a JSON-RPC 2.0 endpoint"],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-1.5">
                  <Link2 className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-foreground">{title}</span>
                    <p className="text-muted-foreground/80">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Per-agent assignment tip */}
          <div className="bg-primary/5 border border-primary/20 rounded-md px-3 py-2.5 space-y-1">
            <p className="font-semibold text-primary flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5" /> Per-agent tool assignment
            </p>
            <p className="text-muted-foreground leading-relaxed">
              By default every agent can use <em>all</em> enabled servers. Open an agent's Edit panel
              and select specific servers to restrict which tools that agent can call — useful when
              a narrow agent (e.g. Chart Builder) shouldn't be distracted by unrelated tools like
              "send email" or "write to database".
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Agent table row ──────────────────────────────────────────────────────────

interface AgentTableRowProps {
  agent: LlmAgent;
  index: number;
  total: number;
  isEditing: boolean;
  mcpServers: McpServer[];
  onToggleEdit: () => void;
  onChange: (updated: LlmAgent) => void;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}

const AgentTableRow = ({ agent, index, total, isEditing, mcpServers, onToggleEdit, onChange, onMove, onRemove }: AgentTableRowProps) => {
  const outputOption = OUTPUT_OPTIONS.find((o) => o.value === agent.expectedOutput);
  const mcpLabel = agent.mcpServerIds.length === 0
    ? (mcpServers.length > 0 ? "All" : "—")
    : `${agent.mcpServerIds.length}`;

  return (
    <div className={`grid grid-cols-[28px_1fr_80px_60px_48px_52px_auto] items-center gap-2 px-3 py-2.5 border-b border-border/50 last:border-0 text-sm transition-colors ${isEditing ? "bg-primary/5" : "hover:bg-muted/40"}`}>
      {/* Order index */}
      <span className="text-xs text-muted-foreground text-center tabular-nums">{index + 1}</span>

      {/* Name + description */}
      <div className="min-w-0">
        <p className="font-medium truncate leading-tight">{agent.name || "Unnamed Agent"}</p>
        {agent.description && (
          <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5">{agent.description}</p>
        )}
      </div>

      {/* Output type */}
      {outputOption ? (
        <Badge variant="outline" className="text-[10px] justify-center">{outputOption.label}</Badge>
      ) : <span />}

      {/* Prompts count */}
      <span className="text-xs text-muted-foreground text-center">{agent.defaultPrompts.length} prompts</span>

      {/* MCP */}
      <span className="text-xs text-muted-foreground text-center">{mcpLabel}</span>

      {/* Enabled */}
      <Switch checked={agent.enabled} onCheckedChange={(v) => onChange({ ...agent, enabled: v })} className="mx-auto" />

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Move up"
          disabled={index === 0} onClick={() => onMove(index, index - 1)}>
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Move down"
          disabled={index === total - 1} onClick={() => onMove(index, index + 1)}>
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant={isEditing ? "secondary" : "ghost"} size="icon" className="h-7 w-7" title={isEditing ? "Collapse detail" : "Edit agent"}
          onClick={onToggleEdit}>
          {isEditing ? <ChevronsUpDown className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Delete agent"
          onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};

// ─── Agent edit panel ─────────────────────────────────────────────────────────

interface AgentEditPanelProps {
  agent: LlmAgent;
  mcpServers: McpServer[];
  globalProviders: LlmProvider[];
  supabaseClient: typeof supabase;
  organizationId?: string;
  onChange: (updated: LlmAgent) => void;
  onClose: () => void;
}

const AgentEditPanel = ({ agent, mcpServers, globalProviders, supabaseClient, organizationId, onChange, onClose }: AgentEditPanelProps) => {
  const [showAgentProviderKey, setShowAgentProviderKey] = useState<string | null>(null);
  // per-server tool discovery state
  const [serverTools, setServerTools] = useState<Record<string, { loading: boolean; tools: McpTool[]; error?: string }>>({});

  const updatePrompt = (i: number, val: string) =>
    onChange({ ...agent, defaultPrompts: agent.defaultPrompts.map((p, j) => (j === i ? val : p)) });
  const removePrompt = (i: number) =>
    onChange({ ...agent, defaultPrompts: agent.defaultPrompts.filter((_, j) => j !== i) });

  const toggleMcp = (serverId: string) => {
    const ids = agent.mcpServerIds.includes(serverId)
      ? agent.mcpServerIds.filter((id) => id !== serverId)
      : [...agent.mcpServerIds, serverId];
    // clear tool filter for deselected server
    const newFilter = { ...agent.mcpToolFilter };
    if (ids.includes(serverId) === false) delete newFilter[serverId];
    onChange({ ...agent, mcpServerIds: ids, mcpToolFilter: newFilter });
  };

  const loadServerTools = async (server: McpServer) => {
    setServerTools((prev) => ({ ...prev, [server.id]: { loading: true, tools: [] } }));
    const result = await testMcpServer(server.url, server.apiKey, supabaseClient, organizationId);
    setServerTools((prev) => ({
      ...prev,
      [server.id]: {
        loading: false,
        tools: result.tools ?? [],
        error: result.ok ? undefined : (result.error ?? "Failed to load tools"),
      },
    }));
  };

  const toggleTool = (serverId: string, toolName: string) => {
    const current = agent.mcpToolFilter[serverId] ?? [];
    const next = current.includes(toolName)
      ? current.filter((n) => n !== toolName)
      : [...current, toolName];
    onChange({ ...agent, mcpToolFilter: { ...agent.mcpToolFilter, [serverId]: next } });
  };

  const clearToolFilter = (serverId: string) => {
    const newFilter = { ...agent.mcpToolFilter };
    delete newFilter[serverId];
    onChange({ ...agent, mcpToolFilter: newFilter });
  };

  const toggleProvider = (providerId: string) => {
    const ids = agent.providerIds.includes(providerId)
      ? agent.providerIds.filter((id) => id !== providerId)
      : [...agent.providerIds, providerId];
    onChange({ ...agent, providerIds: ids });
  };

  const updateAgentProvider = (i: number, updated: LlmProvider) =>
    onChange({ ...agent, agentProviders: agent.agentProviders.map((p, j) => (j === i ? updated : p)) });
  const removeAgentProvider = (i: number) => {
    const removed = agent.agentProviders[i];
    onChange({
      ...agent,
      agentProviders: agent.agentProviders.filter((_, j) => j !== i),
      providerIds: agent.providerIds.filter((id) => id !== removed?.id),
    });
    if (showAgentProviderKey === removed?.id) setShowAgentProviderKey(null);
  };

  return (
    <div className="border-t border-primary/20 bg-muted/20 px-4 pt-4 pb-5 space-y-4">
      {/* Panel header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary">Editing: {agent.name || "Unnamed Agent"}</span>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={onClose}>
          <X className="h-3.5 w-3.5" /> Collapse
        </Button>
      </div>

      {/* Name + Description */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Agent Name</Label>
          <Input className="h-8 text-sm" placeholder="e.g. Data Analyst"
            value={agent.name} onChange={(e) => onChange({ ...agent, name: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Short Description (shown in chat)</Label>
          <Input className="h-8 text-xs" placeholder="e.g. General data analysis and insights"
            value={agent.description} onChange={(e) => onChange({ ...agent, description: e.target.value })} />
        </div>
      </div>

      {/* System Prompt */}
      <div className="space-y-1.5">
        <Label className="text-xs">System Prompt</Label>
        <Textarea className="text-xs font-mono" rows={5} value={agent.systemPrompt}
          onChange={(e) => onChange({ ...agent, systemPrompt: e.target.value })} />
        <p className="text-[10px] text-muted-foreground">
          Defines the agent's persona and expertise. The result dataset JSON and output instructions are appended automatically.
        </p>
      </div>

      {/* Output Format */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Output Format</Label>
          <span className="text-[10px] text-muted-foreground">Controls how the chat renders the response</span>
        </div>

        {/* Type pills */}
        <div className="flex flex-wrap gap-2">
          {OUTPUT_OPTIONS.map((opt) => (
            <button key={opt.value} type="button"
              onClick={() => onChange({
                ...agent,
                expectedOutput: opt.value,
                outputInstructions: agent.outputInstructions || opt.defaultInstructions,
              })}
              className={`inline-flex flex-col items-start px-3 py-2 rounded-lg border text-xs transition-all ${
                agent.expectedOutput === opt.value
                  ? `${opt.color} border-current ring-1 ring-current/30 font-medium`
                  : "bg-background border-border text-muted-foreground hover:border-primary"
              }`}>
              <span className="font-semibold">{opt.label}</span>
              <span className="text-[10px] opacity-75 leading-tight mt-0.5">{opt.description}</span>
            </button>
          ))}
        </div>

        {/* Instructions textarea */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Output Instructions</Label>
            <button type="button"
              className="text-[10px] text-primary hover:underline"
              onClick={() => {
                const preset = OUTPUT_OPTIONS.find((o) => o.value === agent.expectedOutput);
                if (preset) onChange({ ...agent, outputInstructions: preset.defaultInstructions });
              }}>
              Reset to preset
            </button>
          </div>
          <Textarea
            className="text-xs font-mono min-h-[100px]"
            rows={6}
            placeholder="Describe exactly what format the LLM should return…"
            value={agent.outputInstructions}
            onChange={(e) => onChange({ ...agent, outputInstructions: e.target.value })}
          />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            This is injected into the system prompt as <code className="bg-muted px-1 rounded">## Output Format</code>.
            You can reference MCP tool names here (e.g. <em>"call the generate_report tool with the findings"</em>).
          </p>
        </div>

        {/* Compiled system prompt preview */}
        {agent.outputInstructions && (
          <details className="text-[10px]">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
              Preview compiled system prompt →
            </summary>
            <pre className="mt-2 bg-muted/60 rounded-md p-3 font-mono text-[10px] whitespace-pre-wrap overflow-x-auto text-muted-foreground max-h-48 overflow-y-auto">
              {[
                agent.systemPrompt || "(system prompt)",
                "",
                "---",
                "Result dataset (JSON):",
                "{ … }",
                "",
                "## Output Format",
                agent.outputInstructions,
                ...(agent.mcpServerIds.length > 0 || agent.agentProviders.length > 0
                  ? ["", "## Available Tools", agent.mcpServerIds.map((sid) => {
                      const filter = agent.mcpToolFilter[sid];
                      return filter?.length ? filter.map((t) => `- ${t}`).join("\n") : `- (all tools from server ${sid})`;
                    }).join("\n")]
                  : []),
              ].join("\n")}
            </pre>
          </details>
        )}
      </div>

      {/* Document Context */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Document Context</Label>
          <span className="text-[10px] text-muted-foreground">How uploaded documents are included alongside the result data</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { value: "auto", label: "Auto", desc: "Full doc if small (< 30K chars), chunks if large" },
              { value: "chunks", label: "Chunks (RAG)", desc: "Always retrieve top-N semantically similar passages" },
              { value: "none", label: "Disabled", desc: "No document context — result data only" },
            ] as Array<{ value: LlmAgent["ragMode"]; label: string; desc: string }>
          ).map((opt) => (
            <button key={opt.value} type="button"
              onClick={() => onChange({ ...agent, ragMode: opt.value })}
              className={`inline-flex flex-col items-start px-3 py-2 rounded-lg border text-xs transition-all ${
                (agent.ragMode ?? "auto") === opt.value
                  ? "bg-primary/10 text-primary border-primary/40 ring-1 ring-primary/20 font-medium"
                  : "bg-background border-border text-muted-foreground hover:border-primary"
              }`}>
              <span className="font-semibold">{opt.label}</span>
              <span className="text-[10px] opacity-75 leading-tight mt-0.5">{opt.desc}</span>
            </button>
          ))}
        </div>
        {(agent.ragMode ?? "auto") === "chunks" && (
          <div className="flex items-center gap-3">
            <Label className="text-xs text-muted-foreground shrink-0">Max chunks per query</Label>
            <Input
              type="number" min={1} max={100} className="h-7 w-20 text-xs"
              value={agent.ragTopK ?? 20}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v > 0) onChange({ ...agent, ragTopK: v });
              }}
            />
            <span className="text-[10px] text-muted-foreground">20 covers ~5 job profiles</span>
          </div>
        )}
      </div>

      {/* LLM Providers */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">LLM Providers</Label>
          <span className="text-[10px] text-muted-foreground">
            {agent.agentProviders.length === 0 && agent.providerIds.length === 0
              ? "Using global providers"
              : `${agent.agentProviders.length + agent.providerIds.length} selected`}
          </span>
        </div>

        {/* Agent-specific providers */}
        {agent.agentProviders.length > 0 && (
          <div className="space-y-2">
            {agent.agentProviders.map((p, i) => (
              <div key={p.id} className="border border-border/60 rounded-md px-3 py-2.5 space-y-2 bg-background">
                <div className="flex items-center gap-2">
                  <Zap className="h-3 w-3 text-primary shrink-0" />
                  <Input className="h-7 text-xs font-medium flex-1" placeholder="Provider name"
                    value={p.name} onChange={(e) => updateAgentProvider(i, { ...p, name: e.target.value })} />
                  <Switch className="scale-75" checked={p.enabled} onCheckedChange={(v) => updateAgentProvider(i, { ...p, enabled: v })} />
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                    onClick={() => removeAgentProvider(i)}><Trash2 className="h-3 w-3" /></Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-0.5">
                    <Label className="text-[10px]">Base URL</Label>
                    <Input className="h-7 text-[11px]" placeholder="https://api.openai.com/v1"
                      value={p.apiBaseUrl} onChange={(e) => updateAgentProvider(i, { ...p, apiBaseUrl: e.target.value })} />
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[10px]">Model</Label>
                    <Input className="h-7 text-[11px]" placeholder="gpt-4o-mini"
                      value={p.model} onChange={(e) => updateAgentProvider(i, { ...p, model: e.target.value })} />
                  </div>
                  <div className="space-y-0.5 col-span-2">
                    <Label className="text-[10px]">API Key</Label>
                    <div className="relative">
                      <Input className="h-7 text-[11px] pr-8"
                        type={showAgentProviderKey === p.id ? "text" : "password"}
                        placeholder="sk-..."
                        value={p.apiKey} onChange={(e) => updateAgentProvider(i, { ...p, apiKey: e.target.value })} />
                      <button type="button"
                        className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                        onClick={() => setShowAgentProviderKey(showAgentProviderKey === p.id ? null : p.id)}>
                        {showAgentProviderKey === p.id ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Select from global providers */}
        {globalProviders.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {globalProviders.map((p) => (
              <button key={p.id} type="button" onClick={() => toggleProvider(p.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  agent.providerIds.includes(p.id)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border text-muted-foreground hover:border-primary"
                }`}>
                <Zap className="h-3 w-3" />
                {p.name || p.model || "Provider"}
                {p.model && <span className="opacity-70 text-[10px]">{p.model}</span>}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs h-7"
            onClick={() => {
              const newP = emptyProvider();
              onChange({ ...agent, agentProviders: [...agent.agentProviders, newP] });
            }}>
            <Plus className="h-3 w-3" /> Add provider for this agent
          </Button>
        </div>

        <div className="bg-muted/40 rounded-md px-3 py-2 text-[11px] text-muted-foreground">
          {agent.agentProviders.length === 0 && agent.providerIds.length === 0 ? (
            <>
              <span className="font-medium text-foreground">Using global provider list</span>
              <span className="ml-1">— select providers above to restrict, or add an agent-specific one.</span>
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">Provider order: </span>
              {agent.agentProviders.length > 0 && <span>agent-specific first</span>}
              {agent.agentProviders.length > 0 && agent.providerIds.length > 0 && <span>, then </span>}
              {agent.providerIds.length > 0 && <span>{agent.providerIds.length} selected global provider(s)</span>}
              {agent.providerIds.length === 0 && agent.agentProviders.length > 0 && <span>, no global fallback</span>}
            </>
          )}
        </div>
      </div>

      {/* MCP Servers + Tool Filter */}
      {mcpServers.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs">MCP Tool Servers</Label>
            <span className="text-[10px] text-muted-foreground">
              {agent.mcpServerIds.length === 0 ? "Using all servers (all tools)" : `${agent.mcpServerIds.length} server(s) selected`}
            </span>
          </div>

          {/* Server chips */}
          <div className="flex flex-wrap gap-2">
            {mcpServers.map((s) => {
              const selected = agent.mcpServerIds.includes(s.id);
              const filterCount = (agent.mcpToolFilter[s.id] ?? []).length;
              return (
                <button key={s.id} type="button" onClick={() => toggleMcp(s.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    selected
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border text-muted-foreground hover:border-primary"
                  }`}>
                  <Server className="h-3 w-3" />
                  {s.name || s.url}
                  {selected && filterCount > 0 && (
                    <span className="bg-primary-foreground/20 text-primary-foreground text-[9px] rounded-full px-1.5 py-0.5 font-medium">
                      {filterCount} tool{filterCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Per-server tool filter — shown for each selected server */}
          {agent.mcpServerIds.length > 0 && (
            <div className="space-y-2">
              {agent.mcpServerIds.map((sid) => {
                const server = mcpServers.find((s) => s.id === sid);
                if (!server) return null;
                const state = serverTools[sid];
                const selectedTools = agent.mcpToolFilter[sid] ?? [];
                const discovered = state?.tools ?? [];

                return (
                  <div key={sid} className="border border-border/60 rounded-md overflow-hidden">
                    {/* Server header */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border/60">
                      <Server className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-xs font-medium flex-1 truncate">{server.name || server.url}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {selectedTools.length === 0
                          ? "all tools"
                          : `${selectedTools.length} of ${discovered.length || "?"} tool${selectedTools.length !== 1 ? "s" : ""}`}
                      </span>
                      {selectedTools.length > 0 && (
                        <button type="button" onClick={() => clearToolFilter(sid)}
                          className="text-[10px] text-muted-foreground hover:text-foreground shrink-0">
                          clear
                        </button>
                      )}
                      <Button type="button" variant="ghost" size="sm"
                        className="h-6 gap-1 text-[11px] shrink-0 px-2"
                        disabled={state?.loading}
                        onClick={() => loadServerTools(server)}>
                        {state?.loading
                          ? <><Loader2 className="h-2.5 w-2.5 animate-spin" />Loading…</>
                          : <><FlaskConical className="h-2.5 w-2.5" />{discovered.length > 0 ? "Reload" : "Load tools"}</>}
                      </Button>
                    </div>

                    {/* Tool list */}
                    {state?.error && (
                      <div className="px-3 py-2 text-[11px] text-destructive flex items-start gap-1.5">
                        <XCircle className="h-3 w-3 shrink-0 mt-0.5" />{state.error}
                      </div>
                    )}

                    {!state && (
                      <div className="px-3 py-2.5 text-[11px] text-muted-foreground text-center">
                        Click "Load tools" to discover available tools from this server.
                      </div>
                    )}

                    {discovered.length > 0 && (
                      <div className="px-3 py-2 space-y-1.5 max-h-48 overflow-y-auto">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
                            {discovered.length} tool{discovered.length !== 1 ? "s" : ""} available
                          </span>
                          <button type="button" onClick={() => {
                            if (selectedTools.length === discovered.length) {
                              clearToolFilter(sid);
                            } else {
                              onChange({ ...agent, mcpToolFilter: { ...agent.mcpToolFilter, [sid]: discovered.map((t) => t.name) } });
                            }
                          }} className="text-[10px] text-primary hover:underline">
                            {selectedTools.length === discovered.length ? "Deselect all" : "Select all"}
                          </button>
                        </div>
                        {discovered.map((tool) => {
                          const checked = selectedTools.length === 0 || selectedTools.includes(tool.name);
                          const explicitlySelected = selectedTools.includes(tool.name);
                          return (
                            <label key={tool.name}
                              className={`flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                                explicitlySelected ? "bg-primary/8" : "hover:bg-muted/50"
                              } ${selectedTools.length > 0 && !explicitlySelected ? "opacity-50" : ""}`}>
                              <input type="checkbox"
                                className="mt-0.5 h-3 w-3 accent-primary shrink-0"
                                checked={selectedTools.length === 0 ? true : explicitlySelected}
                                onChange={() => toggleTool(sid, tool.name)}
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-mono font-medium leading-tight truncate">{tool.name}</p>
                                {tool.description && (
                                  <p className="text-[10px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">{tool.description}</p>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {/* Status footer */}
                    {discovered.length > 0 && (
                      <div className="px-3 py-1.5 bg-muted/20 border-t border-border/60 text-[10px] text-muted-foreground">
                        {selectedTools.length === 0
                          ? "All tools passed to LLM. Select specific tools above to restrict."
                          : `LLM can only call: ${selectedTools.join(", ")}`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {agent.mcpServerIds.length === 0 && (
            <div className="bg-muted/40 rounded-md px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">All servers active</span>
              <span className="ml-1">— the LLM sees every tool from every enabled server. Select servers above to restrict.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-muted/30 border border-dashed border-border rounded-md px-3 py-2.5 text-[11px] text-muted-foreground flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <span>No MCP servers configured yet. Add servers in the <strong>MCP Servers</strong> section above, then return here to assign them to this agent.</span>
        </div>
      )}

      {/* Default Prompts */}
      <div className="space-y-2">
        <Label className="text-xs">Default Prompts (shown in chat quick-pick)</Label>
        {agent.defaultPrompts.length === 0 && (
          <p className="text-xs text-muted-foreground border border-dashed rounded-md p-3 text-center">
            No prompts yet. Add one below.
          </p>
        )}
        {agent.defaultPrompts.map((p, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className="flex flex-col gap-0 shrink-0">
              <Button type="button" variant="ghost" size="icon" className="h-5 w-6 rounded-none"
                disabled={i === 0}
                onClick={() => onChange({ ...agent, defaultPrompts: moveItem(agent.defaultPrompts, i, i - 1) })}>
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-5 w-6 rounded-none"
                disabled={i === agent.defaultPrompts.length - 1}
                onClick={() => onChange({ ...agent, defaultPrompts: moveItem(agent.defaultPrompts, i, i + 1) })}>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </div>
            {i === 0
              ? <span className="text-[9px] text-primary font-medium shrink-0 w-8 text-center leading-none">top</span>
              : <span className="w-8 shrink-0" />}
            <Input className="h-8 text-xs flex-1" value={p} placeholder="Enter a quick prompt…"
              onChange={(e) => updatePrompt(i, e.target.value)} />
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
              onClick={() => removePrompt(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs"
          onClick={() => onChange({ ...agent, defaultPrompts: [...agent.defaultPrompts, ""] })}>
          <MessageSquarePlus className="h-3.5 w-3.5" /> Add Prompt
        </Button>
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const LlmSettingsSection = () => {
  const { user } = useAuth();
  const [configId, setConfigId] = useState<string | undefined>(undefined);
  const [llm, setLlm] = useState<LlmInsightsConfig>(DEFAULT_CONFIG);
  const [featuresRest, setFeaturesRest] = useState<Record<string, unknown>>({});
  const [globalSnapshot, setGlobalSnapshot] = useState<GlobalConfigSnapshot>(DEFAULT_GLOBAL_SNAPSHOT);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      if (!user?.organization?.id) return;
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("global_configs")
          .select("id, app_name, app_version, environment, logging, features")
          .eq("organization_id", user.organization.id)
          .maybeSingle();
        if (error && error.code !== "PGRST116") throw error;

        const rawFeatures = (data?.features as Record<string, unknown> | null) ?? {};
        const rawLlm = (rawFeatures.llmInsights as Record<string, unknown> | undefined) ?? {};
        const { llmInsights: _drop, ...rest } = rawFeatures;
        setFeaturesRest(rest);
        setLlm(migrateFromLegacy(rawLlm));
        setConfigId(data?.id);
        setGlobalSnapshot({
          app_name: String(data?.app_name || DEFAULT_GLOBAL_SNAPSHOT.app_name),
          app_version: String(data?.app_version || DEFAULT_GLOBAL_SNAPSHOT.app_version),
          environment: (data?.environment as GlobalConfigSnapshot["environment"]) || DEFAULT_GLOBAL_SNAPSHOT.environment,
          logging: { ...DEFAULT_GLOBAL_SNAPSHOT.logging, ...((data?.logging as Record<string, unknown> | null) ?? {}) } as GlobalConfigSnapshot["logging"],
        });
      } catch {
        toast.error("Failed to load LLM settings");
      } finally {
        setIsLoading(false);
      }
    };
    void fetchConfig();
  }, [user?.organization?.id]);

  const patchLlm = (patch: Partial<LlmInsightsConfig>) => setLlm((prev) => ({ ...prev, ...patch }));

  const updateProvider = (i: number, updated: LlmProvider) =>
    patchLlm({ providers: llm.providers.map((p, j) => (j === i ? updated : p)) });
  const removeProvider = (i: number) =>
    patchLlm({ providers: llm.providers.filter((_, j) => j !== i) });
  const moveProvider = (from: number, to: number) =>
    patchLlm({ providers: moveItem(llm.providers, from, to) });

  const updateMcp = (i: number, updated: McpServer) =>
    patchLlm({ mcpServers: llm.mcpServers.map((s, j) => (j === i ? updated : s)) });
  const removeMcp = (i: number) =>
    patchLlm({ mcpServers: llm.mcpServers.filter((_, j) => j !== i) });

  const updateAgent = (i: number, updated: LlmAgent) =>
    patchLlm({ agents: llm.agents.map((a, j) => (j === i ? updated : a)) });
  const removeAgent = (i: number) =>
    patchLlm({ agents: llm.agents.filter((_, j) => j !== i) });
  const moveAgent = (from: number, to: number) =>
    patchLlm({ agents: moveItem(llm.agents, from, to) });

  const updateGlobalPrompt = (i: number, val: string) =>
    patchLlm({ predefinedPrompts: llm.predefinedPrompts.map((p, j) => (j === i ? val : p)) });
  const removeGlobalPrompt = (i: number) =>
    patchLlm({ predefinedPrompts: llm.predefinedPrompts.filter((_, j) => j !== i) });
  const moveGlobalPrompt = (from: number, to: number) =>
    patchLlm({ predefinedPrompts: moveItem(llm.predefinedPrompts, from, to) });

  const handleSave = async () => {
    if (!user?.organization?.id) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from("global_configs").upsert({
        id: configId,
        organization_id: user.organization.id,
        ...globalSnapshot,
        features: { ...featuresRest, llmInsights: llm },
      });
      if (error) throw error;
      toast.success("LLM settings saved");
    } catch {
      toast.error("Failed to save LLM settings");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          LLM Result Insights
        </CardTitle>
        <CardDescription>
          Configure LLM providers, MCP servers, and agents. Each agent has its own system prompt, output type, MCP server assignments, and quick prompts available in the chat.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Enable toggle */}
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div>
            <p className="font-medium">Enable LLM Insights</p>
            <p className="text-sm text-muted-foreground">Show the AI chat button on the result page</p>
          </div>
          <Switch checked={llm.enabled} onCheckedChange={(v) => patchLlm({ enabled: v })} />
        </div>

        <Separator />

        {/* LLM Providers */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">LLM Providers</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Providers are tried in order — primary first, then fallbacks. Any OpenAI-compatible endpoint works.
          </p>
          <div className="space-y-3">
            {llm.providers.length === 0 && (
              <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">
                No providers configured. Add one below.
              </p>
            )}
            {llm.providers.map((provider, i) => (
              <ProviderCard key={provider.id} provider={provider} index={i} total={llm.providers.length}
                onChange={(updated) => updateProvider(i, updated)}
                onMove={moveProvider} onRemove={() => removeProvider(i)} />
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-2"
            onClick={() => patchLlm({ providers: [...llm.providers, emptyProvider()] })}>
            <Plus className="h-4 w-4" /> Add Provider
          </Button>
        </div>

        <Separator />

        {/* MCP Servers */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">MCP Servers</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Connect remote MCP servers to give agents additional tools. Each agent can be configured to use specific servers.
          </p>
          <McpGuide />
          <div className="space-y-3">
            {llm.mcpServers.length === 0 && (
              <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">
                No MCP servers configured. Add one below.
              </p>
            )}
            {llm.mcpServers.map((server, i) => (
              <McpCard key={server.id} server={server} index={i}
                supabaseClient={supabase}
                organizationId={user?.organization?.id}
                onChange={(updated) => updateMcp(i, updated)}
                onRemove={() => removeMcp(i)} />
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-2"
            onClick={() => patchLlm({ mcpServers: [...llm.mcpServers, emptyMcpServer()] })}>
            <Plus className="h-4 w-4" /> Add MCP Server
          </Button>
        </div>

        <Separator />

        {/* Agents */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">Agents</h3>
            </div>
            <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-xs"
              onClick={() => {
                patchLlm({ agents: DEFAULT_AGENTS });
                toast.success("Agents reset to defaults");
              }}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Each agent has its own system prompt, expected output type, MCP server assignments, and quick prompts.
            In the chat, users can type <code className="bg-muted px-1 rounded">/</code> to switch between enabled agents.
            The first enabled agent is the default.
          </p>

          {llm.agents.length === 0 ? (
            <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">
              No agents configured. Add one below or reset to defaults.
            </p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[28px_1fr_80px_60px_48px_52px_auto] gap-2 px-3 py-2 bg-muted/50 border-b border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                <span className="text-center">#</span>
                <span>Name</span>
                <span className="text-center">Output</span>
                <span className="text-center">Prompts</span>
                <span className="text-center">MCP</span>
                <span className="text-center">On</span>
                <span>Actions</span>
              </div>

              {/* Table rows + inline edit panels */}
              {llm.agents.map((agent, i) => (
                <div key={agent.id}>
                  <AgentTableRow
                    agent={agent} index={i} total={llm.agents.length}
                    isEditing={editingAgentId === agent.id}
                    mcpServers={llm.mcpServers}
                    onToggleEdit={() => setEditingAgentId(editingAgentId === agent.id ? null : agent.id)}
                    onChange={(updated) => updateAgent(i, updated)}
                    onMove={moveAgent} onRemove={() => { removeAgent(i); if (editingAgentId === agent.id) setEditingAgentId(null); }}
                  />
                  {editingAgentId === agent.id && (
                    <AgentEditPanel
                      agent={agent} mcpServers={llm.mcpServers} globalProviders={llm.providers}
                      supabaseClient={supabase} organizationId={user?.organization?.id}
                      onChange={(updated) => updateAgent(i, updated)}
                      onClose={() => setEditingAgentId(null)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          <Button type="button" variant="outline" size="sm" className="gap-2"
            onClick={() => patchLlm({ agents: [...llm.agents, emptyAgent()] })}>
            <Plus className="h-4 w-4" /> Add Agent
          </Button>
        </div>

        <Separator />

        {/* General Prompts — not tied to any agent */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">General Prompts</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            These prompts appear in the chat quick-pick alongside agent prompts but are not tied to any specific agent.
            The current active agent will handle them.
          </p>

          {llm.predefinedPrompts.length === 0 && (
            <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">
              No general prompts. Add one below.
            </p>
          )}
          <div className="space-y-2">
            {llm.predefinedPrompts.map((p, i) => (
              <div key={i} className="flex items-center gap-1">
                <div className="flex flex-col gap-0 shrink-0">
                  <Button type="button" variant="ghost" size="icon" className="h-5 w-6 rounded-none"
                    disabled={i === 0} onClick={() => moveGlobalPrompt(i, i - 1)}>
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-5 w-6 rounded-none"
                    disabled={i === llm.predefinedPrompts.length - 1} onClick={() => moveGlobalPrompt(i, i + 1)}>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </div>
                <Input className="h-8 text-xs flex-1" value={p} placeholder="Enter a general prompt…"
                  onChange={(e) => updateGlobalPrompt(i, e.target.value)} />
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => removeGlobalPrompt(i)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-2"
            onClick={() => patchLlm({ predefinedPrompts: [...llm.predefinedPrompts, ""] })}>
            <Plus className="h-4 w-4" /> Add General Prompt
          </Button>
        </div>

        <Separator />

        <p className="text-xs text-muted-foreground">
          LLM settings are stored in the organization global config and included in Admin Export/Import.
        </p>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving} className="gap-2">
            {isSaving ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Saving...</>
            ) : (
              <><Save className="h-4 w-4" />Save LLM Settings</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default LlmSettingsSection;
