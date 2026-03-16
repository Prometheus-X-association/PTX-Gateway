import { useState, useCallback } from "react";
import { Globe, Search, Loader2, AlertCircle, CheckCircle2, ChevronRight, ChevronDown, Maximize2, Minimize2, Pencil, Plus, Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import { validateFetchUrl, secureFetch, sanitizeNetworkError } from "@/utils/urlValidator";

interface DataspaceConfigPageProps {
  onNext: () => void;
}

interface BasisInformation {
  ecosystem: string;
  name: string;
  description: string;
}

interface ServiceChain {
  [key: string]: unknown;
  status: string;
  basisInformation?: BasisInformation;
  contract?: string;
}

interface ExtractedData {
  softwareResources: ResourceItem[];
  dataResources: ResourceItem[];
  serviceChains: ServiceChain[];
}

interface ResourceItem {
  resource: string;
  name: string;
  description: string;
  queryParam: string[];
  provider: string;
  apiResponseRepresentation?: Record<string, unknown>;
  serviceOffering: string;
  apiResponseRepresentationUrl?: string;
  uploadFile?: boolean;
  basisInformation?: BasisInformation;
  contract?: string;
}

// Helper to rename keys at the same level across sibling objects
const renameKeyAtSameLevel = (data: unknown, path: string, oldKey: string, newKey: string): unknown => {
  if (oldKey === newKey) return data;
  
  const result = JSON.parse(JSON.stringify(data));
  const pathParts = path.split('.').filter(k => k && k !== 'root');
  const parentParts = pathParts.slice(0, -1);
  
  const getNodeAtPath = (obj: unknown, parts: string[]): unknown => {
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  };

  const renameInObject = (obj: Record<string, unknown>, oldK: string, newK: string): void => {
    if (oldK in obj && !(newK in obj)) {
      const entries = Object.entries(obj);
      const newObj: Record<string, unknown> = {};
      for (const [k, v] of entries) {
        newObj[k === oldK ? newK : k] = v;
      }
      Object.keys(obj).forEach(k => delete obj[k]);
      Object.assign(obj, newObj);
    }
  };

  if (parentParts.length > 0) {
    const grandParentParts = parentParts.slice(0, -1);
    const parentKey = parentParts[parentParts.length - 1];
    const grandParent = grandParentParts.length > 0 
      ? getNodeAtPath(result, grandParentParts) 
      : result;
    
    if (grandParent && typeof grandParent === 'object') {
      const parent = (grandParent as Record<string, unknown>)[parentKey];
      if (Array.isArray(parent)) {
        parent.forEach((item) => {
          if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            renameInObject(item as Record<string, unknown>, oldKey, newKey);
          }
        });
        toast.success(`Renamed "${oldKey}" to "${newKey}" in ${parent.length} items`);
        return result;
      }
    }
  }

  const parent = parentParts.length > 0 ? getNodeAtPath(result, parentParts) : result;
  
  if (typeof parent === 'object' && parent !== null && !Array.isArray(parent)) {
    renameInObject(parent as Record<string, unknown>, oldKey, newKey);
    toast.success(`Renamed "${oldKey}" to "${newKey}"`);
  }

  return result;
};

// Helper to add a new key-value pair
const addKeyAtPath = (data: unknown, path: string, key: string, value: unknown): unknown => {
  const result = JSON.parse(JSON.stringify(data));
  const pathParts = path.split('.').filter(k => k && k !== 'root');
  
  let current: unknown = result;
  for (const part of pathParts) {
    if (current === null || current === undefined) return result;
    current = (current as Record<string, unknown>)[part];
  }
  
  if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
    (current as Record<string, unknown>)[key] = value;
    toast.success(`Added "${key}"`);
  } else if (Array.isArray(current)) {
    current.push(value);
    toast.success(`Added new item`);
  }
  
  return result;
};

