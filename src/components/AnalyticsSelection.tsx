import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Link2, X } from "lucide-react";
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
import { isSessionIdPlaceholder } from "@/utils/paramSanitizer";

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
  const [paramEditorMode, setParamEditorMode] = useState<"software" | "serviceChain" | null>(null);
  const [serviceChainParamEdits, setServiceChainParamEdits] = useState<Record<string, Record<string, string>>>({});
  const [descriptionDialog, setDescriptionDialog] = useState<{ name: string; description: string } | null>(null);
  const [truncatedItems, setTruncatedItems] = useState<Set<string>>(new Set());
  const descriptionRefs = useRef<Map<string, HTMLParagraphElement>>(new Map());

  const [serviceChainDetails, setServiceChainDetails] = useState<ServiceChain | null>(null);

  const areSetsEqual = (a: Set<string>, b: Set<string>): boolean => {
    if (a.size !== b.size) return false;
    for (const value of a) {
      if (!b.has(value)) return false;
    }
    return true;
  };

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

  // Check for truncated text after render
  useEffect(() => {
    const checkTruncation = () => {
      const newTruncated = new Set<string>();
      descriptionRefs.current.forEach((el, id) => {
        if (el && el.scrollHeight > el.clientHeight) {
          newTruncated.add(id);
        }
      });
      setTruncatedItems((prev) => (areSetsEqual(prev, newTruncated) ? prev : newTruncated));
    };

    const timer = window.requestAnimationFrame(checkTruncation);
    window.addEventListener('resize', checkTruncation);
    
    return () => {
      window.cancelAnimationFrame(timer);
      window.removeEventListener('resize', checkTruncation);
    };
  }, [options]);

  // Set ref for description element
  const setDescriptionRef = useCallback((id: string, el: HTMLParagraphElement | null) => {
    if (el) {
      descriptionRefs.current.set(id, el);
    } else {
      descriptionRefs.current.delete(id);
    }
  }, []);

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

  const selectedSoftwareDefaultParams = useMemo(() => {
    if (!selected || selected.type !== "software") return {};
    const defaults = getParamValuesMap(selected.data.parameters);
    const resolved: Record<string, string> = {};
    Object.entries(defaults).forEach(([key, value]) => {
      resolved[key] = isSessionIdPlaceholder(value) ? sessionId : value;
    });
    return resolved;
  }, [selected, sessionId]);

  // Handle option selection
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
    }
  };

  const handleConfigureParams = (event: React.MouseEvent, option: AnalyticsOption) => {
    event.stopPropagation();
    if (option.type !== "software") return;
    handleOptionSelect(option);
    if (isDebugMode) {
      setParamEditorMode("software");
      setParamsDialogOpen(true);
    }
  };

  const handleConfigureServiceChainParams = (event: React.MouseEvent, option: AnalyticsOption) => {
    event.stopPropagation();
    if (option.type !== "serviceChain") return;
    onSelect(option);

    const initialEdits: Record<string, Record<string, string>> = {};
    (option.data.embedded_resources || []).forEach((resource) => {
      const paramValues = getParamValuesMap(resource.parameters);
      const resolvedValues: Record<string, string> = {};
      Object.entries(paramValues).forEach(([key, value]) => {
        resolvedValues[key] = isSessionIdPlaceholder(value) ? sessionId : value;
      });
      initialEdits[resource.resource_url] = resolvedValues;
    });

    setServiceChainParamEdits(initialEdits);
    if (isDebugMode) {
      setParamEditorMode("serviceChain");
      setParamsDialogOpen(true);
    }
  };

  // Handle query param input change
  const handleParamChange = (param: string, value: string) => {
    onQueryParamChange({
      ...queryParams,
      [param]: value
    });
  };

  const handleContinue = () => {
    onNext();
  };

  const handleSaveParams = () => {
    if (paramEditorMode === "serviceChain" && selected?.type === "serviceChain") {
      const updatedOption: AnalyticsOption = {
        type: "serviceChain",
        data: {
          ...selected.data,
          embedded_resources: (selected.data.embedded_resources || []).map((resource) => {
            const edits = serviceChainParamEdits[resource.resource_url] || {};
            return {
              ...resource,
              parameters: (resource.parameters || []).map((param) => ({
                ...param,
                paramValue: edits[param.paramName] ?? param.paramValue,
              })),
            };
          }),
        },
      };
      onSelect(updatedOption);
    }
    setParamsDialogOpen(false);
    setParamEditorMode(null);
  };

  const openDescriptionDialog = useCallback((e: React.MouseEvent, name: string, description: string) => {
    e.stopPropagation();
    setDescriptionDialog({ name, description });
  }, []);

  const openServiceChainDetails = useCallback((e: React.MouseEvent, chain: ServiceChain) => {
    e.stopPropagation();
    setServiceChainDetails(chain);
  }, []);

  const getServiceChainResources = (chain: ServiceChain): ServiceChainEmbeddedResource[] =>
    [...(chain.embedded_resources || [])].sort((a, b) => a.service_index - b.service_index);

  if (options.length === 0) {
    return (
      <div className="animate-fade-in text-center py-12">
        <p className="text-muted-foreground">No analytics options available.</p>
      </div>
    );
  }

  const optionCards = useMemo(() => (
    options.map((option) => {
      const info = getDisplayInfo(option);
      const optionSelected = isSelected(option);
      const optionId = getOptionId(option);
      const isTruncated = truncatedItems.has(optionId);
      
      return (
        <div
          key={optionId}
          onClick={() => handleOptionSelect(option)}
          className={`analytics-card ${optionSelected ? "selected" : ""} relative cursor-pointer`}
        >
          {option.type === "serviceChain" ? (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="theme-badge border border-border/60 bg-transparent text-muted-foreground/70 cursor-default select-none">
                <Link2 className="w-3 h-3" />
                Service Chain
              </span>
              <button
                type="button"
                onClick={(event) => openServiceChainDetails(event, option.data)}
                className={`theme-badge transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-primary hover:text-primary-foreground hover:shadow-md hover:shadow-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  optionSelected
                    ? "theme-provider-badge selected"
                    : "theme-provider-badge"
                }`}
                aria-label={`Show ${info.provider} in ${info.name}`}
              >
                {info.provider}
              </button>
            </div>
          ) : (
            <div className={`theme-badge mb-4 transition-colors ${
              optionSelected
                ? "theme-provider-badge selected"
                : "theme-provider-badge"
            }`}>
              {info.provider}
            </div>
          )}

          <h3 className="font-semibold text-lg mb-2 line-clamp-2">{info.name}</h3>
          <p
            ref={(el) => setDescriptionRef(optionId, el)}
            className="text-sm text-muted-foreground line-clamp-3"
          >
            {info.description}
          </p>

          {isTruncated && (
            <div className="mt-2">
              <button
                onClick={(e) => openDescriptionDialog(e, info.name, info.description)}
                className="text-xs text-primary hover:underline"
              >
                Read full
              </button>
            </div>
          )}
          
          {isDebugMode && option.type === "software" && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {info.queryParams.length > 0
                    ? `Parameters: ${info.queryParams.join(", ")}`
                    : "Parameters: none configured"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant={optionSelected ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={(event) => handleConfigureParams(event, option)}
                  disabled={info.queryParams.length === 0}
                >
                  Change Parameters
                </Button>
              </div>
            </div>
          )}

          {isDebugMode && option.type === "serviceChain" && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  Service chain parameters
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant={optionSelected ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={(event) => handleConfigureServiceChainParams(event, option)}
                >
                  Change Parameters
                </Button>
              </div>
            </div>
          )}
          
        </div>
      );
    })
  ), [options, truncatedItems, selected, queryParams, isDebugMode, sessionId, openDescriptionDialog, openServiceChainDetails]);

  return (
    <div className="animate-fade-in">
      <div className="text-center mb-8">
        <h2 className="theme-section-title mb-2">
          Select Analytics Type:
        </h2>
        <p className="text-muted-foreground">
          Choose the type of analysis you want to perform on your data
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">{optionCards}</div>

      <div className="flex justify-center">
        <button
          onClick={handleContinue}
          disabled={!selected}
          className={`theme-button px-8 py-3 transition-all duration-300 ${
            selected
              ? "bg-primary text-primary-foreground hover:opacity-90 glow-effect"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          }`}
        >
          Continue to Data Selection
        </button>
      </div>

      {/* Parameters Dialog - Opened via debug "Change Parameters" button */}
      {paramsDialogOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/80"
            onClick={() => setParamsDialogOpen(false)}
          />
          
          {/* Modal Content */}
          <div className="relative z-10 w-full max-w-2xl mx-4 bg-background border rounded-lg shadow-lg max-h-[85vh] flex flex-col overflow-hidden">
            {/* Close Button */}
            <button
              onClick={() => setParamsDialogOpen(false)}
              className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
            >
              <X className="h-4 w-4" />
            </button>
            
            {/* Header */}
            <div className="p-6 pb-0">
              <h3 className="text-lg font-semibold">Configure Parameters</h3>
              <p className="text-sm text-muted-foreground">
                {getDisplayInfo(selected).name}
                <br />
                <span className="text-xs">These parameters are optional.</span>
              </p>
            </div>
            
            {/* Form */}
            <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
              <div className="grid gap-4">
              {paramEditorMode === "software" && selected.type === "software" && selectedQueryParams.map((param) => (
                <div key={param} className="space-y-2">
                  <Label htmlFor={param}>{param}</Label>
                  <Input
                    id={param}
                    placeholder={`Enter ${param}`}
                    value={queryParams[param] ?? selectedSoftwareDefaultParams[param] ?? ""}
                    onChange={(e) => handleParamChange(param, e.target.value)}
                  />
                </div>
              ))}

              {paramEditorMode === "serviceChain" && selected.type === "serviceChain" && (
                <>
                  {getServiceChainResources(selected.data).map((resource) => {
                    const paramNames = getQueryParamNames(resource.parameters);
                    return (
                      <div key={`${resource.service_index}-${resource.resource_url}`} className="rounded-md border p-3 space-y-3">
                        <div>
                          <p className="text-sm font-medium">
                            {resource.resource_name || `Service ${resource.service_index + 1}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {resource.provider || "Unknown Provider"}
                          </p>
                        </div>

                        {paramNames.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No parameters configured.</p>
                        ) : (
                          paramNames.map((param) => (
                            <div key={`${resource.resource_url}-${param}`} className="space-y-1">
                              <Label htmlFor={`${resource.resource_url}-${param}`}>{param}</Label>
                              <Input
                                id={`${resource.resource_url}-${param}`}
                                placeholder={`Enter ${param}`}
                                value={serviceChainParamEdits[resource.resource_url]?.[param] ?? getParamValuesMap(resource.parameters)[param] ?? ""}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setServiceChainParamEdits((prev) => ({
                                    ...prev,
                                    [resource.resource_url]: {
                                      ...(prev[resource.resource_url] || {}),
                                      [param]: value,
                                    },
                                  }));
                                }}
                              />
                            </div>
                          ))
                        )}
                      </div>
                    );
                  })}
                </>
              )}
              </div>
            </div>
            
            {/* Footer */}
            <div className="sticky bottom-0 p-4 border-t bg-background flex justify-end gap-2">
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

      {/* Service Chain Details Dialog */}
      {serviceChainDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/80"
            onClick={() => setServiceChainDetails(null)}
          />
          
          {/* Modal Content */}
          <div className="relative z-10 w-full max-w-6xl mx-4 bg-background border rounded-lg shadow-lg max-h-[85vh] flex flex-col overflow-hidden">
            {/* Close Button */}
            <button
              onClick={() => setServiceChainDetails(null)}
              className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity z-10"
            >
              <X className="h-4 w-4" />
            </button>
            
            {/* Header */}
            <div className="p-6 border-b">
              <h3 className="text-lg font-semibold">
                {serviceChainDetails.basis_information?.name || serviceChainDetails.catalog_id}
              </h3>
              <p className="text-sm text-muted-foreground">
                {getServiceChainResources(serviceChainDetails).length} provider resource{getServiceChainResources(serviceChainDetails).length === 1 ? "" : "s"} in this service chain
              </p>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="p-6 space-y-4">
                {getServiceChainResources(serviceChainDetails).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No provider resources are available for this service chain.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {getServiceChainResources(serviceChainDetails).map((resource) => (
                      <div key={`${resource.service_index}-${resource.resource_url}`} className="rounded-lg border bg-background/60 p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <Badge variant="secondary" className="shrink-0">
                            Service {resource.service_index + 1}
                          </Badge>
                          <Badge variant="outline" className="shrink-0 capitalize">
                            {resource.resource_type}
                          </Badge>
                        </div>

                        <div className="space-y-1">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Provider
                          </p>
                          <p className="font-medium leading-snug">
                            {resource.provider || "Unknown Provider"}
                          </p>
                        </div>

                        <div className="space-y-1">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Resource
                          </p>
                          <p className="text-sm font-medium leading-snug">
                            {resource.resource_name || "Unnamed Resource"}
                          </p>
                        </div>

                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {resource.resource_description || "No description available."}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            {/* Footer */}
            <div className="sticky bottom-0 p-4 border-t bg-background flex justify-end gap-2">
              <Button onClick={() => setServiceChainDetails(null)}>
                Close
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
