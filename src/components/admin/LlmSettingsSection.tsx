import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Brain, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface LlmInsightsConfig {
  enabled: boolean;
  provider: "openai" | "custom";
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  promptTemplate: string;
}

interface FeaturesState {
  [key: string]: unknown;
  llmInsights: LlmInsightsConfig;
}

interface GlobalConfigSnapshot {
  app_name: string;
  app_version: string;
  environment: "development" | "staging" | "production";
  logging: {
    enabled: boolean;
    level: "debug" | "info" | "warn" | "error";
  };
}

const DEFAULT_LLM_CONFIG: LlmInsightsConfig = {
  enabled: false,
  provider: "openai",
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  promptTemplate:
    "Analyze the JSON data and return JSON only. Required keys: summary (string), insights (string[]), visualization (object). Choose the best type from: 'bar'|'line'|'area'|'scatter'|'pie'|'radial'|'treemap'|'network'|'map'. Provide matching structure: data[] for cartesian/pie/radial, nodes[]+links[] for network, hierarchy for treemap, and data[] with lat/lng for map. Keep labels concise and aggregate long-tail items as 'Other'. User can switch to another compatible chart type in UI.",
};

const DEFAULT_GLOBAL_SNAPSHOT: GlobalConfigSnapshot = {
  app_name: "Data Analytics Platform",
  app_version: "1.0.0",
  environment: "production",
  logging: {
    enabled: true,
    level: "info",
  },
};

const LlmSettingsSection = () => {
  const { user } = useAuth();
  const [configId, setConfigId] = useState<string | undefined>(undefined);
  const [featuresState, setFeaturesState] = useState<FeaturesState>({
    llmInsights: DEFAULT_LLM_CONFIG,
  });
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

        const llmInsights: LlmInsightsConfig = {
          ...DEFAULT_LLM_CONFIG,
          enabled: Boolean(rawLlm.enabled ?? DEFAULT_LLM_CONFIG.enabled),
          provider: rawLlm.provider === "custom" ? "custom" : "openai",
          apiBaseUrl: typeof rawLlm.apiBaseUrl === "string" ? rawLlm.apiBaseUrl : DEFAULT_LLM_CONFIG.apiBaseUrl,
          apiKey: typeof rawLlm.apiKey === "string" ? rawLlm.apiKey : DEFAULT_LLM_CONFIG.apiKey,
          model: typeof rawLlm.model === "string" ? rawLlm.model : DEFAULT_LLM_CONFIG.model,
          promptTemplate:
            typeof rawLlm.promptTemplate === "string" ? rawLlm.promptTemplate : DEFAULT_LLM_CONFIG.promptTemplate,
        };

        setConfigId(data?.id);
        setGlobalSnapshot({
          app_name: (data?.app_name as string) || DEFAULT_GLOBAL_SNAPSHOT.app_name,
          app_version: (data?.app_version as string) || DEFAULT_GLOBAL_SNAPSHOT.app_version,
          environment:
            (data?.environment as "development" | "staging" | "production") || DEFAULT_GLOBAL_SNAPSHOT.environment,
          logging: {
            ...DEFAULT_GLOBAL_SNAPSHOT.logging,
            ...(((data?.logging as Record<string, unknown> | null) || {}) as GlobalConfigSnapshot["logging"]),
          },
        });
        setFeaturesState({
          ...rawFeatures,
          llmInsights,
        });
      } catch {
        toast.error("Failed to load LLM settings");
      } finally {
        setIsLoading(false);
      }
    };

    void fetchConfig();
  }, [user?.organization?.id]);

  const llm = featuresState.llmInsights;

  const setLlm = (next: Partial<LlmInsightsConfig>) => {
    setFeaturesState((prev) => ({
      ...prev,
      llmInsights: { ...prev.llmInsights, ...next },
    }));
  };

  const handleResetPrompt = () => {
    setLlm({ promptTemplate: DEFAULT_LLM_CONFIG.promptTemplate });
    toast.success("Prompt reset to default template");
  };

  const handleSave = async () => {
    if (!user?.organization?.id) return;

    setIsSaving(true);
    try {
      const { error } = await supabase.from("global_configs").upsert({
        id: configId,
        organization_id: user.organization.id,
        app_name: globalSnapshot.app_name,
        app_version: globalSnapshot.app_version,
        environment: globalSnapshot.environment,
        logging: globalSnapshot.logging,
        features: featuresState,
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
          Configure organization LLM credentials, model, and prompt used to generate insights + D3 visualization on the result page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div>
            <p className="font-medium">Enable LLM Insights</p>
            <p className="text-sm text-muted-foreground">Allow result page to call LLM and generate chart specs from JSON output</p>
          </div>
          <Switch checked={llm.enabled} onCheckedChange={(v) => setLlm({ enabled: v })} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select value={llm.provider} onValueChange={(v) => setLlm({ provider: v as "openai" | "custom" })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI (Default API)</SelectItem>
                <SelectItem value="custom">Custom OpenAI-Compatible</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Model</Label>
            <Input value={llm.model} onChange={(e) => setLlm({ model: e.target.value })} placeholder="gpt-4o-mini" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>API Base URL</Label>
            <Input
              value={llm.apiBaseUrl}
              onChange={(e) => setLlm({ apiBaseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>API Key</Label>
            <Input
              type="password"
              value={llm.apiKey}
              onChange={(e) => setLlm({ apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Prompt Template</Label>
            <Textarea
              value={llm.promptTemplate}
              onChange={(e) => setLlm({ promptTemplate: e.target.value })}
              rows={7}
            />
            <div className="flex justify-end">
              <Button type="button" variant="secondary" size="sm" onClick={handleResetPrompt}>
                Reset To Default Prompt
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Optional token: use <code>{"{{json}}"}</code> to inject the raw result JSON at a specific location in your prompt.
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          LLM settings are stored in organization global config and are included in Admin Export/Import Settings.
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
