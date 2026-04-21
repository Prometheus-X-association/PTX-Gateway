import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Save, Send, Trash2, Eye, EyeOff, Upload, Palette } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CustomVisualizationConfig, ExportApiConfig } from "@/types/dataspace";

interface TemplateTagHelp {
  tag: string;
  title: string;
  description: string;
  example: string;
}

interface VisualizationTargetOption {
  id: string;
  label: string;
  type: "software" | "serviceChain";
}

const TEMPLATE_TAG_HELP: TemplateTagHelp[] = [
  {
    tag: "##result",
    title: "Full Result Object",
    description: "Inject the entire result JSON as a value.",
    example: '{\n  "raw_result": ##result\n}',
  },
  {
    tag: "##resultArray",
    title: "Single Path Value",
    description: "Get one specific value by JSON path and optional array index.",
    example: '{\n  "skill": ##resultArray.data.content.data.nodes[0].label,\n  "weight": ##resultArray.data.content.data.nodes[0].weight\n}',
  },
  {
    tag: "##resultArrayEach",
    title: "Map All Items In Array",
    description: "Generate one array item from each element in a source array.",
    example:
      '[\n  {\n    "name": ##resultArrayEach.data.content.data.nodes.label,\n    "weight": ##resultArrayEach.data.content.data.nodes.weight\n  }\n]',
  },
  {
    tag: "##forEach",
    title: "Send Multiple POST Requests",
    description: "Prefix template to send one POST request per item in the resolved body array.",
    example:
      '##forEach(1:)\n[\n  {\n    "name": ##resultArrayEach.data.content.data.nodes.label,\n    "weight": ##resultArrayEach.data.content.data.nodes.weight\n  }\n]',
  },
];

const emptyExportApi = (): ExportApiConfig => ({
  name: "",
  url: "",
  authorization: "",
  params: [],
  body_template: '{\n  "data": ##result\n}',
});