// Helper to delete a key at path
const deleteKeyAtPath = (data: unknown, path: string): unknown => {
  const result = JSON.parse(JSON.stringify(data));
  const pathParts = path.split('.').filter(k => k && k !== 'root');
  
  if (pathParts.length === 0) return result;
  
  const parentParts = pathParts.slice(0, -1);
  const keyToDelete = pathParts[pathParts.length - 1];
  
  let parent: unknown = result;
  for (const part of parentParts) {
    if (parent === null || parent === undefined) return result;
    parent = (parent as Record<string, unknown>)[part];
  }
  
  if (Array.isArray(parent)) {
    const index = parseInt(keyToDelete);
    if (!isNaN(index)) {
      parent.splice(index, 1);
      toast.success(`Deleted item at index ${index}`);
    }
  } else if (typeof parent === 'object' && parent !== null) {
    delete (parent as Record<string, unknown>)[keyToDelete];
    toast.success(`Deleted "${keyToDelete}"`);
  }
  
  return result;
};

// Collapsible JSON Viewer Component with inline editing
interface CollapsibleJsonProps {
  data: unknown;
  onChange: (newData: unknown) => void;
}

interface JsonNodeProps {
  keyName: string | null;
  value: unknown;
  path: string;
  depth: number;
  isLast: boolean;
  isArrayItem: boolean;
  collapsedPaths: Set<string>;
  editingPath: string | null;
  editingType: 'key' | 'value' | null;
  onToggle: (path: string) => void;
  onValueEdit: (path: string, newValue: string) => void;
  onKeyEdit: (path: string, oldKey: string, newKey: string) => void;
  onStartEdit: (path: string, type: 'key' | 'value') => void;
  onEndEdit: () => void;
  onAdd: (path: string) => void;
  onDelete: (path: string) => void;
}

