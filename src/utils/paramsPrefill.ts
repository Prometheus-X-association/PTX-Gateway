// Parameter Pre-fill Utilities
// Matches resources against dataspace-params.config.ts and returns pre-filled values

import { findResourceParams } from "@/config/dataspace-params.config";
import { sanitizeParams, isSessionIdPlaceholder } from "@/utils/paramSanitizer";

/**
 * Get pre-filled parameters for a resource
 * Matches by resource URL and contract URL
 * Does NOT resolve special values like #genSessionId - caller should resolve those
 */
export const getPrefillParams = (
  resourceUrl: string,
  contractUrl: string,
  queryParams: string[]
): Record<string, string> => {
  // Find matching config
  const configParams = findResourceParams(resourceUrl, contractUrl);
  
  // Build params record from queryParams list, filling with config values where available
  const result: Record<string, string> = {};
  
  queryParams.forEach(paramName => {
    // Find matching param from config
    const configParam = configParams?.find(p => p.paramName === paramName);
    // Use config value or empty string
    result[paramName] = configParam?.paramValue ?? "";
  });
  
  return result;
};

/**
 * Get pre-filled parameters and resolve special values like #genSessionId
 * Also removes any #ignoreParam entries
 * @param resourceUrl - The resource URL
 * @param contractUrl - The contract URL
 * @param queryParams - Array of query parameter names
 * @param sessionId - The current process session ID (for #genSessionId resolution)
 */
export const getPrefillParamsResolved = (
  resourceUrl: string,
  contractUrl: string,
  queryParams: string[],
  sessionId: string
): Record<string, string> => {
  const params = getPrefillParams(resourceUrl, contractUrl, queryParams);
  
  // Use centralized sanitizer to resolve and filter params
  return sanitizeParams(params, sessionId, false); // Don't remove empty - they're unfilled inputs
};

/**
 * Check if a parameter value contains a special placeholder
 */
export const isSpecialPlaceholder = (value: string): boolean => {
  return value.startsWith("#");
};

/**
 * Get display value for a parameter (shows placeholder for special values)
 */
export const getParamDisplayValue = (
  value: string,
  sessionId: string
): { display: string; isGenerated: boolean } => {
  if (isSessionIdPlaceholder(value)) {
    return { display: sessionId, isGenerated: true };
  }
  return { display: value, isGenerated: false };
};

export default {
  getPrefillParams,
  getPrefillParamsResolved,
  isSpecialPlaceholder,
  getParamDisplayValue,
};
