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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Save, ChevronDown, ChevronRight, Database, Code, Settings, Plus, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { VisualizationType } from "@/types/auth";

type ResultUrlSource = 'contract' | 'fallback' | 'custom';

interface ServiceChainService {
  participant: string;
  service: string;
  params: string;
  configuration: string;
  pre: string[];
}

interface EmbeddedResource {
  service_index: number;
  resource_type: 'software' | 'data';
  resource_url: string;
  contract_url: string;
  resource_name: string | null;
  resource_description: string | null;
  provider: string | null;
  service_offering: string | null;
  parameters: Array<{ paramName: string; paramValue: string; paramAction?: string }>;
  api_response_representation: Record<string, unknown>;
  visualization_type: VisualizationType | null;
  upload_url: string | null;
  upload_authorization: string | null;
  result_url_source: ResultUrlSource;
  custom_result_url: string | null;
  result_authorization: string | null;
  result_query_params: ResultQueryParam[];
}

interface ResultQueryParam {
  paramName: string;
  paramValue: string;
}

type ChainResultUrlSource = 'contract' | 'fallback' | 'custom';

interface ServiceChainData {
  id: string;
  catalog_id: string;
  contract_url: string;
  status: string | null;
  basis_information: Record<string, unknown> | null;
  llm_context?: string | null;
  services: ServiceChainService[] | null;
  is_visible: boolean;
  visualization_type?: VisualizationType | null;
  embedded_resources: EmbeddedResource[];
  fallback_result_url?: string | null;
  result_url_source?: string | null;
  custom_result_url?: string | null;
  result_authorization?: string | null;
  result_query_params?: ResultQueryParam[] | null;
}

interface ServiceChainDetailsModalProps {
  chain: ServiceChainData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (chain: ServiceChainData) => Promise<void>;
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
  { value: 'contract', label: 'From Contract', description: 'Use URL from API response representation' },
  { value: 'fallback', label: 'Fallback URL', description: 'Use fallback result URL from PDC configuration' },
  { value: 'custom', label: 'Custom URL', description: 'Specify a custom result URL' },
];

const CHAIN_RESULT_URL_SOURCE_OPTIONS: { value: ChainResultUrlSource; label: string; description: string }[] = [
  { value: 'contract', label: 'From Contract', description: 'Use representation.url from the last embedded resource (chain runtime behavior)' },
  { value: 'fallback', label: 'Fallback URL', description: 'Use fallback result URL from PDC configuration (chain runtime behavior)' },
  { value: 'custom', label: 'Custom URL', description: 'Manually set chain result URL, authorization, and query parameters (chain runtime behavior)' },
];

