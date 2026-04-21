import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Save, Plus, Trash2, Globe } from "lucide-react";
import { createPdcConfig, updatePdcConfig, PdcConfigData } from "@/services/configApi";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const PdcConfigSection = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [configs, setConfigs] = useState<PdcConfigData[]>([]);
  const [editingConfig, setEditingConfig] = useState<PdcConfigData | null>(null);

  const fetchConfigs = async () => {
    if (!user?.organization?.id) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('dataspace_configs')
        .select('*')
        .eq('organization_id', user.organization.id);

      if (error) throw error;
      setConfigs(data || []);
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

    </div>
  );
};

export default PdcConfigSection;
