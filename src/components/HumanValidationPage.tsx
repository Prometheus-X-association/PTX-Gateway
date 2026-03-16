import { useState, useMemo } from "react";
import { UserCheck, FileText, Database, Globe, Type, CheckCircle2, XCircle, AlertTriangle, Code, ChevronDown, ChevronRight, Copy, Check, ExternalLink } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { AnalyticsOption, DataResource, getParamActionsMap } from "@/types/dataspace";
import { resolveResultUrl, formatResultUrlWithParams, ResultUrlInfo } from "@/utils/resultUrlResolver";
import { sanitizeParams, sanitizeParamsArray, shouldIgnoreParam, resolveParamValue } from "@/utils/paramSanitizer";
interface HumanValidationPageProps {
  selectedData: {
    files: File[];
    apis: string[];
    textData: string;
    customApiUrl: string;
    apiParams: Record<string, Record<string, string>>;
    selectedDataResources: DataResource[];
    uploadResourceParams?: Record<string, string>;
    serviceChainResourceParams?: Record<string, Record<string, string>>;
  };
  selectedAnalytics: AnalyticsOption;
  analyticsQueryParams: Record<string, string>;
  sessionId: string;
  pdcUrl?: string;
  onApprove: () => void;
  onReject: () => void;
}

// JSON Tree Node Component for VS Code-like collapsible display
const JsonTreeNode = ({ 
  keyName, 
  value, 
  depth = 0,
  isLast = true
}: { 
  keyName?: string; 
  value: unknown; 
  depth?: number;
  isLast?: boolean;
}) => {
  const [isExpanded, setIsExpanded] = useState(depth < 3);
  
  const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
  const isArray = Array.isArray(value);
  const hasChildren = isObject || isArray;
  
  // VS Code-like color classes
  const keyColor = "text-[hsl(187,85%,65%)]"; // Cyan for keys
  const stringColor = "text-[hsl(29,85%,65%)]"; // Orange for strings
  const numberColor = "text-[hsl(140,70%,65%)]"; // Green for numbers
  const booleanColor = "text-[hsl(280,70%,70%)]"; // Purple for booleans
  const nullColor = "text-[hsl(0,70%,65%)]"; // Red for null
  const punctuationColor = "text-muted-foreground"; // Gray for punctuation
  
  const renderValue = () => {
    if (value === null) return <span className={nullColor}>null</span>;
    if (typeof value === "boolean") return <span className={booleanColor}>{value.toString()}</span>;
    if (typeof value === "number") return <span className={numberColor}>{value}</span>;
    if (typeof value === "string") return (
      <>
        <span className={punctuationColor}>"</span>
        <span className={stringColor}>{value}</span>
        <span className={punctuationColor}>"</span>
      </>
    );
    return null;
  };
  
  const childEntries = isArray 
    ? (value as unknown[]).map((item, index) => ({ key: String(index), value: item }))
    : isObject 
      ? Object.entries(value as object).map(([key, val]) => ({ key, value: val }))
      : [];
  
  const comma = !isLast ? <span className={punctuationColor}>,</span> : null;
  
  return (
    <div className="font-mono text-sm leading-relaxed">
      <div 
        className={`flex items-start ${hasChildren ? "cursor-pointer hover:bg-muted/20" : ""}`}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
        style={{ paddingLeft: `${depth * 20}px` }}
      >
        {hasChildren && (
          <span className="text-muted-foreground w-5 flex-shrink-0 select-none">
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>
        )}
        {!hasChildren && <span className="w-5" />}
        
        <span className="flex-1">
          {keyName !== undefined && (
            <>
              <span className={punctuationColor}>"</span>
              <span className={keyColor}>{keyName}</span>
              <span className={punctuationColor}>"</span>
              <span className={punctuationColor}>: </span>
            </>
          )}
          
          {hasChildren ? (
            <>
              <span className={punctuationColor}>{isArray ? "[" : "{"}</span>
              {!isExpanded && (
                <>
                  <span className="text-muted-foreground/60 text-xs mx-1">
                    {childEntries.length} {childEntries.length === 1 ? "item" : "items"}
                  </span>
                  <span className={punctuationColor}>{isArray ? "]" : "}"}</span>
                  {comma}
                </>
              )}
            </>
          ) : (
            <>
              {renderValue()}
              {comma}
            </>
          )}
        </span>
      </div>
      
      {hasChildren && isExpanded && (
        <>
          {childEntries.map((entry, index) => (
            <JsonTreeNode 
              key={entry.key} 
              keyName={isArray ? undefined : entry.key} 
              value={entry.value} 
              depth={depth + 1}
              isLast={index === childEntries.length - 1}
            />
          ))}
          <div style={{ paddingLeft: `${depth * 20}px` }} className="flex">
            <span className="w-5" />
            <span className={punctuationColor}>{isArray ? "]" : "}"}{comma}</span>
          </div>
        </>
      )}
    </div>
  );
};

