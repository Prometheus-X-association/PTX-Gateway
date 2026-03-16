import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Save, Plus, Trash2, Globe, Send } from "lucide-react";
import { createPdcConfig, updatePdcConfig, PdcConfigData } from "@/services/configApi";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ExportApiConfig } from "@/types/dataspace";

interface TemplateTagHelp {
  tag: string;
  title: string;
  description: string;
  example: string;
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

const PdcConfigSection = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [configs, setConfigs] = useState<(PdcConfigData & { export_api_configs?: ExportApiConfig[] })[]>([]);
  const [editingConfig, setEditingConfig] = useState<(PdcConfigData & { export_api_configs?: ExportApiConfig[] }) | null>(null);
  const [isTagHelpOpen, setIsTagHelpOpen] = useState(false);
  const [selectedTagHelp, setSelectedTagHelp] = useState<TemplateTagHelp | null>(null);

  const fetchConfigs = async () => {
    if (!user?.organization?.id) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('dataspace_configs')
        .select('*')
        .eq('organization_id', user.organization.id);

      if (error) throw error;
      setConfigs((data || []).map((d: any) => ({
        ...d,
        export_api_configs: Array.isArray(d.export_api_configs) ? d.export_api_configs : [],
      })));
    } catch (err) {
      toast.error("Failed to load configurations");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, [user?.organization?.id]);

  const handleSave = async () => {
    if (!editingConfig || !user?.organization?.id) return;
    
    setIsSaving(true);
    try {
      const payload: Partial<PdcConfigData> = {
        name: editingConfig.name,
        pdc_url: editingConfig.pdc_url,
        fallback_result_url: editingConfig.fallback_result_url,
        fallback_result_authorization: editingConfig.fallback_result_authorization,
        export_api_configs: editingConfig.export_api_configs || [],
        is_active: editingConfig.is_active,
      };

      if (editingConfig.bearer_token && editingConfig.bearer_token.trim()) {
        payload.bearer_token = editingConfig.bearer_token.trim();
      }

      if (editingConfig.id) {
        const { error } = await updatePdcConfig(editingConfig.id, payload, user.organization.id);
        if (error) throw error;
        toast.success("Configuration updated");
      } else {
        const { error } = await createPdcConfig({
          name: editingConfig.name || 'default',
          pdc_url: editingConfig.pdc_url,
          fallback_result_url: editingConfig.fallback_result_url,
          fallback_result_authorization: editingConfig.fallback_result_authorization,
          export_api_configs: editingConfig.export_api_configs || [],
          bearer_token: payload.bearer_token,
          is_active: editingConfig.is_active ?? true,
        }, user.organization.id);
        if (error) throw error;
        toast.success("Configuration created");
      }
      
      await fetchConfigs();
      setEditingConfig(null);
    } catch (err) {
      toast.error("Failed to save configuration");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from('dataspace_configs')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success("Configuration deleted");
      await fetchConfigs();
    } catch (err) {
      toast.error("Failed to delete configuration");
    }
  };

  const handleSetActive = async (id: string) => {
    try {
      // Deactivate all
      await supabase
        .from('dataspace_configs')
        .update({ is_active: false })
        .eq('organization_id', user?.organization?.id);

      // Activate selected
      const { error } = await supabase
        .from('dataspace_configs')
        .update({ is_active: true })
        .eq('id', id);

      if (error) throw error;
      toast.success("Configuration activated");
      await fetchConfigs();
    } catch (err) {
      toast.error("Failed to set active configuration");
    }
  };

