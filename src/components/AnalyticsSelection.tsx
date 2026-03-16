import { useState, useMemo, useEffect, useRef } from "react";
import { Link2, X, Settings, ChevronDown, ChevronUp, Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useProcessSession } from "@/contexts/ProcessSessionContext";
import { 
  AnalyticsOption, 
  SoftwareResource, 
  ServiceChain,
  ServiceChainEmbeddedResource,
  getQueryParamNames,
  getParamValuesMap,
} from "@/types/dataspace";
import { sanitizeParams, isSessionIdPlaceholder } from "@/utils/paramSanitizer";

// Re-export type for backward compatibility
export type { AnalyticsOption } from "@/types/dataspace";

interface AnalyticsSelectionProps {
  selected: AnalyticsOption | null;
  onSelect: (option: AnalyticsOption) => void;
  onNext: () => void;
  queryParams: Record<string, string>;
  onQueryParamChange: (params: Record<string, string>) => void;
  softwareResources: SoftwareResource[];
  serviceChains: ServiceChain[];
  isDebugMode?: boolean;
}

const AnalyticsSelection = ({ 
  selected, 
  onSelect, 
  onNext,
  queryParams,
  onQueryParamChange,
  softwareResources,
  serviceChains,
  isDebugMode = false,
}: AnalyticsSelectionProps) => {
  const { sessionId } = useProcessSession();
  const [paramsDialogOpen, setParamsDialogOpen] = useState(false);
  const [descriptionDialog, setDescriptionDialog] = useState<{ name: string; description: string } | null>(null);
  const [truncatedItems, setTruncatedItems] = useState<Set<string>>(new Set());
  const descriptionRefs = useRef<Map<string, HTMLParagraphElement>>(new Map());
  
  // State for service chain details dialog
  const [serviceChainDetailsOpen, setServiceChainDetailsOpen] = useState(false);
  const [expandedEmbeddedResources, setExpandedEmbeddedResources] = useState<Set<number>>(new Set());
  const [embeddedResourceParams, setEmbeddedResourceParams] = useState<Record<number, Record<string, string>>>({});

  // Build options from props
  const options = useMemo(() => {
    const softwareOptions: AnalyticsOption[] = softwareResources.map(resource => ({
      type: "software" as const,
      data: resource
    }));
    
    const chainOptions: AnalyticsOption[] = serviceChains.map(chain => ({
      type: "serviceChain" as const,
      data: chain
    }));
    
    return [...softwareOptions, ...chainOptions];
  }, [softwareResources, serviceChains]);

  // Get unique ID for an option
  const getOptionId = (option: AnalyticsOption): string => {
    if (option.type === "software") {
      return option.data.resource_url;
    }
    return option.data.catalog_id;
  };

  // Get display info for an option
  const getDisplayInfo = (option: AnalyticsOption) => {
    if (option.type === "software") {
      const queryParamNames = getQueryParamNames(option.data.parameters);
      return {
        name: option.data.resource_name || "Unnamed Resource",
        description: option.data.resource_description || "No description available",
        provider: option.data.provider || "Unknown Provider",
        queryParams: queryParamNames,
        isServiceChain: false
      };
    }
    // For service chains, show name and description from basis_information
    return {
      name: option.data.basis_information?.name || option.data.catalog_id,
      description: option.data.basis_information?.description || "Service chain analytics workflow",
      provider: `${option.data.services.length} services`,
      queryParams: [] as string[],
      isServiceChain: true
    };
  };

  // Get embedded software resources from service chain
  const getEmbeddedSoftwareResources = (chain: ServiceChain): ServiceChainEmbeddedResource[] => {
    return (chain.embedded_resources || []).filter(r => r.resource_type === 'software');
  };

  // Check for truncated text after render
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
  }, [options]);

  // Initialize embedded resource params when selecting service chain
  useEffect(() => {
    if (selected?.type === "serviceChain") {
      const softwareResources = getEmbeddedSoftwareResources(selected.data);
      const initialParams: Record<number, Record<string, string>> = {};
      
      softwareResources.forEach(resource => {
        const prefillParams = getParamValuesMap(resource.parameters);
        const resolvedParams: Record<string, string> = {};
        
        for (const [key, value] of Object.entries(prefillParams)) {
          if (isSessionIdPlaceholder(value)) {
            resolvedParams[key] = sessionId;
          } else {
            resolvedParams[key] = value;
          }
        }
        
        initialParams[resource.service_index] = resolvedParams;
      });
      
      setEmbeddedResourceParams(initialParams);
      // Keep all embedded resources collapsed by default.
      setExpandedEmbeddedResources(new Set<number>());
    }
  }, [selected, sessionId]);

  // Set ref for description element
  const setDescriptionRef = (id: string, el: HTMLParagraphElement | null) => {
    if (el) {
      descriptionRefs.current.set(id, el);
    } else {
      descriptionRefs.current.delete(id);
    }
  };

  // Check if current option is selected
  const isSelected = (option: AnalyticsOption): boolean => {
    if (!selected) return false;
    return getOptionId(option) === getOptionId(selected);
  };

  // Get query params for selected option
  const selectedQueryParams = useMemo(() => {
    if (!selected) return [];
    const info = getDisplayInfo(selected);
    return info.queryParams;
  }, [selected]);

  // Handle option selection - auto open params dialog if has params (debug mode only)
  const handleOptionSelect = (option: AnalyticsOption) => {
    onSelect(option);
    const info = getDisplayInfo(option);
    
    // Pre-fill query params from resource parameters
    if (info.queryParams.length > 0 && option.type === "software") {
      const prefillParams = getParamValuesMap(option.data.parameters);
      
      // Resolve #genSessionId placeholders
      const resolvedParams: Record<string, string> = {};
      for (const [key, value] of Object.entries(prefillParams)) {
        if (isSessionIdPlaceholder(value)) {
          resolvedParams[key] = sessionId;
        } else {
          resolvedParams[key] = value;
        }
      }
      
      onQueryParamChange(resolvedParams);
      // Only show params dialog in debug mode
      if (isDebugMode) {
        setParamsDialogOpen(true);
      }
    }
  };

  // Handle query param input change
  const handleParamChange = (param: string, value: string) => {
    onQueryParamChange({
      ...queryParams,
      [param]: value
    });
  };

  // Handle embedded resource param change
  const handleEmbeddedParamChange = (serviceIndex: number, param: string, value: string) => {
    setEmbeddedResourceParams(prev => ({
      ...prev,
      [serviceIndex]: {
        ...(prev[serviceIndex] || {}),
        [param]: value
      }
    }));
  };

  // Toggle embedded resource expansion
  const toggleEmbeddedResource = (serviceIndex: number) => {
    setExpandedEmbeddedResources(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serviceIndex)) {
        newSet.delete(serviceIndex);
      } else {
        newSet.add(serviceIndex);
      }
      return newSet;
    });
  };

  const handleContinue = () => {
    onNext();
  };

  const handleSaveParams = () => {
    setParamsDialogOpen(false);
  };

  const openDescriptionDialog = (e: React.MouseEvent, name: string, description: string) => {
    e.stopPropagation();
    setDescriptionDialog({ name, description });
  };

  // Open service chain details
  const openServiceChainDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    setServiceChainDetailsOpen(true);
  };

  if (options.length === 0) {
    return (
      <div className="animate-fade-in text-center py-12">
        <p className="text-muted-foreground">No analytics options available.</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold mb-2">
          Select <span className="gradient-text">Analytics Type</span>
        </h2>
        <p className="text-muted-foreground">
          Choose the type of analysis you want to perform on your data
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {options.map((option) => {
          const info = getDisplayInfo(option);
          const optionSelected = isSelected(option);
          const optionId = getOptionId(option);
          const isTruncated = truncatedItems.has(optionId);
          const embeddedSoftware = option.type === "serviceChain" 
            ? getEmbeddedSoftwareResources(option.data) 
            : [];
          
          return (
            <div
              key={optionId}
              onClick={() => handleOptionSelect(option)}
              className={`analytics-card ${optionSelected ? "selected" : ""} relative cursor-pointer`}
            >
              {info.isServiceChain && (
                <Badge className="absolute top-3 right-3 bg-primary/20 text-primary border-primary/30 gap-1">
                  <Link2 className="w-3 h-3" />
                  Service Chain
                </Badge>
              )}
              
              {/* Provider badge instead of icon */}
              <div className={`inline-flex px-3 py-1.5 rounded-lg text-sm font-medium mb-4 transition-colors ${
                optionSelected 
                  ? "bg-primary text-primary-foreground" 
                  : "bg-muted text-muted-foreground"
              }`}>
                {info.provider}
              </div>
              
              <h3 className="font-semibold text-lg mb-2 line-clamp-2">{info.name}</h3>
              <p 
                ref={(el) => setDescriptionRef(optionId, el)}
                className="text-sm text-muted-foreground line-clamp-3"
              >
                {info.description}
              </p>
              
              {/* Read full button - only show if text is truncated */}
              {isTruncated && (
                <button
                  onClick={(e) => openDescriptionDialog(e, info.name, info.description)}
                  className="text-xs text-primary hover:underline mt-1"
                >
                  Read full
                </button>
              )}
              
              {isDebugMode && info.queryParams.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <span className="text-xs text-muted-foreground">
                    Parameters: {info.queryParams.join(", ")}
                  </span>
                </div>
              )}
              
              {/* Debug mode: Show embedded software resources count for service chains */}
              {isDebugMode && option.type === "serviceChain" && embeddedSoftware.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <button
                    onClick={openServiceChainDetails}
                    className="flex items-center gap-2 text-xs text-primary hover:underline"
                  >
                    <Cpu className="w-3 h-3" />
                    {embeddedSoftware.length} embedded software resource{embeddedSoftware.length > 1 ? 's' : ''}
                    <Settings className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleContinue}
          disabled={!selected}
          className={`px-8 py-3 rounded-lg font-medium transition-all duration-300 ${
            selected
              ? "bg-primary text-primary-foreground hover:opacity-90 glow-effect"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          }`}
        >
          Continue to Data Selection
        </button>
      </div>

      {/* Parameters Dialog - Auto opens when selecting option with params */}
      {paramsDialogOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/80"
            onClick={() => setParamsDialogOpen(false)}
          />
          
          {/* Modal Content */}
          <div className="relative z-10 w-full max-w-md mx-4 bg-background border rounded-lg shadow-lg p-6">
            {/* Close Button */}
            <button
              onClick={() => setParamsDialogOpen(false)}
              className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
            >
              <X className="h-4 w-4" />
            </button>
            
            {/* Header */}
            <div className="mb-4">
              <h3 className="text-lg font-semibold">Configure Parameters</h3>
              <p className="text-sm text-muted-foreground">
                {getDisplayInfo(selected).name}
                <br />
                <span className="text-xs">These parameters are optional.</span>
              </p>
            </div>
            
            {/* Form */}
            <div className="grid gap-4 py-4">
              {selectedQueryParams.map((param) => (
                <div key={param} className="space-y-2">
                  <Label htmlFor={param}>{param}</Label>
                  <Input
                    id={param}
                    placeholder={`Enter ${param}`}
                    value={queryParams[param] || ""}
                    onChange={(e) => handleParamChange(param, e.target.value)}
                  />
                </div>
              ))}
            </div>
            
            {/* Footer */}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setParamsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveParams}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Service Chain Details Dialog - Shows embedded software resources */}
      {serviceChainDetailsOpen && selected?.type === "serviceChain" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/80"
            onClick={() => setServiceChainDetailsOpen(false)}
          />
          
          {/* Modal Content */}
          <div className="relative z-10 w-full max-w-2xl mx-4 bg-background border rounded-lg shadow-lg max-h-[85vh] flex flex-col overflow-hidden">
            {/* Close Button */}
            <button
              onClick={() => setServiceChainDetailsOpen(false)}
              className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity z-10"
            >
              <X className="h-4 w-4" />
            </button>
            
            {/* Header */}
            <div className="p-6 border-b">
              <h3 className="text-lg font-semibold">Service Chain Details</h3>
              <p className="text-sm text-muted-foreground">
                {selected.data.catalog_id}
              </p>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              <div className="p-6 space-y-4">
                <div>
                  <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-primary" />
                    Embedded Software Resources
                  </h4>
                  
                  {getEmbeddedSoftwareResources(selected.data).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No embedded software resources.</p>
                  ) : (
                    <div className="space-y-3">
                      {getEmbeddedSoftwareResources(selected.data).map((resource) => {
                        const isExpanded = expandedEmbeddedResources.has(resource.service_index);
                        const params = resource.parameters || [];
                        const resourceParams = embeddedResourceParams[resource.service_index] || {};
                        
                        return (
                          <div
                            key={resource.service_index}
                            className="border rounded-lg overflow-hidden"
                          >
                            <button
                              onClick={() => toggleEmbeddedResource(resource.service_index)}
                              className="w-full p-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
                            >
                              <div className="text-left">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                    Service {resource.service_index + 1}
                                  </span>
                                  <p className="font-medium text-sm">
                                    {resource.resource_name || "Unnamed Resource"}
                                  </p>
                                </div>
                                {resource.provider && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {resource.provider}
                                  </p>
                                )}
                              </div>
                              {params.length > 0 && (
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                    {params.length} params
                                  </span>
                                  {isExpanded ? (
                                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                  ) : (
                                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                  )}
                                </div>
                              )}
                            </button>
                            
                            {isExpanded && (
                              <div className="px-4 pb-4 space-y-4 border-t bg-muted/20">
                                {/* Description */}
                                {resource.resource_description && (
                                  <div className="pt-4">
                                    <p className="text-xs text-muted-foreground">
                                      {resource.resource_description}
                                    </p>
                                  </div>
                                )}
                                
                                {/* Parameters */}
                                {params.length > 0 && (
                                  <div className="pt-2 space-y-3">
                                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                                      Parameters
                                    </p>
                                    {params.map((param, idx) => (
                                      <div key={idx} className="space-y-1.5">
                                        <div className="flex items-center gap-2">
                                          <Label htmlFor={`embedded-${resource.service_index}-${param.paramName}`} className="text-xs">
                                            {param.paramName}
                                          </Label>
                                          {param.paramAction && (
                                            <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                                              {param.paramAction}
                                            </span>
                                          )}
                                        </div>
                                        <Input
                                          id={`embedded-${resource.service_index}-${param.paramName}`}
                                          placeholder={`Enter ${param.paramName}`}
                                          value={resourceParams[param.paramName] || ""}
                                          onChange={(e) => handleEmbeddedParamChange(
                                            resource.service_index,
                                            param.paramName,
                                            e.target.value
                                          )}
                                          className="h-8 text-xs"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                )}
                                
                                {/* URLs */}
                                <div className="pt-2 space-y-1">
                                  <p className="text-[10px] text-muted-foreground break-all">
                                    <span className="font-medium">Resource:</span> {resource.resource_url}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground break-all">
                                    <span className="font-medium">Contract:</span> {resource.contract_url}
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* Footer */}
            <div className="p-6 border-t flex justify-end gap-2">
              <Button variant="outline" onClick={() => setServiceChainDetailsOpen(false)}>
                Close
              </Button>
              <Button onClick={() => setServiceChainDetailsOpen(false)}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Description Dialog */}
      {descriptionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/80"
            onClick={() => setDescriptionDialog(null)}
          />
          
          {/* Modal Content */}
          <div className="relative z-10 w-full max-w-lg mx-4 bg-background border rounded-lg shadow-lg p-6 max-h-[80vh] overflow-y-auto">
            {/* Close Button */}
            <button
              onClick={() => setDescriptionDialog(null)}
              className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
            >
              <X className="h-4 w-4" />
            </button>
            
            {/* Header */}
            <h3 className="text-lg font-semibold mb-4 pr-8">{descriptionDialog.name}</h3>
            
            {/* Description */}
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {descriptionDialog.description}
            </p>
            
            {/* Footer */}
            <div className="flex justify-end mt-6">
              <Button onClick={() => setDescriptionDialog(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsSelection;
