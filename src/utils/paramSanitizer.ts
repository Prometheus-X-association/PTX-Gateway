// Parameter Sanitization Utilities
// Centralized functions to handle #ignoreParam, #genSessionId, and paramAction placeholders
// across all fetch requests and payload generation

/**
 * Special placeholder values for paramValue
 */
export const IGNORE_PARAM = "#ignoreParam";
export const GEN_SESSION_ID = "#genSessionId";

/**
 * Special action flags for paramAction
 * These control whether parameters are included in specific processes
 */
export const ACTION_IGNORE_PAYLOAD = "#ignorePayload";      // Don't include in PDC payload
export const ACTION_IGNORE_FLOW_RESULT = "#ignoreFlowResult"; // Don't include in result fetch
export const ACTION_IGNORE_FLOW_DATA = "#ignoreFlowData";    // Don't include in data page fetch (upload)

/**
 * Flow context types for filtering parameters
 */
export type FlowContext = "payload" | "flowResult" | "flowData" | "all";

/**
 * Check if a parameter value should be ignored (contains #ignoreParam)
 */
export const shouldIgnoreParam = (value: string): boolean => {
  return value === IGNORE_PARAM || value.includes(IGNORE_PARAM);
};

/**
 * Check if a paramAction contains a specific action flag
 */
export const hasAction = (paramAction: string | undefined, action: string): boolean => {
  if (!paramAction) return false;
  return paramAction.includes(action);
};

/**
 * Check if a parameter should be excluded based on paramAction and flow context
 */
export const shouldExcludeForContext = (
  paramAction: string | undefined,
  context: FlowContext
): boolean => {
  if (!paramAction || context === "all") return false;
  
  switch (context) {
    case "payload":
      return hasAction(paramAction, ACTION_IGNORE_PAYLOAD);
    case "flowResult":
      return hasAction(paramAction, ACTION_IGNORE_FLOW_RESULT);
    case "flowData":
      return hasAction(paramAction, ACTION_IGNORE_FLOW_DATA);
    default:
      return false;
  }
};

/**
 * Check if a parameter value is a session ID placeholder
 */
export const isSessionIdPlaceholder = (value: string): boolean => {
  return value === GEN_SESSION_ID;
};

/**
 * Resolve a parameter value - replaces #genSessionId with actual session ID
 */
export const resolveParamValue = (value: string, sessionId: string): string => {
  if (isSessionIdPlaceholder(value)) {
    return sessionId;
  }
  return value;
};

/**
 * Parameter with optional action metadata
 */
export interface ParamWithAction {
  value: string;
  action?: string;
}

/**
 * Sanitize a single parameter record - removes ignored params and resolves session IDs
 * @param params - Record of parameter key-value pairs
 * @param sessionId - Current session ID for resolution
 * @param removeEmpty - Whether to also remove empty string values (default: true)
 * @param context - Flow context for filtering (default: "all" - no action filtering)
 * @param paramActions - Optional map of param names to their actions
 * @returns Sanitized parameters with placeholders resolved
 */
export const sanitizeParams = (
  params: Record<string, string>,
  sessionId: string,
  removeEmpty: boolean = true,
  context: FlowContext = "all",
  paramActions?: Record<string, string | undefined>
): Record<string, string> => {
  const sanitized: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(params)) {
    // Skip ignored params (value-based)
    if (shouldIgnoreParam(value)) {
      continue;
    }
    
    // Skip based on paramAction and context
    if (paramActions && shouldExcludeForContext(paramActions[key], context)) {
      continue;
    }
    
    // Skip empty values if removeEmpty is true
    if (removeEmpty && (!value || value.trim() === "")) {
      continue;
    }
    
    // Resolve session ID placeholder
    sanitized[key] = resolveParamValue(value, sessionId);
  }
  
  return sanitized;
};

/**
 * Sanitize nested parameter records (e.g., apiParams with resource keys)
 * @param nestedParams - Nested record of resource -> params
 * @param sessionId - Current session ID for resolution
 * @param removeEmpty - Whether to also remove empty string values
 * @returns Sanitized nested parameters
 */
export const sanitizeNestedParams = (
  nestedParams: Record<string, Record<string, string>>,
  sessionId: string,
  removeEmpty: boolean = true
): Record<string, Record<string, string>> => {
  const sanitized: Record<string, Record<string, string>> = {};
  
  for (const [resourceKey, params] of Object.entries(nestedParams)) {
    const sanitizedInner = sanitizeParams(params, sessionId, removeEmpty);
    // Only include if there are remaining params
    if (Object.keys(sanitizedInner).length > 0) {
      sanitized[resourceKey] = sanitizedInner;
    }
  }
  
  return sanitized;
};

/**
 * Sanitize an array of parameter objects (for PDC payload format)
 * @param paramsArray - Array of { key: value } objects
 * @param sessionId - Current session ID for resolution
 * @returns Sanitized array with placeholders resolved and ignored params removed
 */
export const sanitizeParamsArray = (
  paramsArray: Array<Record<string, string>>,
  sessionId: string
): Array<Record<string, string>> => {
  return paramsArray
    .filter(paramObj => {
      // Filter out objects where any value is #ignoreParam
      return !Object.values(paramObj).some(v => shouldIgnoreParam(v));
    })
    .map(paramObj => {
      // Resolve session ID in remaining objects
      const resolved: Record<string, string> = {};
      for (const [key, value] of Object.entries(paramObj)) {
        resolved[key] = resolveParamValue(value, sessionId);
      }
      return resolved;
    })
    .filter(paramObj => {
      // Filter out objects with empty values
      return Object.values(paramObj).some(v => v && v.trim() !== "");
    });
};

/**
 * Build query string from sanitized params
 */
export const buildQueryString = (params: Record<string, string>): string => {
  const entries = Object.entries(params);
  if (entries.length === 0) return "";
  
  return entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
};

/**
 * Append sanitized params to a URL as query string
 */
export const appendParamsToUrl = (
  baseUrl: string,
  params: Record<string, string>,
  sessionId: string
): string => {
  const sanitized = sanitizeParams(params, sessionId);
  const queryString = buildQueryString(sanitized);
  
  if (!queryString) return baseUrl;
  
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}${queryString}`;
};

export default {
  shouldIgnoreParam,
  isSessionIdPlaceholder,
  resolveParamValue,
  sanitizeParams,
  sanitizeNestedParams,
  sanitizeParamsArray,
  buildQueryString,
  appendParamsToUrl,
  hasAction,
  shouldExcludeForContext,
  IGNORE_PARAM,
  GEN_SESSION_ID,
  ACTION_IGNORE_PAYLOAD,
  ACTION_IGNORE_FLOW_RESULT,
  ACTION_IGNORE_FLOW_DATA,
};