  const handleOpenTagHelp = (tag: string) => {
    const help = TEMPLATE_TAG_HELP.find((item) => item.tag === tag);
    if (!help) return;
    setSelectedTagHelp(help);
    setIsTagHelpOpen(true);
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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                PDC Configurations
              </CardTitle>
              <CardDescription>
                Configure your PTX-Dataspace-Connector (PDC) endpoints
              </CardDescription>
            </div>
            <Button
              onClick={() => setEditingConfig({ pdc_url: '', is_active: true })}
              size="sm"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Config
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {configs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No PDC configurations yet</p>
              <p className="text-sm">Click "Add Config" to create your first configuration</p>
            </div>
          ) : (
            <div className="space-y-4">
              {configs.map((config) => (
                <div
                  key={config.id}
                  className={`p-4 rounded-lg border ${
                    config.is_active ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{config.name || 'Unnamed'}</span>
                        {config.is_active && (
                          <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {config.pdc_url}
                      </p>
                      {config.fallback_result_url && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Fallback: {config.fallback_result_url}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!config.is_active && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSetActive(config.id!)}
                        >
                          Set Active
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingConfig(config)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(config.id!)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Modal */}
      {editingConfig && (
        <Card>
          <CardHeader>
            <CardTitle>{editingConfig.id ? 'Edit' : 'New'} PDC Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="config-name">Configuration Name</Label>
              <Input
                id="config-name"
                value={editingConfig.name || ''}
                onChange={(e) => setEditingConfig({ ...editingConfig, name: e.target.value })}
                placeholder="Production PDC"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pdc-url">PDC URL *</Label>
              <Input
                id="pdc-url"
                value={editingConfig.pdc_url}
                onChange={(e) => setEditingConfig({ ...editingConfig, pdc_url: e.target.value })}
                placeholder="https://pdc.example.com/exchange"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bearer-token">Bearer Token</Label>
              <Input
                id="bearer-token"
                type="password"
                value={editingConfig.bearer_token || ''}
                onChange={(e) => setEditingConfig({ ...editingConfig, bearer_token: e.target.value })}
                placeholder="Enter bearer token..."
              />
              <p className="text-xs text-muted-foreground">
                Token is stored securely and never exposed to the frontend
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fallback-url">Fallback Result URL</Label>
              <Input
                id="fallback-url"
                value={editingConfig.fallback_result_url || ''}
                onChange={(e) => setEditingConfig({ ...editingConfig, fallback_result_url: e.target.value })}
                placeholder="https://api.example.com/results"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fallback-auth">Fallback Result Authorization</Label>
              <Input
                id="fallback-auth"
                type="password"
                value={editingConfig.fallback_result_authorization || ''}
                onChange={(e) => setEditingConfig({ ...editingConfig, fallback_result_authorization: e.target.value })}
                placeholder="Bearer <token> or API key"
              />
              <p className="text-xs text-muted-foreground">
                Authorization header for fetching results from the fallback URL
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="is-active"
                checked={editingConfig.is_active}
                onCheckedChange={(checked) => setEditingConfig({ ...editingConfig, is_active: checked })}
              />
              <Label htmlFor="is-active">Set as active configuration</Label>
            </div>

            {/* Export API Configurations */}
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Send className="w-4 h-4" />
                  Export API Endpoints
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingConfig({
                    ...editingConfig,
                    export_api_configs: [
                      ...(editingConfig.export_api_configs || []),
                      { name: '', url: '', authorization: '', params: [], body_template: '{\n  "data": ##result\n}' }
                    ]
                  })}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add API
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Configure API endpoints available for users to export results
              </p>
              {(editingConfig.export_api_configs || []).map((api, apiIndex) => (
                <div key={apiIndex} className="border border-border rounded-lg p-4 space-y-3 bg-secondary/20">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">API #{apiIndex + 1}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const newConfigs = [...(editingConfig.export_api_configs || [])];
                        newConfigs.splice(apiIndex, 1);
                        setEditingConfig({ ...editingConfig, export_api_configs: newConfigs });
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Name</Label>
                      <Input
                        value={api.name}
                        onChange={(e) => {
                          const newConfigs = [...(editingConfig.export_api_configs || [])];
                          newConfigs[apiIndex] = { ...newConfigs[apiIndex], name: e.target.value };
                          setEditingConfig({ ...editingConfig, export_api_configs: newConfigs });
                        }}
                        placeholder="My Export API"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">URL</Label>
                      <Input
                        value={api.url}
                        onChange={(e) => {
                          const newConfigs = [...(editingConfig.export_api_configs || [])];
                          newConfigs[apiIndex] = { ...newConfigs[apiIndex], url: e.target.value };
                          setEditingConfig({ ...editingConfig, export_api_configs: newConfigs });
                        }}
                        placeholder="https://api.example.com/data"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Authorization</Label>
                    <Input
                      type="password"
                      value={api.authorization || ''}
                      onChange={(e) => {
                        const newConfigs = [...(editingConfig.export_api_configs || [])];
                        newConfigs[apiIndex] = { ...newConfigs[apiIndex], authorization: e.target.value };
                        setEditingConfig({ ...editingConfig, export_api_configs: newConfigs });
                      }}
                      placeholder="Bearer <token>"
                    />
                  </div>
                  {/* Key-Value Parameters */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Parameters</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => {
                          const newConfigs = [...(editingConfig.export_api_configs || [])];
                          newConfigs[apiIndex] = {
                            ...newConfigs[apiIndex],
                            params: [...(newConfigs[apiIndex].params || []), { key: '', value: '' }]
                          };
                          setEditingConfig({ ...editingConfig, export_api_configs: newConfigs });
                        }}
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
                            const newConfigs = [...(editingConfig.export_api_configs || [])];
                            const newParams = [...(newConfigs[apiIndex].params || [])];
                            newParams[paramIndex] = { ...newParams[paramIndex], key: e.target.value };
                            newConfigs[apiIndex] = { ...newConfigs[apiIndex], params: newParams };
                            setEditingConfig({ ...editingConfig, export_api_configs: newConfigs });
                          }}
                          placeholder="Key"
                          className="flex-1"
                        />
                        <Input
                          value={param.value}
                          onChange={(e) => {
                            const newConfigs = [...(editingConfig.export_api_configs || [])];
                            const newParams = [...(newConfigs[apiIndex].params || [])];
                            newParams[paramIndex] = { ...newParams[paramIndex], value: e.target.value };
                            newConfigs[apiIndex] = { ...newConfigs[apiIndex], params: newParams };
                            setEditingConfig({ ...editingConfig, export_api_configs: newConfigs });
                          }}
                          placeholder="Value"
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-10 px-2"
                          onClick={() => {
                            const newConfigs = [...(editingConfig.export_api_configs || [])];
                            const newParams = [...(newConfigs[apiIndex].params || [])];
                            newParams.splice(paramIndex, 1);
                            newConfigs[apiIndex] = { ...newConfigs[apiIndex], params: newParams };
                            setEditingConfig({ ...editingConfig, export_api_configs: newConfigs });
                          }}
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
                      value={api.body_template || ''}
                      onChange={(e) => {
                        const newConfigs = [...(editingConfig.export_api_configs || [])];
                        newConfigs[apiIndex] = { ...newConfigs[apiIndex], body_template: e.target.value };
                        setEditingConfig({ ...editingConfig, export_api_configs: newConfigs });
                      }}
                      placeholder='{"data": ##result}'
                      className="font-mono text-xs min-h-[60px]"
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
              ))}
            </div>
            <div className="flex gap-2 pt-4">
              <Button onClick={handleSave} disabled={isSaving || !editingConfig.pdc_url}>
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={() => setEditingConfig(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
    </div>
  );
};

export default PdcConfigSection;
