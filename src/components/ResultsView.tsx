import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { FileJson, FileText, Table as TableIcon, RotateCcw, Download, CheckCircle2, Send, Code, TableProperties, ChevronRight, ChevronDown, Maximize2, Minimize2, Pencil, Plus, Trash2, Loader2, AlertCircle, RefreshCw, Filter, ArrowUpDown, ArrowUp, ArrowDown, Palette, GraduationCap } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ResultUrlInfo, formatResultUrlWithParams, buildResultRequestBody } from "@/utils/resultUrlResolver";
import { isDebugMode } from "@/config/global.config";
import { supabase } from "@/integrations/supabase/client";
import { AnalyticsOption, CustomVisualizationConfig, ExportApiConfig } from "@/types/dataspace";
import D3InsightChart, { LlmVisualizationSpec } from "@/components/results/D3InsightChart";

interface ResultsViewProps {
  analyticsType: string;
  onRestart: () => void;
  resultUrlInfo?: ResultUrlInfo | null;
  exportApiConfigs?: ExportApiConfig[];
  forcedResultData?: unknown;
  forcedResultNotice?: string | null;
  organizationId?: string | null;
  orgExecutionToken?: string | null;
  llmPromptContext?: string | null;
  selectedAnalytics?: AnalyticsOption | null;
  selectedAnalyticsTargetId?: string | null;
  customVisualizations?: CustomVisualizationConfig[];
  showDebugApiExportConfig?: boolean;
}

interface LlmInsightPayload {
  summary?: string;
  insights?: string[];
  visualization?: LlmVisualizationSpec | null;
}

interface ApiRequestPreview {
  targetUrl: string;
  bodies: string[];
  hasAuthorization: boolean;
  forEachMode: boolean;
  forEachRange?: string;
}

interface TemplateTagHelp {
  tag: string;
  title: string;
  description: string;
  example: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const schemaTypeMatches = (schemaType: unknown, value: unknown): boolean => {
  const types = Array.isArray(schemaType) ? schemaType.map(String) : [String(schemaType)];
  return types.some((type) => {
    if (type === "null") return value === null;
    if (type === "array") return Array.isArray(value);
    if (type === "object") return isPlainObject(value);
    if (type === "integer") return typeof value === "number" && Number.isInteger(value);
    if (type === "number") return typeof value === "number";
    if (type === "string") return typeof value === "string";
    if (type === "boolean") return typeof value === "boolean";
    return true;
  });
};

const validateJsonAgainstSchema = (
  value: unknown,
  schema: unknown,
  path = "resultData",
): string[] => {
  if (!isPlainObject(schema)) return [];

  if (Array.isArray(schema.anyOf)) {
    const hasMatch = schema.anyOf.some((candidate) => validateJsonAgainstSchema(value, candidate, path).length === 0);
    return hasMatch ? [] : [`${path} does not match any allowed schema option`];
  }

  const errors: string[] = [];
  if (schema.type && !schemaTypeMatches(schema.type, value)) {
    errors.push(`${path} expected ${Array.isArray(schema.type) ? schema.type.join(" or ") : String(schema.type)}`);
    return errors;
  }

  if (schema.type === "object" && isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.map(String) : [];

    required.forEach((key) => {
      if (!(key in value)) {
        errors.push(`${path}.${key} is required`);
      }
    });

    Object.entries(properties).forEach(([key, propertySchema]) => {
      if (key in value) {
        errors.push(...validateJsonAgainstSchema(value[key], propertySchema, `${path}.${key}`));
      }
    });
  }

  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    value.slice(0, 50).forEach((item, index) => {
      errors.push(...validateJsonAgainstSchema(item, schema.items, `${path}[${index}]`));
    });
  }

  return errors;
};

const escapeHtml = (value: string): string =>
  value.replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[char] || char));

const CUSTOM_VISUALIZATION_ELEMENT = "ptx-custom-visualization";

const ensureCustomVisualizationElement = () => {
  if (typeof window === "undefined" || !window.customElements) return;
  if (window.customElements.get(CUSTOM_VISUALIZATION_ELEMENT)) return;

  window.customElements.define(
    CUSTOM_VISUALIZATION_ELEMENT,
    class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
      }
    },
  );
};

// Fallback data when no result URL is available or fetch fails
const fallbackResultData = {
  message: "No result data available",
  info: "The analytics result could not be fetched. This may be due to missing configuration or network issues.",
  timestamp: new Date().toISOString()
};

const RESULT_PLACEHOLDER = "##result";
const RESULT_ARRAY_PREFIXES = ["##resultArray", "##resultsArray"] as const;
const RESULT_ARRAY_EACH_PREFIXES = ["##resultArrayEach", "##resultsArrayEach"] as const;
const RESULT_OBJECT_EACH_PREFIXES = ["##resultObjectEach", "##resultsObjectEach"] as const;
const TOKEN_TRANSFORM_PATTERN = String.raw`(?:\|replace\((?:"[^"]*"|'[^']*'|[^,)]*),(?:"[^"]*"|'[^']*'|[^)]*)\))?`;
const RESULT_TOKEN_PATTERN = String.raw`(?:##resultArrayEach(?:\.[A-Za-z_$][\w$]*|\[\d+\])*|##resultsArrayEach(?:\.[A-Za-z_$][\w$]*|\[\d+\])*|##resultObjectEach(?:\.[A-Za-z_$][\w$]*|\[\d+\])*|##resultsObjectEach(?:\.[A-Za-z_$][\w$]*|\[\d+\])*|##result(?![A-Za-z])|##results?Array(?:\.[A-Za-z_$][\w$]*|\[\d+\])*)`;
const RESULT_DYNAMIC_TOKEN_REGEX = new RegExp(`${RESULT_TOKEN_PATTERN}${TOKEN_TRANSFORM_PATTERN}`, "g");
const QUOTED_RESULT_DYNAMIC_TOKEN_REGEX = new RegExp(`"(${RESULT_TOKEN_PATTERN}${TOKEN_TRANSFORM_PATTERN})"`, "g");
const TOKEN_SENTINEL_PREFIX = "__PTX_TOKEN__";

type PathToken = string | number;
interface TokenTransform {
  type: "replace";
  search: string;
  replacement: string;
}
interface TokenSpec {
  token: string;
  quoted: boolean;
}
interface EachTokenInfo {
  mode: "array" | "object";
  arrayPath: PathToken[];
  arrayPathKey: string;
  itemPath: PathToken[];
  objectValuePath?: PathToken[];
  objectField?: "key" | "value";
}
interface EachResolveContext {
  arrayPathKey: string;
  item: unknown;
  objectKey?: string;
}

const parseResultArrayPath = (pathExpression: string): PathToken[] => {
  const normalized = pathExpression.replace(/^\./, "");
  if (!normalized) return [];

  const tokens: PathToken[] = [];
  const segments = normalized.split(".").filter(Boolean);

  for (const segment of segments) {
    const segmentRegex = /([A-Za-z_$][\w$]*)|\[(\d+)\]/g;
    let consumed = 0;
    let hadMatch = false;
    let match: RegExpExecArray | null;

    while ((match = segmentRegex.exec(segment)) !== null) {
      if (match.index !== consumed) {
        throw new Error(`Invalid resultArray path segment "${segment}"`);
      }
      consumed = segmentRegex.lastIndex;
      hadMatch = true;
      if (match[1]) {
        tokens.push(match[1]);
      } else {
        tokens.push(Number(match[2]));
      }
    }

    if (!hadMatch || consumed !== segment.length) {
      throw new Error(`Invalid resultArray path segment "${segment}"`);
    }
  }

  return tokens;
};

const pathToKey = (tokens: PathToken[]): string =>
  tokens.map((token) => (typeof token === "number" ? `[${token}]` : `.${token}`)).join("");

const getNextValue = (current: unknown, token: PathToken): unknown => {
  if (current === null || current === undefined) return undefined;

  if (typeof token === "number") {
    if (Array.isArray(current)) return current[token];
    if (typeof current === "object") return (current as Record<string, unknown>)[String(token)];
    return undefined;
  }

  if (typeof current === "object") return (current as Record<string, unknown>)[token];
  return undefined;
};

const getValueByPath = (data: unknown, path: PathToken[]): unknown => {
  let current: unknown = data;
  for (const token of path) {
    current = getNextValue(current, token);
    if (current === undefined) return undefined;
  }
  return current;
};