const JsonNode = ({ 
  keyName, value, path, depth, isLast, isArrayItem, collapsedPaths, editingPath, editingType,
  onToggle, onValueEdit, onKeyEdit, onStartEdit, onEndEdit, onAdd, onDelete
}: JsonNodeProps) => {
  const [tempKeyName, setTempKeyName] = useState(keyName || '');
  const [tempValue, setTempValue] = useState('');
  const indent = depth * 20;
  const isCollapsed = collapsedPaths.has(path);
  const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
  const isArray = Array.isArray(value);
  const isExpandable = isObject || isArray;
  const isEditingThisKey = editingPath === path && editingType === 'key';
  const isEditingThisValue = editingPath === path && editingType === 'value';

  const getValueColor = (val: unknown) => {
    if (typeof val === 'string') return 'text-green-400';
    if (typeof val === 'number') return 'text-blue-400';
    if (typeof val === 'boolean') return 'text-yellow-400';
    if (val === null) return 'text-muted-foreground';
    return 'text-foreground';
  };

  const renderPrimitiveValue = () => {
    if (typeof value === 'string') return `"${value}"`;
    if (value === null) return 'null';
    return String(value);
  };

  const getEditableValue = () => {
    if (typeof value === 'string') return value;
    if (value === null) return 'null';
    return String(value);
  };

  const renderCollapsedPreview = () => {
    if (isArray) {
      const arr = value as unknown[];
      if (arr.length === 0) return '[]';
      return `[...] // ${arr.length} items`;
    }
    if (isObject) {
      const keys = Object.keys(value as object);
      if (keys.length === 0) return '{}';
      return `{...} // ${keys.length} properties`;
    }
    return '';
  };

  const handleKeySubmit = (newKeyName: string) => {
    if (keyName && newKeyName && newKeyName !== keyName) {
      onKeyEdit(path, keyName, newKeyName);
    }
    onEndEdit();
  };

  const handleValueSubmit = (newValue: string) => {
    onValueEdit(path, newValue);
    onEndEdit();
  };

  const startKeyEdit = () => {
    if (!isArrayItem && keyName) {
      setTempKeyName(keyName);
      onStartEdit(path, 'key');
    }
  };

  const startValueEdit = () => {
    setTempValue(getEditableValue());
    onStartEdit(path, 'value');
  };

  const renderKeyName = () => {
    if (keyName === null) return null;
    
    if (isEditingThisKey) {
      return (
        <>
          <span className="text-foreground">"</span>
          <input
            type="text"
            defaultValue={keyName || ''}
            onChange={(e) => setTempKeyName(e.target.value)}
            onBlur={(e) => handleKeySubmit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleKeySubmit((e.target as HTMLInputElement).value);
              if (e.key === 'Escape') onEndEdit();
            }}
            className="bg-primary/20 text-purple-400 border-none outline-none px-1 rounded min-w-[40px]"
            style={{ width: `${Math.max((keyName || '').length, 3)}ch` }}
            autoFocus
          />
          <span className="text-foreground">"</span>
          <span className="text-foreground">: </span>
        </>
      );
    }

    return (
      <>
        <span 
          className="text-purple-400 cursor-pointer hover:bg-primary/20 rounded px-0.5 group/key inline-flex items-center gap-1"
          onDoubleClick={startKeyEdit}
          title={isArrayItem ? "Array index (read-only)" : "Double-click to edit key"}
        >
          "{keyName}"
          {!isArrayItem && <Pencil className="w-3 h-3 opacity-0 group-hover/key:opacity-50" />}
        </span>
        <span className="text-foreground">: </span>
      </>
    );
  };

  const renderValue = () => {
    if (isEditingThisValue) {
      return (
        <input
          type="text"
          defaultValue={getEditableValue()}
          onChange={(e) => setTempValue(e.target.value)}
          onBlur={(e) => handleValueSubmit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleValueSubmit((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') onEndEdit();
          }}
          className={`bg-primary/20 ${getValueColor(value)} border-none outline-none px-1 rounded min-w-[40px]`}
          style={{ width: `${Math.max(getEditableValue().length + 2, 5)}ch` }}
          autoFocus
        />
      );
    }

    return (
      <span 
        className={`${getValueColor(value)} cursor-pointer hover:bg-primary/20 px-1 rounded group/value inline-flex items-center gap-1`}
        onDoubleClick={startValueEdit}
        title="Double-click to edit value"
      >
        {renderPrimitiveValue()}
        <Pencil className="w-3 h-3 opacity-0 group-hover/value:opacity-50" />
      </span>
    );
  };

  // Primitive value
  if (!isExpandable) {
    return (
      <div className="flex items-center group leading-relaxed" style={{ paddingLeft: `${indent}px` }}>
        <span className="w-5" />
        {renderKeyName()}
        {renderValue()}
        {!isLast && <span className="text-foreground">,</span>}
        <button
          onClick={() => onDelete(path)}
          className="ml-2 p-0.5 rounded hover:bg-destructive/20 transition-colors opacity-0 group-hover:opacity-100"
          title="Delete this property"
        >
          <Trash2 className="w-3 h-3 text-destructive" />
        </button>
      </div>
    );
  }

  // Object or Array
  const entries = isArray 
    ? (value as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(value as object);
  const openBracket = isArray ? '[' : '{';
  const closeBracket = isArray ? ']' : '}';

  return (
    <div>
      <div 
        className="flex items-center group hover:bg-secondary/30 rounded leading-relaxed"
        style={{ paddingLeft: `${indent}px` }}
      >
        <button 
          className="p-0.5 rounded hover:bg-primary/20 transition-colors mr-1"
          onClick={() => onToggle(path)}
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4 text-primary" />
          ) : (
            <ChevronDown className="w-4 h-4 text-primary" />
          )}
        </button>
        {renderKeyName()}
        <span className="text-foreground cursor-pointer" onClick={() => onToggle(path)}>{openBracket}</span>
        {isCollapsed && (
          <>
            <span className="text-muted-foreground italic ml-1 text-sm cursor-pointer" onClick={() => onToggle(path)}>
              {renderCollapsedPreview()}
            </span>
            <span className="text-foreground">{closeBracket}</span>
            {!isLast && <span className="text-foreground">,</span>}
          </>
        )}
        <button
          onClick={() => onAdd(path)}
          className="ml-2 p-0.5 rounded hover:bg-primary/20 transition-colors opacity-0 group-hover:opacity-100"
          title={isArray ? "Add new item" : "Add new property"}
        >
          <Plus className="w-3 h-3 text-primary" />
        </button>
        {keyName !== null && (
          <button
            onClick={() => onDelete(path)}
            className="ml-1 p-0.5 rounded hover:bg-destructive/20 transition-colors opacity-0 group-hover:opacity-100"
            title="Delete this property"
          >
            <Trash2 className="w-3 h-3 text-destructive" />
          </button>
        )}
      </div>

      {!isCollapsed && (
        <>
          {entries.map(([key, val], index) => (
            <JsonNode
              key={`${path}.${key}`}
              keyName={isArray ? key : key}
              value={val}
              path={`${path}.${key}`}
              depth={depth + 1}
              isLast={index === entries.length - 1}
              isArrayItem={isArray}
              collapsedPaths={collapsedPaths}
              editingPath={editingPath}
              editingType={editingType}
              onToggle={onToggle}
              onValueEdit={onValueEdit}
              onKeyEdit={onKeyEdit}
              onStartEdit={onStartEdit}
              onEndEdit={onEndEdit}
              onAdd={onAdd}
              onDelete={onDelete}
            />
          ))}
          <div style={{ paddingLeft: `${indent}px` }} className="leading-relaxed">
            <span className="w-5 inline-block" />
            <span className="text-foreground">{closeBracket}</span>
            {!isLast && <span className="text-foreground">,</span>}
          </div>
        </>
      )}
    </div>
  );
};