const emptyCustomVisualization = (): CustomVisualizationConfig => ({
  id: crypto.randomUUID(),
  name: "",
  description: "",
  is_active: false,
  library_source: "url",
  library_url: "",
  library_file_name: "",
  library_code: "",
  json_schema: '{\n  "type": "object",\n  "description": "Describe the expected result JSON structure for this visualization."\n}',
  render_code:
    "// Available variables: container, resultData, jsonSchema, config\n" +
    "// The visualization library is loaded before this code runs.\n" +
    "container.innerHTML = `<pre style=\"white-space:pre-wrap;font:12px monospace;\">${JSON.stringify(resultData, null, 2)}</pre>`;",
  target_resources: [],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getExportApisFromFeatures = (features: unknown): ExportApiConfig[] => {
  if (!isRecord(features)) return [];
  const resultPage = isRecord(features.resultPage) ? features.resultPage : {};
  return Array.isArray(resultPage.exportApiConfigs)
    ? (resultPage.exportApiConfigs as unknown as ExportApiConfig[])
    : [];
};

const getCustomVisualizationsFromFeatures = (features: unknown): CustomVisualizationConfig[] => {
  if (!isRecord(features)) return [];
  const resultPage = isRecord(features.resultPage) ? features.resultPage : {};
  return Array.isArray(resultPage.customVisualizations)
    ? (resultPage.customVisualizations as unknown as CustomVisualizationConfig[])
    : [];
};

const ResultPageSettingsSection = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [globalFeatures, setGlobalFeatures] = useState<Record<string, unknown>>({});
  const [exportApis, setExportApis] = useState<ExportApiConfig[]>([]);
  const [customVisualizations, setCustomVisualizations] = useState<CustomVisualizationConfig[]>([]);
  const [visualizationTargets, setVisualizationTargets] = useState<VisualizationTargetOption[]>([]);
  const [isUsingLegacyExportApis, setIsUsingLegacyExportApis] = useState(false);
  const [isTagHelpOpen, setIsTagHelpOpen] = useState(false);
  const [selectedTagHelp, setSelectedTagHelp] = useState<TemplateTagHelp | null>(null);

  const fetchSettings = async () => {
    if (!user?.organization?.id) return;

    setIsLoading(true);
    try {
      const [
        { data: globalData, error: globalError },
        { data: legacyData, error: legacyError },
        { data: softwareData, error: softwareError },
        { data: chainsData, error: chainsError },
      ] = await Promise.all([
        supabase
          .from("global_configs")
          .select("features")
          .eq("organization_id", user.organization.id)
          .maybeSingle(),
        supabase
          .from("dataspace_configs")
          .select("export_api_configs")
          .eq("organization_id", user.organization.id),
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
      if (legacyError) throw legacyError;
      if (softwareError) throw softwareError;
      if (chainsError) throw chainsError;

      const features = isRecord(globalData?.features) ? globalData.features : {};
      const storedExportApis = getExportApisFromFeatures(features);
      const storedCustomVisualizations = getCustomVisualizationsFromFeatures(features);
      const legacyExportApis = (legacyData || []).flatMap((config) =>
        Array.isArray(config.export_api_configs)
          ? (config.export_api_configs as unknown as ExportApiConfig[])
          : [],
      );
      const softwareTargets: VisualizationTargetOption[] = (softwareData || []).map((item) => ({
        id: `software:${item.id}`,
        label: item.resource_name || item.resource_url || item.id,
        type: "software",
      }));
      const serviceChainTargets: VisualizationTargetOption[] = (chainsData || []).map((item) => {
        const basis = isRecord(item.basis_information) ? item.basis_information : {};
        return {
          id: `serviceChain:${item.id}`,
          label: String(basis.name || item.catalog_id || item.id),
          type: "serviceChain",
        };
      });

      setGlobalFeatures(features);
      setExportApis(storedExportApis.length > 0 ? storedExportApis : legacyExportApis);
      setCustomVisualizations(storedCustomVisualizations);
      setVisualizationTargets([...softwareTargets, ...serviceChainTargets]);
      setIsUsingLegacyExportApis(storedExportApis.length === 0 && legacyExportApis.length > 0);
    } catch {
      toast.error("Failed to load result page settings");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchSettings();
  }, [user?.organization?.id]);

  const updateApi = (index: number, next: Partial<ExportApiConfig>) => {
    setExportApis((current) => {
      const updated = [...current];
      updated[index] = { ...updated[index], ...next };
      return updated;
    });
  };

  const updateCustomVisualization = (index: number, next: Partial<CustomVisualizationConfig>) => {
    setCustomVisualizations((current) => {
      const updated = [...current];
      updated[index] = { ...updated[index], ...next };
      return updated;
    });
  };

  const toggleVisualizationTarget = (index: number, targetId: string, checked: boolean) => {
    setCustomVisualizations((current) => {
      const updated = [...current];
      const currentTargets = updated[index]?.target_resources || [];
      updated[index] = {
        ...updated[index],
        target_resources: checked
          ? Array.from(new Set([...currentTargets, targetId]))
          : currentTargets.filter((id) => id !== targetId),
      };
      return updated;
    });
  };

  const handleVisualizationFileUpload = async (index: number, file: File | undefined) => {
    if (!file) return;
    if (!file.name.endsWith(".js")) {
      toast.error("Only .js visualization library files are supported");
      return;
    }

    const code = await file.text();
    updateCustomVisualization(index, {
      library_source: "upload",
      library_file_name: file.name,
      library_code: code,
      library_url: "",
    });
    toast.success(`Loaded ${file.name}`);
  };

  const handleOpenTagHelp = (tag: string) => {
    const help = TEMPLATE_TAG_HELP.find((item) => item.tag === tag);
    if (!help) return;
    setSelectedTagHelp(help);
    setIsTagHelpOpen(true);
  };

  const saveResultPageSettings = async (successMessage: string) => {
    if (!user?.organization?.id) return;

    setIsSaving(true);
    try {
      const nextFeatures = {
        ...globalFeatures,
        resultPage: {
          ...(isRecord(globalFeatures.resultPage) ? globalFeatures.resultPage : {}),
          exportApiConfigs: exportApis,
          customVisualizations,
        },
      };

      const { error } = await supabase
        .from("global_configs")
        .upsert({
          organization_id: user.organization.id,
          features: nextFeatures,
        }, { onConflict: "organization_id" });

      if (error) throw error;
      toast.success(successMessage);
      setIsUsingLegacyExportApis(false);
      await fetchSettings();
    } catch {
      toast.error("Failed to save result page settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    await saveResultPageSettings("Export API endpoints saved");
  };

  const handleSaveCustomVisualizations = async () => {
    await saveResultPageSettings("Custom visualizations saved");
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
        <CardTitle>Result Page Settings</CardTitle>
        <CardDescription>
          Configure settings used after PDC execution, including export endpoints and future result-page behavior.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="export-api" className="space-y-4">
          <TabsList>
            <TabsTrigger value="export-api" className="gap-2">
              <Send className="h-4 w-4" />
              Export API Endpoints
            </TabsTrigger>
            <TabsTrigger value="custom-visualization" className="gap-2">
              <Palette className="h-4 w-4" />
              Custom Visualization
            </TabsTrigger>
            <TabsTrigger value="page-settings">
              Page Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="export-api" className="space-y-4">
            <>
              {isUsingLegacyExportApis && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-200">
                  Existing export endpoints were loaded from the old PDC configuration location. Save this page once to migrate them to Result Page settings.
                </div>
              )}
                <div className="space-y-3 border rounded-lg p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Label className="flex items-center gap-2">
                        <Send className="w-4 h-4" />
                        Export API Endpoints
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Configure API endpoints available for users to export result data from the result page.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setExportApis((current) => [...current, emptyExportApi()])}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add API
                    </Button>
                  </div>

                  {exportApis.length === 0 ? (
                    <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
                      No export API endpoints configured yet.
                    </div>
                  ) : (
                    exportApis.map((api, apiIndex) => (
                      <div key={apiIndex} className="border border-border rounded-lg p-4 space-y-3 bg-secondary/20">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">API #{apiIndex + 1}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setExportApis((current) => current.filter((_, index) => index !== apiIndex))}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Name</Label>
                            <Input
                              value={api.name}
                              onChange={(e) => updateApi(apiIndex, { name: e.target.value })}
                              placeholder="My Export API"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">URL</Label>
                            <Input
                              value={api.url}
                              onChange={(e) => updateApi(apiIndex, { url: e.target.value })}
                              placeholder="https://api.example.com/data"
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Authorization</Label>
                          <Input
                            type="password"
                            value={api.authorization || ""}
                            onChange={(e) => updateApi(apiIndex, { authorization: e.target.value })}
                            placeholder="Bearer <token>"
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs">Parameters</Label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs"
                              onClick={() =>
                                updateApi(apiIndex, {
                                  params: [...(api.params || []), { key: "", value: "" }],
                                })
                              }
                            >
                              <Plus className="h-3 w-3 mr-1" />
                              Add
                            </Button>
                          </div>
                          {(api.params || []).map((param, paramIndex) => (
                            <div key={paramIndex} className="flex gap-2">
                              <Input
                                value={param.key}
                                onChange={(e) => {
                                  const params = [...(api.params || [])];
                                  params[paramIndex] = { ...params[paramIndex], key: e.target.value };
                                  updateApi(apiIndex, { params });
                                }}
                                placeholder="Key"
                                className="flex-1"
                              />
                              <Input
                                value={param.value}
                                onChange={(e) => {
                                  const params = [...(api.params || [])];
                                  params[paramIndex] = { ...params[paramIndex], value: e.target.value };
                                  updateApi(apiIndex, { params });
                                }}
                                placeholder="Value"
                                className="flex-1"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-10 px-2"
                                onClick={() => updateApi(apiIndex, { params: (api.params || []).filter((_, index) => index !== paramIndex) })}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">
                            Body Template <span className="text-primary">(supports ##result, ##resultArray, ##resultArrayEach, ##forEach)</span>
                          </Label>
                          <Textarea
                            value={api.body_template || ""}
                            onChange={(e) => updateApi(apiIndex, { body_template: e.target.value })}
                            placeholder='{"data": ##result}'
                            className="font-mono text-xs min-h-[80px]"
                          />
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">Tag examples:</span>
                            {TEMPLATE_TAG_HELP.map((item) => (
                              <button
                                key={item.tag}
                                type="button"
                                onClick={() => handleOpenTagHelp(item.tag)}
                                className="text-xs px-2 py-1 rounded border border-border bg-secondary/40 hover:bg-secondary/70 transition-colors"
                              >
                                {item.tag}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save Export APIs
                      </>
                    )}
                  </Button>
                </div>
            </>
          </TabsContent>

          <TabsContent value="custom-visualization" className="space-y-4">
            <div className="space-y-3 border rounded-lg p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Label className="flex items-center gap-2">
                    <Palette className="w-4 h-4" />
                    Custom Visualization List
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Define JavaScript visualizations that render result JSON for selected software resources or service chains.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCustomVisualizations((current) => [...current, emptyCustomVisualization()])}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Visualization
                </Button>
              </div>

              {customVisualizations.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
                  No custom visualizations configured yet.
                </div>
              ) : (
                customVisualizations.map((visualization, index) => (
                  <div key={visualization.id} className="border border-border rounded-lg p-4 space-y-4 bg-secondary/20">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {visualization.name || `Visualization #${index + 1}`}
                        </span>
                        <Badge variant={visualization.is_active ? "default" : "secondary"}>
                          {visualization.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => updateCustomVisualization(index, { is_active: !visualization.is_active })}
                        >
                          {visualization.is_active ? (
                            <>
                              <EyeOff className="h-4 w-4 mr-1" />
                              Deactivate
                            </>
                          ) : (
                            <>
                              <Eye className="h-4 w-4 mr-1" />
                              Activate
                            </>
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setCustomVisualizations((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Name</Label>
                        <Input
                          value={visualization.name}
                          onChange={(event) => updateCustomVisualization(index, { name: event.target.value })}
                          placeholder="Skills network visualization"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Library URL / CDN</Label>
                        <Input
                          value={visualization.library_url || ""}
                          disabled={visualization.library_source === "upload"}
                          onChange={(event) => updateCustomVisualization(index, {
                            library_source: "url",
                            library_url: event.target.value,
                            library_code: "",
                            library_file_name: "",
                          })}
                          placeholder="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Short Description</Label>
                      <Textarea
                        value={visualization.description || ""}
                        onChange={(event) => updateCustomVisualization(index, { description: event.target.value })}
                        placeholder="Explain what this visualization shows on the result page."
                        className="min-h-[70px]"
                      />
                    </div>

                    <div className="rounded-md border bg-background/40 p-3 space-y-2">
                      <Label className="text-xs flex items-center gap-2">
                        <Upload className="h-3.5 w-3.5" />
                        Uploaded Visualization Library (.js)
                      </Label>
                      <Input
                        type="file"
                        accept=".js,application/javascript,text/javascript"
                        onChange={(event) => void handleVisualizationFileUpload(index, event.target.files?.[0])}
                      />
                      {visualization.library_file_name && (
                        <p className="text-xs text-muted-foreground">
                          Loaded file: <span className="font-medium">{visualization.library_file_name}</span>. The script content is stored in Result Page settings and loaded on the result page.
                        </p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Expected Result JSON Schema / Structure</Label>
                      <Textarea
                        value={visualization.json_schema}
                        onChange={(event) => updateCustomVisualization(index, { json_schema: event.target.value })}
                        placeholder='{"type":"object","properties":{"nodes":{"type":"array"}}}'
                        className="font-mono text-xs min-h-[120px]"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Custom JavaScript Render Code</Label>
                      <Textarea
                        value={visualization.render_code}
                        onChange={(event) => updateCustomVisualization(index, { render_code: event.target.value })}
                        placeholder="container.innerHTML = ''; /* render resultData here */"
                        className="font-mono text-xs min-h-[160px]"
                      />
                      <p className="text-xs text-muted-foreground">
                        Variables available: <code>container</code>, <code>resultData</code>, <code>jsonSchema</code>, <code>config</code>. Use globals from your loaded library, for example <code>window.d3</code>.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">Show For Software / Service Chain Result</Label>
                      {visualizationTargets.length === 0 ? (
                        <p className="text-xs text-muted-foreground border border-dashed rounded-md p-3">
                          No software resources or service chains found yet.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-auto rounded-md border p-3 bg-background/30">
                          {visualizationTargets.map((target) => (
                            <label key={target.id} className="flex items-start gap-2 text-sm">
                              <Checkbox
                                checked={(visualization.target_resources || []).includes(target.id)}
                                onCheckedChange={(checked) => toggleVisualizationTarget(index, target.id, checked === true)}
                              />
                              <span>
                                <span className="font-medium">{target.label}</span>
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {target.type === "software" ? "Software" : "Service Chain"}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSaveCustomVisualizations} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save Custom Visualizations
                  </>
                )}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="page-settings" className="space-y-4">
            <div className="rounded-lg border p-4 bg-secondary/20">
              <h3 className="font-medium">Result Page Settings Data</h3>
              <p className="text-sm text-muted-foreground mt-1">
                This area is reserved for result-page behavior that will be stored separately from PDC connection
                settings. Export API Endpoints are available now as the first moved result-page setting.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded border bg-background/40 p-3">
	                  <p className="text-sm font-medium">Current Settings Source</p>
	                  <p className="text-xs text-muted-foreground mt-1">
	                    Export endpoints are stored in organization Result Page settings at <code>global_configs.features.resultPage.exportApiConfigs</code>.
	                  </p>
                </div>
                <div className="rounded border bg-background/40 p-3">
                  <p className="text-sm font-medium">Planned Result Settings</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Future options can include default result view, AI insight behavior, export visibility, and result-page layout.
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>

      <Dialog open={isTagHelpOpen} onOpenChange={setIsTagHelpOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{selectedTagHelp?.title ?? "Template Tag Help"}</DialogTitle>
            <DialogDescription>
              {selectedTagHelp?.description ?? "Select a tag to see usage examples."}
            </DialogDescription>
          </DialogHeader>
          {selectedTagHelp && (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Tag</p>
                <code className="text-xs bg-secondary/50 px-2 py-1 rounded">{selectedTagHelp.tag}</code>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Example</p>
                <pre className="text-xs bg-secondary/50 p-3 rounded overflow-auto max-h-[320px]">
{selectedTagHelp.example}
                </pre>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setIsTagHelpOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default ResultPageSettingsSection;
