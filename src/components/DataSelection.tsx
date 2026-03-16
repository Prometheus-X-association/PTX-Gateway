import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { Upload, Database, Link, User, Check, X, Settings, FileJson, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CenterFocusCarousel from "./CenterFocusCarousel";
import DocumentUploadZone, { UploadConfig } from "./DocumentUploadZone";
import ManualJsonInput from "./ManualJsonInput";
import { useProcessSession } from "@/contexts/ProcessSessionContext";
import { 
  DataResource, 
  AnalyticsOption,
  ServiceChainEmbeddedResource,
  getQueryParamNames, 
  getParamValuesMap,
  getParamActionsMap as getParamActionsMapFromParams,
} from "@/types/dataspace";
import { isSessionIdPlaceholder } from "@/utils/paramSanitizer";

interface ManualJsonResource {
  id: string;
  name: string;
  provider: string;
  description: string;
  queryParams: string[];
  fullData: DataResource;
}

interface DataSelectionProps {
  onNext: (data: { 
    files: File[]; 
    apis: string[]; 
    textData: string;
    customApiUrl: string;
    apiParams: Record<string, Record<string, string>>;
    selectedDataResources: DataResource[];
    uploadConfig?: UploadConfig;
    uploadResourceParams?: Record<string, string>;
    manualJsonData?: string;
    serviceChainResourceParams?: Record<string, Record<string, string>>;
  }) => void;
  onBack: () => void;
  dataResources: DataResource[];
  selectedAnalytics?: AnalyticsOption | null;
  isDebugMode?: boolean;
}

// File upload resource (upload_file: true)
export interface UploadResource {
  id: string;
  name: string;
  provider: string;
  description: string;
  queryParams: string[];
  fullData: DataResource;
}

// API resource (upload_file: false)
interface ApiResource {
  id: string;
  name: string;
  provider: string;
  description: string;
  queryParams: string[];
  fullData: DataResource;
}

const DataSelection = ({ onNext, onBack, dataResources, selectedAnalytics, isDebugMode = false }: DataSelectionProps) => {
  const { sessionId } = useProcessSession();

  // State for debug-mode result query param overrides (keyed by resource_url)
  const [resultQueryParamOverrides, setResultQueryParamOverrides] = useState<Record<string, Array<{ paramName: string; paramValue: string }>>>({});
  
  // Helper to convert embedded resource to DataResource format
  const embeddedToDataResource = (embedded: ServiceChainEmbeddedResource): DataResource => ({
    id: `embedded-${embedded.service_index}-${embedded.resource_url}`,
    resource_url: embedded.resource_url,
    contract_url: embedded.contract_url,
    resource_name: embedded.resource_name,
    resource_description: embedded.resource_description,
    resource_type: 'data',
    provider: embedded.provider,
    service_offering: embedded.service_offering,
    parameters: embedded.parameters,
    param_actions: [],
    api_response_representation: embedded.api_response_representation,
    upload_file: embedded.visualization_type === 'upload_document',
    is_visible: true,
    visualization_type: embedded.visualization_type,
    organization_id: null,
    upload_url: embedded.upload_url,
    upload_authorization: embedded.upload_authorization,
    result_url_source: embedded.result_url_source,
    custom_result_url: embedded.custom_result_url,
    result_authorization: embedded.result_authorization,
    result_query_params: [],
  });
  
  // Determine which data resources to use based on selected analytics
  const effectiveDataResources = useMemo(() => {
    // If a service chain is selected, use only the FIRST embedded data resource from the chain
    // (the one with the lowest service_index that initiates the flow)
    if (selectedAnalytics?.type === "serviceChain") {
      const embeddedResources = selectedAnalytics.data.embedded_resources || [];
      // Filter to only data-type resources
      const dataEmbedded = embeddedResources.filter(r => r.resource_type === 'data');
      
      if (dataEmbedded.length === 0) {
        return [];
      }
      
      // Find the data resource with the lowest service_index (first in the chain)
      const firstDataResource = dataEmbedded.reduce((first, current) => 
        current.service_index < first.service_index ? current : first
      );
      
      // Only return the first data resource
      const converted = [embeddedToDataResource(firstDataResource)];
      return converted;
    }
    // Otherwise use the provided data resources list
    return dataResources;
  }, [selectedAnalytics, dataResources]);
  
  // Get data resources - categorize by visualization_type
  const { uploadResources, apiResources, manualJsonResources } = useMemo(() => {
    const uploads: UploadResource[] = [];
    const apis: ApiResource[] = [];
    const manualJson: ManualJsonResource[] = [];

    effectiveDataResources.forEach((resource) => {
      const queryParamNames = getQueryParamNames(resource.parameters);
      const item = {
        id: resource.resource_url,
        name: resource.resource_name || "Unnamed Resource",
        provider: resource.provider || "Unknown Provider",
        description: resource.resource_description || "No description",
        queryParams: queryParamNames,
        fullData: resource,
      };

      // Use visualization_type to determine resource category
      if (resource.visualization_type === 'upload_document') {
        uploads.push(item);
      } else if (resource.visualization_type === 'manual_json_input') {
        manualJson.push(item);
      } else {
        // Default to API for 'data_api' or null visualization_type
        apis.push(item);
      }
    });

    return { uploadResources: uploads, apiResources: apis, manualJsonResources: manualJson };
  }, [effectiveDataResources]);

  // State for selected upload resource
  const [selectedUploadResource, setSelectedUploadResource] = useState<UploadResource | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadConfig, setUploadConfig] = useState<UploadConfig | null>(null);
  const [uploadSuccessful, setUploadSuccessful] = useState(false);
  
  // Cache for upload state per resource (preserves data when deselecting/reselecting)
  const [uploadStateCache, setUploadStateCache] = useState<Record<string, {
    files: File[];
    uploadConfig: UploadConfig | null;
    uploadSuccessful: boolean;
    params: Record<string, string>;
  }>>({});
  
  // State for upload resource query params (from dataResource config)
  const [uploadResourceParams, setUploadResourceParams] = useState<Record<string, string>>({});
  const [showUploadParamsDialog, setShowUploadParamsDialog] = useState(false);
  const [pendingUploadResource, setPendingUploadResource] = useState<UploadResource | null>(null);
  const [isEditingParams, setIsEditingParams] = useState(false);
  const [previousParams, setPreviousParams] = useState<Record<string, string>>({});
  
  // State for selected APIs
  const [selectedApis, setSelectedApis] = useState<string[]>([]);
  const [apiParams, setApiParams] = useState<Record<string, Record<string, string>>>({});
  
  // Flag to track if we've initialized service chain auto-selection
  const [serviceChainInitialized, setServiceChainInitialized] = useState(false);
  
  // State for service chain resource params (all embedded resources including software)
  const [serviceChainResourceParams, setServiceChainResourceParams] = useState<Record<string, Record<string, string>>>({});

  // Auto-select all API resources when service chain is selected (they're required for the flow)
  // Also build serviceChainResourceParams from ALL embedded resources (including software)
  useEffect(() => {
    if (selectedAnalytics?.type === "serviceChain" && !serviceChainInitialized) {
      const embeddedResources = selectedAnalytics.data.embedded_resources || [];
      
      // Build params for ALL embedded resources (software and data)
      const allResourceParams: Record<string, Record<string, string>> = {};
      embeddedResources.forEach(resource => {
        const prefillParams = getParamValuesMap(resource.parameters);
        const resolvedParams: Record<string, string> = {};
        
        for (const [key, value] of Object.entries(prefillParams)) {
          if (isSessionIdPlaceholder(value)) {
            resolvedParams[key] = sessionId;
          } else {
            resolvedParams[key] = value;
          }
        }
        
        // Only include if there are params
        if (Object.keys(resolvedParams).length > 0) {
          allResourceParams[resource.resource_url] = resolvedParams;
        }
      });
      setServiceChainResourceParams(allResourceParams);
      
      // Also auto-select API resources for data selection UI
      if (apiResources.length > 0) {
        const allApiIds = apiResources.map(api => api.id);
        setSelectedApis(allApiIds);
        
        // Pre-fill params for each API resource (for UI display)
        const initialParams: Record<string, Record<string, string>> = {};
        apiResources.forEach(api => {
          const prefillParams = getParamValuesMap(api.fullData.parameters);
          const resolvedParams: Record<string, string> = {};
          
          for (const [key, value] of Object.entries(prefillParams)) {
            if (isSessionIdPlaceholder(value)) {
              resolvedParams[key] = sessionId;
            } else {
              resolvedParams[key] = value;
            }
          }
          
          initialParams[api.id] = resolvedParams;
        });
        setApiParams(initialParams);
      }
      
      setServiceChainInitialized(true);
    }
  }, [selectedAnalytics, apiResources, serviceChainInitialized, sessionId]);

  // Reset initialization flag and service chain params when analytics selection changes
  useEffect(() => {
    if (selectedAnalytics?.type !== "serviceChain") {
      setServiceChainInitialized(false);
      setServiceChainResourceParams({});
    }
  }, [selectedAnalytics]);

  // State for manual JSON input
  const [selectedManualJsonResource, setSelectedManualJsonResource] = useState<ManualJsonResource | null>(null);
  const [manualJsonData, setManualJsonData] = useState<string>("");

  // State for description dialog (custom modal)
  const [descriptionDialog, setDescriptionDialog] = useState<{ open: boolean; title: string; description: string }>({
    open: false,
    title: "",
    description: "",
  });
  
  // State for custom API
  const [customApiUrl, setCustomApiUrl] = useState("");

  // Truncation detection for upload resources descriptions
  const descriptionRefs = useRef<Map<string, HTMLParagraphElement>>(new Map());
  const [truncatedItems, setTruncatedItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    const checkTruncation = () => {
      const newTruncated = new Set<string>();
      descriptionRefs.current.forEach((el, id) => {
        if (el && el.scrollHeight > el.clientHeight) {
          newTruncated.add(id);
        }
      });
      setTruncatedItems(newTruncated);
    };

    const timer = setTimeout(checkTruncation, 100);
    window.addEventListener('resize', checkTruncation);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', checkTruncation);
    };
  }, [uploadResources]);

  const setDescriptionRef = (id: string) => (el: HTMLParagraphElement | null) => {
    if (el) {
      descriptionRefs.current.set(id, el);
    } else {
      descriptionRefs.current.delete(id);
    }
  };

  const openDescriptionDialog = (e: React.MouseEvent, title: string, description: string) => {
    e.stopPropagation();
    setDescriptionDialog({ open: true, title, description });
  };

  // Upload config handler (for representation-based config)
  const handleUploadConfigChange = useCallback((config: UploadConfig) => {
    setUploadConfig(config);
  }, []);

  // Get pre-filled params for a resource
  const getPrefillParamsResolved = (resource: UploadResource): Record<string, string> => {
    const prefillParams = getParamValuesMap(resource.fullData.parameters);
    const resolvedParams: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(prefillParams)) {
      if (isSessionIdPlaceholder(value)) {
        resolvedParams[key] = sessionId;
      } else {
        resolvedParams[key] = value;
      }
    }
    
    return resolvedParams;
  };

  // Handle upload resource selection - toggle selection
  const selectUploadResource = (resource: UploadResource) => {
    // If clicking on already selected resource, deselect it (but cache current state)
    if (selectedUploadResource?.id === resource.id) {
      // Cache current state before deselecting
      setUploadStateCache(prev => ({
        ...prev,
        [resource.id]: {
          files,
          uploadConfig,
          uploadSuccessful,
          params: uploadResourceParams,
        }
      }));
      setSelectedUploadResource(null);
      setFiles([]);
      setUploadConfig(null);
      setUploadResourceParams({});
      setUploadSuccessful(false);
      return;
    }
    
    // Check if we have cached state for this resource
    const cachedState = uploadStateCache[resource.id];
    
    if (cachedState) {
      // Restore cached state directly
      setSelectedUploadResource(resource);
      setFiles(cachedState.files);
      setUploadConfig(cachedState.uploadConfig);
      setUploadSuccessful(cachedState.uploadSuccessful);
      setUploadResourceParams(cachedState.params);
      return;
    }
    
    if (resource.queryParams.length > 0 && isDebugMode) {
      // Has queryParams and debug mode - show dialog first (new selection)
      setPendingUploadResource(resource);
      setIsEditingParams(false);
      
      // Get pre-filled params
      const prefillParams = getPrefillParamsResolved(resource);
      setUploadResourceParams(prefillParams);
      setShowUploadParamsDialog(true);
    } else if (resource.queryParams.length > 0) {
      // Has queryParams but public mode - just pre-fill and select directly
      const prefillParams = getPrefillParamsResolved(resource);
      setUploadResourceParams(prefillParams);
      confirmUploadResourceSelection(resource, prefillParams);
    } else {
      // No queryParams - select directly
      confirmUploadResourceSelection(resource);
    }
  };

  // Open params dialog for editing existing selection
  const openParamsForEditing = (resource: UploadResource) => {
    setPendingUploadResource(resource);
    setIsEditingParams(true);
    setPreviousParams({ ...uploadResourceParams });
    setShowUploadParamsDialog(true);
  };

  const confirmUploadResourceSelection = (resource: UploadResource, params?: Record<string, string>) => {
    setSelectedUploadResource(resource);
    if (params !== undefined) {
      setUploadResourceParams(params);
    }
    setFiles([]);
    setUploadConfig(null);
    setUploadSuccessful(false);
    setShowUploadParamsDialog(false);
    setPendingUploadResource(null);
    setIsEditingParams(false);
  };

  const handleUploadParamsSave = () => {
    if (pendingUploadResource) {
      if (isEditingParams) {
        setShowUploadParamsDialog(false);
        setPendingUploadResource(null);
        setIsEditingParams(false);
      } else {
        confirmUploadResourceSelection(pendingUploadResource, uploadResourceParams);
      }
    }
  };

  const handleUploadParamsCancel = () => {
    setShowUploadParamsDialog(false);
    setPendingUploadResource(null);
    if (isEditingParams) {
      setUploadResourceParams(previousParams);
    } else {
      setUploadResourceParams({});
    }
    setIsEditingParams(false);
  };

  // API handling - toggle selection
  const handleApiSelect = (item: { id: string; name: string; provider: string; description: string; queryParams: string[] }) => {
    const isCurrentlySelected = selectedApis.includes(item.id);
    
    if (isCurrentlySelected) {
      setSelectedApis((prev) => prev.filter((id) => id !== item.id));
      setApiParams((params) => {
        const newParams = { ...params };
        delete newParams[item.id];
        return newParams;
      });
    } else {
      setSelectedApis((prev) => [...prev, item.id]);
    }
  };

  const handleApiParamsChange = (itemId: string, params: Record<string, string>) => {
    setApiParams((prev) => ({
      ...prev,
      [itemId]: params,
    }));
    
    // Also update serviceChainResourceParams if this is a service chain
    if (selectedAnalytics?.type === "serviceChain") {
      setServiceChainResourceParams((prev) => ({
        ...prev,
        [itemId]: params,
      }));
    }
  };

  // Handle manual JSON resource selection - toggle
  const selectManualJsonResource = (resource: ManualJsonResource) => {
    if (selectedManualJsonResource?.id === resource.id) {
      // Deselect
      setSelectedManualJsonResource(null);
      setManualJsonData("");
    } else {
      // Select new resource
      setSelectedManualJsonResource(resource);
      setManualJsonData("");
    }
  };

  // Check if manual JSON is valid
  const isManualJsonValid = useCallback((jsonString: string): boolean => {
    if (!jsonString.trim()) return false;
    try {
      JSON.parse(jsonString);
      return true;
    } catch {
      return false;
    }
  }, []);

  // Get selected data resources for next step (with debug overrides applied)
  const getSelectedDataResources = (): DataResource[] => {
    const resources: DataResource[] = [];
    
    const applyOverrides = (resource: DataResource): DataResource => {
      const overrides = resultQueryParamOverrides[resource.resource_url];
      if (overrides) {
        return { ...resource, result_query_params: overrides };
      }
      return resource;
    };
    
    if (selectedUploadResource && files.length > 0) {
      resources.push(applyOverrides(selectedUploadResource.fullData));
    }
    
    selectedApis.forEach((apiId) => {
      const api = apiResources.find((a) => a.id === apiId);
      if (api) {
        resources.push(applyOverrides(api.fullData));
      }
    });

    // Include manual JSON resource if selected and has valid data
    if (selectedManualJsonResource && isManualJsonValid(manualJsonData)) {
      resources.push(applyOverrides(selectedManualJsonResource.fullData));
    }
    
    return resources;
  };

  // Determine if user can proceed
  const uploadDataReady = selectedUploadResource ? (files.length > 0 && uploadSuccessful) : false;
  const manualJsonReady = selectedManualJsonResource ? isManualJsonValid(manualJsonData) : false;
  const hasData = uploadDataReady || selectedApis.length > 0 || customApiUrl.trim() !== "" || manualJsonReady;

  return (
    <div className="animate-fade-in">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold mb-2">
          Select Your <span className="gradient-text">Data Sources</span>
        </h2>
        <p className="text-muted-foreground">
          Upload documents or connect to data APIs from the dataspace
        </p>
      </div>

      <div className="max-w-3xl mx-auto space-y-8 mb-8">
        {/* Upload Documents Section - Only show if there are upload resources */}
        {uploadResources.length > 0 && (
          <div className="space-y-6">
            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Upload className="w-5 h-5 text-primary" />
                Upload Documents
              </h3>
              
              {/* Upload Resource Selection */}
              <div className="space-y-3">
              {uploadResources.map((resource) => {
                  const isSelected = selectedUploadResource?.id === resource.id;
                  const hasParams = resource.queryParams.length > 0;
                  const params = resource.fullData.parameters || [];
                  const paramActionsMap = getParamActionsMapFromParams(params);
                  
                  return (
                    <div key={resource.id} className="space-y-3">
                      <div
                        onClick={() => selectUploadResource(resource)}
                        className={`analytics-card py-4 ${isSelected ? "selected" : ""}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-medium text-sm">{resource.name}</p>
                              {hasParams && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                  {resource.queryParams.length} params
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                              <User className="w-3 h-3" />
                              <span>{resource.provider}</span>
                            </div>
                            <p
                              ref={setDescriptionRef(`upload-${resource.id}`)}
                              className="text-xs text-muted-foreground line-clamp-2"
                            >
                              {resource.description}
                            </p>
                            {truncatedItems.has(`upload-${resource.id}`) && (
                              <button
                                onClick={(e) => openDescriptionDialog(e, resource.name, resource.description)}
                                className="text-xs text-primary hover:underline mt-1"
                              >
                                Read more
                              </button>
                            )}
                            
                            {/* Debug mode: show parameters with values */}
                            {isDebugMode && hasParams && (
                              <div className="mt-3 pt-3 border-t border-border/50">
                                <p className="text-[10px] font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                                  Parameters
                                </p>
                                <div className="space-y-1.5">
                                  {params.map((param, idx) => (
                                    <div key={idx} className="text-xs">
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono text-foreground/80">{param.paramName}</span>
                                        {param.paramAction && (
                                          <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                                            {param.paramAction}
                                          </span>
                                        )}
                                      </div>
                                      {param.paramValue && (
                                        <span className="text-muted-foreground text-[10px] font-mono ml-2">
                                          = {param.paramValue}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {/* Debug mode: show additional configuration */}
                            {isDebugMode && (
                              <div className="mt-2 space-y-1">
                                {resource.fullData.upload_url && (
                                  <p className="text-[10px] text-muted-foreground">
                                    <span className="font-medium">Upload URL:</span>{" "}
                                    <span className="font-mono break-all">{resource.fullData.upload_url}</span>
                                  </p>
                                )}
                                {resource.fullData.result_url_source && (
                                  <p className="text-[10px] text-muted-foreground">
                                    <span className="font-medium">Result Source:</span> {resource.fullData.result_url_source}
                                  </p>
                                )}
                              </div>
                            )}
                            
                            {/* Debug mode: editable result query params */}
                            {isDebugMode && isSelected && (
                              <div className="mt-3 pt-3 border-t border-border/50">
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                                    Result Query Parameters
                                  </p>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const current = resultQueryParamOverrides[resource.id] || resource.fullData.result_query_params || [];
                                      setResultQueryParamOverrides(prev => ({
                                        ...prev,
                                        [resource.fullData.resource_url]: [...current, { paramName: '', paramValue: '' }]
                                      }));
                                    }}
                                    className="flex items-center gap-1 text-[10px] text-primary hover:underline"
                                  >
                                    <Plus className="w-3 h-3" /> Add
                                  </button>
                                </div>
                                {(resultQueryParamOverrides[resource.fullData.resource_url] || resource.fullData.result_query_params || []).map((param, idx) => (
                                  <div key={idx} className="flex items-center gap-1 mb-1" onClick={(e) => e.stopPropagation()}>
                                    <Input
                                      value={param.paramName}
                                      onChange={(e) => {
                                        const current = [...(resultQueryParamOverrides[resource.fullData.resource_url] || resource.fullData.result_query_params || [])];
                                        current[idx] = { ...current[idx], paramName: e.target.value };
                                        setResultQueryParamOverrides(prev => ({ ...prev, [resource.fullData.resource_url]: current }));
                                      }}
                                      placeholder="Key"
                                      className="h-7 text-xs flex-1"
                                    />
                                    <Input
                                      value={param.paramValue}
                                      onChange={(e) => {
                                        const current = [...(resultQueryParamOverrides[resource.fullData.resource_url] || resource.fullData.result_query_params || [])];
                                        current[idx] = { ...current[idx], paramValue: e.target.value };
                                        setResultQueryParamOverrides(prev => ({ ...prev, [resource.fullData.resource_url]: current }));
                                      }}
                                      placeholder="Value or #genSessionId"
                                      className="h-7 text-xs flex-1"
                                    />
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const current = [...(resultQueryParamOverrides[resource.fullData.resource_url] || resource.fullData.result_query_params || [])];
                                        current.splice(idx, 1);
                                        setResultQueryParamOverrides(prev => ({ ...prev, [resource.fullData.resource_url]: current }));
                                      }}
                                      className="text-destructive hover:text-destructive/80 p-1"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                            
                            {/* Edit params button for selected resource with params - debug mode only */}
                            {isDebugMode && isSelected && hasParams && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openParamsForEditing(resource);
                                }}
                                className="flex items-center gap-1 text-xs text-primary hover:underline mt-2"
                              >
                                <Settings className="w-3 h-3" />
                                Edit parameters
                              </button>
                            )}
                          </div>
                          <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ${
                              isSelected
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted"
                            }`}
                          >
                            {isSelected && <Check className="w-4 h-4" />}
                          </div>
                        </div>
                      </div>

                      {/* File Upload Zone - directly after the selected resource */}
                      {isSelected && (
                        <DocumentUploadZone
                          resource={{
                            ...resource,
                            contract: resource.fullData.contract_url,
                            uploadUrl: resource.fullData.upload_url,
                            uploadAuthorization: resource.fullData.upload_authorization,
                            parameters: resource.fullData.parameters,
                          }}
                          files={files}
                          onFilesChange={setFiles}
                          onUploadConfigChange={handleUploadConfigChange}
                          paramValues={uploadResourceParams}
                          onParamValuesChange={setUploadResourceParams}
                          onUploadSuccess={() => setUploadSuccessful(true)}
                          onUploadReset={() => setUploadSuccessful(false)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Manual JSON Input Section */}
        {manualJsonResources.length > 0 && (
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <FileJson className="w-5 h-5 text-primary" />
              Manual JSON Input
            </h3>
            
            {/* Manual JSON Resource Selection */}
            <div className="space-y-3">
              {manualJsonResources.map((resource) => {
                const isSelected = selectedManualJsonResource?.id === resource.id;
                const hasParams = resource.queryParams.length > 0;
                const params = resource.fullData.parameters || [];
                
                return (
                  <div
                    key={resource.id}
                    onClick={() => selectManualJsonResource(resource)}
                    className={`analytics-card py-4 ${isSelected ? "selected" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium text-sm">{resource.name}</p>
                          {hasParams && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                              {resource.queryParams.length} params
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                          <User className="w-3 h-3" />
                          <span>{resource.provider}</span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {resource.description}
                        </p>
                        
                        {/* Debug mode: show parameters with values */}
                        {isDebugMode && hasParams && (
                          <div className="mt-3 pt-3 border-t border-border/50">
                            <p className="text-[10px] font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                              Parameters
                            </p>
                            <div className="space-y-1.5">
                              {params.map((param, idx) => (
                                <div key={idx} className="text-xs">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-foreground/80">{param.paramName}</span>
                                    {param.paramAction && (
                                      <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                                        {param.paramAction}
                                      </span>
                                    )}
                                  </div>
                                  {param.paramValue && (
                                    <span className="text-muted-foreground text-[10px] font-mono ml-2">
                                      = {param.paramValue}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {/* Debug mode: show additional configuration */}
                        {isDebugMode && resource.fullData.result_url_source && (
                          <div className="mt-2">
                            <p className="text-[10px] text-muted-foreground">
                              <span className="font-medium">Result Source:</span> {resource.fullData.result_url_source}
                            </p>
                          </div>
                        )}
                        
                        {/* Debug mode: editable result query params */}
                        {isDebugMode && isSelected && (
                          <div className="mt-3 pt-3 border-t border-border/50">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                                Result Query Parameters
                              </p>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const current = resultQueryParamOverrides[resource.fullData.resource_url] || resource.fullData.result_query_params || [];
                                  setResultQueryParamOverrides(prev => ({
                                    ...prev,
                                    [resource.fullData.resource_url]: [...current, { paramName: '', paramValue: '' }]
                                  }));
                                }}
                                className="flex items-center gap-1 text-[10px] text-primary hover:underline"
                              >
                                <Plus className="w-3 h-3" /> Add
                              </button>
                            </div>
                            {(resultQueryParamOverrides[resource.fullData.resource_url] || resource.fullData.result_query_params || []).map((param, idx) => (
                              <div key={idx} className="flex items-center gap-1 mb-1" onClick={(e) => e.stopPropagation()}>
                                <Input
                                  value={param.paramName}
                                  onChange={(e) => {
                                    const current = [...(resultQueryParamOverrides[resource.fullData.resource_url] || resource.fullData.result_query_params || [])];
                                    current[idx] = { ...current[idx], paramName: e.target.value };
                                    setResultQueryParamOverrides(prev => ({ ...prev, [resource.fullData.resource_url]: current }));
                                  }}
                                  placeholder="Key"
                                  className="h-7 text-xs flex-1"
                                />
                                <Input
                                  value={param.paramValue}
                                  onChange={(e) => {
                                    const current = [...(resultQueryParamOverrides[resource.fullData.resource_url] || resource.fullData.result_query_params || [])];
                                    current[idx] = { ...current[idx], paramValue: e.target.value };
                                    setResultQueryParamOverrides(prev => ({ ...prev, [resource.fullData.resource_url]: current }));
                                  }}
                                  placeholder="Value or #genSessionId"
                                  className="h-7 text-xs flex-1"
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const current = [...(resultQueryParamOverrides[resource.fullData.resource_url] || resource.fullData.result_query_params || [])];
                                    current.splice(idx, 1);
                                    setResultQueryParamOverrides(prev => ({ ...prev, [resource.fullData.resource_url]: current }));
                                  }}
                                  className="text-destructive hover:text-destructive/80 p-1"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ${
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        {isSelected && <Check className="w-4 h-4" />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Manual JSON Input Component - Only show when resource is selected */}
            {selectedManualJsonResource && (
              <ManualJsonInput
                value={manualJsonData}
                onChange={setManualJsonData}
                resourceName={selectedManualJsonResource.name}
                resourceDescription={selectedManualJsonResource.description}
              />
            )}
          </div>
        )}

        {/* Data APIs Section - Only show if there are API resources */}
        {apiResources.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  <Database className="w-5 h-5 text-primary" />
                  {selectedAnalytics?.type === "serviceChain" ? "Required Data Resources" : "Connect to Data APIs"}
                </h3>
                {selectedAnalytics?.type === "serviceChain" && (
                  <p className="text-xs text-muted-foreground mt-1">
                    These data resources are part of the service chain flow
                  </p>
                )}
              </div>
              {selectedApis.length > 0 && (
                <span className="text-xs text-primary bg-primary/10 px-2 py-1 rounded-full">
                  {selectedApis.length} selected
                </span>
              )}
            </div>
            
            <CenterFocusCarousel
              items={apiResources.map((api) => ({
                id: api.id,
                name: api.name,
                provider: api.provider,
                description: api.description,
                queryParams: api.queryParams,
                contract: api.fullData.contract_url,
                parameters: api.fullData.parameters,
              }))}
              selectedIds={selectedApis}
              onSelect={selectedAnalytics?.type === "serviceChain" ? undefined : handleApiSelect}
              onParamsChange={handleApiParamsChange}
              params={apiParams}
              isDebugMode={isDebugMode}
              disableDeselect={selectedAnalytics?.type === "serviceChain"}
            />
          </div>
        )}

        {/* Custom API URL Section - Only show when NOT using service chain */}
        {selectedAnalytics?.type !== "serviceChain" && (
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Link className="w-5 h-5 text-primary" />
              Custom API Connection
            </h3>
            <div className="glass-card p-4">
              <Label htmlFor="customApi" className="text-sm text-muted-foreground mb-2 block">
                Enter your API endpoint URL
              </Label>
              <Input
                id="customApi"
                value={customApiUrl}
                onChange={(e) => setCustomApiUrl(e.target.value)}
                placeholder="https://api.example.com/v1/data"
                className="bg-background/50 border-border/50 focus:border-primary"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Connect to any REST API endpoint for data retrieval
              </p>
            </div>
          </div>
        )}

        {/* Empty state when no data resources available */}
        {uploadResources.length === 0 && apiResources.length === 0 && manualJsonResources.length === 0 && (
          <div className="glass-card p-8 text-center">
            <Database className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">
              {selectedAnalytics?.type === "serviceChain" 
                ? "No data resources are embedded in this service chain." 
                : "No data resources available."}
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-3 rounded-lg font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => onNext({ 
            files, 
            apis: selectedApis, 
            textData: manualJsonData,
            customApiUrl, 
            apiParams,
            selectedDataResources: getSelectedDataResources(),
            uploadConfig: uploadConfig || undefined,
            uploadResourceParams: Object.keys(uploadResourceParams).length > 0 ? uploadResourceParams : undefined,
            manualJsonData: manualJsonData || undefined,
            serviceChainResourceParams: Object.keys(serviceChainResourceParams).length > 0 ? serviceChainResourceParams : undefined,
          })}
          disabled={!hasData}
          className={`px-6 py-3 rounded-lg font-medium transition-all duration-300 ${
            hasData
              ? "bg-primary text-primary-foreground hover:opacity-90 glow-effect"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          }`}
        >
          Continue to Processing
        </button>
      </div>

      {/* Upload Resource Params Dialog */}
      {showUploadParamsDialog && pendingUploadResource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div 
            className="absolute inset-0 bg-black/80"
            onClick={handleUploadParamsCancel}
          />
          
          <div className="relative z-10 w-full max-w-md mx-4 bg-background border rounded-lg shadow-lg p-6">
            <button
              onClick={handleUploadParamsCancel}
              className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
            >
              <X className="h-4 w-4" />
            </button>
            
            <div className="mb-4">
              <h3 className="text-lg font-semibold">Configure Parameters</h3>
              <p className="text-sm text-muted-foreground">
                {pendingUploadResource.name}
                <br />
                <span className="text-xs">These parameters are optional.</span>
              </p>
            </div>
            
            <div className="grid gap-4 py-4">
              {pendingUploadResource.queryParams.map((param) => (
                <div key={param} className="space-y-2">
                  <Label htmlFor={`upload-${param}`}>{param}</Label>
                  <Input
                    id={`upload-${param}`}
                    placeholder={`Enter ${param}`}
                    value={uploadResourceParams[param] || ""}
                    onChange={(e) => setUploadResourceParams(prev => ({ ...prev, [param]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={handleUploadParamsCancel}
                className="px-4 py-2 rounded-lg font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUploadParamsSave}
                className="px-4 py-2 rounded-lg font-medium bg-primary text-primary-foreground hover:opacity-90 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Description Dialog */}
      {descriptionDialog.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div 
            className="absolute inset-0 bg-black/80"
            onClick={() => setDescriptionDialog({ open: false, title: "", description: "" })}
          />
          
          <div className="relative z-10 w-full max-w-lg mx-4 bg-background border rounded-lg shadow-lg p-6 max-h-[80vh] overflow-y-auto">
            <button
              onClick={() => setDescriptionDialog({ open: false, title: "", description: "" })}
              className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
            >
              <X className="h-4 w-4" />
            </button>
            
            <h3 className="text-lg font-semibold mb-4 pr-8">{descriptionDialog.title}</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {descriptionDialog.description}
            </p>
            
            <div className="flex justify-end mt-6">
              <button
                onClick={() => setDescriptionDialog({ open: false, title: "", description: "" })}
                className="px-4 py-2 rounded-lg font-medium bg-primary text-primary-foreground hover:opacity-90 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataSelection;
