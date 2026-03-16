import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Settings, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import PlaceholdersConfigSection from "./PlaceholdersConfigSection";

interface GlobalConfigState {
  id?: string;
  app_name: string;
  app_version: string;
  environment: 'development' | 'staging' | 'production';
  features: {
    enableFileUpload: boolean;
    enableApiConnections: boolean;
    enableTextInput: boolean;
    enableCustomApi: boolean;
    allowContinueOnPdcError: boolean;
    llmInsights: {
      enabled: boolean;
      provider: "openai" | "custom";
      apiBaseUrl: string;
      apiKey: string;
      model: string;
      promptTemplate: string;
    };
    maxFileSizeMB: number;
    maxFilesCount: number;
  };
  logging: {
    enabled: boolean;
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}

const DEFAULT_CONFIG: GlobalConfigState = {
  app_name: 'Data Analytics Platform',
  app_version: '1.0.0',
  environment: 'production',
  features: {
    enableFileUpload: true,
    enableApiConnections: true,
    enableTextInput: true,
    enableCustomApi: true,
    allowContinueOnPdcError: false,
    llmInsights: {
      enabled: false,
      provider: "openai",
      apiBaseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4o-mini",
      promptTemplate:
        "Analyze the JSON data and return JSON only. Required keys: summary (string), insights (string[]), visualization (object). Choose the best type from: 'bar'|'line'|'area'|'scatter'|'pie'|'radial'|'treemap'|'network'|'map'. Provide matching structure: data[] for cartesian/pie/radial, nodes[]+links[] for network, hierarchy for treemap, and data[] with lat/lng for map. Keep labels concise and aggregate long-tail items as 'Other'. User can switch to another compatible chart type in UI.",
    },
    maxFileSizeMB: 50,
    maxFilesCount: 10,
  },
  logging: {
    enabled: true,
    level: 'info',
  },
};

const GlobalConfigSection = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [config, setConfig] = useState<GlobalConfigState>(DEFAULT_CONFIG);

  const fetchConfig = async () => {
    if (!user?.organization?.id) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('global_configs')
        .select('*')
        .eq('organization_id', user.organization.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setConfig({
          id: data.id,
          app_name: data.app_name || DEFAULT_CONFIG.app_name,
          app_version: data.app_version || DEFAULT_CONFIG.app_version,
          environment: (data.environment as GlobalConfigState['environment']) || DEFAULT_CONFIG.environment,
          features: {
            ...DEFAULT_CONFIG.features,
            ...(data.features as GlobalConfigState['features'] || {}),
          },
          logging: {
            ...DEFAULT_CONFIG.logging,
            ...(data.logging as GlobalConfigState['logging'] || {}),
          },
        });
      }
    } catch (err) {
      toast.error("Failed to load global configuration");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, [user?.organization?.id]);

  const handleSave = async () => {
    if (!user?.organization?.id) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('global_configs')
        .upsert({
          id: config.id,
          organization_id: user.organization.id,
          app_name: config.app_name,
          app_version: config.app_version,
          environment: config.environment,
          features: config.features,
          logging: config.logging,
        });

      if (error) throw error;
      
      toast.success("Configuration saved");
      await fetchConfig();
    } catch (err) {
      toast.error("Failed to save configuration");
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Global Settings
          </CardTitle>
          <CardDescription>
            Configure application-wide settings and feature flags
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Application Info */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Application</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>App Name</Label>
                <Input
                  value={config.app_name}
                  onChange={(e) => setConfig({ ...config, app_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Version</Label>
                <Input
                  value={config.app_version}
                  onChange={(e) => setConfig({ ...config, app_version: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Environment</Label>
                <Select
                  value={config.environment}
                  onValueChange={(v) => setConfig({ ...config, environment: v as GlobalConfigState['environment'] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="development">Development</SelectItem>
                    <SelectItem value="staging">Staging</SelectItem>
                    <SelectItem value="production">Production</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Feature Flags */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Features</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <p className="font-medium">File Upload</p>
                  <p className="text-sm text-muted-foreground">Allow users to upload files</p>
                </div>
                <Switch
                  checked={config.features.enableFileUpload}
                  onCheckedChange={(v) => setConfig({
                    ...config,
                    features: { ...config.features, enableFileUpload: v }
                  })}
                />
              </div>
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <p className="font-medium">API Connections</p>
                  <p className="text-sm text-muted-foreground">Enable API data sources</p>
                </div>
                <Switch
                  checked={config.features.enableApiConnections}
                  onCheckedChange={(v) => setConfig({
                    ...config,
                    features: { ...config.features, enableApiConnections: v }
                  })}
                />
              </div>
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <p className="font-medium">Text Input</p>
                  <p className="text-sm text-muted-foreground">Allow manual text input</p>
                </div>
                <Switch
                  checked={config.features.enableTextInput}
                  onCheckedChange={(v) => setConfig({
                    ...config,
                    features: { ...config.features, enableTextInput: v }
                  })}
                />
              </div>
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <p className="font-medium">Custom API</p>
                  <p className="text-sm text-muted-foreground">Enable custom API URLs</p>
                </div>
                <Switch
                  checked={config.features.enableCustomApi}
                  onCheckedChange={(v) => setConfig({
                    ...config,
                    features: { ...config.features, enableCustomApi: v }
                  })}
                />
              </div>
              <div className="flex items-center justify-between p-4 border rounded-lg md:col-span-2">
                <div>
                  <p className="font-medium">Continue On PDC Error</p>
                  <p className="text-sm text-muted-foreground">Allow users to continue to Results with dummy data when PDC execution fails</p>
                </div>
                <Switch
                  checked={config.features.allowContinueOnPdcError}
                  onCheckedChange={(v) => setConfig({
                    ...config,
                    features: { ...config.features, allowContinueOnPdcError: v }
                  })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Max File Size (MB)</Label>
                <Input
                  type="number"
                  value={config.features.maxFileSizeMB}
                  onChange={(e) => setConfig({
                    ...config,
                    features: { ...config.features, maxFileSizeMB: parseInt(e.target.value) || 50 }
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Files Count</Label>
                <Input
                  type="number"
                  value={config.features.maxFilesCount}
                  onChange={(e) => setConfig({
                    ...config,
                    features: { ...config.features, maxFilesCount: parseInt(e.target.value) || 10 }
                  })}
                />
              </div>
            </div>
          </div>

          {/* Logging */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Logging</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <p className="font-medium">Enable Logging</p>
                  <p className="text-sm text-muted-foreground">Log application events</p>
                </div>
                <Switch
                  checked={config.logging.enabled}
                  onCheckedChange={(v) => setConfig({
                    ...config,
                    logging: { ...config.logging, enabled: v }
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label>Log Level</Label>
                <Select
                  value={config.logging.level}
                  onValueChange={(v) => setConfig({
                    ...config,
                    logging: { ...config.logging, level: v as GlobalConfigState['logging']['level'] }
                  })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="debug">Debug</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warn">Warning</SelectItem>
                    <SelectItem value="error">Error</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="pt-4">
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Configuration
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
      {/* Parameter Placeholders */}
      <PlaceholdersConfigSection />
    </div>
  );
};

export default GlobalConfigSection;
