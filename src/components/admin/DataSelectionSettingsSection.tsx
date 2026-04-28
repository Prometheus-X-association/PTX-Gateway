import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plug, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DataPagePluginConfig, DataSelectionSettings } from "@/types/dataspace";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const defaultSettings: DataSelectionSettings = {
  customApiDebugOnly: true,
  customApiTargetSoftwareIds: [],
  customApiTargetServiceChainIds: [],
  dataPagePlugins: [],
};

const DataSelectionSettingsSection = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);
  const [settings, setSettings] = useState<DataSelectionSettings>(defaultSettings);
  const [softwareOptions, setSoftwareOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [serviceChainOptions, setServiceChainOptions] = useState<Array<{ id: string; name: string }>>([]);

  const pluginSummary = useMemo(() => {
    const plugins = settings.dataPagePlugins || [];
    if (plugins.length === 0) return "No plugin configured";
    return `${plugins.length} plugin config(s)`;
  }, [settings.dataPagePlugins]);

  useEffect(() => {
    const fetchData = async () => {
      if (!user?.organization?.id) return;
      setIsLoading(true);
      try {
        const [{ data: globalData, error: globalError }, { data: softwareData, error: softwareError }, { data: chainData, error: chainError }] = await Promise.all([
          supabase
            .from("global_configs")
            .select("id, features")
            .eq("organization_id", user.organization.id)
            .maybeSingle(),
          supabase
            .from("dataspace_params")
            .select("id, resource_name, resource_url")
            .eq("organization_id", user.organization.id)
            .eq("resource_type", "software"),
          supabase
            .from("service_chains")
            .select("id, catalog_id, basis_information")
            .eq("organization_id", user.organization.id),
        ]);

        if (globalError) throw globalError;
        if (softwareError) throw softwareError;
        if (chainError) throw chainError;

        setConfigId(globalData?.id ?? null);

        const features = isRecord(globalData?.features) ? globalData.features : {};
        const dataSelection = isRecord(features.dataSelection) ? features.dataSelection : {};
        setSettings({
          customApiDebugOnly:
            typeof dataSelection.customApiDebugOnly === "boolean" ? dataSelection.customApiDebugOnly : true,
          customApiTargetSoftwareIds: Array.isArray(dataSelection.customApiTargetSoftwareIds)
            ? (dataSelection.customApiTargetSoftwareIds as string[])
            : [],
          customApiTargetServiceChainIds: Array.isArray(dataSelection.customApiTargetServiceChainIds)
            ? (dataSelection.customApiTargetServiceChainIds as string[])
            : [],
          dataPagePlugins: Array.isArray(dataSelection.dataPagePlugins)
            ? (dataSelection.dataPagePlugins as DataPagePluginConfig[])
            : [],
        });

        setSoftwareOptions(
          (softwareData || []).map((item) => ({
            id: item.id,
            name: item.resource_name || item.resource_url,
          }))
        );

        setServiceChainOptions(
          (chainData || []).map((item) => {
            const basis = isRecord(item.basis_information) ? item.basis_information : {};
            return {
              id: item.id,
              name: (typeof basis.name === "string" && basis.name) || item.catalog_id,
            };
          })
        );
      } catch (err) {
        toast.error("Failed to load data selection settings");
      } finally {
        setIsLoading(false);
      }
    };

    void fetchData();
  }, [user?.organization?.id]);

  const toggleTarget = (type: "software" | "serviceChain", id: string, checked: boolean) => {
    if (type === "software") {
      const current = new Set(settings.customApiTargetSoftwareIds || []);
      if (checked) current.add(id);
      else current.delete(id);
      setSettings((prev) => ({ ...prev, customApiTargetSoftwareIds: Array.from(current) }));
      return;
    }

    const current = new Set(settings.customApiTargetServiceChainIds || []);
    if (checked) current.add(id);
    else current.delete(id);
    setSettings((prev) => ({ ...prev, customApiTargetServiceChainIds: Array.from(current) }));
  };

  const saveSettings = async () => {
    if (!user?.organization?.id || !configId) return;
    setIsSaving(true);
    try {
      const { data: existing, error: fetchError } = await supabase
        .from("global_configs")
        .select("features")
        .eq("id", configId)
        .maybeSingle();
      if (fetchError) throw fetchError;

      const existingFeatures = isRecord(existing?.features) ? existing.features : {};
      const nextFeatures = {
        ...existingFeatures,
        dataSelection: {
          customApiDebugOnly: settings.customApiDebugOnly ?? true,
          customApiTargetSoftwareIds: settings.customApiTargetSoftwareIds || [],
          customApiTargetServiceChainIds: settings.customApiTargetServiceChainIds || [],
          dataPagePlugins: settings.dataPagePlugins || [],
        },
      };

      const { error } = await supabase
        .from("global_configs")
        .update({ features: nextFeatures })
        .eq("id", configId);
      if (error) throw error;
      toast.success("Data selection settings saved");
    } catch (err) {
      toast.error("Failed to save data selection settings");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">Loading...</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Custom API Visibility</CardTitle>
          <CardDescription>
            Default behavior is debug-only. You can additionally allow Custom API on specific analytics options.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <Label>Show Custom API only in debug mode by default</Label>
            <Switch
              checked={settings.customApiDebugOnly ?? true}
              onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, customApiDebugOnly: checked }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Show Custom API for selected software analytics</Label>
            <div className="space-y-2 rounded-md border p-3 max-h-48 overflow-y-auto">
              {softwareOptions.length === 0 && <p className="text-xs text-muted-foreground">No software resources.</p>}
              {softwareOptions.map((option) => (
                <label key={option.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={(settings.customApiTargetSoftwareIds || []).includes(option.id)}
                    onCheckedChange={(checked) => toggleTarget("software", option.id, checked === true)}
                  />
                  <span>{option.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Show Custom API for selected service chains</Label>
            <div className="space-y-2 rounded-md border p-3 max-h-48 overflow-y-auto">
              {serviceChainOptions.length === 0 && <p className="text-xs text-muted-foreground">No service chains.</p>}
              {serviceChainOptions.map((option) => (
                <label key={option.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={(settings.customApiTargetServiceChainIds || []).includes(option.id)}
                    onCheckedChange={(checked) => toggleTarget("serviceChain", option.id, checked === true)}
                  />
                  <span>{option.name}</span>
                </label>
              ))}
            </div>
          </div>

          <Button onClick={saveSettings} disabled={isSaving}>
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? "Saving..." : "Save Data Selection Settings"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data Page Plugins (Dummy)</CardTitle>
          <CardDescription>
            Placeholder section for installing data-page plugins (similar to Result Page custom visualization).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{pluginSummary}</Badge>
            <Badge variant="outline">Coming soon</Badge>
          </div>
          <div className="rounded-md border p-4 bg-muted/30 text-sm text-muted-foreground">
            <div className="flex items-center gap-2 mb-2">
              <Plug className="h-4 w-4" />
              Plugin installer for data selection page is not active yet.
            </div>
            This section is intentionally added as a dummy scaffold and can be extended to support script/style bundle uploads.
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default DataSelectionSettingsSection;