const HumanValidationPage = ({ 
  selectedData, 
  selectedAnalytics, 
  analyticsQueryParams,
  sessionId,
  pdcUrl,
  onApprove, 
  onReject 
}: HumanValidationPageProps) => {
  const [validationNotes, setValidationNotes] = useState("");
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  const toggleCheck = (id: string) => {
    setCheckedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Get analytics display name
  const getAnalyticsDisplayName = (): string => {
    if (selectedAnalytics.type === "software") {
      return selectedAnalytics.data.resource_name || "Analytics";
    }
    return selectedAnalytics.data.basis_information?.name || selectedAnalytics.data.catalog_id;
  };

  // Resolve the result fetch URL
  const resultUrlInfo: ResultUrlInfo | null = useMemo(() => {
    return resolveResultUrl(
      selectedAnalytics,
      selectedData.selectedDataResources,
      selectedData.apiParams,
      selectedData.uploadResourceParams,
      sessionId
    );
  }, [selectedAnalytics, selectedData, sessionId]);

  const pdcPayload = useMemo(() => {
    // Get contract info from selected analytics
    const contract = selectedAnalytics.data.contract_url;
    
    // Handle service chain analytics
    if (selectedAnalytics.type === "serviceChain") {
      const catalogId = selectedAnalytics.data.catalog_id;
      const embeddedResources = selectedAnalytics.data.embedded_resources || [];
      
      // Sort by service_index
      const sortedResources = [...embeddedResources].sort((a, b) => a.service_index - b.service_index);
      
      if (sortedResources.length === 0) {
        return {
          contract,
          serviceChainId: catalogId,
          resources: [],
          purposes: [],
        };
      }
      
      // Merge serviceChainResourceParams with apiParams (serviceChainResourceParams takes priority for service chains)
      const mergedParams: Record<string, Record<string, string>> = { ...selectedData.apiParams };
      if (selectedData.serviceChainResourceParams) {
        Object.entries(selectedData.serviceChainResourceParams).forEach(([resourceUrl, params]) => {
          mergedParams[resourceUrl] = { ...(mergedParams[resourceUrl] || {}), ...params };
        });
      }
      
      // First resource goes to resources array
      const firstResource = sortedResources[0];
      const firstParamActions = getParamActionsMap(firstResource.parameters);
      const firstParams = mergedParams[firstResource.resource_url] || {};
      const sanitizedFirstParams = sanitizeParams(firstParams, sessionId, true, "payload", firstParamActions);
      const firstParamsArray = Object.entries(sanitizedFirstParams).map(([k, v]) => ({ [k]: v }));
      
      const resourcesArray = [{
        resource: firstResource.resource_url,
        ...(firstParamsArray.length > 0 ? { params: { query: firstParamsArray } } : {}),
      }];
      
      // Last resource goes to purposes array
      const lastResource = sortedResources[sortedResources.length - 1];
      const lastParamActions = getParamActionsMap(lastResource.parameters);
      const lastParams = mergedParams[lastResource.resource_url] || {};
      const sanitizedLastParams = sanitizeParams(lastParams, sessionId, true, "payload", lastParamActions);
      const lastParamsArray = Object.entries(sanitizedLastParams).map(([k, v]) => ({ [k]: v }));
      
      const purposesArray = sortedResources.length > 1 ? [{
        resource: lastResource.resource_url,
        ...(lastParamsArray.length > 0 ? { params: { query: lastParamsArray } } : {}),
      }] : [];
      
      // Middle resources go to serviceChainParams
      const serviceChainParams: Array<{ resource: string; params?: { query: Array<Record<string, string>> } }> = [];
      for (let i = 1; i < sortedResources.length - 1; i++) {
        const middleResource = sortedResources[i];
        const middleParamActions = getParamActionsMap(middleResource.parameters);
        const middleParams = mergedParams[middleResource.resource_url] || {};
        const sanitizedMiddleParams = sanitizeParams(middleParams, sessionId, true, "payload", middleParamActions);
        const middleParamsArray = Object.entries(sanitizedMiddleParams).map(([k, v]) => ({ [k]: v }));
        
        serviceChainParams.push({
          resource: middleResource.resource_url,
          ...(middleParamsArray.length > 0 ? { params: { query: middleParamsArray } } : {}),
        });
      }
      
      return {
        contract,
        serviceChainId: catalogId,
        resources: resourcesArray,
        purposes: purposesArray,
        ...(serviceChainParams.length > 0 ? { serviceChainParams } : {}),
      };
    }
    
    // Handle software analytics (existing logic)
    const purposeId = selectedAnalytics.data.service_offering || "";
    const purposeResource = selectedAnalytics.data.resource_url;

    // Build purposes array with analytics params - sanitized
    const purposes: Array<{
      resource: string;
      params?: { query: Array<Record<string, string>> };
    }> = [];
    
    // Get paramActions for analytics resource
    const analyticsParams = selectedAnalytics.data.parameters;
    const analyticsParamActions = getParamActionsMap(analyticsParams);
    
    // Sanitize analytics params - remove #ignoreParam, #ignorePayload and resolve #genSessionId
    const sanitizedAnalyticsParams = sanitizeParams(analyticsQueryParams, sessionId, true, "payload", analyticsParamActions);
    const analyticsParamsArray = Object.entries(sanitizedAnalyticsParams)
      .map(([key, value]) => ({ [key]: value }));
    
    if (purposeResource) {
      const purposeEntry: { resource: string; params?: { query: Array<Record<string, string>> } } = {
        resource: purposeResource,
      };
      
      // Only add params if there are non-empty sanitized query params
      if (analyticsParamsArray.length > 0) {
        purposeEntry.params = {
          query: analyticsParamsArray
        };
      }
      
      purposes.push(purposeEntry);
    }

    // Build resources array from selected data resources
    const resources: Array<{
      resource: string;
      params?: { query: Array<Record<string, string>> };
    }> = [];

    // Get first resource's service_offering for resourceId
    let resourceId = "";
    if (selectedData.selectedDataResources.length > 0) {
      resourceId = selectedData.selectedDataResources[0].service_offering || "";
    }

    // Process each selected data resource
    selectedData.selectedDataResources.forEach((dataResource) => {
      // Get params for this resource
      let rawParams: Record<string, string> = {};
      
      // Check if this is an upload resource (params in uploadResourceParams)
      if (dataResource.upload_file && selectedData.uploadResourceParams) {
        rawParams = { ...selectedData.uploadResourceParams };
      }
      
      // Check if this is an API resource (params in apiParams)
      if (!dataResource.upload_file && selectedData.apiParams[dataResource.resource_url]) {
        rawParams = { ...selectedData.apiParams[dataResource.resource_url] };
      }

      // Get paramActions for this resource
      const resourceParamActions = getParamActionsMap(dataResource.parameters);

      // Sanitize params - removes #ignoreParam, #ignorePayload and resolves #genSessionId
      const sanitizedParams = sanitizeParams(rawParams, sessionId, true, "payload", resourceParamActions);
      const resourceParams = Object.entries(sanitizedParams)
        .map(([key, value]) => ({ [key]: value }));

      const resourceEntry: { resource: string; params?: { query: Array<Record<string, string>> } } = {
        resource: dataResource.resource_url,
      };
      
      // Only add params if there are non-empty sanitized query params
      if (resourceParams.length > 0) {
        resourceEntry.params = {
          query: resourceParams
        };
      }

      resources.push(resourceEntry);
    });

    return {
      contract,
      purposeId,
      resourceId,
      resources,
      purposes
    };
  }, [selectedAnalytics, analyticsQueryParams, selectedData, sessionId]);

  const handleCopyPayload = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(pdcPayload, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const validationItems = [
    { id: "data-sources", label: "Data sources are correct and complete" },
    { id: "analytics-type", label: "Analytics type matches requirements" },
    { id: "parameters", label: "All required parameters are configured" },
    { id: "payload", label: "PDC payload structure is valid" },
  ];

  const allChecked = validationItems.every((item) => checkedItems[item.id]);

  return (
    <div className="animate-fade-in">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 mb-4">
          <UserCheck className="w-4 h-4 text-amber-500" />
          <span className="text-sm text-amber-500 font-medium">Human Validation Required</span>
        </div>
        <h2 className="text-3xl font-bold mb-2">
          Review & <span className="gradient-text">Validate</span>
        </h2>
        <p className="text-muted-foreground">
          Please review the PDC payload and configuration before processing
        </p>
      </div>

      <div className="max-w-2xl mx-auto space-y-6 mb-8">
        {/* PDC Payload */}
        <div className="glass-card p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Code className="w-5 h-5 text-primary" />
                PDC Request Payload
              </h3>
              <div className="flex items-center gap-2">
                {pdcUrl && (
                  <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                    {pdcUrl}
                  </span>
                )}
                <button
                  onClick={handleCopyPayload}
                  className="p-1.5 rounded hover:bg-muted transition-colors"
                  title="Copy payload"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>
          <div className="bg-background/50 rounded-lg border border-border/50 p-3 sm:p-4 max-h-[300px] sm:max-h-[400px] overflow-y-auto">
            <JsonTreeNode value={pdcPayload} />
          </div>
        </div>

        {/* Analytics Type */}
        <div className="glass-card p-4 sm:p-6">
          <h3 className="font-semibold flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-primary" />
            Selected Analytics
          </h3>
          <div className="px-3 sm:px-4 py-2 sm:py-3 rounded-lg bg-primary/10 border border-primary/20">
            <span className="text-base sm:text-lg font-medium text-primary">{getAnalyticsDisplayName()}</span>
          </div>
        </div>

        {/* Result Fetch URL */}
        {resultUrlInfo && (
          <div className="glass-card p-4 sm:p-6">
            <h3 className="font-semibold flex items-center gap-2 mb-4">
              <ExternalLink className="w-5 h-5 text-primary" />
              Result Fetch URL
            </h3>
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  resultUrlInfo.isServiceChain 
                    ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                    : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                }`}>
                  {resultUrlInfo.isServiceChain ? "Service Chain" : "Data Resource"}
                </span>
                <span className="px-2 py-1 rounded text-xs font-medium bg-muted text-muted-foreground">
                  {resultUrlInfo.method}
                </span>
                {resultUrlInfo.isFallback && (
                  <span className="px-2 py-1 rounded text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    Fallback URL
                  </span>
                )}
              </div>
              <div className="p-2 sm:p-3 rounded-lg bg-background/50 border border-border/50">
                <code className="text-xs break-all text-primary">
                  {formatResultUrlWithParams(resultUrlInfo)}
                </code>
              </div>
              <p className="text-xs text-muted-foreground">
                {resultUrlInfo.description}
              </p>
              {resultUrlInfo.queryParams && Object.keys(resultUrlInfo.queryParams).length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-2">Query Parameters:</p>
                  <div className="space-y-1">
                    {Object.entries(resultUrlInfo.queryParams).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-cyan-400">{key}</span>
                        <span className="text-muted-foreground">=</span>
                        <span className="font-mono text-orange-400 break-all">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Files */}
        {selectedData.files.length > 0 && (
          <div className="glass-card p-4 sm:p-6">
            <h3 className="font-semibold flex items-center gap-2 mb-4">
              <FileText className="w-5 h-5 text-primary" />
              Uploaded Files ({selectedData.files.length})
            </h3>
            <div className="space-y-2 max-h-[120px] overflow-y-auto">
              {selectedData.files.map((file, index) => (
                <div key={index} className="flex justify-between items-center py-2 px-3 rounded bg-muted/50">
                  <span className="text-sm truncate max-w-[60%] sm:max-w-[200px]">{file.name}</span>
                  <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* APIs */}
        {selectedData.apis.length > 0 && (
          <div className="glass-card p-4 sm:p-6">
            <h3 className="font-semibold flex items-center gap-2 mb-4">
              <Database className="w-5 h-5 text-primary" />
              Connected APIs ({selectedData.apis.length})
            </h3>
            <div className="space-y-2">
              {selectedData.apis.map((api) => (
                <div key={api} className="py-2 px-3 rounded bg-muted/50">
                  <span className="text-sm font-medium truncate block">{api.split("/").pop()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Custom API */}
        {selectedData.customApiUrl && (
          <div className="glass-card p-4 sm:p-6">
            <h3 className="font-semibold flex items-center gap-2 mb-4">
              <Globe className="w-5 h-5 text-primary" />
              Custom API
            </h3>
            <div className="p-2 sm:p-3 rounded bg-muted/50">
              <code className="text-xs break-all">{selectedData.customApiUrl}</code>
            </div>
          </div>
        )}

        {/* Validation Checklist */}
        <div className="glass-card p-4 sm:p-6">
          <h3 className="font-semibold flex items-center gap-2 mb-4">
            <UserCheck className="w-5 h-5 text-primary" />
            Validation Checklist
          </h3>
          <div className="space-y-3">
            {validationItems.map((item) => (
              <button
                key={item.id}
                onClick={() => toggleCheck(item.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all ${
                  checkedItems[item.id]
                    ? "bg-green-500/10 border-green-500/30"
                    : "bg-muted/30 border-border/50 hover:border-primary/30"
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                    checkedItems[item.id] ? "bg-green-500 text-white" : "bg-muted"
                  }`}
                >
                  {checkedItems[item.id] && <CheckCircle2 className="w-4 h-4" />}
                </div>
                <span className={`text-sm text-left ${checkedItems[item.id] ? "text-green-400" : ""}`}>
                  {item.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Validation Notes */}
        <div className="glass-card p-4 sm:p-6">
          <h3 className="font-semibold mb-4">Validation Notes (Optional)</h3>
          <Textarea
            value={validationNotes}
            onChange={(e) => setValidationNotes(e.target.value)}
            placeholder="Add any notes or observations about the payload..."
            className="min-h-[100px] bg-background/50 border-border/50 focus:border-primary"
          />
        </div>
      </div>

      <div className="max-w-2xl mx-auto flex flex-col sm:flex-row justify-between gap-4">
        <button
          onClick={onReject}
          className="px-6 py-3 rounded-lg font-medium bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors flex items-center justify-center gap-2"
        >
          <XCircle className="w-5 h-5" />
          Reject & Go Back
        </button>
        <button
          onClick={onApprove}
          disabled={!allChecked}
          className={`px-8 py-3 rounded-lg font-medium transition-all duration-300 flex items-center justify-center gap-2 ${
            allChecked
              ? "bg-green-500 text-white hover:bg-green-600 glow-effect"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          }`}
        >
          <CheckCircle2 className="w-5 h-5" />
          Approve & Start Processing
        </button>
      </div>
    </div>
  );
};

export default HumanValidationPage;
