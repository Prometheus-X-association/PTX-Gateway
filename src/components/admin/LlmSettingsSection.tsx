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
  expectedOutput: "text" | "echarts" | "table" | "mixed";
  mcpServerIds: string[];
  defaultPrompts: string[];
  enabled: boolean;
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

const DEFAULT_AGENTS: LlmAgent[] = [
  {
    id: "data-analyst",
    name: "Data Analyst",
    description: "General data analysis, insights, and trend identification",
    systemPrompt: DATA_ANALYST_PROMPT,
    expectedOutput: "text",
    mcpServerIds: [],
    defaultPrompts: [
      "Summarize the key findings in 3 bullet points",
      "Which item has the highest value and why might that be?",
      "Are there any outliers or anomalies in this data?",
      "What trends do you see?",
    ],
    enabled: true,
  },
  {
    id: "chart-builder",
    name: "Chart Builder",
    description: "Creates interactive ECharts visualizations from data",
    systemPrompt: CHART_BUILDER_PROMPT,
    expectedOutput: "echarts",
    mcpServerIds: [],
    defaultPrompts: [
      "Show me a bar chart of the top 10 results",
      "Create a pie chart of the data distribution",
      "Show a line chart of values over time",
      "Visualize the top 5 items as a horizontal bar chart",
    ],
    enabled: true,
  },
  {
    id: "ai-insight",
    name: "AI Insight",
    description: "Full analysis with written insights and a chart visualization",
    systemPrompt: AI_INSIGHT_PROMPT,
    expectedOutput: "mixed",
    mcpServerIds: [],
    defaultPrompts: [
      "Generate a complete AI insight with visualization for this data",
      "Give me a business summary with a supporting chart",
      "Analyze this data and show me the most important visualization",
    ],
    enabled: true,
  },
  {
    id: "switchable-chart",
    name: "Switchable Chart",
    description: "Returns structured JSON with summary, insights, and a chart spec the user can switch between types",
    systemPrompt: SWITCHABLE_CHART_PROMPT,
    expectedOutput: "mixed",
    mcpServerIds: [],
    defaultPrompts: [
      "Analyze this data and generate an interactive chart I can switch between types",
      "Generate a summary with insights and a switchable visualization",
      "What is the best chart type for this data? Show me the result",
    ],
    enabled: true,
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
  expectedOutput: "text", mcpServerIds: [], defaultPrompts: [], enabled: true,
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
      expectedOutput: (["text", "echarts", "table", "mixed"].includes(String(a.expectedOutput))
        ? a.expectedOutput : "text") as LlmAgent["expectedOutput"],
      mcpServerIds: Array.isArray(a.mcpServerIds) ? (a.mcpServerIds as unknown[]).map(String) : [],
      defaultPrompts: Array.isArray(a.defaultPrompts) ? (a.defaultPrompts as unknown[]).map(String).filter(Boolean) : [],
      enabled: a.enabled !== false,
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

const OUTPUT_OPTIONS: Array<{ value: LlmAgent["expectedOutput"]; label: string; description: string }> = [
  { value: "text", label: "Text", description: "Plain markdown / structured text response" },
  { value: "echarts", label: "ECharts", description: "HTML block with an ECharts visualization" },
  { value: "table", label: "Table", description: "Tabular data response" },
  { value: "mixed", label: "Mixed", description: "Text analysis + ECharts chart at the end" },
];

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

interface McpCardProps {
  server: McpServer; index: number;
  onChange: (updated: McpServer) => void;
  onRemove: () => void;
}

const McpCard = ({ server, onChange, onRemove }: McpCardProps) => {
  const [showKey, setShowKey] = useState(false);
  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card">
      <div className="flex items-center gap-2">
        <Input className="h-8 text-sm font-medium" placeholder="Server name (e.g. Analytics MCP)"
          value={server.name} onChange={(e) => onChange({ ...server, name: e.target.value })} />
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <Switch checked={server.enabled} onCheckedChange={(v) => onChange({ ...server, enabled: v })} />
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">SSE URL</Label>
          <Input className="h-8 text-xs" placeholder="https://your-mcp-server.com/sse"
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
    </div>
  );
};

interface AgentCardProps {
  agent: LlmAgent;
  index: number;
  total: number;
  mcpServers: McpServer[];
  onChange: (updated: LlmAgent) => void;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}

const AgentCard = ({ agent, index, total, mcpServers, onChange, onMove, onRemove }: AgentCardProps) => {
  const [expanded, setExpanded] = useState(index === 0);

  const updatePrompt = (i: number, val: string) =>
    onChange({ ...agent, defaultPrompts: agent.defaultPrompts.map((p, j) => (j === i ? val : p)) });
  const removePrompt = (i: number) =>
    onChange({ ...agent, defaultPrompts: agent.defaultPrompts.filter((_, j) => j !== i) });

  const toggleMcp = (serverId: string) => {
    const ids = agent.mcpServerIds.includes(serverId)
      ? agent.mcpServerIds.filter((id) => id !== serverId)
      : [...agent.mcpServerIds, serverId];
    onChange({ ...agent, mcpServerIds: ids });
  };

  const outputOption = OUTPUT_OPTIONS.find((o) => o.value === agent.expectedOutput);

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      {/* Agent header row */}
      <div className="flex items-center gap-2 px-4 py-3">
        <button type="button" className="flex items-center gap-2 flex-1 min-w-0 text-left"
          onClick={() => setExpanded((v) => !v)}>
          <Bot className="h-4 w-4 text-primary shrink-0" />
          <span className="font-medium text-sm truncate">{agent.name || "Unnamed Agent"}</span>
          {outputOption && (
            <Badge variant="outline" className="text-[10px] shrink-0">{outputOption.label}</Badge>
          )}
          {agent.defaultPrompts.length > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">{agent.defaultPrompts.length} prompts</span>
          )}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={index === 0}
            onClick={() => onMove(index, index - 1)}><ChevronUp className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={index === total - 1}
            onClick={() => onMove(index, index + 1)}><ChevronDown className="h-4 w-4" /></Button>
          <Switch checked={agent.enabled} onCheckedChange={(v) => onChange({ ...agent, enabled: v })} />
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border/60 pt-4">
          {/* Name + Description */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Agent Name</Label>
              <Input className="h-8 text-sm" placeholder="e.g. Data Analyst"
                value={agent.name} onChange={(e) => onChange({ ...agent, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Expected Output</Label>
              <Select value={agent.expectedOutput}
                onValueChange={(v) => onChange({ ...agent, expectedOutput: v as LlmAgent["expectedOutput"] })}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTPUT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="font-medium">{o.label}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{o.description}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
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
              The result dataset JSON is automatically appended to the system context.
            </p>
          </div>

          {/* MCP Servers */}
          {mcpServers.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">MCP Tools (leave all unchecked to use all)</Label>
              <div className="flex flex-wrap gap-2">
                {mcpServers.map((s) => (
                  <button key={s.id} type="button"
                    onClick={() => toggleMcp(s.id)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      agent.mcpServerIds.includes(s.id)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border text-muted-foreground hover:border-primary"
                    }`}>
                    <Server className="h-3 w-3" />
                    {s.name || s.url}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {agent.mcpServerIds.length === 0
                  ? "No restriction — agent will use all available MCP servers."
                  : `Agent will only use the ${agent.mcpServerIds.length} selected server(s).`}
              </p>
            </div>
          )}

          {/* Default Prompts */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs">Default Prompts (shown in chat quick-pick)</Label>
            </div>
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
                {i === 0 && (
                  <span className="text-[9px] text-primary font-medium shrink-0 w-8 text-center leading-none">top</span>
                )}
                {i > 0 && <span className="w-8 shrink-0" />}
                <Input className="h-8 text-xs flex-1" value={p} placeholder="Enter a quick prompt…"
                  onChange={(e) => updatePrompt(i, e.target.value)} />
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => removePrompt(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs"
              onClick={() => onChange({ ...agent, defaultPrompts: [...agent.defaultPrompts, ""] })}>
              <MessageSquarePlus className="h-3.5 w-3.5" />
              Add Prompt
            </Button>
          </div>
        </div>
      )}
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
          <div className="space-y-3">
            {llm.mcpServers.length === 0 && (
              <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">
                No MCP servers configured. Add one below.
              </p>
            )}
            {llm.mcpServers.map((server, i) => (
              <McpCard key={server.id} server={server} index={i}
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

          {llm.agents.length === 0 && (
            <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">
              No agents configured. Add one below or reset to defaults.
            </p>
          )}
          <div className="space-y-3">
            {llm.agents.map((agent, i) => (
              <AgentCard
                key={agent.id} agent={agent} index={i} total={llm.agents.length}
                mcpServers={llm.mcpServers}
                onChange={(updated) => updateAgent(i, updated)}
                onMove={moveAgent} onRemove={() => removeAgent(i)}
              />
            ))}
          </div>

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
