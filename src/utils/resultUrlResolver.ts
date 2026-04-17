// Utility to resolve the result fetch URL based on selected analytics and data options

import { AnalyticsOption, DataResource, getParamActionsMap, getParamValuesMap, ResultQueryParam } from "@/types/dataspace";
import { sanitizeParams, shouldIgnoreParam, resolveParamValue, isSessionIdPlaceholder } from "@/utils/paramSanitizer";

export interface ResultUrlInfo {
  url: string;
  method: "GET" | "POST";
  queryParams?: Record<string, string>;
  bodyParams?: Record<string, string>;
  isServiceChain: boolean;
  isFallback: boolean;
  description: string;
  authorization?: string;
}

/**
 * Resolves query params from ResultQueryParam[] with session ID resolution
 */
const resolveQueryParams = (
  params: ResultQueryParam[],
  sessionId?: string
): Record<string, string> => {
  const resolved: Record<string, string> = {};
  for (const p of params) {
    if (isSessionIdPlaceholder(p.paramValue)) {
      resolved[p.paramName] = sessionId || "";
    } else if (p.paramValue && p.paramValue.trim() !== "") {
      resolved[p.paramName] = p.paramValue;
    }
  }
  return resolved;
};

/**
 * Resolves the URL that will be used to fetch analytics results.
 * 
 * Logic for service chains:
 * 1. If result_url_source = 'custom': use custom_result_url + result_authorization + result_query_params
 * 2. If result_url_source = 'fallback': use fallback result URL from PDC config
 * 3. If result_url_source = 'contract' (default): find last embedded resource,
 *    use its api_response_representation.url
 *    Fallback: last service URL in chain, then global fallback
 * 
 * Logic for software resources:
 * - Take "apiResponseRepresentation.url" from selected data resources
 */