const unquoteTransformArg = (value: string): string => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const splitTokenTransform = (token: string): { baseToken: string; transform?: TokenTransform } => {
  const match = token.match(/^(.*)\|replace\((?:"([^"]*)"|'([^']*)'|([^,)]*)),(?:"([^"]*)"|'([^']*)'|([^)]*))\)$/);
  if (!match) return { baseToken: token };

  const search = match[2] ?? match[3] ?? unquoteTransformArg(match[4] || "");
  const replacement = match[5] ?? match[6] ?? unquoteTransformArg(match[7] || "");
  return {
    baseToken: match[1],
    transform: {
      type: "replace",
      search,
      replacement,
    },
  };
};

const applyTokenTransform = (value: unknown, transform?: TokenTransform): unknown => {
  if (!transform) return value;

  const applyReplace = (item: unknown): unknown => {
    if (typeof item !== "string") return item;
    if (!transform.search) return item;
    return item.split(transform.search).join(transform.replacement);
  };

  if (Array.isArray(value)) return value.map(applyReplace);
  return applyReplace(value);
};

const parseEachTokenInfo = (token: string, result: unknown): EachTokenInfo => {
  let matchedPrefix: string | undefined;
  for (const prefix of RESULT_ARRAY_EACH_PREFIXES) {
    if (token === prefix || token.startsWith(prefix)) {
      matchedPrefix = prefix;
      break;
    }
  }
  if (!matchedPrefix) {
    throw new Error(`Unsupported token "${token}"`);
  }

  const fullPath = parseResultArrayPath(token.slice(matchedPrefix.length));
  let current: unknown = result;
  for (let i = 0; i < fullPath.length; i++) {
    current = getNextValue(current, fullPath[i]);
    if (current === undefined) {
      throw new Error(`Could not resolve token "${token}" from result data`);
    }
    if (Array.isArray(current)) {
      const arrayPath = fullPath.slice(0, i + 1);
      return {
        mode: "array",
        arrayPath,
        arrayPathKey: pathToKey(arrayPath),
        itemPath: fullPath.slice(i + 1),
      };
    }
  }

  throw new Error(`Token "${token}" must point to an array path`);
};

const parseObjectEachTokenInfo = (token: string): EachTokenInfo => {
  let matchedPrefix: string | undefined;
  for (const prefix of RESULT_OBJECT_EACH_PREFIXES) {
    if (token === prefix || token.startsWith(prefix)) {
      matchedPrefix = prefix;
      break;
    }
  }
  if (!matchedPrefix) {
    throw new Error(`Unsupported token "${token}"`);
  }

  const fullPath = parseResultArrayPath(token.slice(matchedPrefix.length));
  const markerIndex = fullPath.findIndex((pathToken) => pathToken === "$key" || pathToken === "$value");
  if (markerIndex < 0) {
    throw new Error(`Token "${token}" must include .$key or .$value after the object path`);
  }

  const objectField = fullPath[markerIndex] === "$key" ? "key" : "value";
  const objectPath = fullPath.slice(0, markerIndex);
  if (objectPath.length === 0) {
    throw new Error(`Token "${token}" must include an object path before ${objectField === "key" ? "$key" : "$value"}`);
  }

  return {
    mode: "object",
    arrayPath: objectPath,
    arrayPathKey: pathToKey(objectPath),
    itemPath: [],
    objectValuePath: fullPath.slice(markerIndex + 1),
    objectField,
  };
};

const collectEachTokenInfos = (
  node: unknown,
  tokenMap: Map<string, TokenSpec>,
  result: unknown
): EachTokenInfo[] => {
  if (typeof node === "string" && node.startsWith(TOKEN_SENTINEL_PREFIX)) {
    const tokenId = node.slice(TOKEN_SENTINEL_PREFIX.length);
    const spec = tokenMap.get(tokenId);
    if (!spec) return [];
    const { baseToken } = splitTokenTransform(spec.token);
    if (RESULT_ARRAY_EACH_PREFIXES.some((prefix) => baseToken === prefix || baseToken.startsWith(prefix))) {
      return [parseEachTokenInfo(baseToken, result)];
    }
    if (RESULT_OBJECT_EACH_PREFIXES.some((prefix) => baseToken === prefix || baseToken.startsWith(prefix))) {
      return [parseObjectEachTokenInfo(baseToken)];
    }
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap((child) => collectEachTokenInfos(child, tokenMap, result));
  }

  if (node && typeof node === "object") {
    return Object.values(node).flatMap((child) => collectEachTokenInfos(child, tokenMap, result));
  }

  return [];
};

const resolveResultToken = (
  token: string,
  result: unknown,
  eachContext?: EachResolveContext
): unknown => {
  const { baseToken, transform } = splitTokenTransform(token);
  token = baseToken;

  const finish = (value: unknown) => applyTokenTransform(value, transform);

  if (token === RESULT_PLACEHOLDER) return finish(result);

  for (const prefix of RESULT_ARRAY_EACH_PREFIXES) {
    if (token === prefix || token.startsWith(prefix)) {
      const info = parseEachTokenInfo(token, result);

      if (eachContext && eachContext.arrayPathKey === info.arrayPathKey) {
        const value = getValueByPath(eachContext.item, info.itemPath);
        if (value === undefined) throw new Error(`Could not resolve token "${token}" for one array item`);
        return finish(value);
      }

      const sourceArray = getValueByPath(result, info.arrayPath);
      if (!Array.isArray(sourceArray)) throw new Error(`Token "${token}" path does not resolve to an array`);

      return finish(sourceArray.map((item) => {
        const value = getValueByPath(item, info.itemPath);
        if (value === undefined) throw new Error(`Could not resolve token "${token}" for one array item`);
        return value;
      }));
    }
  }

  for (const prefix of RESULT_OBJECT_EACH_PREFIXES) {
    if (token === prefix || token.startsWith(prefix)) {
      const info = parseObjectEachTokenInfo(token);

      if (eachContext && eachContext.arrayPathKey === info.arrayPathKey) {
        if (info.objectField === "key") return finish(eachContext.objectKey);
        const value = getValueByPath(eachContext.item, info.objectValuePath || []);
        if (value === undefined) throw new Error(`Could not resolve token "${token}" for one object entry`);
        return finish(value);
      }

      const sourceObject = getValueByPath(result, info.arrayPath);
      if (!sourceObject || typeof sourceObject !== "object" || Array.isArray(sourceObject)) {
        throw new Error(`Token "${token}" path does not resolve to an object`);
      }

      return finish(Object.entries(sourceObject as Record<string, unknown>).map(([key, value]) => {
        if (info.objectField === "key") return key;
        const resolved = getValueByPath(value, info.objectValuePath || []);
        if (resolved === undefined) throw new Error(`Could not resolve token "${token}" for object entry "${key}"`);
        return resolved;
      }));
    }
  }

  for (const prefix of RESULT_ARRAY_PREFIXES) {
    if (token === prefix) return finish(result);
    if (token.startsWith(prefix)) {
      const pathExpression = token.slice(prefix.length);
      const pathTokens = parseResultArrayPath(pathExpression);
      const resolved = getValueByPath(result, pathTokens);
      if (resolved === undefined) {
        throw new Error(`Could not resolve token "${token}" from result data`);
      }
      return finish(resolved);
    }
  }

  throw new Error(`Unsupported token "${token}"`);
};

const buildApiExportBody = (template: string, result: unknown): string => {
  if (!template.trim()) {
    throw new Error("Request body template cannot be empty");
  }

  let tokenIndex = 0;
  const tokenMap = new Map<string, TokenSpec>();
  const nextTokenId = () => {
    tokenIndex += 1;
    return `T${tokenIndex}`;
  };

  const withQuotedTokens = template.replace(QUOTED_RESULT_DYNAMIC_TOKEN_REGEX, (_full, token: string) => {
    const tokenId = nextTokenId();
    tokenMap.set(tokenId, { token, quoted: true });
    return `"${TOKEN_SENTINEL_PREFIX}${tokenId}"`;
  });

  const withAllTokens = withQuotedTokens.replace(RESULT_DYNAMIC_TOKEN_REGEX, (token) => {
    const tokenId = nextTokenId();
    tokenMap.set(tokenId, { token, quoted: false });
    return `"${TOKEN_SENTINEL_PREFIX}${tokenId}"`;
  });

  let parsedTemplate: unknown;
  try {
    parsedTemplate = JSON.parse(withAllTokens);
  } catch {
    throw new Error(
      "Invalid JSON template. Supported tokens: ##result, ##resultArray.path[0], ##resultsArray.path[0], ##resultArrayEach.path.to.array.field, ##resultObjectEach.path.$key, ##resultObjectEach.path.$value.field."
    );
  }

  const resolveNode = (node: unknown, eachContext?: EachResolveContext): unknown => {
    if (typeof node === "string" && node.startsWith(TOKEN_SENTINEL_PREFIX)) {
      const tokenId = node.slice(TOKEN_SENTINEL_PREFIX.length);
      const spec = tokenMap.get(tokenId);
      if (!spec) throw new Error(`Unknown token reference "${node}"`);

      const resolved = resolveResultToken(spec.token, result, eachContext);
      if (!spec.quoted) return resolved;
      if (typeof resolved === "string") return resolved;
      return JSON.stringify(resolved);
    }

    if (Array.isArray(node)) {
      if (node.length === 1) {
        const eachInfos = collectEachTokenInfos(node[0], tokenMap, result);
        if (eachInfos.length > 0) {
          const firstPathKey = eachInfos[0].arrayPathKey;
          if (!eachInfos.every((info) => info.arrayPathKey === firstPathKey)) {
            throw new Error("All ##resultArrayEach tokens in one template array item must target the same source array");
          }

          const firstInfo = eachInfos[0];
          const sourceCollection = getValueByPath(result, firstInfo.arrayPath);
          if (firstInfo.mode === "array" && !Array.isArray(sourceCollection)) {
            throw new Error("##resultArrayEach source path does not resolve to an array");
          }
          if (firstInfo.mode === "object" && (!sourceCollection || typeof sourceCollection !== "object" || Array.isArray(sourceCollection))) {
            throw new Error("##resultObjectEach source path does not resolve to an object");
          }

          if (firstInfo.mode === "array") {
            return (sourceCollection as unknown[]).map((item) => resolveNode(node[0], { arrayPathKey: firstPathKey, item }));
          }

          return Object.entries(sourceCollection as Record<string, unknown>).flatMap(([objectKey, item]) => {
            try {
              return [resolveNode(node[0], { arrayPathKey: firstPathKey, item, objectKey })];
            } catch {
              return [];
            }
          });
        }
      }

      return node.map((child) => resolveNode(child, eachContext));
    }

    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        out[key] = resolveNode(value, eachContext);
      }
      return out;
    }

    return node;
  };

  const resolved = resolveNode(parsedTemplate);
  return JSON.stringify(resolved);
};

interface ForEachDirective {
  enabled: boolean;
  startIndex: number;
  endIndex?: number;
}

