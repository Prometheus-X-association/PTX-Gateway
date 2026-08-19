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
  Loader2, Brain, Save, Plus, Trash2, ChevronUp, ChevronDown,
  Eye, EyeOff, Server, MessageSquare, Zap, RotateCcw,
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

interface LlmInsightsConfig {
  enabled: boolean;
  providers: LlmProvider[];
  insightSystemPrompt: string;
  chatSystemPrompt: string;
  mcpServers: McpServer[];
  predefinedPrompts: string[];
}

interface GlobalConfigSnapshot {
  app_name: string;
  app_version: string;
  environment: "development" | "staging" | "production";
  logging: { enabled: boolean; level: "debug" | "info" | "warn" | "error" };
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_INSIGHT_PROMPT =
  "Analyze the JSON data and return JSON only. Required keys: summary (string), insights (string[]), visualization (object). Choose the best type from: 'bar'|'line'|'area'|'scatter'|'pie'|'radial'|'treemap'|'network'|'map'. Provide matching structure: data[] for cartesian/pie/radial, nodes[]+links[] for network, hierarchy for treemap, and data[] with lat/lng for map. Keep labels concise and aggregate long-tail items as 'Other'. User can switch to another compatible chart type in UI.";

const DEFAULT_CHAT_PROMPT =
  "You are a data analyst assistant. The user is viewing a result dataset provided below in JSON. Answer questions clearly and concisely. When asked for a chart or visualization, return a self-contained HTML snippet using Apache ECharts loaded from CDN (https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js). Wrap the snippet in a single <div> with inline styles and a <script> block.";

const DEFAULT_PREDEFINED_PROMPTS = [
  "Summarize the key findings in 3 bullet points",
  "Which item has the highest value and why might that be?",
  "Show me a bar chart of the top 10 results",
  "Are there any outliers or anomalies in this data?",
  "What trends do you see?",
  "Group these results by category and visualize it",
];

const DEFAULT_CONFIG: LlmInsightsConfig = {
  enabled: false,
  providers: [],
  insightSystemPrompt: DEFAULT_INSIGHT_PROMPT,
  chatSystemPrompt: DEFAULT_CHAT_PROMPT,
  mcpServers: [],
  predefinedPrompts: DEFAULT_PREDEFINED_PROMPTS,
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
  id: uid(),
  name: "",
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  enabled: true,
});

const emptyMcpServer = (): McpServer => ({
  id: uid(),
  name: "",
  url: "",
  apiKey: "",
  enabled: true,
});