export const resolveResultUrl = (
  selectedAnalytics: AnalyticsOption,
  selectedDataResources: DataResource[],
  apiParams: Record<string, Record<string, string>>,
  uploadResourceParams?: Record<string, string>,
  sessionId?: string,
  fallbackResultUrl?: string,
  fallbackResultAuthorization?: string
): ResultUrlInfo | null => {
  // Handle service chain analytics
  if (selectedAnalytics.type === "serviceChain") {
    const serviceChain = selectedAnalytics.data;
    const source = serviceChain.result_url_source || 'contract';
    const chainQueryParams = serviceChain.result_query_params || [];

    // Custom URL
    if (source === 'custom' && serviceChain.custom_result_url) {
      const resolvedParams = resolveQueryParams(chainQueryParams, sessionId);
      return {
        url: serviceChain.custom_result_url,
        method: "GET",
        queryParams: Object.keys(resolvedParams).length > 0 ? resolvedParams : undefined,
        isServiceChain: true,
        isFallback: false,
        description: "Result from custom URL (service chain)",
        authorization: serviceChain.result_authorization || undefined,
      };
    }

    // Fallback URL from PDC config
    if (source === 'fallback') {
      if (fallbackResultUrl) {
        const resolvedParams = resolveQueryParams(chainQueryParams, sessionId);
        return {
          url: fallbackResultUrl,
          method: "GET",
          queryParams: Object.keys(resolvedParams).length > 0 ? resolvedParams : undefined,
          isServiceChain: true,
          isFallback: true,
          description: "Result from fallback URL (service chain)",
          authorization: serviceChain.result_authorization || fallbackResultAuthorization || undefined,
        };
      }
      return getFallbackResultUrl(fallbackResultUrl, sessionId, fallbackResultAuthorization);
    }

    // Contract source (default) - use last embedded resource's api_response_representation.url
    if (serviceChain.embedded_resources && serviceChain.embedded_resources.length > 0) {
      // Find the last embedded resource
      const sortedResources = [...serviceChain.embedded_resources].sort(
        (a, b) => a.service_index - b.service_index
      );
      const lastResource = sortedResources[sortedResources.length - 1];
      const representationUrl = (lastResource.api_response_representation as { url?: string })?.url;

      if (representationUrl && representationUrl.trim() !== "") {
        const resolvedParams = resolveQueryParams(chainQueryParams, sessionId);
        return {
          url: representationUrl,
          method: "GET",
          queryParams: Object.keys(resolvedParams).length > 0 ? resolvedParams : undefined,
          isServiceChain: true,
          isFallback: false,
          description: `Result from last embedded resource representation (${lastResource.resource_name || 'unnamed'})`,
          authorization:
            lastResource.result_authorization ||
            serviceChain.result_authorization ||
            undefined,
        };
      }
    }

    // Legacy fallback: last service URL in chain
    if (serviceChain.services && serviceChain.services.length > 0) {
      const lastService = serviceChain.services[serviceChain.services.length - 1];
      const resolvedParams = resolveQueryParams(chainQueryParams, sessionId);
      return {
        url: lastService.service,
        method: "GET",
        queryParams: Object.keys(resolvedParams).length > 0 ? resolvedParams : undefined,
        isServiceChain: true,
        isFallback: false,
        description: `Result from service chain (last service: ${lastService.service.split("/").pop()})`,
        authorization: serviceChain.result_authorization || undefined,
      };
    }
    
    // No services in chain, use fallback
    return getFallbackResultUrl(fallbackResultUrl, sessionId);
  }
  
  // Handle software resource analytics - use data resource's apiResponseRepresentation.url
  if (selectedAnalytics.type === "software") {
    // Find data resource with apiResponseRepresentation.url
    for (const dataResource of selectedDataResources) {
      // Determine the result URL source (default to 'contract')
      const urlSource = dataResource.result_url_source || 'contract';
      const resourceQueryParams = dataResource.result_query_params || [];
      
      // Determine the result URL based on source
      let resultUrl: string | undefined;
      let isFallback = false;
      let description = "";
      
      switch (urlSource) {
        case 'fallback':
          if (fallbackResultUrl) {
            resultUrl = fallbackResultUrl;
            isFallback = true;
            description = `Result from fallback URL (for ${dataResource.resource_name || "data resource"})`;
          }
          break;
        case 'custom':
          if (dataResource.custom_result_url) {
            resultUrl = dataResource.custom_result_url;
            description = `Result from custom URL (for ${dataResource.resource_name || "data resource"})`;
          }
          break;
        case 'contract':
        default:
          resultUrl = dataResource.api_response_representation?.url;
          description = `Result from ${dataResource.resource_name || "data resource"}`;
          break;
      }
      
      if (resultUrl && resultUrl.trim() !== "") {
        // Collect query params for this resource
        const params: Record<string, string> = {};
        
        // First, apply result_query_params from admin config (with placeholder resolution)
        const resolvedResultParams = resolveQueryParams(resourceQueryParams, sessionId);
        Object.entries(resolvedResultParams).forEach(([key, value]) => {
          params[key] = value;
        });
        
        // Check if this is an upload resource
        if (dataResource.upload_file && uploadResourceParams) {
          Object.entries(uploadResourceParams).forEach(([key, value]) => {
            params[key] = value;
          });
        }
        
        // Check if this is an API resource - use apiParams from UI or fallback to database params
        if (!dataResource.upload_file) {
          const uiParams = apiParams[dataResource.resource_url];
          
          if (uiParams && Object.keys(uiParams).length > 0) {
            // Use params from UI (user input or prefilled)
            Object.entries(uiParams).forEach(([key, value]) => {
              params[key] = value;
            });
          } else if (resourceQueryParams.length === 0) {
            // Only fallback to database parameters if no result_query_params configured
            const dbParams = getParamValuesMap(dataResource.parameters);
            Object.entries(dbParams).forEach(([key, value]) => {
              if (isSessionIdPlaceholder(value)) {
                params[key] = sessionId || "";
              } else if (value && value.trim() !== "") {
                params[key] = value;
              }
            });
          }
        }
        
        // Get paramActions for this resource to filter #ignoreFlowResult
        const resourceParamActions = getParamActionsMap(dataResource.parameters);
        
        // Sanitize params - removes #ignoreParam, #ignoreFlowResult, and resolves #genSessionId
        const resolvedParams = sanitizeParams(
          params, 
          sessionId || "", 
          true, 
          "flowResult",
          resourceParamActions
        );
        
        // Determine authorization: resource-specific overrides fallback
        const authorization = dataResource.result_authorization || 
          (isFallback ? fallbackResultAuthorization : undefined) || 
          undefined;
        
        return {
          url: resultUrl,
          method: "GET",
          queryParams: Object.keys(resolvedParams).length > 0 ? resolvedParams : undefined,
          isServiceChain: false,
          isFallback,
          description,
          authorization,
        };
      }
    }
    
    // No URL found in data resources, use fallback
    return getFallbackResultUrl(fallbackResultUrl, sessionId, fallbackResultAuthorization);
  }
  
  // Default to fallback
  return getFallbackResultUrl(fallbackResultUrl, sessionId, fallbackResultAuthorization);
};

/**
 * Gets the fallback result URL from config with resolved parameters
 */
export const getFallbackResultUrl = (
  fallbackUrl?: string, 
  sessionId?: string,
  fallbackAuthorization?: string
): ResultUrlInfo | null => {
  if (!fallbackUrl) return null;
  
  return {
    url: fallbackUrl,
    method: "GET",
    isServiceChain: false,
    isFallback: true,
    description: "Fallback result URL",
    authorization: fallbackAuthorization || undefined,
  };
};

/**
 * Formats the result URL with query parameters for display
 */
export const formatResultUrlWithParams = (resultInfo: ResultUrlInfo): string => {
  if (!resultInfo.queryParams || Object.keys(resultInfo.queryParams).length === 0) {
    return resultInfo.url;
  }
  
  const queryString = Object.entries(resultInfo.queryParams)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  
  return `${resultInfo.url}?${queryString}`;
};

/**
 * Builds the request body for POST requests (if needed)
 */
export const buildResultRequestBody = (resultInfo: ResultUrlInfo): Record<string, string> | null => {
  if (resultInfo.method === "POST" && resultInfo.bodyParams) {
    return resultInfo.bodyParams;
  }
  return null;
};