const parseForEachDirective = (template: string): { bodyTemplate: string; directive: ForEachDirective } => {
  const match = template.match(/^\s*##forEach(?:\((\d*):(\d*)\))?\s*/);
  if (!match) {
    return {
      bodyTemplate: template,
      directive: { enabled: false, startIndex: 0 },
    };
  }

  const startRaw = match[1];
  const endRaw = match[2];
  const startIndex = startRaw === undefined || startRaw === "" ? 0 : Number(startRaw);
  const endIndex = endRaw === undefined || endRaw === "" ? undefined : Number(endRaw);

  if (!Number.isInteger(startIndex) || startIndex < 0) {
    throw new Error("Invalid ##forEach start index");
  }
  if (endIndex !== undefined && (!Number.isInteger(endIndex) || endIndex < 0)) {
    throw new Error("Invalid ##forEach end index");
  }
  if (endIndex !== undefined && endIndex < startIndex) {
    throw new Error("##forEach end index must be greater than or equal to start index");
  }

  return {
    bodyTemplate: template.slice(match[0].length),
    directive: {
      enabled: true,
      startIndex,
      endIndex,
    },
  };
};

const buildApiExportBodies = (template: string, result: unknown): { bodies: string[]; forEachRange?: string } => {
  const { bodyTemplate, directive } = parseForEachDirective(template);
  const singleBody = buildApiExportBody(bodyTemplate, result);

  if (!directive.enabled) {
    return { bodies: [singleBody] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(singleBody);
  } catch {
    throw new Error("##forEach template must resolve to a valid JSON array");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("##forEach requires the resolved request body to be a JSON array");
  }

  const start = directive.startIndex;
  const endInclusive = directive.endIndex ?? parsed.length - 1;
  const slice = parsed.slice(start, endInclusive + 1);

  if (slice.length === 0) {
    throw new Error("##forEach range resolved to zero items");
  }

  return {
    bodies: slice.map((item) => JSON.stringify(item)),
    forEachRange: `${start}:${directive.endIndex ?? ""}`,
  };
};

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
    description: "Generate an array item template from each element in a source array.",
    example:
      '[\n  {\n    "name": ##resultArrayEach.data.content.data.nodes.label,\n    "weight": ##resultArrayEach.data.content.data.nodes.weight\n  }\n]',
  },
  {
    tag: "##resultObjectEach",
    title: "Map Object Entries",
    description: "Generate an array item template from each key/value pair in a source object. Use .$key for the object key and .$value for fields inside that value. Entries missing a selected field are skipped.",
    example:
      '[\n  {\n    "skill_name": ##resultObjectEach.data.content.data.result.$key|replace("_"," "),\n    "description": ##resultObjectEach.data.content.data.result.$value.skills[0].description.literal\n  }\n]',
  },
  {
    tag: "##forEach",
    title: "Send Multiple POST Requests",
    description: "Prefix template to send one POST per item of the resolved array body. Use ##forEach(0:2) for the first 3 items.",
    example:
      '##forEach(0:2)\n[\n  {\n    "skill_name": ##resultObjectEach.data.content.data.result.$key|replace("_"," "),\n    "description": ##resultObjectEach.data.content.data.result.$value.skills[0].description.literal\n  }\n]',
  },
];

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

  // Check if parent is an array - if so, rename in all siblings
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

  // Single object rename
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
    
    // Parse the value appropriately
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
      // Generate unique key name
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
        <button onClick={expandAll} className="theme-button subtle px-3 py-1.5 text-[length:var(--theme-font-size-s)]">
          <Maximize2 className="w-3.5 h-3.5" />
          Expand All
        </button>
        <button onClick={collapseAll} className="theme-button subtle px-3 py-1.5 text-[length:var(--theme-font-size-s)]">
          <Minimize2 className="w-3.5 h-3.5" />
          Collapse All
        </button>
      </div>

      <div className="theme-json-surface p-4 max-h-[450px] overflow-auto">
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

// Table View Components
const getTypeBadge = (value: unknown) => {
  if (typeof value === 'number') return { label: 'number', className: 'bg-blue-500/20 text-blue-400' };
  if (typeof value === 'boolean') return { label: 'boolean', className: 'bg-yellow-500/20 text-yellow-400' };
  if (typeof value === 'string') return { label: 'string', className: 'bg-green-500/20 text-green-400' };
  if (Array.isArray(value)) return { label: `array[${value.length}]`, className: 'bg-purple-500/20 text-purple-400' };
  if (typeof value === 'object' && value !== null) return { label: 'object', className: 'bg-orange-500/20 text-orange-400' };
  return { label: 'null', className: 'bg-muted text-muted-foreground' };
};

interface FlattenedRow {
  keyPath: string;
  displayKey: string;
  actualKey: string;
  value: unknown;
  depth: number;
  isExpandable: boolean;
  parentPath: string;
  isArrayItem: boolean;
}

const flattenData = (data: unknown, parentPath = '', depth = 0, parentIsArray = false): FlattenedRow[] => {
  const rows: FlattenedRow[] = [];
  if (typeof data !== 'object' || data === null) return rows;

  const isArray = Array.isArray(data);
  const entries = Object.entries(data);
  
  for (const [key, value] of entries) {
    const keyPath = parentPath ? `${parentPath}.${key}` : key;
    const isExpandable = typeof value === 'object' && value !== null;
    const displayKey = isArray ? `[${key}]` : key;
    
    rows.push({ keyPath, displayKey, actualKey: key, value, depth, isExpandable, parentPath, isArrayItem: parentIsArray });
    
    if (isExpandable) {
      rows.push(...flattenData(value, keyPath, depth + 1, Array.isArray(value)));
    }
  }
  return rows;
};

interface NestedTableProps {
  data: unknown;
  onEdit: (path: string, value: string) => void;
  onKeyEdit: (path: string, oldKey: string, newKey: string) => void;
  onAdd: (path: string) => void;
  onDelete: (path: string) => void;
}