// Migrate old flat-field format to new providers array on first load
const migrateFromLegacy = (raw: Record<string, unknown>): LlmInsightsConfig => {
  const hasProviders =
    Array.isArray(raw.providers) && (raw.providers as unknown[]).length > 0;

  const providers: LlmProvider[] = hasProviders
    ? (raw.providers as LlmProvider[]).map((p) => ({
        id: String(p.id || uid()),
        name: String(p.name || ""),
        apiBaseUrl: String(p.apiBaseUrl || "https://api.openai.com/v1"),
        apiKey: String(p.apiKey || ""),
        model: String(p.model || "gpt-4o-mini"),
        enabled: p.enabled !== false,
      }))
    : typeof raw.apiKey === "string" && raw.apiKey
    ? [
        {
          id: uid(),
          name: "Default",
          apiBaseUrl: String(raw.apiBaseUrl || "https://api.openai.com/v1"),
          apiKey: String(raw.apiKey),
          model: String(raw.model || "gpt-4o-mini"),
          enabled: true,
        },
      ]
    : [];

  const mcpServers: McpServer[] = Array.isArray(raw.mcpServers)
    ? (raw.mcpServers as McpServer[]).map((s) => ({
        id: String(s.id || uid()),
        name: String(s.name || ""),
        url: String(s.url || ""),
        apiKey: String(s.apiKey || ""),
        enabled: s.enabled !== false,
      }))
    : [];

  const predefinedPrompts: string[] = Array.isArray(raw.predefinedPrompts)
    ? (raw.predefinedPrompts as unknown[]).map(String).filter(Boolean)
    : DEFAULT_PREDEFINED_PROMPTS;

  // insightSystemPrompt: prefer new key, fall back to old promptTemplate
  const insightSystemPrompt =
    typeof raw.insightSystemPrompt === "string"
      ? raw.insightSystemPrompt
      : typeof raw.promptTemplate === "string"
      ? raw.promptTemplate
      : DEFAULT_INSIGHT_PROMPT;

  return {
    enabled: Boolean(raw.enabled ?? false),
    providers,
    insightSystemPrompt,
    chatSystemPrompt:
      typeof raw.chatSystemPrompt === "string"
        ? raw.chatSystemPrompt
        : DEFAULT_CHAT_PROMPT,
    mcpServers,
    predefinedPrompts,
  };
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ProviderCardProps {
  provider: LlmProvider;
  index: number;
  total: number;
  onChange: (updated: LlmProvider) => void;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}

const ProviderCard = ({ provider, index, total, onChange, onMove, onRemove }: ProviderCardProps) => {
  const [showKey, setShowKey] = useState(false);
  const label = index === 0 ? "Primary" : `Fallback ${index}`;
  const labelVariant = index === 0 ? "default" : "secondary";

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card">
      <div className="flex items-center gap-2">
        <Badge variant={labelVariant} className="shrink-0">{label}</Badge>
        <Input
          className="h-8 text-sm font-medium"
          placeholder="Provider name (e.g. OpenAI, Groq, Ollama)"
          value={provider.name}
          onChange={(e) => onChange({ ...provider, name: e.target.value })}
        />
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <Button
            type="button" variant="ghost" size="icon" className="h-7 w-7"
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            type="button" variant="ghost" size="icon" className="h-7 w-7"
            disabled={index === total - 1}
            onClick={() => onMove(index, index + 1)}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Switch
            checked={provider.enabled}
            onCheckedChange={(v) => onChange({ ...provider, enabled: v })}
          />
          <Button
            type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">API Base URL</Label>
          <Input
            className="h-8 text-xs"
            placeholder="https://api.openai.com/v1"
            value={provider.apiBaseUrl}
            onChange={(e) => onChange({ ...provider, apiBaseUrl: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Model</Label>
          <Input
            className="h-8 text-xs"
            placeholder="gpt-4o-mini"
            value={provider.model}
            onChange={(e) => onChange({ ...provider, model: e.target.value })}
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">API Key</Label>
          <div className="relative">
            <Input
              className="h-8 text-xs pr-9"
              type={showKey ? "text" : "password"}
              placeholder="sk-..."
              value={provider.apiKey}
              onChange={(e) => onChange({ ...provider, apiKey: e.target.value })}
            />
            <button
              type="button"
              className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface McpCardProps {
  server: McpServer;
  index: number;
  onChange: (updated: McpServer) => void;
  onRemove: () => void;
}

const McpCard = ({ server, onChange, onRemove }: McpCardProps) => {
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card">
      <div className="flex items-center gap-2">
        <Input
          className="h-8 text-sm font-medium"
          placeholder="Server name (e.g. Analytics MCP)"
          value={server.name}
          onChange={(e) => onChange({ ...server, name: e.target.value })}
        />
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <Switch
            checked={server.enabled}
            onCheckedChange={(v) => onChange({ ...server, enabled: v })}
          />
          <Button
            type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">SSE URL</Label>
          <Input
            className="h-8 text-xs"
            placeholder="https://your-mcp-server.com/sse"
            value={server.url}
            onChange={(e) => onChange({ ...server, url: e.target.value })}
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">API Key (optional)</Label>
          <div className="relative">
            <Input
              className="h-8 text-xs pr-9"
              type={showKey ? "text" : "password"}
              placeholder="Bearer token or API key"
              value={server.apiKey}
              onChange={(e) => onChange({ ...server, apiKey: e.target.value })}
            />
            <button
              type="button"
              className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
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
          environment:
            (data?.environment as GlobalConfigSnapshot["environment"]) ||
            DEFAULT_GLOBAL_SNAPSHOT.environment,
          logging: {
            ...DEFAULT_GLOBAL_SNAPSHOT.logging,
            ...((data?.logging as Record<string, unknown> | null) ?? {}),
          } as GlobalConfigSnapshot["logging"],
        });
      } catch {
        toast.error("Failed to load LLM settings");
      } finally {
        setIsLoading(false);
      }
    };

    void fetchConfig();
  }, [user?.organization?.id]);

  const patchLlm = (patch: Partial<LlmInsightsConfig>) =>
    setLlm((prev) => ({ ...prev, ...patch }));

  const updateProvider = (index: number, updated: LlmProvider) =>
    patchLlm({ providers: llm.providers.map((p, i) => (i === index ? updated : p)) });

  const removeProvider = (index: number) =>
    patchLlm({ providers: llm.providers.filter((_, i) => i !== index) });

  const moveProvider = (from: number, to: number) =>
    patchLlm({ providers: moveItem(llm.providers, from, to) });

  const updateMcp = (index: number, updated: McpServer) =>
    patchLlm({ mcpServers: llm.mcpServers.map((s, i) => (i === index ? updated : s)) });

  const removeMcp = (index: number) =>
    patchLlm({ mcpServers: llm.mcpServers.filter((_, i) => i !== index) });

  const updatePrompt = (index: number, value: string) =>
    patchLlm({
      predefinedPrompts: llm.predefinedPrompts.map((p, i) => (i === index ? value : p)),
    });

  const removePrompt = (index: number) =>
    patchLlm({ predefinedPrompts: llm.predefinedPrompts.filter((_, i) => i !== index) });

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
          Configure LLM providers (with automatic fallback), MCP servers, chat system prompts, and predefined user prompts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Enable toggle */}
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div>
            <p className="font-medium">Enable LLM Insights</p>
            <p className="text-sm text-muted-foreground">Allow the result page to call LLM and generate chart specs from JSON output</p>
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
            Providers are tried in order. If the primary fails, the next enabled provider is used automatically.
            Any OpenAI-compatible endpoint works (OpenAI, Groq, Ollama, Together AI, LM Studio, etc.).
          </p>

          <div className="space-y-3">
            {llm.providers.length === 0 && (
              <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">
                No providers configured. Add one below.
              </p>
            )}
            {llm.providers.map((provider, index) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                index={index}
                total={llm.providers.length}
                onChange={(updated) => updateProvider(index, updated)}
                onMove={moveProvider}
                onRemove={() => removeProvider(index)}
              />
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => patchLlm({ providers: [...llm.providers, emptyProvider()] })}
          >
            <Plus className="h-4 w-4" />
            Add Provider
          </Button>
        </div>

        <Separator />

        {/* Insight System Prompt */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Insight System Prompt</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Used for the automatic insight generation when a result loads. Must instruct the LLM to return valid JSON.
            Use <code className="text-xs bg-muted px-1 rounded">{"{{json}}"}</code> to inject the result at a specific location.
          </p>
          <Textarea
            value={llm.insightSystemPrompt}
            onChange={(e) => patchLlm({ insightSystemPrompt: e.target.value })}
            rows={6}
            className="text-xs font-mono"
          />
          <div className="flex justify-end">
            <Button
              type="button" variant="ghost" size="sm" className="gap-1 text-xs"
              onClick={() => { patchLlm({ insightSystemPrompt: DEFAULT_INSIGHT_PROMPT }); toast.success("Reset to default insight prompt"); }}
            >
              <RotateCcw className="h-3 w-3" />
              Reset to default
            </Button>
          </div>
        </div>

        <Separator />

        {/* Chat System Prompt */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Chat System Prompt</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Used for the interactive chat assistant on the result page. The result JSON is appended to the system context automatically.
          </p>
          <Textarea
            value={llm.chatSystemPrompt}
            onChange={(e) => patchLlm({ chatSystemPrompt: e.target.value })}
            rows={5}
            className="text-xs font-mono"
          />
          <div className="flex justify-end">
            <Button
              type="button" variant="ghost" size="sm" className="gap-1 text-xs"
              onClick={() => { patchLlm({ chatSystemPrompt: DEFAULT_CHAT_PROMPT }); toast.success("Reset to default chat prompt"); }}
            >
              <RotateCcw className="h-3 w-3" />
              Reset to default
            </Button>
          </div>
        </div>

        <Separator />

        {/* MCP Servers */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">MCP Servers</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Connect remote MCP servers (HTTP/SSE) to give the chat assistant additional tools — analytics, database queries, report generation, etc.
            The LLM will automatically discover and use available tools during chat.
          </p>

          <div className="space-y-3">
            {llm.mcpServers.length === 0 && (
              <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">
                No MCP servers configured. Add one below.
              </p>
            )}
            {llm.mcpServers.map((server, index) => (
              <McpCard
                key={server.id}
                server={server}
                index={index}
                onChange={(updated) => updateMcp(index, updated)}
                onRemove={() => removeMcp(index)}
              />
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => patchLlm({ mcpServers: [...llm.mcpServers, emptyMcpServer()] })}
          >
            <Plus className="h-4 w-4" />
            Add MCP Server
          </Button>
        </div>

        <Separator />

        {/* Predefined Prompts */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Predefined Prompts</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            These appear as quick-action chips in the chat drawer on the result page. Users can click one to send it immediately.
          </p>

          <div className="space-y-2">
            {llm.predefinedPrompts.map((prompt, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  className="h-8 text-sm"
                  value={prompt}
                  onChange={(e) => updatePrompt(index, e.target.value)}
                  placeholder="Enter a predefined prompt..."
                />
                <Button
                  type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => removePrompt(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => patchLlm({ predefinedPrompts: [...llm.predefinedPrompts, ""] })}
            >
              <Plus className="h-4 w-4" />
              Add Prompt
            </Button>
            {llm.predefinedPrompts.length === 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 text-xs"
                onClick={() => patchLlm({ predefinedPrompts: DEFAULT_PREDEFINED_PROMPTS })}
              >
                <RotateCcw className="h-3 w-3" />
                Restore defaults
              </Button>
            )}
          </div>
        </div>

        <Separator />

        <p className="text-xs text-muted-foreground">
          LLM settings are stored in the organization global config and included in Admin Export/Import.
        </p>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving} className="gap-2">
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save LLM Settings
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default LlmSettingsSection;
