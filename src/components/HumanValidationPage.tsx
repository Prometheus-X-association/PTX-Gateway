import { useState, useMemo } from "react";
import { UserCheck, FileText, Database, Globe, Type, CheckCircle2, XCircle, AlertTriangle, Code, ChevronDown, ChevronRight, Copy, Check, ExternalLink } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { AnalyticsOption, DataResource } from "@/types/dataspace";
import { resolveResultUrl, formatResultUrlWithParams, ResultUrlInfo } from "@/utils/resultUrlResolver";
import { sanitizeParamsArray, shouldIgnoreParam, resolveParamValue } from "@/utils/paramSanitizer";
import { generatePdcPayload } from "@/utils/pdcPayloadGenerator";
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
    return generatePdcPayload(
      selectedAnalytics,
      selectedData.selectedDataResources,
      analyticsQueryParams,
      selectedData.apiParams,
      selectedData.uploadResourceParams,
      sessionId,
      selectedData.serviceChainResourceParams
    );
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