const NestedTable = ({ data, onEdit, onKeyEdit, onAdd, onDelete }: NestedTableProps) => {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (typeof data === 'object' && data !== null) {
      Object.keys(data).forEach(key => initial.add(key));
    }
    return initial;
  });
  const [editingKeyPath, setEditingKeyPath] = useState<string | null>(null);

  const allRows = useMemo(() => flattenData(data), [data]);

  // Reset expanded paths when data structure changes significantly
  useEffect(() => {
    if (typeof data === 'object' && data !== null) {
      const newInitial = new Set<string>();
      Object.keys(data).forEach(key => newInitial.add(key));
      setExpandedPaths(newInitial);
    }
  }, []);

  const toggleExpand = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        for (const p of next) {
          if (p === path || p.startsWith(path + '.')) next.delete(p);
        }
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const isVisible = (row: FlattenedRow): boolean => {
    if (row.depth === 0) return true;
    const parts = row.parentPath.split('.');
    let currentPath = '';
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}.${part}` : part;
      if (!expandedPaths.has(currentPath)) return false;
    }
    return true;
  };

  const visibleRows = allRows.filter(isVisible);

  const handleKeySubmit = (row: FlattenedRow, newKeyName: string) => {
    if (newKeyName && newKeyName !== row.actualKey) {
      onKeyEdit(row.keyPath, row.actualKey, newKeyName);
    }
    setEditingKeyPath(null);
  };

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-secondary z-10">
              <TableRow>
                <TableHead className="font-semibold text-foreground w-[30%]">Key</TableHead>
                <TableHead className="font-semibold text-foreground w-[40%]">Value</TableHead>
                <TableHead className="font-semibold text-foreground w-[15%]">Type</TableHead>
                <TableHead className="font-semibold text-foreground w-[15%]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => {
                const typeBadge = getTypeBadge(row.value);
                const isExpanded = expandedPaths.has(row.keyPath);
                const isEditingKey = editingKeyPath === row.keyPath;
                
                return (
                  <TableRow key={row.keyPath} className="hover:bg-secondary/50 border-b border-border/50 group">
                    <TableCell className="font-medium py-2" style={{ paddingLeft: `${row.depth * 24 + 12}px` }}>
                      <div className="flex items-center gap-2">
                        {row.isExpandable ? (
                          <button onClick={() => toggleExpand(row.keyPath)} className="p-0.5 rounded hover:bg-primary/20 transition-colors">
                            {isExpanded ? <ChevronDown className="w-4 h-4 text-primary" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                          </button>
                        ) : (
                          <span className="w-5" />
                        )}
                        {isEditingKey ? (
                          <Input
                            defaultValue={row.actualKey}
                            onBlur={(e) => handleKeySubmit(row, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleKeySubmit(row, (e.target as HTMLInputElement).value);
                              if (e.key === 'Escape') setEditingKeyPath(null);
                            }}
                            className="h-7 w-32 text-sm"
                            autoFocus
                          />
                        ) : (
                          <span 
                            className={`${row.isExpandable ? 'font-semibold' : ''} ${
                              row.isArrayItem ? 'text-muted-foreground' : 'cursor-pointer hover:bg-primary/20 rounded px-1 group/key inline-flex items-center gap-1'
                            }`}
                            onDoubleClick={() => {
                              if (!row.isArrayItem) {
                                setEditingKeyPath(row.keyPath);
                              }
                            }}
                            title={row.isArrayItem ? "Array index (read-only)" : "Double-click to edit key"}
                          >
                            {row.displayKey}
                            {!row.isArrayItem && <Pencil className="w-3 h-3 opacity-0 group-hover/key:opacity-50" />}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      {row.isExpandable ? (
                        <span className="text-sm text-muted-foreground italic">
                          {Array.isArray(row.value) ? `${(row.value as unknown[]).length} items` : `${Object.keys(row.value as object).length} properties`}
                        </span>
                      ) : (
                        <Input
                          value={String(row.value ?? '')}
                          onChange={(e) => onEdit(row.keyPath, e.target.value)}
                          className="h-8 border-0 bg-transparent hover:bg-secondary/50 focus:bg-secondary/50 rounded px-2 font-mono text-sm"
                        />
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <span className={`text-xs px-2 py-1 rounded-full ${typeBadge.className}`}>{typeBadge.label}</span>
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {row.isExpandable && (
                          <button
                            onClick={() => onAdd(row.keyPath)}
                            className="p-1.5 rounded hover:bg-primary/20 transition-colors"
                            title={Array.isArray(row.value) ? "Add new item" : "Add new property"}
                          >
                            <Plus className="w-3.5 h-3.5 text-primary" />
                          </button>
                        )}
                        <button
                          onClick={() => onDelete(row.keyPath)}
                          className="p-1.5 rounded hover:bg-destructive/20 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Pencil className="w-3 h-3" />
        Double-click to edit keys. Use + to add, trash to delete.
      </p>
    </div>
  );
};

// Array Table View Component - filterable by path
interface ArrayTableViewProps {
  data: unknown;
  onChange: (newData: unknown) => void;
}

type SortDirection = 'asc' | 'desc' | null;

const getValueAtPath = (obj: unknown, path: string): unknown => {
  if (!path || path === '') return obj;
  const keys = path.split('.').filter(k => k);
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = parseInt(key, 10);
      if (!isNaN(index)) {
        current = current[index];
      } else {
        return undefined;
      }
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
};

const setValueAtPath = (obj: unknown, path: string, value: unknown): unknown => {
  const result = JSON.parse(JSON.stringify(obj));
  if (!path || path === '') return value;
  const keys = path.split('.').filter(k => k);
  let current: Record<string, unknown> = result;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] === undefined) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
  return result;
};

const findArrayPaths = (data: unknown, currentPath = '', maxDepth = 10): string[] => {
  const paths: string[] = [];
  if (maxDepth <= 0) return paths;
  if (typeof data !== 'object' || data === null) return paths;
  
  if (Array.isArray(data) && data.length > 0) {
    // Any non-empty array is table-suitable (primitives shown as single-column)
    paths.push(currentPath || 'root');
    
    // Also check nested arrays inside array items (only first item to avoid explosion)
    const firstItem = data[0];
    if (typeof firstItem === 'object' && firstItem !== null && !Array.isArray(firstItem)) {
      for (const [key, value] of Object.entries(firstItem)) {
        const newPath = currentPath ? `${currentPath}.0.${key}` : `0.${key}`;
        paths.push(...findArrayPaths(value, newPath, maxDepth - 1));
      }
    }
  } else {
    for (const [key, value] of Object.entries(data)) {
      const newPath = currentPath ? `${currentPath}.${key}` : key;
      paths.push(...findArrayPaths(value, newPath, maxDepth - 1));
    }
  }
  
  return [...new Set(paths)];
};

const ArrayTableView = ({ data, onChange }: ArrayTableViewProps) => {
  const [arrayPath, setArrayPath] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; column: string } | null>(null);

  // Find all array paths in the data
  const availablePaths = useMemo(() => findArrayPaths(data), [data]);

  // Get the array at the specified path
  const arrayData = useMemo(() => {
    if (!arrayPath) return null;
    const value = getValueAtPath(data, arrayPath);
    if (Array.isArray(value) && value.length > 0) {
      return value;
    }
    return null;
  }, [data, arrayPath]);

  // Normalize array data - wrap primitives into objects for table display
  const normalizedData = useMemo(() => {
    if (!arrayData) return null;
    const firstItem = arrayData[0];
    if (typeof firstItem !== 'object' || firstItem === null || Array.isArray(firstItem)) {
      // Wrap primitives into { value: ... } objects
      return arrayData.map((item: unknown) => ({ value: item }));
    }
    return arrayData;
  }, [arrayData]);

  // Get column headers from the first item
  const columns = useMemo(() => {
    if (!normalizedData || normalizedData.length === 0) return [];
    const firstItem = normalizedData[0];
    if (typeof firstItem !== 'object' || firstItem === null) return [];
    return Object.keys(firstItem);
  }, [normalizedData]);

  // Sort the data
  const sortedData = useMemo(() => {
    if (!normalizedData) return [];
    if (!sortColumn || !sortDirection) return normalizedData.map((item: Record<string, unknown>, index: number) => ({ ...item, _originalIndex: index }));
    
    return [...normalizedData]
      .map((item: Record<string, unknown>, index: number) => ({ ...item, _originalIndex: index }))
      .sort((a, b) => {
        const aVal = a[sortColumn];
        const bVal = b[sortColumn];
        
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
        
        let comparison = 0;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          comparison = aVal - bVal;
        } else {
          comparison = String(aVal).localeCompare(String(bVal));
        }
        
        return sortDirection === 'desc' ? -comparison : comparison;
      });
  }, [normalizedData, sortColumn, sortDirection]);

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const handleCellEdit = (rowIndex: number, column: string, value: string) => {
    if (!arrayData) return;
    
    const newArray = [...arrayData];
    const originalIndex = sortedData[rowIndex]._originalIndex;
    const originalValue = newArray[originalIndex][column];
    
    // Parse value appropriately
    let parsedValue: unknown = value;
    if (typeof originalValue === 'number') {
      const num = parseFloat(value);
      parsedValue = isNaN(num) ? value : num;
    } else if (typeof originalValue === 'boolean') {
      parsedValue = value === 'true';
    }
    
    newArray[originalIndex] = { ...newArray[originalIndex], [column]: parsedValue };
    const newData = setValueAtPath(data, arrayPath, newArray);
    onChange(newData);
    toast.success('Cell updated');
  };

  const handleDeleteRow = (rowIndex: number) => {
    if (!arrayData) return;
    
    const originalIndex = sortedData[rowIndex]._originalIndex;
    const newArray = arrayData.filter((_, i) => i !== originalIndex);
    const newData = setValueAtPath(data, arrayPath, newArray);
    onChange(newData);
    toast.success('Row deleted');
  };

  const handleAddRow = () => {
    if (!arrayData || columns.length === 0) return;
    
    // Create new row with empty values matching column types
    const firstItem = arrayData[0];
    const newRow: Record<string, unknown> = {};
    for (const col of columns) {
      const sampleValue = firstItem[col];
      if (typeof sampleValue === 'number') {
        newRow[col] = 0;
      } else if (typeof sampleValue === 'boolean') {
        newRow[col] = false;
      } else {
        newRow[col] = '';
      }
    }
    
    const newArray = [...arrayData, newRow];
    const newData = setValueAtPath(data, arrayPath, newArray);
    onChange(newData);
    toast.success('Row added');
  };

  const handleExportArrayTable = (format: 'json' | 'csv') => {
    if (!arrayData) return;
    
    let content: string;
    let mimeType: string;
    let extension: string;
    
    if (format === 'json') {
      content = JSON.stringify(arrayData, null, 2);
      mimeType = 'application/json';
      extension = 'json';
    } else {
      // CSV export
      const headers = columns.join(',');
      const rows = arrayData.map((item: Record<string, unknown>) => 
        columns.map(col => {
          const val = item[col];
          if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val ?? '';
        }).join(',')
      );
      content = [headers, ...rows].join('\n');
      mimeType = 'text/csv';
      extension = 'csv';
    }
    
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `array-data-${arrayPath.replace(/\./g, '-')}.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Array exported as ${extension.toUpperCase()}`);
  };

  const getSortIcon = (column: string) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="w-3 h-3 opacity-50" />;
    }
    if (sortDirection === 'asc') {
      return <ArrowUp className="w-3 h-3 text-primary" />;
    }
    return <ArrowDown className="w-3 h-3 text-primary" />;
  };

  return (
    <div className="space-y-4">
      {/* Path Selection */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <label className="text-sm text-muted-foreground mb-2 block flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Array Path (e.g., content.data.skills)
          </label>
          <div className="flex gap-2">
            <Input
              value={arrayPath}
              onChange={(e) => setArrayPath(e.target.value)}
              placeholder="Enter path to array (e.g., content.data.skills)"
              className="flex-1 bg-secondary/30"
            />
          </div>
          {availablePaths.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="text-xs text-muted-foreground">Available arrays:</span>
              {availablePaths.map((path) => (
                <button
                  key={path}
                  onClick={() => setArrayPath(path === 'root' ? '' : path)}
                  className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                    arrayPath === path || (path === 'root' && arrayPath === '')
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                  }`}
                >
                  {path === 'root' ? '(root array)' : path}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Table or placeholder */}
      {!arrayPath && !normalizedData && (
        <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-lg">
          <Filter className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-sm">Enter a path to a nested array to display it as a table</p>
          <p className="text-xs mt-2">Example: If your JSON has <code className="bg-secondary px-1 rounded">{"{ content: { data: { skills: [...] } } }"}</code></p>
          <p className="text-xs">Enter: <code className="bg-secondary px-1 rounded">content.data.skills</code></p>
        </div>
      )}

      {arrayPath && !normalizedData && (
        <div className="text-center py-12 text-destructive/80 border border-dashed border-destructive/30 rounded-lg bg-destructive/5">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-sm">No array found at path: <code className="bg-secondary px-1 rounded">{arrayPath}</code></p>
          <p className="text-xs mt-2 text-muted-foreground">Make sure the path points to an array of objects</p>
        </div>
      )}

      {normalizedData && columns.length > 0 && (
        <>
          {/* Table Actions */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {normalizedData.length} items • {columns.length} columns
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddRow}
                className="px-3 py-1.5 text-sm rounded-md bg-primary/20 text-primary hover:bg-primary/30 transition-colors flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Row
              </button>
              <button
                onClick={() => handleExportArrayTable('csv')}
                className="px-3 py-1.5 text-sm rounded-md bg-secondary text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
              <button
                onClick={() => handleExportArrayTable('json')}
                className="px-3 py-1.5 text-sm rounded-md bg-secondary text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                JSON
              </button>
            </div>
          </div>

          {/* Data Table */}
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-secondary z-10">
                  <TableRow>
                    <TableHead className="w-12 font-semibold text-foreground">#</TableHead>
                    {columns.map((col) => (
                      <TableHead 
                        key={col} 
                        className="font-semibold text-foreground cursor-pointer hover:bg-primary/10 transition-colors"
                        onClick={() => handleSort(col)}
                      >
                        <div className="flex items-center gap-1.5">
                          {col}
                          {getSortIcon(col)}
                        </div>
                      </TableHead>
                    ))}
                    <TableHead className="w-16 font-semibold text-foreground">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedData.map((row, rowIndex) => (
                    <TableRow key={row._originalIndex} className="hover:bg-secondary/50 group">
                      <TableCell className="text-muted-foreground text-sm font-mono">
                        {row._originalIndex + 1}
                      </TableCell>
                      {columns.map((col) => {
                        const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.column === col;
                        const cellValue = row[col];
                        
                        return (
                          <TableCell key={col} className="py-2">
                            {isEditing ? (
                              <Input
                                defaultValue={String(cellValue ?? '')}
                                onBlur={(e) => {
                                  handleCellEdit(rowIndex, col, e.target.value);
                                  setEditingCell(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleCellEdit(rowIndex, col, (e.target as HTMLInputElement).value);
                                    setEditingCell(null);
                                  }
                                  if (e.key === 'Escape') {
                                    setEditingCell(null);
                                  }
                                }}
                                className="h-7 text-sm"
                                autoFocus
                              />
                            ) : (
                              <div
                                className="cursor-pointer px-2 py-1 rounded hover:bg-primary/10 transition-colors font-mono text-sm inline-flex items-center gap-1 group/cell"
                                onDoubleClick={() => setEditingCell({ rowIndex, column: col })}
                                title="Double-click to edit"
                              >
                                {typeof cellValue === 'boolean' ? (
                                  <span className={cellValue ? 'text-green-400' : 'text-red-400'}>
                                    {String(cellValue)}
                                  </span>
                                ) : typeof cellValue === 'number' ? (
                                  <span className="text-blue-400">{cellValue}</span>
                                ) : cellValue === null || cellValue === undefined ? (
                                  <span className="text-muted-foreground italic">null</span>
                                ) : typeof cellValue === 'object' ? (
                                  <span className="text-orange-400 text-xs">{JSON.stringify(cellValue)}</span>
                                ) : (
                                  <span>{String(cellValue)}</span>
                                )}
                                <Pencil className="w-3 h-3 opacity-0 group-hover/cell:opacity-50" />
                              </div>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell>
                        <button
                          onClick={() => handleDeleteRow(rowIndex)}
                          className="p-1.5 rounded hover:bg-destructive/20 transition-colors opacity-0 group-hover:opacity-100"
                          title="Delete row"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Pencil className="w-3 h-3" />
            Double-click cells to edit. Click column headers to sort.
          </p>
        </>
      )}
    </div>
  );
};

const LoadingJsonSkeleton = () => {
  const widths = ["w-11/12", "w-8/12", "w-10/12", "w-7/12", "w-9/12", "w-6/12", "w-10/12", "w-5/12"];

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-secondary/20">
      <div className="space-y-3 p-4 blur-[1.5px]">
        {widths.map((width, index) => (
          <div key={`${width}-${index}`} className={`h-4 rounded bg-muted/70 animate-pulse ${width}`} />
        ))}
      </div>
      <div className="absolute inset-0 bg-background/45 backdrop-blur-[2px]" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <span className="text-sm text-muted-foreground">Loading result JSON...</span>
      </div>
    </div>
  );
};

interface CustomVisualizationRuntimeProps {
  visualization: CustomVisualizationConfig;
  resultData: unknown;
  onResultDataChange: (nextData: unknown) => void;
}

const CustomVisualizationRuntime = ({ visualization, resultData, onResultDataChange }: CustomVisualizationRuntimeProps) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    const blobUrls: string[] = [];
    const scriptElements: HTMLScriptElement[] = [];
    let hostElement: HTMLElement | null = null;

    ensureCustomVisualizationElement();
    mount.innerHTML = "";

    hostElement = document.createElement(CUSTOM_VISUALIZATION_ELEMENT);
    hostElement.style.display = "block";
    hostElement.style.width = "100%";
    hostElement.style.maxWidth = "100%";
    hostElement.style.minHeight = "360px";
    mount.appendChild(hostElement);

    const shadowRoot = hostElement.shadowRoot ?? hostElement.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = "";

    const baseStyle = document.createElement("style");
    baseStyle.textContent = `
      :host {
        display: block;
        width: 100%;
        max-width: 100%;
        min-height: 360px;
        color: inherit;
        font: inherit;
      }
      *, *::before, *::after {
        box-sizing: border-box;
      }
      .ptx-custom-visualization-container {
        display: block;
        width: 100%;
        max-width: 100%;
        min-height: 360px;
        overflow: auto;
        color: inherit;
        font: inherit;
      }
      .ptx-custom-visualization-error {
        padding: 16px;
        border: 1px solid rgba(239, 68, 68, 0.35);
        border-radius: 12px;
        color: #ef4444;
        background: rgba(239, 68, 68, 0.06);
      }
      .ptx-custom-visualization-error p {
        margin: 8px 0 0;
        font-size: 13px;
      }
    `;
    shadowRoot.appendChild(baseStyle);

    const container = document.createElement("div");
    container.className = "ptx-custom-visualization-container";
    shadowRoot.appendChild(container);

    const cleanup = () => {
      disposed = true;
      scriptElements.forEach((scriptElement) => {
        if (scriptElement.parentNode) {
          scriptElement.parentNode.removeChild(scriptElement);
        }
      });
      blobUrls.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
      if (hostElement?.parentNode) {
        hostElement.parentNode.removeChild(hostElement);
      }
    };

    const enforceTabulatorButtonsVisible = () => {
      const saveButtons = Array.from(shadowRoot.querySelectorAll<HTMLElement>(".tabulator-save-button"));
      const resetButtons = Array.from(shadowRoot.querySelectorAll<HTMLElement>(".tabulator-reset-button"));
      [...saveButtons, ...resetButtons].forEach((button) => {
        button.style.setProperty("display", "inline-flex", "important");
        button.style.setProperty("visibility", "visible", "important");
        button.style.setProperty("opacity", "1", "important");
      });
    };

    const appendCss = (content: string, fileName?: string) => {
      if (!content.trim()) return;
      const styleElement = document.createElement("style");
      styleElement.setAttribute("data-ptx-custom-visualization-file", fileName || "uploaded-css");
      styleElement.textContent = content;
      shadowRoot.appendChild(styleElement);
    };

    const appendCssUrl = (href: string) =>
      new Promise<void>((resolve, reject) => {
        if (!href.trim()) {
          resolve();
          return;
        }

        const linkElement = document.createElement("link");
        linkElement.rel = "stylesheet";
        linkElement.href = href;
        linkElement.setAttribute("data-ptx-custom-visualization-file", href);
        linkElement.onload = () => resolve();
        linkElement.onerror = () => reject(new Error("Failed to load custom visualization stylesheet"));
        shadowRoot.appendChild(linkElement);
      });

    const loadScriptSource = (scriptSource: string, sourceType: "upload" | "url", fileName?: string) =>
      new Promise<void>((resolve, reject) => {
        if (!scriptSource?.trim()) {
          resolve();
          return;
        }

        const stylesBeforeLoad = new Set(
          Array.from(document.head.querySelectorAll("style, link[rel='stylesheet']")),
        );

        const scriptElement = document.createElement("script");
        scriptElement.async = true;
        scriptElement.crossOrigin = "anonymous";
        scriptElement.setAttribute("data-ptx-custom-visualization-file", fileName || sourceType);
        scriptElement.onload = () => {
          const injectedStyles = Array.from(document.head.querySelectorAll("style, link[rel='stylesheet']"))
            .filter((node) => !stylesBeforeLoad.has(node));

          injectedStyles.forEach((node) => {
            shadowRoot.appendChild(node);
          });

          resolve();
        };
        scriptElement.onerror = () => reject(new Error("Failed to load custom visualization library"));

        if (sourceType === "upload") {
          const blobUrl = URL.createObjectURL(new Blob([scriptSource], { type: "text/javascript" }));
          blobUrls.push(blobUrl);
          scriptElement.src = blobUrl;
        } else {
          scriptElement.src = scriptSource;
        }

        scriptElements.push(scriptElement);
        document.head.appendChild(scriptElement);
      });

    const loadLibraries = async () => {
      const uploadedFiles = visualization.library_source === "bundle"
        ? visualization.library_bundle_files || []
        : visualization.library_files || [];

      uploadedFiles
        .filter((file) => file.file_type === "css")
        .forEach((file) => appendCss(file.content, file.file_name));

      for (const file of uploadedFiles.filter((item) => item.file_type === "js")) {
        await loadScriptSource(file.content, "upload", file.file_name);
      }

      if (uploadedFiles.length > 0) return;

      if (visualization.library_source === "upload") {
        await loadScriptSource(visualization.library_code || "", "upload", visualization.library_file_name);
      } else {
        const libraryUrls = (visualization.library_url || "").split(/\s+/).filter(Boolean);
        for (const libraryUrl of libraryUrls) {
          if (/\.css($|[?#])/.test(libraryUrl)) {
            await appendCssUrl(libraryUrl);
          } else {
            await loadScriptSource(libraryUrl, "url");
          }
        }
      }
    };

    const runVisualization = async () => {
      container.innerHTML = "";
      try {
        await loadLibraries();
        if (disposed) return;

        const hasInputSchema = Boolean(visualization.json_schema?.trim());
        const jsonSchema = hasInputSchema ? JSON.parse(visualization.json_schema) : null;
        if (hasInputSchema) {
          const schemaErrors = validateJsonAgainstSchema(resultData, jsonSchema);
          if (schemaErrors.length > 0) {
            throw new Error(
              `Fetched result JSON does not match this custom visualization schema: ${schemaErrors.slice(0, 5).join("; ")}`
            );
          }
        }
        const render = new Function(
          "container",
          "resultData",
          "jsonSchema",
          "config",
          "shadowRoot",
          "updateResultData",
          `"use strict";\n${visualization.render_code || ""}`
        );
        await render(container, resultData, jsonSchema, visualization, shadowRoot, onResultDataChange);
        enforceTabulatorButtonsVisible();

        // Defensive: some older saved render scripts toggle inline display:none after init.
        const observer = new MutationObserver(() => {
          enforceTabulatorButtonsVisible();
        });
        observer.observe(shadowRoot, { subtree: true, attributes: true, childList: true, attributeFilter: ["style", "class"] });
        setTimeout(() => observer.disconnect(), 3000);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Custom visualization failed";
        container.innerHTML = `
          <div class="ptx-custom-visualization-error">
            <strong>Custom visualization error</strong>
            <p>${escapeHtml(message)}</p>
          </div>
        `;
      }
    };

    void runVisualization();
    return cleanup;
  }, [visualization, resultData, onResultDataChange]);

  return (
    <div className="space-y-3">
      {visualization.description && (
        <p className="text-sm text-muted-foreground">{visualization.description}</p>
      )}
      <div ref={mountRef} className="min-h-[360px] rounded-lg border border-border bg-background/40 p-4 overflow-auto" />
    </div>
  );
};

const ResultsView = ({
  analyticsType,
  onRestart,
  resultUrlInfo,
  exportApiConfigs = [],
  forcedResultData,
  forcedResultNotice,
  organizationId,
  orgExecutionToken,
  llmPromptContext,
  selectedAnalytics,
  selectedAnalyticsTargetId,
  customVisualizations = [],
  showDebugApiExportConfig = false,
}: ResultsViewProps) => {
  const [resultData, setResultData] = useState<unknown>(fallbackResultData);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [apiUrl, setApiUrl] = useState("");
  const [apiAuthorization, setApiAuthorization] = useState("");
  const [apiParams, setApiParams] = useState<Array<{ key: string; value: string }>>([]);
  const [selectedExportApi, setSelectedExportApi] = useState<string>("");
  const [apiTemplate, setApiTemplate] = useState('{\n  "data": ##result,\n  "timestamp": "2024-01-01"\n}');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [pendingApiRequest, setPendingApiRequest] = useState<ApiRequestPreview | null>(null);
  const [isSendingToApi, setIsSendingToApi] = useState(false);
  const [isTagHelpOpen, setIsTagHelpOpen] = useState(false);
  const [selectedTagHelp, setSelectedTagHelp] = useState<TemplateTagHelp | null>(null);
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false);
  const [llmInsightsEnabled, setLlmInsightsEnabled] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [llmInsight, setLlmInsight] = useState<LlmInsightPayload | null>(null);
  const selectedTargetId = useMemo(() => {
    if (selectedAnalytics) {
      return selectedAnalytics.type === "software"
        ? `software:${selectedAnalytics.data.id}`
        : `serviceChain:${selectedAnalytics.data.id}`;
    }
    return selectedAnalyticsTargetId || null;
  }, [selectedAnalytics, selectedAnalyticsTargetId]);
  const compatibleExportApiConfigs = useMemo(() => {
    return exportApiConfigs.filter((config) => {
      if (!(config.is_active ?? true)) {
        return false;
      }
      if (!selectedTargetId || !(config.target_resources || []).includes(selectedTargetId)) {
        return false;
      }
      return true;
    });
  }, [exportApiConfigs, selectedTargetId]);
  const activeCustomVisualization = useMemo(() => {
    if (!selectedTargetId) return null;
    return customVisualizations.find((visualization) =>
      visualization.is_active && (visualization.target_resources || []).includes(selectedTargetId)
    ) || null;
  }, [customVisualizations, selectedTargetId]);
  const activeCustomVisualizationLabel = activeCustomVisualization?.name?.trim() || "Custom Visualization";

  const fetchResultDataInternal = useCallback(async (): Promise<"ready" | "error"> => {
    if (forcedResultData !== undefined) {
      setFetchError(null);
      setResultData(forcedResultData);
      return "ready";
    }

    if (!resultUrlInfo || !resultUrlInfo.url) {
      console.log("No result URL info available, using fallback data");
      setResultData(fallbackResultData);
      return "error";
    }

    setIsLoading(true);
    setFetchError(null);

    try {
      const fullUrl = formatResultUrlWithParams(resultUrlInfo);
      console.log("Fetching result from:", fullUrl);
      console.log("Method:", resultUrlInfo.method);
      if (resultUrlInfo.authorization) {
        console.log("Using authorization header");
      }

      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/result-proxy`;

      const proxyHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "x-result-url": fullUrl,
        "x-result-method": resultUrlInfo.method,
      };

      if (resultUrlInfo.authorization) {
        proxyHeaders["x-result-authorization"] = resultUrlInfo.authorization;
      }
      proxyHeaders["apikey"] = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const fetchOptions: RequestInit = {
        method: "POST",
        headers: proxyHeaders,
      };

      if (resultUrlInfo.method === "POST") {
        const body = buildResultRequestBody(resultUrlInfo);
        if (body) {
          fetchOptions.body = JSON.stringify(body);
        }
      }

      console.log("Proxying request through edge function");
      const response = await fetch(proxyUrl, fetchOptions);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorBody || response.statusText}`);
      }

      const data = await response.json();
      if (isDebugMode()) {
        console.log("Result data fetched successfully:", data);
      }

      setResultData(data);
      toast.success("Result data loaded successfully");
      return "ready";
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("Failed to fetch result data:", errorMessage);
      setFetchError(errorMessage);
      setResultData({
        error: "Failed to fetch result",
        message: errorMessage,
        url: resultUrlInfo.url,
        timestamp: new Date().toISOString()
      });
      toast.error(`Failed to fetch results: ${errorMessage}`);

      return "error";
    } finally {
      setIsLoading(false);
    }
  }, [forcedResultData, resultUrlInfo]);

  const generateLlmInsight = useCallback(async () => {
    if (!llmInsightsEnabled) return;

    setIsGeneratingInsight(true);
    setInsightError(null);

    try {
      const headers: Record<string, string> = {};
      if (organizationId) {
        headers["x-organization-id"] = organizationId;
      }

      const { data, error } = await supabase.functions.invoke("llm-insights", {
        headers,
        body: {
          org_execution_token: orgExecutionToken || undefined,
          result: resultData,
          prompt_context: llmPromptContext || undefined,
        },
      });

      if (error || !data?.ok) {
        throw new Error(data?.error || error?.message || "Failed to generate insights");
      }

      const insight = (data.insight || {}) as LlmInsightPayload;
      setLlmInsight({
        summary: typeof insight.summary === "string" ? insight.summary : "",
        insights: Array.isArray(insight.insights) ? insight.insights.map(String) : [],
        visualization: insight.visualization || null,
      });
      toast.success("AI insights generated");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate AI insights";
      setInsightError(message);
      toast.error(message);
    } finally {
      setIsGeneratingInsight(false);
    }
  }, [organizationId, orgExecutionToken, resultData, llmPromptContext, llmInsightsEnabled]);

  useEffect(() => {
    let isMounted = true;

    const fetchLlmInsightStatus = async () => {
      if (!organizationId && !orgExecutionToken) {
        setLlmInsightsEnabled(false);
        return;
      }

      try {
        const headers: Record<string, string> = {};
        if (organizationId) {
          headers["x-organization-id"] = organizationId;
        }

        const { data, error } = await supabase.functions.invoke("llm-insights", {
          headers,
          body: {
            action: "status",
            org_execution_token: orgExecutionToken || undefined,
          },
        });

        if (!isMounted) return;
        setLlmInsightsEnabled(!error && Boolean(data?.ok) && Boolean(data?.enabled));
      } catch {
        if (isMounted) {
          setLlmInsightsEnabled(false);
        }
      }
    };

    void fetchLlmInsightStatus();

    return () => {
      isMounted = false;
    };
  }, [organizationId, orgExecutionToken]);

  // Fetch result data automatically for normal flow.
  useEffect(() => {
    if (forcedResultData !== undefined) {
      setResultData(forcedResultData);
      setFetchError(null);
      setIsLoading(false);
      return;
    }
    if (!resultUrlInfo || !resultUrlInfo.url) {
      setResultData(fallbackResultData);
      return;
    }
    void fetchResultDataInternal();
  }, [forcedResultData, resultUrlInfo, fetchResultDataInternal]);

  // Retry fetch function
  const handleRetryFetch = useCallback(() => {
    if (!resultUrlInfo) return;
    void fetchResultDataInternal();
  }, [resultUrlInfo, fetchResultDataInternal]);

  useEffect(() => {
    if (!selectedExportApi) return;
    const stillCompatible = compatibleExportApiConfigs.some((config) => config.name === selectedExportApi);
    if (!stillCompatible) {
      setSelectedExportApi("");
    }
  }, [compatibleExportApiConfigs, selectedExportApi]);

  useEffect(() => {
    setLlmInsight(null);
    setInsightError(null);
  }, [resultData]);

  useEffect(() => {
    if (!llmInsightsEnabled) {
      setLlmInsight(null);
      setInsightError(null);
    }
  }, [llmInsightsEnabled]);

  const setNestedValue = useCallback((obj: unknown, path: string, value: unknown): unknown => {
    const keys = path.split('.').filter(k => k);
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
    
    if (typeof originalValue === 'number') {
      const num = parseFloat(value as string);
      current[lastKey] = isNaN(num) ? value : num;
    } else if (typeof originalValue === 'boolean') {
      current[lastKey] = value === 'true';
    } else {
      current[lastKey] = value;
    }
    
    return result;
  }, []);

  const handleNestedEdit = useCallback((path: string, value: string) => {
    const newData = setNestedValue(resultData, path, value);
    setResultData(newData);
  }, [resultData, setNestedValue]);

  const handleKeyEdit = useCallback((path: string, oldKey: string, newKey: string) => {
    const newData = renameKeyAtSameLevel(resultData, path, oldKey, newKey);
    setResultData(newData);
  }, [resultData]);

  const handleAdd = useCallback((path: string) => {
    let target: unknown = resultData;
    const pathParts = path.split('.').filter(k => k);
    for (const part of pathParts) {
      target = (target as Record<string, unknown>)[part];
    }
    
    if (Array.isArray(target)) {
      const newData = addKeyAtPath(resultData, path, '', '');
      setResultData(newData);
    } else {
      const existingKeys = Object.keys(target as object);
      let newKey = 'newKey';
      let counter = 1;
      while (existingKeys.includes(newKey)) {
        newKey = `newKey${counter}`;
        counter++;
      }
      const newData = addKeyAtPath(resultData, path, newKey, 'value');
      setResultData(newData);
    }
  }, [resultData]);

  const handleDelete = useCallback((path: string) => {
    const newData = deleteKeyAtPath(resultData, path);
    setResultData(newData);
  }, [resultData]);

  const handleExport = (format: string) => {
    let content: string;
    let mimeType: string;
    let extension: string;

    switch (format) {
      case "json":
        content = JSON.stringify(resultData, null, 2);
        mimeType = "application/json";
        extension = "json";
        break;
      case "csv":
        const flatten = (obj: unknown, prefix = ''): Record<string, unknown> => {
          const result: Record<string, unknown> = {};
          if (typeof obj !== 'object' || obj === null) return { [prefix || 'value']: obj };
          for (const [key, value] of Object.entries(obj)) {
            const newKey = prefix ? `${prefix}.${key}` : key;
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
              Object.assign(result, flatten(value, newKey));
            } else {
              result[newKey] = Array.isArray(value) ? JSON.stringify(value) : value;
            }
          }
          return result;
        };
        const flattened = flatten(resultData);
        content = `${Object.keys(flattened).join(",")}\n${Object.values(flattened).map(v => JSON.stringify(v)).join(",")}`;
        mimeType = "text/csv";
        extension = "csv";
        break;
      default:
        content = JSON.stringify({ format, analyticsType, results: resultData }, null, 2);
        mimeType = "text/plain";
        extension = "txt";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-results.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported as ${extension.toUpperCase()}`);
  };

  const buildApiRequestPreview = useCallback((): ApiRequestPreview => {
    if (!apiUrl.trim()) {
      throw new Error("Please enter an API URL");
    }
    const { bodies, forEachRange } = buildApiExportBodies(apiTemplate, resultData);

    let finalUrl = apiUrl;
    if (apiParams.length > 0) {
      const searchParams = new URLSearchParams();
      apiParams.forEach((p) => {
        if (p.key.trim()) searchParams.append(p.key, p.value);
      });
      const paramString = searchParams.toString();
      if (paramString) {
        finalUrl += (finalUrl.includes("?") ? "&" : "?") + paramString;
      }
    }

    return {
      targetUrl: finalUrl,
      bodies,
      hasAuthorization: Boolean(apiAuthorization.trim()),
      forEachMode: bodies.length > 1,
      forEachRange,
    };
  }, [apiUrl, apiAuthorization, apiParams, apiTemplate, resultData]);

  const buildApiRequestPreviewForConfig = useCallback((config: ExportApiConfig): ApiRequestPreview => {
    if (!config.url?.trim()) {
      throw new Error(`${config.name || "Export API"} has no API URL`);
    }

    const template = config.body_template?.trim() || '{\n  "data": ##result\n}';
    const { bodies, forEachRange } = buildApiExportBodies(template, resultData);

    let finalUrl = config.url;
    const params = config.params || [];
    if (params.length > 0) {
      const searchParams = new URLSearchParams();
      params.forEach((p) => {
        if (p.key.trim()) searchParams.append(p.key, p.value);
      });
      const paramString = searchParams.toString();
      if (paramString) {
        finalUrl += (finalUrl.includes("?") ? "&" : "?") + paramString;
      }
    }

    return {
      targetUrl: finalUrl,
      bodies,
      hasAuthorization: Boolean(config.authorization?.trim()),
      forEachMode: bodies.length > 1,
      forEachRange,
    };
  }, [resultData]);

  const handlePreviewApiExport = useCallback(() => {
    try {
      const preview = buildApiRequestPreview();
      setPendingApiRequest(preview);
      setIsPreviewOpen(true);
    } catch (e) {
      toast.error("API export failed: " + (e as Error).message);
    }
  }, [buildApiRequestPreview]);

  const handleApiExport = useCallback(async () => {
    try {
      setIsSendingToApi(true);
      const request = buildApiRequestPreview();
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/result-proxy`;
      const proxyHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "x-result-url": request.targetUrl,
        "x-result-method": "POST",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      };

      if (apiAuthorization.trim()) {
        proxyHeaders["x-result-authorization"] = apiAuthorization;
      }

      let successCount = 0;
      for (let i = 0; i < request.bodies.length; i++) {
        const response = await fetch(proxyUrl, {
          method: "POST",
          headers: proxyHeaders,
          body: request.bodies[i],
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Request ${i + 1}/${request.bodies.length} failed: HTTP ${response.status}: ${errText}`);
        }
        successCount += 1;
      }

      toast.success(
        request.bodies.length > 1
          ? `Data sent to API successfully (${successCount} requests)`
          : "Data sent to API successfully!"
      );
      if (isDebugMode()) {
        console.log("API Export URL:", request.targetUrl);
        console.log("API Export Bodies:", request.bodies);
      }
    } catch (e) {
      toast.error("API export failed: " + (e as Error).message);
    } finally {
      setIsSendingToApi(false);
    }
  }, [apiAuthorization, buildApiRequestPreview]);

  const handleConfirmApiExport = useCallback(async () => {
    setIsPreviewOpen(false);
    await handleApiExport();
  }, [handleApiExport]);

  const handleImportToLms = useCallback(async () => {
    if (compatibleExportApiConfigs.length === 0) return;

    try {
      setIsSendingToApi(true);
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/result-proxy`;
      let endpointCount = 0;
      let requestCount = 0;

      for (const config of compatibleExportApiConfigs) {
        const request = buildApiRequestPreviewForConfig(config);
        const proxyHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          "x-result-url": request.targetUrl,
          "x-result-method": "POST",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        };

        if (config.authorization?.trim()) {
          proxyHeaders["x-result-authorization"] = config.authorization;
        }

        for (let i = 0; i < request.bodies.length; i++) {
          const response = await fetch(proxyUrl, {
            method: "POST",
            headers: proxyHeaders,
            body: request.bodies[i],
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`${config.name || "Export API"} request ${i + 1}/${request.bodies.length} failed: HTTP ${response.status}: ${errText}`);
          }
          requestCount += 1;
        }

        endpointCount += 1;
      }

      toast.success(
        endpointCount > 1
          ? `Imported to LMS through ${endpointCount} endpoints (${requestCount} requests)`
          : "Imported to LMS successfully"
      );
    } catch (e) {
      toast.error("LMS import failed: " + (e as Error).message);
    } finally {
      setIsSendingToApi(false);
    }
  }, [buildApiRequestPreviewForConfig, compatibleExportApiConfigs]);

  const handleSelectExportApi = (configName: string) => {
    setSelectedExportApi(configName);
    const config = compatibleExportApiConfigs.find(c => c.name === configName);
    if (config) {
      setApiUrl(config.url);
      setApiAuthorization(config.authorization || "");
      setApiParams(config.params?.map(p => ({ key: p.key, value: p.value })) || []);
      if (config.body_template) {
        setApiTemplate(config.body_template);
      }
      toast.success(`Loaded "${config.name}" configuration`);
    }
  };

  const handleOpenTagHelp = useCallback((tag: string) => {
    const help = TEMPLATE_TAG_HELP.find((item) => item.tag === tag);
    if (!help) return;
    setSelectedTagHelp(help);
    setIsTagHelpOpen(true);
  }, []);

  return (
    <div className="animate-fade-in">
      <div className="text-center mb-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/20 flex items-center justify-center">
          {isLoading ? (
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          ) : fetchError ? (
            <AlertCircle className="w-8 h-8 text-destructive" />
          ) : (
            <CheckCircle2 className="w-8 h-8 text-primary" />
          )}
        </div>
        <h2 className="text-3xl font-bold mb-2">
          {isLoading ? (
            <>Fetching <span className="gradient-text">Results</span></>
          ) : fetchError ? (
            <>Result <span className="text-destructive">Error</span></>
          ) : (
            <>Analysis <span className="gradient-text">Complete</span></>
          )}
        </h2>
        <p className="text-muted-foreground">
          {isLoading 
            ? "Loading analytics results from the configured endpoint..." 
            : fetchError 
              ? `Failed to fetch results: ${fetchError}`
              : `Your ${analyticsType} analysis has finished processing`
          }
        </p>
        {fetchError && resultUrlInfo && (
          <button 
            onClick={handleRetryFetch}
            className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 mx-auto"
          >
            <RefreshCw className="w-4 h-4" />
            Retry Fetch
          </button>
        )}
      </div>

      {forcedResultData !== undefined && forcedResultNotice && (
        <div className="glass-card p-4 mb-6 border-amber-400/40 bg-amber-500/10">
          <p className="text-sm text-amber-200 font-medium">{forcedResultNotice}</p>
        </div>
      )}

      {/* Result URL Info */}
      {resultUrlInfo && (
        <div className="glass-card p-4 mb-6">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="text-muted-foreground">Result Source:</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              resultUrlInfo.isServiceChain 
                ? "bg-purple-500/20 text-purple-400"
                : "bg-blue-500/20 text-blue-400"
            }`}>
              {resultUrlInfo.isServiceChain ? "Service Chain" : "Data Resource"}
            </span>
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
              {resultUrlInfo.method}
            </span>
            {resultUrlInfo.isFallback && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-400">
                Fallback
              </span>
            )}
            <code className="text-xs text-primary break-all flex-1 min-w-0">
              {formatResultUrlWithParams(resultUrlInfo)}
            </code>
          </div>
        </div>
      )}

      {llmInsightsEnabled && (
        <div className="glass-card p-6 mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div>
              <h3 className="font-semibold">AI Insight + Dynamic D3 Visualization</h3>
              <p className="text-sm text-muted-foreground">
                Uses organization LLM Settings to interpret any JSON result and build a D3 chart.
              </p>
            </div>
            <button
              onClick={generateLlmInsight}
              disabled={isGeneratingInsight || isLoading}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isGeneratingInsight ? "Generating..." : "Generate AI Insight"}
            </button>
          </div>

          {insightError && (
            <p className="text-sm text-destructive mb-3">{insightError}</p>
          )}

          {llmInsight?.summary && (
            <p className="text-sm mb-3">{llmInsight.summary}</p>
          )}

          {llmInsight?.insights && llmInsight.insights.length > 0 && (
            <ul className="list-disc list-inside text-sm text-muted-foreground mb-4 space-y-1">
              {llmInsight.insights.map((item, idx) => (
                <li key={`${item}-${idx}`}>{item}</li>
              ))}
            </ul>
          )}

          <D3InsightChart spec={llmInsight?.visualization || null} />
        </div>
      )}

      {/* Data Result - JSON/Table Views */}
      <div className="glass-card p-6 mb-8">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <FileJson className="w-5 h-5 text-primary" />
          Result Data
          {!isLoading && (
            <span className="text-xs text-muted-foreground ml-2">(Edit in either view - changes sync in real-time)</span>
          )}
        </h3>

        {isLoading ? (
          <LoadingJsonSkeleton />
        ) : (
          <Tabs defaultValue={activeCustomVisualization ? "custom" : "json"} className="w-full">
            <TabsList className={`grid w-full ${activeCustomVisualization ? "grid-cols-4" : "grid-cols-3"} mb-4`}>
              {activeCustomVisualization && (
                <TabsTrigger value="custom" className="flex items-center gap-2">
                  <Palette className="w-4 h-4" />
                  <span className="truncate">{activeCustomVisualizationLabel}</span>
                </TabsTrigger>
              )}
              <TabsTrigger value="json" className="flex items-center gap-2">
                <Code className="w-4 h-4" />
                JSON View
              </TabsTrigger>
              <TabsTrigger value="table" className="flex items-center gap-2">
                <TableProperties className="w-4 h-4" />
                Tree Table
              </TabsTrigger>
              <TabsTrigger value="array" className="flex items-center gap-2">
                <Filter className="w-4 h-4" />
                Array Table
              </TabsTrigger>
            </TabsList>

            {activeCustomVisualization && (
              <TabsContent value="custom">
                <CustomVisualizationRuntime
                  visualization={activeCustomVisualization}
                  resultData={resultData}
                  onResultDataChange={setResultData}
                />
              </TabsContent>
            )}
            
            <TabsContent value="json">
              <CollapsibleJson data={resultData} onChange={setResultData} />
            </TabsContent>
            
            <TabsContent value="table">
              <NestedTable data={resultData} onEdit={handleNestedEdit} onKeyEdit={handleKeyEdit} onAdd={handleAdd} onDelete={handleDelete} />
            </TabsContent>
            
            <TabsContent value="array">
              <ArrayTableView data={resultData} onChange={setResultData} />
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Export Options */}
      <div className="mb-8">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Download className="w-5 h-5 text-primary" />
          Export Results
        </h3>
        <div className={`grid grid-cols-1 ${compatibleExportApiConfigs.length > 0 ? "sm:grid-cols-4" : "sm:grid-cols-3"} gap-4`}>
          <button onClick={() => handleExport("pdf")} className="export-btn">
            <FileText className="w-8 h-8 text-primary" />
            <span className="font-medium">PDF Report</span>
            <span className="text-xs text-muted-foreground">Full formatted report</span>
          </button>
          <button onClick={() => handleExport("json")} className="export-btn">
            <FileJson className="w-8 h-8 text-primary" />
            <span className="font-medium">JSON Data</span>
            <span className="text-xs text-muted-foreground">Raw structured data</span>
          </button>
          <button onClick={() => handleExport("csv")} className="export-btn">
            <TableIcon className="w-8 h-8 text-primary" />
            <span className="font-medium">CSV Export</span>
            <span className="text-xs text-muted-foreground">Spreadsheet compatible</span>
          </button>
          {compatibleExportApiConfigs.length > 0 && (
            <button
              onClick={handleImportToLms}
              className="export-btn"
              disabled={isSendingToApi}
            >
              {isSendingToApi ? (
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              ) : (
                <GraduationCap className="w-8 h-8 text-primary" />
              )}
              <span className="font-medium">Import to LMS</span>
              <span className="text-xs text-muted-foreground">
                {compatibleExportApiConfigs.length === 1
                  ? compatibleExportApiConfigs[0].name || "Connected endpoint"
                  : `${compatibleExportApiConfigs.length} connected endpoints`}
              </span>
            </button>
          )}
        </div>

        {showDebugApiExportConfig && (
          <div className="glass-card p-6 mt-4">
            <h4 className="font-medium mb-4 flex items-center gap-2">
              <Send className="w-4 h-4 text-primary" />
              Export API Configuration
            </h4>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Preconfigured API Presets</label>
                {compatibleExportApiConfigs.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {compatibleExportApiConfigs.map((config) => (
                      <button
                        key={config.id || config.name}
                        onClick={() => handleSelectExportApi(config.name)}
                        className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                          selectedExportApi === config.name
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-secondary/50 text-muted-foreground border-border hover:border-primary/50"
                        }`}
                      >
                        {config.name}
                      </button>
                    ))}
                  </div>
                ) : exportApiConfigs.length > 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    No active API presets are connected to this selected analytics.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No preconfigured APIs available. Admins can add export presets in Result Page settings.</p>
                )}
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">API Endpoint URL</label>
                <Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://api.example.com/data" className="bg-secondary/30" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Authorization</label>
                <Input
                  value={apiAuthorization}
                  onChange={(e) => setApiAuthorization(e.target.value)}
                  placeholder="Bearer <token> or API key"
                  type="password"
                  className="bg-secondary/30"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-muted-foreground">Query Parameters</label>
                  <button
                    onClick={() => setApiParams([...apiParams, { key: "", value: "" }])}
                    className="text-xs px-2 py-1 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    Add Parameter
                  </button>
                </div>
                {apiParams.map((param, index) => (
                  <div key={index} className="flex gap-2 mb-2">
                    <Input
                      value={param.key}
                      onChange={(e) => {
                        const newParams = [...apiParams];
                        newParams[index] = { ...newParams[index], key: e.target.value };
                        setApiParams(newParams);
                      }}
                      placeholder="Parameter name"
                      className="flex-1 bg-secondary/30"
                    />
                    <Input
                      value={param.value}
                      onChange={(e) => {
                        const newParams = [...apiParams];
                        newParams[index] = { ...newParams[index], value: e.target.value };
                        setApiParams(newParams);
                      }}
                      placeholder="Value"
                      className="flex-1 bg-secondary/30"
                    />
                    <button
                      onClick={() => setApiParams(apiParams.filter((_, i) => i !== index))}
                      className="p-2 rounded hover:bg-destructive/20 transition-colors"
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">
                  Request Body Template <span className="text-primary ml-1">(optional: ##result, ##resultArray.path[0], ##resultArrayEach.path.to.array.field, ##resultObjectEach.path.$key, ##forEach(0:2))</span>
                </label>
                <Textarea value={apiTemplate} onChange={(e) => setApiTemplate(e.target.value)} className="font-mono text-sm min-h-[120px] bg-secondary/30" />
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
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={handlePreviewApiExport}
                  className="w-full px-4 py-3 rounded-lg font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors flex items-center justify-center gap-2"
                  disabled={isSendingToApi}
                >
                  <Code className="w-4 h-4" />
                  Preview Request
                </button>
                <button
                  onClick={handleApiExport}
                  className="w-full px-4 py-3 rounded-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                  disabled={isSendingToApi}
                >
                  {isSendingToApi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {isSendingToApi ? "Sending..." : "Send to API"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Confirm API Request</DialogTitle>
            <DialogDescription>
              Verify the resolved request body before sending it to the target API.
            </DialogDescription>
          </DialogHeader>

          {pendingApiRequest && (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Method</p>
                <code className="text-sm bg-secondary/50 px-2 py-1 rounded">POST</code>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Target URL</p>
                <code className="text-xs break-all block bg-secondary/50 p-2 rounded">{pendingApiRequest.targetUrl}</code>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Headers</p>
                <code className="text-xs block bg-secondary/50 p-2 rounded">
                  {JSON.stringify(
                    {
                      "Content-Type": "application/json",
                      ...(pendingApiRequest.hasAuthorization ? { Authorization: "***" } : {}),
                    },
                    null,
                    2
                  )}
                </code>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  Resolved Request Bodies ({pendingApiRequest.bodies.length})
                  {pendingApiRequest.forEachMode && (
                    <span className="ml-2 text-primary">
                      ##forEach{pendingApiRequest.forEachRange ? `(${pendingApiRequest.forEachRange})` : ""}
                    </span>
                  )}
                </p>
                <div className="space-y-2 max-h-[320px] overflow-auto">
                  {pendingApiRequest.bodies.slice(0, 3).map((body, idx) => (
                    <pre key={idx} className="text-xs bg-secondary/50 p-3 rounded overflow-auto whitespace-pre-wrap break-all">
{JSON.stringify(JSON.parse(body), null, 2)}
                    </pre>
                  ))}
                  {pendingApiRequest.bodies.length > 3 && (
                    <p className="text-xs text-muted-foreground">
                      ...and {pendingApiRequest.bodies.length - 3} more request bodies
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <button
              onClick={() => setIsPreviewOpen(false)}
              className="px-4 py-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              disabled={isSendingToApi}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmApiExport}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
              disabled={isSendingToApi}
            >
              {isSendingToApi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {isSendingToApi ? "Sending..." : "Confirm Send"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isTagHelpOpen} onOpenChange={setIsTagHelpOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{selectedTagHelp?.title ?? "Tag Help"}</DialogTitle>
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
            <button
              onClick={() => setIsTagHelpOpen(false)}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Close
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restart */}
      <div className="flex justify-center">
        <button onClick={onRestart} className="px-6 py-3 rounded-lg font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors flex items-center gap-2">
          <RotateCcw className="w-5 h-5" />
          Start New Analysis
        </button>
      </div>
    </div>
  );
};

export default ResultsView;