const CollapsibleJson = ({ data, onChange }: CollapsibleJsonProps) => {
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<'key' | 'value' | null>(null);

  const togglePath = useCallback((path: string) => {
    setCollapsedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setCollapsedPaths(new Set()), []);

  const collapseAll = useCallback(() => {
    const paths = new Set<string>();
    const collectPaths = (obj: unknown, path: string) => {
      if (typeof obj === 'object' && obj !== null) {
        paths.add(path);
        const entries = Array.isArray(obj) ? obj.map((v, i) => [String(i), v]) : Object.entries(obj);
        entries.forEach(([key, val]) => collectPaths(val, `${path}.${key}`));
      }
    };
    collectPaths(data, 'root');
    setCollapsedPaths(paths);
  }, [data]);

  const setNestedValue = useCallback((obj: unknown, path: string, value: unknown): unknown => {
    const keys = path.split('.').filter(k => k && k !== 'root');
    if (keys.length === 0) return value;
    
    const result = JSON.parse(JSON.stringify(obj));
    let current: Record<string, unknown> = result;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (current[key] === undefined) current[key] = {};
      current = current[key] as Record<string, unknown>;
    }
    
    const lastKey = keys[keys.length - 1];
    const originalValue = current[lastKey];
    
    if (value === 'null') {
      current[lastKey] = null;
    } else if (value === 'true') {
      current[lastKey] = true;
    } else if (value === 'false') {
      current[lastKey] = false;
    } else if (typeof originalValue === 'number') {
      const num = parseFloat(value as string);
      current[lastKey] = isNaN(num) ? value : num;
    } else {
      current[lastKey] = value;
    }
    
    return result;
  }, []);

  const handleValueEdit = useCallback((path: string, newValue: string) => {
    const newData = setNestedValue(data, path, newValue);
    onChange(newData);
  }, [data, onChange, setNestedValue]);

  const handleKeyEdit = useCallback((path: string, oldKey: string, newKey: string) => {
    const newData = renameKeyAtSameLevel(data, path, oldKey, newKey);
    onChange(newData);
  }, [data, onChange]);

  const handleStartEdit = useCallback((path: string, type: 'key' | 'value') => {
    setEditingPath(path);
    setEditingType(type);
  }, []);

  const handleEndEdit = useCallback(() => {
    setEditingPath(null);
    setEditingType(null);
  }, []);

  const handleAdd = useCallback((path: string) => {
    const pathParts = path.split('.').filter(k => k && k !== 'root');
    let target: unknown = data;
    for (const part of pathParts) {
      target = (target as Record<string, unknown>)[part];
    }
    
    if (Array.isArray(target)) {
      const newData = addKeyAtPath(data, path, '', '');
      onChange(newData);
    } else {
      const existingKeys = Object.keys(target as object);
      let newKey = 'newKey';
      let counter = 1;
      while (existingKeys.includes(newKey)) {
        newKey = `newKey${counter}`;
        counter++;
      }
      const newData = addKeyAtPath(data, path, newKey, 'value');
      onChange(newData);
    }
  }, [data, onChange]);

  const handleDelete = useCallback((path: string) => {
    const newData = deleteKeyAtPath(data, path);
    onChange(newData);
  }, [data, onChange]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <button onClick={expandAll} className="px-3 py-1.5 text-sm rounded-md bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
          <Maximize2 className="w-3.5 h-3.5" />
          Expand All
        </button>
        <button onClick={collapseAll} className="px-3 py-1.5 text-sm rounded-md bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
          <Minimize2 className="w-3.5 h-3.5" />
          Collapse All
        </button>
      </div>

      <div className="font-mono text-sm bg-secondary/30 rounded-lg p-4 max-h-[450px] overflow-auto border border-border">
        <JsonNode
          keyName={null}
          value={data}
          path="root"
          depth={0}
          isLast={true}
          isArrayItem={false}
          collapsedPaths={collapsedPaths}
          editingPath={editingPath}
          editingType={editingType}
          onToggle={togglePath}
          onValueEdit={handleValueEdit}
          onKeyEdit={handleKeyEdit}
          onStartEdit={handleStartEdit}
          onEndEdit={handleEndEdit}
          onAdd={handleAdd}
          onDelete={handleDelete}
        />
      </div>
      
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Pencil className="w-3 h-3" />
        Double-click to edit keys/values. Use + to add, trash to delete.
      </p>
    </div>
  );
};