const ServiceChainDetailsModal = ({ chain, open, onOpenChange, onSave, isSaving }: ServiceChainDetailsModalProps) => {
  const [editedChain, setEditedChain] = useState<ServiceChainData | null>(null);
  const [expandedResources, setExpandedResources] = useState<Set<number>>(new Set());
  const [customActionInputs, setCustomActionInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (chain) {
      const cloned = typeof structuredClone === "function"
        ? structuredClone(chain)
        : JSON.parse(JSON.stringify(chain)) as ServiceChainData;
      setEditedChain(cloned);
      setExpandedResources(new Set());
      setCustomActionInputs({});
    }
  }, [chain]);

  if (!editedChain) return null;

  const basisInfo = editedChain.basis_information as { name?: string; description?: string; ecosystem?: string } | null;

  const toggleResource = (index: number) => {
    setExpandedResources(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const updateEmbeddedResource = (resourceIndex: number, updates: Partial<EmbeddedResource>) => {
    const newResources = [...editedChain.embedded_resources];
    newResources[resourceIndex] = { ...newResources[resourceIndex], ...updates };
    setEditedChain({ ...editedChain, embedded_resources: newResources });
  };

  const parseActions = (actionString: unknown): string[] => {
    if (typeof actionString !== 'string' || !actionString.trim()) return [];
    return actionString.split(/\s+/).filter(Boolean);
  };

  const formatActions = (actions: string[]): string => {
    return actions.filter(Boolean).join(' ');
  };

  const handleActionToggle = (resourceIndex: number, paramIndex: number, action: string, checked: boolean) => {
    const resource = editedChain.embedded_resources[resourceIndex];
    const newParams = [...resource.parameters];
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
    
    updateEmbeddedResource(resourceIndex, { parameters: newParams });
  };

  const handleAddCustomAction = (resourceIndex: number, paramIndex: number) => {
    const key = `${resourceIndex}-${paramIndex}`;
    const customAction = customActionInputs[key]?.trim();
    if (!customAction) return;
    
    const formattedAction = customAction.startsWith('#') ? customAction : `#${customAction}`;
    
    const resource = editedChain.embedded_resources[resourceIndex];
    const newParams = [...resource.parameters];
    const currentActions = parseActions(newParams[paramIndex]?.paramAction);
    
    if (!currentActions.includes(formattedAction)) {
      currentActions.push(formattedAction);
      newParams[paramIndex] = {
        ...newParams[paramIndex],
        paramAction: formatActions(currentActions)
      };
      updateEmbeddedResource(resourceIndex, { parameters: newParams });
    }
    
    setCustomActionInputs(prev => ({ ...prev, [key]: '' }));
  };

  const handleRemoveAction = (resourceIndex: number, paramIndex: number, action: string) => {
    const resource = editedChain.embedded_resources[resourceIndex];
    const newParams = [...resource.parameters];
    const currentActions = parseActions(newParams[paramIndex]?.paramAction);
    const updatedActions = currentActions.filter(a => a !== action);
    
    newParams[paramIndex] = {
      ...newParams[paramIndex],
      paramAction: formatActions(updatedActions) || undefined
    };
    
    updateEmbeddedResource(resourceIndex, { parameters: newParams });
  };

  const handleParamValueChange = (resourceIndex: number, paramIndex: number, value: string) => {
    const resource = editedChain.embedded_resources[resourceIndex];
    const newParams = [...resource.parameters];
    newParams[paramIndex] = { ...newParams[paramIndex], paramValue: value };
    updateEmbeddedResource(resourceIndex, { parameters: newParams });
  };

  const handleSave = async () => {
    if (editedChain) {
      await onSave(editedChain);
    }
  };

  const getServiceForResource = (serviceIndex: number): ServiceChainService | null => {
    if (!editedChain.services || serviceIndex >= editedChain.services.length) return null;
    return editedChain.services[serviceIndex];
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden [&>button]:hidden"
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Service Chain Details</DialogTitle>
          <DialogDescription>
            Configure service chain and its embedded resources
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2 -mr-2">
          <div className="space-y-6 py-4 pr-2">
            {/* Basic Information */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Basic Information</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Catalog ID (read-only)</Label>
                  <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 py-2 text-sm font-mono text-muted-foreground">
                    {editedChain.catalog_id}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Status</Label>
                  <Badge variant={editedChain.status === 'active' ? 'default' : 'secondary'}>
                    {editedChain.status || 'unknown'}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={basisInfo?.name || ''}
                    onChange={(e) => setEditedChain({
                      ...editedChain,
                      basis_information: {
                        ...editedChain.basis_information,
                        name: e.target.value
                      }
                    })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Visible</Label>
                  <Switch
                    checked={editedChain.is_visible}
                    onCheckedChange={(c) => setEditedChain({ ...editedChain, is_visible: c })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={basisInfo?.description || ''}
                  onChange={(e) => setEditedChain({
                    ...editedChain,
                    basis_information: {
                      ...editedChain.basis_information,
                      description: e.target.value
                    }
                  })}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>LLM Result Context (Optional)</Label>
                <Textarea
                  value={editedChain.llm_context || ''}
                  onChange={(e) => setEditedChain({ ...editedChain, llm_context: e.target.value || null })}
                  rows={3}
                  placeholder="Explain business/industry context for this service-chain analytics result. This text will be appended to the result-page LLM prompt."
                />
                <p className="text-xs text-muted-foreground">
                  Chart keyword hints to force type: <code>bar chart</code>, <code>line chart</code>, <code>area chart</code>, <code>scatter</code>, <code>pie chart</code>, <code>radial</code>, <code>treemap</code>, <code>network</code>, <code>map</code>. If none is mentioned, the model auto-selects.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Contract URL (read-only)</Label>
                <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 py-2 text-xs font-mono text-muted-foreground overflow-hidden">
                  <span className="truncate">{editedChain.contract_url}</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Service Chain Visualization Type */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Chain Settings</h3>
              
              <div className="space-y-2">
                <Label>Visualization Type</Label>
                <Select
                  value={editedChain.visualization_type || 'data_api'}
                  onValueChange={(v) => setEditedChain({ 
                    ...editedChain, 
                    visualization_type: v as VisualizationType 
                  })}
                >
                  <SelectTrigger className="w-48">
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
            </div>

            <Separator />

            {/* Result URL Configuration */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Chain Result URL Configuration</h3>
              <p className="text-xs text-muted-foreground">
                This controls the final result URL used at runtime for the whole service chain.
              </p>

              <div className="space-y-2">
                <Label>Chain Result URL Source</Label>
                <Select
                  value={editedChain.result_url_source || 'contract'}
                  onValueChange={(v) => setEditedChain({
                    ...editedChain,
                    result_url_source: v as ChainResultUrlSource,
                  })}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHAIN_RESULT_URL_SOURCE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {CHAIN_RESULT_URL_SOURCE_OPTIONS.find(o => o.value === (editedChain.result_url_source || 'contract'))?.description}
                </p>
              </div>

              {/* Custom URL input */}
              {editedChain.result_url_source === 'custom' && (
                <div className="space-y-2">
                  <Label>Custom Chain Result URL</Label>
                  <Input
                    value={editedChain.custom_result_url || ''}
                    onChange={(e) => setEditedChain({ ...editedChain, custom_result_url: e.target.value || null })}
                    placeholder="https://api.example.com/results"
                  />
                </div>
              )}

              {/* Authorization - show for custom and fallback */}
              {(editedChain.result_url_source === 'custom' || editedChain.result_url_source === 'fallback') && (
                <div className="space-y-2">
                  <Label>Chain Result Authorization</Label>
                  <Input
                    value={editedChain.result_authorization || ''}
                    onChange={(e) => setEditedChain({ ...editedChain, result_authorization: e.target.value || null })}
                    placeholder="Bearer <token>"
                    type="password"
                  />
                  <p className="text-xs text-muted-foreground">
                    You can enter <code>Bearer your-token</code> or just the raw token; the gateway will normalize it.
                  </p>
                </div>
              )}

              {/* Query Parameters */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Chain Query Parameters</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const params = [...(editedChain.result_query_params || [])];
                      params.push({ paramName: '', paramValue: '' });
                      setEditedChain({ ...editedChain, result_query_params: params });
                    }}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Parameter
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Add query parameters for the result URL. Use <code className="bg-muted px-1 rounded">#genSessionId</code> as value to inject the session ID.
                </p>

                {(editedChain.result_query_params || []).length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No query parameters configured.</p>
                ) : (
                  <div className="space-y-2">
                    {(editedChain.result_query_params || []).map((param, paramIdx) => (
                      <div key={paramIdx} className="flex items-center gap-2">
                        <Input
                          value={param.paramName}
                          onChange={(e) => {
                            const params = [...(editedChain.result_query_params || [])];
                            params[paramIdx] = { ...params[paramIdx], paramName: e.target.value };
                            setEditedChain({ ...editedChain, result_query_params: params });
                          }}
                          placeholder="Parameter name"
                          className="flex-1"
                        />
                        <Input
                          value={param.paramValue}
                          onChange={(e) => {
                            const params = [...(editedChain.result_query_params || [])];
                            params[paramIdx] = { ...params[paramIdx], paramValue: e.target.value };
                            setEditedChain({ ...editedChain, result_query_params: params });
                          }}
                          placeholder="Value (e.g. #genSessionId)"
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const params = [...(editedChain.result_query_params || [])];
                            params.splice(paramIdx, 1);
                            setEditedChain({ ...editedChain, result_query_params: params });
                          }}
                        >
                          <X className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <Separator />
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Embedded Resources ({editedChain.embedded_resources.length})
              </h3>
              <p className="text-xs text-muted-foreground">
                Resources extracted from services in this chain. Each resource can be configured individually.
              </p>

              {editedChain.embedded_resources.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No embedded resources extracted yet.</p>
                    <p className="text-xs mt-1">Re-extract this service chain to fetch resource details.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {editedChain.embedded_resources.map((resource, index) => {
                    const service = getServiceForResource(resource.service_index);
                    const isExpanded = expandedResources.has(index);
                    
                    return (
                      <Collapsible key={index} open={isExpanded} onOpenChange={() => toggleResource(index)}>
                        <Card>
                          <CardHeader className="py-3 px-4">
                            <CollapsibleTrigger className="w-full">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                  )}
                                  <Badge variant={resource.resource_type === 'software' ? 'default' : 'secondary'}>
                                    {resource.resource_type}
                                  </Badge>
                                  <CardTitle className="text-sm font-medium">
                                    {resource.resource_name || 'Unnamed Resource'}
                                  </CardTitle>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-xs">
                                    Step {resource.service_index + 1}
                                  </Badge>
                                  {resource.visualization_type && (
                                    <Badge variant="outline" className="text-xs">
                                      {resource.visualization_type}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </CollapsibleTrigger>
                          </CardHeader>
                          
                          <CollapsibleContent>
                            <CardContent className="pt-0 pb-4 px-4 space-y-4">
                              {/* Service Reference */}
                              {service && (
                                <div className="p-3 rounded-lg bg-muted/50 text-xs">
                                  <p className="text-muted-foreground">
                                    <span className="font-medium">Service URL:</span>{' '}
                                    <span className="font-mono">{service.service}</span>
                                  </p>
                                </div>
                              )}

                              {/* Resource Basic Info */}
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label>Resource Name</Label>
                                  <Input
                                    value={resource.resource_name || ''}
                                    onChange={(e) => updateEmbeddedResource(index, { resource_name: e.target.value })}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Provider</Label>
                                  <Input
                                    value={resource.provider || ''}
                                    onChange={(e) => updateEmbeddedResource(index, { provider: e.target.value })}
                                  />
                                </div>
                              </div>

                              <div className="space-y-2">
                                <Label>Description</Label>
                                <Textarea
                                  value={resource.resource_description || ''}
                                  onChange={(e) => updateEmbeddedResource(index, { resource_description: e.target.value })}
                                  rows={2}
                                />
                              </div>

                              <div className="space-y-2">
                                <Label className="text-muted-foreground">Resource URL (read-only)</Label>
                                <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 py-2 text-xs font-mono text-muted-foreground">
                                  <span className="truncate">{resource.resource_url}</span>
                                </div>
                              </div>

                              {/* Visualization Type for Data Resources */}
                              {resource.resource_type === 'data' && (
                                <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                                  <h4 className="text-sm font-medium">Data Configuration</h4>
                                  
                                  <div className="space-y-2">
                                    <Label>Visualization Type</Label>
                                    <Select
                                      value={resource.visualization_type || 'data_api'}
                                      onValueChange={(v) => updateEmbeddedResource(index, { visualization_type: v as VisualizationType })}
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

                                  {/* Upload Configuration */}
                                  {resource.visualization_type === 'upload_document' && (
                                    <div className="space-y-3">
                                      <div className="space-y-2">
                                        <Label>Upload URL</Label>
                                        <Input
                                          value={resource.upload_url || ''}
                                          onChange={(e) => updateEmbeddedResource(index, { upload_url: e.target.value || null })}
                                          placeholder="https://api.example.com/upload"
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <Label>Upload Authorization</Label>
                                        <Input
                                          value={resource.upload_authorization || ''}
                                          onChange={(e) => updateEmbeddedResource(index, { upload_authorization: e.target.value || null })}
                                          placeholder="Bearer <token>"
                                          type="password"
                                        />
                                      </div>
                                    </div>
                                  )}

                                  {/* Embedded Resource Result URL Configuration (metadata) */}
                                  {resource.visualization_type === 'data_api' && (
                                    <div className="space-y-3">
                                      <div className="space-y-2">
                                        <Label>Embedded Resource Result URL Source</Label>
                                        <Select
                                          value={resource.result_url_source || 'contract'}
                                          onValueChange={(v) => updateEmbeddedResource(index, { result_url_source: v as ResultUrlSource })}
                                        >
                                          <SelectTrigger>
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {RESULT_URL_SOURCE_OPTIONS.map((opt) => (
                                              <SelectItem key={opt.value} value={opt.value}>
                                                {opt.label}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                        <p className="text-xs text-muted-foreground">
                                          {RESULT_URL_SOURCE_OPTIONS.find(o => o.value === resource.result_url_source)?.description}
                                        </p>
                                        <p className="text-xs text-amber-600">
                                          Metadata only. Final service-chain runtime result URL is controlled by "Chain Result URL Source" above.
                                        </p>
                                      </div>

                                      {resource.result_url_source === 'custom' && (
                                        <div className="space-y-2">
                                          <Label>Custom Embedded Result URL</Label>
                                          <Input
                                            value={resource.custom_result_url || ''}
                                            onChange={(e) => updateEmbeddedResource(index, { custom_result_url: e.target.value || null })}
                                            placeholder="https://api.example.com/results"
                                          />
                                        </div>
                                      )}

                                      <div className="space-y-2">
                                        <Label>Embedded Result Authorization</Label>
                                        <Input
                                          value={resource.result_authorization || ''}
                                          onChange={(e) => updateEmbeddedResource(index, { result_authorization: e.target.value || null })}
                                          placeholder="Bearer <token>"
                                          type="password"
                                        />
                                        <p className="text-xs text-muted-foreground">
                                          You can enter <code>Bearer your-token</code> or just the raw token; the gateway will normalize it.
                                        </p>
                                      </div>

                                      <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                          <Label>Embedded Result Query Parameters</Label>
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                              const params = [...(resource.result_query_params || [])];
                                              params.push({ paramName: '', paramValue: '' });
                                              updateEmbeddedResource(index, { result_query_params: params });
                                            }}
                                          >
                                            <Plus className="h-3 w-3 mr-1" />
                                            Add Parameter
                                          </Button>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                          Stored with the embedded resource metadata. Use <code className="bg-muted px-1 rounded">#genSessionId</code> to inject the current session ID.
                                        </p>

                                        {(resource.result_query_params || []).length === 0 ? (
                                          <p className="text-xs text-muted-foreground italic">No embedded query parameters configured.</p>
                                        ) : (
                                          <div className="space-y-2">
                                            {(resource.result_query_params || []).map((param, paramIdx) => (
                                              <div key={paramIdx} className="flex items-center gap-2">
                                                <Input
                                                  value={param.paramName}
                                                  onChange={(e) => {
                                                    const params = [...(resource.result_query_params || [])];
                                                    params[paramIdx] = { ...params[paramIdx], paramName: e.target.value };
                                                    updateEmbeddedResource(index, { result_query_params: params });
                                                  }}
                                                  placeholder="Parameter name"
                                                  className="flex-1"
                                                />
                                                <Input
                                                  value={param.paramValue}
                                                  onChange={(e) => {
                                                    const params = [...(resource.result_query_params || [])];
                                                    params[paramIdx] = { ...params[paramIdx], paramValue: e.target.value };
                                                    updateEmbeddedResource(index, { result_query_params: params });
                                                  }}
                                                  placeholder="Value"
                                                  className="flex-1"
                                                />
                                                <Button
                                                  type="button"
                                                  variant="ghost"
                                                  size="sm"
                                                  onClick={() => {
                                                    const params = [...(resource.result_query_params || [])];
                                                    params.splice(paramIdx, 1);
                                                    updateEmbeddedResource(index, { result_query_params: params });
                                                  }}
                                                >
                                                  <X className="h-4 w-4 text-destructive" />
                                                </Button>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Parameters */}
                              {resource.parameters.length > 0 && (
                                <div className="space-y-3">
                                  <h4 className="text-sm font-medium">Parameters</h4>
                                  {resource.parameters.map((param, paramIndex) => {
                                    const currentActions = parseActions(param.paramAction);
                                    const customKey = `${index}-${paramIndex}`;
                                    
                                    return (
                                      <div key={paramIndex} className="p-3 border rounded-lg space-y-3">
                                        <div className="grid grid-cols-2 gap-3">
                                          <div className="space-y-1">
                                            <Label className="text-xs text-muted-foreground">Name (read-only)</Label>
                                            <div className="h-9 flex items-center px-3 text-sm font-mono bg-muted rounded-md">
                                              {param.paramName}
                                            </div>
                                          </div>
                                          <div className="space-y-1">
                                            <Label className="text-xs">Default Value</Label>
                                            <Input
                                              value={param.paramValue}
                                              onChange={(e) => handleParamValueChange(index, paramIndex, e.target.value)}
                                              placeholder="Enter value..."
                                              className="h-9"
                                            />
                                          </div>
                                        </div>
                                        
                                        {/* Actions */}
                                        <div className="space-y-2">
                                          <Label className="text-xs">Actions</Label>
                                          <div className="flex flex-wrap gap-2">
                                            {PARAM_ACTION_OPTIONS.map((action) => (
                                              <div key={action.value} className="flex items-center gap-1">
                                                <Checkbox
                                                  id={`action-${index}-${paramIndex}-${action.value}`}
                                                  checked={currentActions.includes(action.value)}
                                                  onCheckedChange={(checked) => 
                                                    handleActionToggle(index, paramIndex, action.value, !!checked)
                                                  }
                                                />
                                                <Label
                                                  htmlFor={`action-${index}-${paramIndex}-${action.value}`}
                                                  className="text-xs font-mono cursor-pointer"
                                                >
                                                  {action.label}
                                                </Label>
                                              </div>
                                            ))}
                                          </div>
                                          
                                          {/* Custom Actions */}
                                          {currentActions.filter(a => !PARAM_ACTION_OPTIONS.find(o => o.value === a)).map((action) => (
                                            <Badge key={action} variant="secondary" className="gap-1">
                                              <span className="font-mono text-xs">{action}</span>
                                              <X
                                                className="h-3 w-3 cursor-pointer hover:text-destructive"
                                                onClick={() => handleRemoveAction(index, paramIndex, action)}
                                              />
                                            </Badge>
                                          ))}
                                          
                                          {/* Add Custom Action */}
                                          <div className="flex gap-2 mt-2">
                                            <Input
                                              value={customActionInputs[customKey] || ''}
                                              onChange={(e) => setCustomActionInputs(prev => ({ ...prev, [customKey]: e.target.value }))}
                                              placeholder="Add custom action..."
                                              className="h-8 text-xs"
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  e.preventDefault();
                                                  handleAddCustomAction(index, paramIndex);
                                                }
                                              }}
                                            />
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              onClick={() => handleAddCustomAction(index, paramIndex)}
                                              className="h-8"
                                            >
                                              <Plus className="h-3 w-3" />
                                            </Button>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </CardContent>
                          </CollapsibleContent>
                        </Card>
                      </Collapsible>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 border-t pt-4">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>Saving...</>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ServiceChainDetailsModal;
