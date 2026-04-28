import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

import { Save, Plus, Trash2, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { VisualizationType } from "@/types/auth";

type ResultUrlSource = 'contract' | 'fallback' | 'custom';

interface ResourceParam {
  id: string;
  resource_url: string;
  contract_url: string;
  resource_type: 'software' | 'data' | 'service_chain';
  resource_name: string | null;
  resource_description: string | null;
  provider: string | null;
  llm_context?: string | null;
  parameters: Array<{ paramName: string; paramValue: string; paramAction?: string }> | null;
  is_visible: boolean;
  visualization_type: VisualizationType;
  upload_file: boolean;
  // Upload configuration for visualization_type = 'upload_document'
  upload_url: string | null;
  upload_authorization: string | null;
  // API response representation from contract (contains URL info)
  api_response_representation?: Record<string, unknown> | null;
  // Result URL configuration
  result_url_source: ResultUrlSource;
  custom_result_url: string | null;
  result_authorization: string | null;
  result_query_params: Array<{ paramName: string; paramValue: string }>;
  visible_for_software_ids: string[];
  // Fallback URL from PDC config (passed in for display)
  fallback_result_url?: string | null;
}

interface ResourceDetailsModalProps {
  resource: ResourceParam | null;
  softwareOptions: Array<{ id: string; name: string }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (resource: ResourceParam) => Promise<void>;
  isSaving: boolean;
}

const VISUALIZATION_OPTIONS: { value: VisualizationType; label: string }[] = [
  { value: 'data_api', label: 'Data API' },
  { value: 'upload_document', label: 'Upload Document' },
  { value: 'manual_json_input', label: 'Manual JSON Input' },
];

const PARAM_ACTION_OPTIONS = [
  { value: '#ignorePayload', label: '#ignorePayload' },
  { value: '#ignoreFlowResult', label: '#ignoreFlowResult' },
  { value: '#ignoreFlowData', label: '#ignoreFlowData' },
  { value: '#ignoreParam', label: '#ignoreParam' },
];

const RESULT_URL_SOURCE_OPTIONS: { value: ResultUrlSource; label: string; description: string }[] = [
  { value: 'contract', label: 'From Contract', description: 'Use URL from API response representation (default)' },
  { value: 'fallback', label: 'Fallback URL', description: 'Use fallback result URL from PDC configuration' },
  { value: 'custom', label: 'Custom URL', description: 'Specify a custom result URL' },
];

const ResourceDetailsModal = ({ resource, softwareOptions, open, onOpenChange, onSave, isSaving }: ResourceDetailsModalProps) => {
  const [editedResource, setEditedResource] = useState<ResourceParam | null>(null);
  const [customActionInput, setCustomActionInput] = useState<Record<number, string>>({});

  useEffect(() => {
    if (resource) {
      setEditedResource({ ...resource, visible_for_software_ids: resource.visible_for_software_ids || [] });
      setCustomActionInput({});
    }
  }, [resource]);

  if (!editedResource) return null;

  const parseActions = (actionString: unknown): string[] => {
    if (typeof actionString !== 'string' || !actionString.trim()) return [];
    return actionString.split(/\s+/).filter(Boolean);
  };

  const formatActions = (actions: string[]): string => {
    return actions.filter(Boolean).join(' ');
  };

  const handleActionToggle = (paramIndex: number, action: string, checked: boolean) => {
    const newParams = [...(editedResource.parameters || [])];
    const currentActions = parseActions(newParams[paramIndex]?.paramAction);
    
    let updatedActions: string[];
    if (checked) {
      updatedActions = [...currentActions, action];
    } else {
      updatedActions = currentActions.filter(a => a !== action);
    }
    
    newParams[paramIndex] = {
      ...newParams[paramIndex],
      paramAction: formatActions(updatedActions) || undefined
    };
    
    setEditedResource({ ...editedResource, parameters: newParams });
  };

  const handleAddCustomAction = (paramIndex: number) => {
    const customAction = customActionInput[paramIndex]?.trim();
    if (!customAction) return;
    
    // Ensure it starts with #
    const formattedAction = customAction.startsWith('#') ? customAction : `#${customAction}`;
    
    const newParams = [...(editedResource.parameters || [])];
    const currentActions = parseActions(newParams[paramIndex]?.paramAction);
    
    if (!currentActions.includes(formattedAction)) {
      currentActions.push(formattedAction);
      newParams[paramIndex] = {
        ...newParams[paramIndex],
        paramAction: formatActions(currentActions)
      };
      setEditedResource({ ...editedResource, parameters: newParams });
    }
    
    setCustomActionInput(prev => ({ ...prev, [paramIndex]: '' }));
  };

  const handleRemoveAction = (paramIndex: number, action: string) => {
    const newParams = [...(editedResource.parameters || [])];
    const currentActions = parseActions(newParams[paramIndex]?.paramAction);
    const updatedActions = currentActions.filter(a => a !== action);
    
    newParams[paramIndex] = {
      ...newParams[paramIndex],
      paramAction: formatActions(updatedActions) || undefined
    };
    
    setEditedResource({ ...editedResource, parameters: newParams });
  };

  const handleParamValueChange = (index: number, value: string) => {
    const newParams = [...(editedResource.parameters || [])];
    newParams[index] = { ...newParams[index], paramValue: value };
    setEditedResource({ ...editedResource, parameters: newParams });
  };

  const handleSave = async () => {
    if (editedResource) {
      await onSave(editedResource);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden [&>button]:hidden"
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Resource Details</DialogTitle>
          <DialogDescription>
            Configure settings and parameters for {editedResource.resource_name || 'this resource'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2 -mr-2">
          <div className="space-y-6 py-4 pr-2">
            {/* Basic Information */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Basic Information</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Resource Name</Label>
                  <Input
                    value={editedResource.resource_name || ''}
                    onChange={(e) => setEditedResource({ ...editedResource, resource_name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Input
                    value={editedResource.provider || ''}
                    onChange={(e) => setEditedResource({ ...editedResource, provider: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={editedResource.resource_description || ''}
                  onChange={(e) => setEditedResource({ ...editedResource, resource_description: e.target.value })}
                  rows={2}
                />
              </div>

              {editedResource.resource_type === 'software' && (
                <div className="space-y-2">
                  <Label>LLM Result Context (Optional)</Label>
                  <Textarea
                    value={editedResource.llm_context || ''}
                    onChange={(e) => setEditedResource({ ...editedResource, llm_context: e.target.value || null })}
                    rows={3}
                    placeholder="Explain domain/industry context for this software analytics result. This text is appended to the LLM prompt on the result page."
                  />
                  <p className="text-xs text-muted-foreground">
                    Chart keyword hints to force type: <code>bar chart</code>, <code>line chart</code>, <code>area chart</code>, <code>scatter</code>, <code>pie chart</code>, <code>radial</code>, <code>treemap</code>, <code>network</code>, <code>map</code>. If none is mentioned, the model auto-selects.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Resource URL (read-only)</Label>
                  <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 py-2 text-xs font-mono text-muted-foreground overflow-hidden">
                    <span className="truncate">{editedResource.resource_url}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Contract URL (read-only)</Label>
                  <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 py-2 text-xs font-mono text-muted-foreground overflow-hidden">
                    <span className="truncate">{editedResource.contract_url}</span>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Settings */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Settings</h3>
              
              <div className="grid grid-cols-2 gap-4">
                {editedResource.resource_type === 'data' && (
                  <div className="space-y-2">
                    <Label>Visualization Type</Label>
                    <Select
                      value={editedResource.visualization_type}
                      onValueChange={(v) => {
                        const newType = v as VisualizationType;
                        let newUploadUrl = editedResource.upload_url;
                        
                        // Auto-extract upload URL from api_response_representation when switching to upload_document
                        if (newType === 'upload_document' && !editedResource.upload_url) {
                          const apiRep = editedResource.api_response_representation;
                          if (apiRep) {
                            // Try to get URL from apiResponseRepresentation
                            const extractedUrl = (apiRep.url as string) || 
                              ((apiRep.input as Record<string, unknown>)?.url as string) ||
                              null;
                            if (extractedUrl) {
                              newUploadUrl = extractedUrl;
                            }
                          }
                        }
                        
                        setEditedResource({ 
                          ...editedResource, 
                          visualization_type: newType,
                          upload_url: newUploadUrl
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VISUALIZATION_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                
                <div className="flex items-center justify-between">
                  <Label>Visible</Label>
                  <Switch
                    checked={editedResource.is_visible}
                    onCheckedChange={(c) => setEditedResource({ ...editedResource, is_visible: c })}
                  />
                </div>
              </div>

              {/* Upload Configuration - only show for upload_document visualization type */}
              {editedResource.resource_type === 'data' && editedResource.visualization_type === 'upload_document' && (
                <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                  <h4 className="text-sm font-medium">Upload Configuration</h4>
                  <p className="text-xs text-muted-foreground">
                    Configure the endpoint where files will be uploaded for this resource.
                  </p>
                  
                  <div className="space-y-2">
                    <Label>Upload URL</Label>
                    <Input
                      value={editedResource.upload_url || ''}
                      onChange={(e) => setEditedResource({ ...editedResource, upload_url: e.target.value || null })}
                      placeholder="https://api.example.com/upload"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Authorization Header</Label>
                    <Input
                      value={editedResource.upload_authorization || ''}
                      onChange={(e) => setEditedResource({ ...editedResource, upload_authorization: e.target.value || null })}
                      placeholder="Bearer <token> or API key"
                      type="password"
                    />
                    <p className="text-xs text-muted-foreground">
                      Authorization header value for upload requests (e.g., Bearer token)
                    </p>
                  </div>
                </div>
              )}

              {/* Result URL Configuration - show for all data resources */}
              {editedResource.resource_type === 'data' && (
                <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                  <div className="space-y-2">
                    <Label>Allowed Software Resources</Label>
                    <p className="text-xs text-muted-foreground">
                      This data resource will appear in Gateway only when one of these software analytics is selected.
                    </p>
                    <div className="space-y-2 max-h-40 overflow-y-auto rounded-md border p-3 bg-background">
                      {softwareOptions.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No software resources available.</p>
                      ) : softwareOptions.map((option) => {
                        const checked = editedResource.visible_for_software_ids.includes(option.id);
                        return (
                          <label key={option.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(nextChecked) => {
                                const next = new Set(editedResource.visible_for_software_ids);
                                if (nextChecked) next.add(option.id);
                                else next.delete(option.id);
                                setEditedResource({
                                  ...editedResource,
                                  visible_for_software_ids: Array.from(next),
                                });
                              }}
                            />
                            <span>{option.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <h4 className="text-sm font-medium">Result URL Configuration</h4>
                  <p className="text-xs text-muted-foreground">
                    Configure how results are fetched for this data resource on the results page.
                  </p>
                  
                  {/* Result URL Source Selection */}
                  <div className="space-y-2">
                    <Label>Result URL Source</Label>
                    <Select
                      value={editedResource.result_url_source || 'contract'}
                      onValueChange={(v) => setEditedResource({ 
                        ...editedResource, 
                        result_url_source: v as ResultUrlSource 
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RESULT_URL_SOURCE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            <div className="flex flex-col">
                              <span>{opt.label}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {RESULT_URL_SOURCE_OPTIONS.find(o => o.value === (editedResource.result_url_source || 'contract'))?.description}
                    </p>
                  </div>

                  {/* Show current URLs for reference */}
                  <div className="space-y-2 text-xs">
                    <div className={`p-2 rounded border ${editedResource.result_url_source === 'contract' ? 'bg-primary/10 border-primary/20' : 'bg-secondary/50 border-transparent'}`}>
                      <span className="text-muted-foreground">Contract URL: </span>
                      <span className="font-mono">{(editedResource.api_response_representation?.url as string) || 'Not available'}</span>
                    </div>
                    {editedResource.fallback_result_url && (
                      <div className={`p-2 rounded border ${editedResource.result_url_source === 'fallback' ? 'bg-primary/10 border-primary/20' : 'bg-secondary/50 border-transparent'}`}>
                        <span className="text-muted-foreground">Fallback URL (from PDC): </span>
                        <span className="font-mono">{editedResource.fallback_result_url}</span>
                      </div>
                    )}
                  </div>

                  {/* Custom URL Input - only show when custom is selected */}
                  {editedResource.result_url_source === 'custom' && (
                    <div className="space-y-2">
                      <Label>Custom Result URL</Label>
                      <Input
                        value={editedResource.custom_result_url || ''}
                        onChange={(e) => setEditedResource({ ...editedResource, custom_result_url: e.target.value || null })}
                        placeholder="https://api.example.com/results"
                      />
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <Label>Result Authorization Header</Label>
                    <Input
                      value={editedResource.result_authorization || ''}
                      onChange={(e) => setEditedResource({ ...editedResource, result_authorization: e.target.value || null })}
                      placeholder="Bearer <token> or API key"
                      type="password"
                    />
                    <p className="text-xs text-muted-foreground">
                      Authorization for fetching results. You can enter either a full value like <code>Bearer your-token</code> or just the raw token; the gateway will normalize it.
                    </p>
                  </div>

                  {/* Query Parameters */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Query Parameters</Label>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const params = editedResource.result_query_params || [];
                          setEditedResource({
                            ...editedResource,
                            result_query_params: [...params, { paramName: '', paramValue: '' }]
                          });
                        }}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Query parameters appended to the result URL. Use <code className="text-xs bg-muted px-1 rounded">#genSessionId</code> as value for session ID.
                    </p>
                    {(editedResource.result_query_params || []).map((param, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input
                          value={param.paramName}
                          onChange={(e) => {
                            const params = [...(editedResource.result_query_params || [])];
                            params[index] = { ...params[index], paramName: e.target.value };
                            setEditedResource({ ...editedResource, result_query_params: params });
                          }}
                          placeholder="Parameter name"
                          className="flex-1"
                        />
                        <Input
                          value={param.paramValue}
                          onChange={(e) => {
                            const params = [...(editedResource.result_query_params || [])];
                            params[index] = { ...params[index], paramValue: e.target.value };
                            setEditedResource({ ...editedResource, result_query_params: params });
                          }}
                          placeholder="Value or #genSessionId"
                          className="flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => {
                            const params = [...(editedResource.result_query_params || [])];
                            params.splice(index, 1);
                            setEditedResource({ ...editedResource, result_query_params: params });
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Parameters */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Parameters (from Contract)</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Parameters are derived from the contract's queryParam mapping. Use actions to control how each parameter is processed.
              </p>

              {editedResource.parameters && editedResource.parameters.length > 0 ? (
                <div className="space-y-4">
                  {editedResource.parameters.map((param, index) => {
                    const currentActions = parseActions(param.paramAction);
                    
                    return (
                      <div key={index} className="p-4 border rounded-lg space-y-4 bg-muted/30">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-xs">Parameter Name</Label>
                            <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 py-2 text-sm font-mono">
                              {param.paramName}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs">Default Value</Label>
                            <Input
                              value={param.paramValue || ''}
                              onChange={(e) => handleParamValueChange(index, e.target.value)}
                              placeholder="Enter default value..."
                            />
                          </div>
                        </div>

                        {/* Actions Section */}
                        <div className="space-y-3">
                          <Label className="text-xs">Actions</Label>
                          
                          {/* Current Actions Tags */}
                          {currentActions.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {currentActions.map((action, actionIndex) => (
                                <Badge 
                                  key={actionIndex} 
                                  variant="secondary"
                                  className="pl-2 pr-1 py-1 flex items-center gap-1"
                                >
                                  <span className="font-mono text-xs">{action}</span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 p-0 hover:bg-destructive/20"
                                    onClick={() => handleRemoveAction(index, action)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </Badge>
                              ))}
                            </div>
                          )}

                          {/* Predefined Actions Checkboxes */}
                          <div className="flex flex-wrap gap-4">
                            {PARAM_ACTION_OPTIONS.map((option) => {
                              const isChecked = currentActions.includes(option.value);
                              return (
                                <div
                                  key={option.value}
                                  className="flex items-center gap-2"
                                >
                                  <Checkbox
                                    id={`action-${index}-${option.value}`}
                                    checked={isChecked}
                                    onCheckedChange={(checked) => handleActionToggle(index, option.value, !!checked)}
                                  />
                                  <label 
                                    htmlFor={`action-${index}-${option.value}`}
                                    className="text-sm font-mono cursor-pointer"
                                  >
                                    {option.label}
                                  </label>
                                </div>
                              );
                            })}
                          </div>

                          {/* Custom Action Input */}
                          <div className="flex items-center gap-2">
                            <Input
                              placeholder="Add custom action (e.g., #customAction)"
                              value={customActionInput[index] || ''}
                              onChange={(e) => setCustomActionInput(prev => ({ ...prev, [index]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleAddCustomAction(index);
                                }
                              }}
                              className="flex-1"
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleAddCustomAction(index)}
                              disabled={!customActionInput[index]?.trim()}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8 border rounded-lg bg-muted/30">
                  No parameters found. Parameters are extracted from the contract's queryParam definitions.
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="pt-4">
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ResourceDetailsModal;