// Main Dataspace Config Page Component
const DataspaceConfigPage = ({ onNext }: DataspaceConfigPageProps) => {
  const [contractUrls, setContractUrls] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<string>("");

  // Fetch JSON from URL with security validation
  const fetchJson = async (url: string): Promise<unknown> => {
    // Validate URL before fetching
    const validation = validateFetchUrl(url);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }
    
    const response = await secureFetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }
    return response.json();
  };

  // Extract data from a single contract URL
  const extractSingleContract = async (contractUrl: string): Promise<{
    softwareResources: ResourceItem[];
    dataResources: ResourceItem[];
    serviceChains: ServiceChain[];
  }> => {
    const contractData = await fetchJson(contractUrl) as Record<string, unknown>;

    // Extract ecosystem info
    const ecosystemUrl = contractData.ecosystem as string;
    let basisInformation: BasisInformation = {
      ecosystem: ecosystemUrl || "",
      name: "",
      description: ""
    };

    if (ecosystemUrl) {
      try {
        const ecosystemData = await fetchJson(ecosystemUrl) as Record<string, unknown>;
        basisInformation.name = (ecosystemData.name as string) || "";
        basisInformation.description = (ecosystemData.description as string) || "";
      } catch (err) {
        console.warn("Could not fetch ecosystem:", err);
      }
    }

    const softwareResources: ResourceItem[] = [];
    const dataResources: ResourceItem[] = [];

    // Extract service offerings
    const serviceOfferings = (contractData.serviceOfferings || []) as { participant?: string; serviceOffering?: string }[];

    for (const offering of serviceOfferings) {
      const participantUrl = offering.participant;
      const serviceOfferingUrl = offering.serviceOffering || "";
      let providerName = "";

      if (participantUrl) {
        try {
          const participantData = await fetchJson(participantUrl) as Record<string, unknown>;
          providerName = (participantData.legalName as string) || "";
        } catch (err) {
          console.warn("Could not fetch participant:", err);
        }
      }

      if (serviceOfferingUrl) {
        try {
          const serviceOfferingData = await fetchJson(serviceOfferingUrl) as Record<string, unknown>;
          const aggregationOf = (serviceOfferingData.aggregationOf || []) as string[];

          for (const resourceUrl of aggregationOf) {
            try {
              const resourceData = await fetchJson(resourceUrl) as Record<string, unknown>;
              
              const name = (resourceData.name as string) || "";
              const description = (resourceData.description as string) || "";
              const resourceType = (resourceData["@type"] as string) || "";
              
              let queryParams: string[] = [];
              const representation = resourceData.representation as Record<string, unknown> | undefined;
              if (representation && representation.queryParams) {
                const params = representation.queryParams;
                if (Array.isArray(params)) {
                  queryParams = params.map(p => String(p));
                } else if (typeof params === 'string') {
                  queryParams = [params];
                }
              }

              const apiResponseRepresentation = resourceData.apiResponseRepresentation as Record<string, unknown> | undefined;

              const resourceItem: ResourceItem = {
                resource: resourceUrl,
                name,
                description,
                queryParam: queryParams,
                provider: providerName,
                serviceOffering: serviceOfferingUrl,
                basisInformation,
                contract: contractUrl
              };

              // Check for #uploadDocument tag
              let uploadFile = false;
              
              const representationInput = representation?.input as Record<string, unknown> | undefined;
              const repInputDescription = (representationInput?.description as string) || "";
              if (repInputDescription.includes("#uploadDocument")) {
                uploadFile = true;
              }
              
              if (!uploadFile) {
                const apiRepInput = apiResponseRepresentation?.input as Record<string, unknown> | undefined;
                const apiInputDescription = (apiRepInput?.description as string) || "";
                if (apiInputDescription.includes("#uploadDocument")) {
                  uploadFile = true;
                }
              }
              
              if (!uploadFile) {
                const nestedRep = apiResponseRepresentation?.representation as Record<string, unknown> | undefined;
                const nestedInput = nestedRep?.input as Record<string, unknown> | undefined;
                const nestedDescription = (nestedInput?.description as string) || "";
                if (nestedDescription.includes("#uploadDocument")) {
                  uploadFile = true;
                }
              }

              // Classify by type
              const typeLower = resourceType.toLowerCase();
              if (typeLower.includes("software") || typeLower.includes("service") || typeLower.includes("application")) {
                softwareResources.push(resourceItem);
              } else {
                dataResources.push({
                  ...resourceItem,
                  apiResponseRepresentation: apiResponseRepresentation || {},
                  uploadFile
                });
              }
            } catch (err) {
              console.warn("Could not fetch resource:", resourceUrl, err);
            }
          }
        } catch (err) {
          console.warn("Could not fetch service offering:", err);
        }
      }
    }

    // Extract active service chains with basisInformation and contract
    const allServiceChains = (contractData.serviceChains || []) as ServiceChain[];
    const filteredServiceChains = allServiceChains
      .filter(chain => (chain as Record<string, unknown>).catalogId)
      .map(chain => ({
        ...chain,
        basisInformation,
        contract: contractUrl
      }));

    return { softwareResources, dataResources, serviceChains: filteredServiceChains };
  };

  // Extract data from multiple contract URLs
  const extractContractData = async () => {
    const urls = contractUrls
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.length > 0);

    if (urls.length === 0) {
      setError("Please enter at least one contract URL");
      return;
    }

    setIsLoading(true);
    setError(null);
    setExtractedData(null);

    try {
      const allSoftwareResources: ResourceItem[] = [];
      const allDataResources: ResourceItem[] = [];
      const allServiceChains: ServiceChain[] = [];

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        setLoadingStatus(`Processing contract ${i + 1} of ${urls.length}: ${url.substring(0, 50)}...`);
        
        try {
          const result = await extractSingleContract(url);
          allSoftwareResources.push(...result.softwareResources);
          allDataResources.push(...result.dataResources);
          allServiceChains.push(...result.serviceChains);
        } catch (err) {
          console.warn(`Failed to extract from ${url}:`, err);
          // Continue with other URLs
        }
      }

      // Deduplicate combined results by resource+contract or catalogId+contract
      setLoadingStatus("Removing duplicates from combined results...");
      
      const uniqueSoftwareResources = allSoftwareResources.filter(
        (item, index, self) => index === self.findIndex(
          r => r.resource === item.resource && r.contract === item.contract
        )
      );
      
      const uniqueDataResources = allDataResources.filter(
        (item, index, self) => index === self.findIndex(
          r => r.resource === item.resource && r.contract === item.contract
        )
      );
      
      const uniqueServiceChains = allServiceChains.filter(
        (item, index, self) => index === self.findIndex(
          chain => (chain.catalogId as string) === (item.catalogId as string) && 
                   (chain.contract as string) === (item.contract as string)
        )
      );

      setExtractedData({
        softwareResources: uniqueSoftwareResources,
        dataResources: uniqueDataResources,
        serviceChains: uniqueServiceChains
      });

      setLoadingStatus("");
      toast.success(`Successfully extracted data from ${urls.length} contract(s)!`);
    } catch (err) {
      // Use sanitized error message to prevent network topology leakage
      const errorMessage = err instanceof Error && err.message.startsWith('Domain') 
        ? err.message 
        : sanitizeNetworkError(err);
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDataChange = (newData: unknown) => {
    setExtractedData(newData as ExtractedData);
  };

  const downloadAsJson = () => {
    if (!extractedData) return;
    
    const jsonString = JSON.stringify(extractedData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `dataspace-config-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast.success("Configuration downloaded as JSON");
  };

  return (
    <div className="animate-fade-in">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/20 border border-primary/30 mb-4">
          <Globe className="w-4 h-4 text-primary" />
          <span className="text-sm text-primary font-medium">Dataspace Configuration</span>
        </div>
        <h2 className="text-3xl font-bold mb-2">
          Configure <span className="gradient-text">Dataspace</span>
        </h2>
        <p className="text-muted-foreground">
          Enter one or more contract URLs to extract and combine ecosystem and resource information
        </p>
      </div>

      {/* URL Input Section */}
      <div className="glass-card p-6 mb-6">
        <h3 className="font-semibold flex items-center gap-2 mb-4">
          <Search className="w-5 h-5 text-primary" />
          Contract URLs
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          Enter one URL per line. Results from all contracts will be combined.
        </p>
        <div className="flex flex-col gap-3">
          <textarea
            value={contractUrls}
            onChange={(e) => setContractUrls(e.target.value)}
            placeholder={"https://example.com/contract1.json\nhttps://example.com/contract2.json"}
            className="w-full min-h-[120px] px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
            disabled={isLoading}
          />
          <button
            onClick={extractContractData}
            disabled={isLoading || !contractUrls.trim()}
            className="self-end px-6 py-2 rounded-lg font-medium bg-primary text-primary-foreground hover:opacity-90 glow-effect transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                Extract All
              </>
            )}
          </button>
        </div>

        {/* Loading Status */}
        {isLoading && loadingStatus && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            {loadingStatus}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mt-4 p-4 rounded-lg bg-destructive/10 border border-destructive/30 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Extraction Failed</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </div>
        )}
      </div>

      {/* Extracted Data Results */}
      {extractedData && (
        <div className="glass-card p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              Extracted Configuration
            </h3>
            <div className="flex items-center gap-4">
              <div className="text-sm text-muted-foreground">
                {extractedData.softwareResources.length} software, {extractedData.dataResources.length} data resources, {extractedData.serviceChains?.length || 0} service chains
              </div>
              <button
                onClick={downloadAsJson}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download JSON
              </button>
            </div>
          </div>
          
          <CollapsibleJson 
            data={extractedData} 
            onChange={handleDataChange}
          />
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="px-8 py-3 rounded-lg font-medium bg-primary text-primary-foreground hover:opacity-90 glow-effect transition-all duration-300"
        >
          Continue to Analytics Selection
        </button>
      </div>
    </div>
  );
};

export default DataspaceConfigPage;
