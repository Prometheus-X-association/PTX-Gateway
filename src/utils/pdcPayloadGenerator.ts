// Utility to generate PDC payload from selected analytics and data

import { AnalyticsOption, DataResource, ServiceChainEmbeddedResource, getParamActionsMap } from "@/types/dataspace";
import { sanitizeParams } from "@/utils/paramSanitizer";

export interface PdcPayload {
  contract: string;
  purposeId?: string;
  resourceId?: string;
  serviceChainId?: string;
  resources: Array<{
    resource: string;
    params?: { query: Array<Record<string, string>> };
  }>;
  purposes: Array<{
    resource: string;
    params?: { query: Array<Record<string, string>> };
  }>;
  serviceChainParams?: Array<{
    resource: string;
    params?: { query: Array<Record<string, string>> };
  }>;
}

// Helper to build resource entry with params
const buildResourceEntry = (
  resourceUrl: string,
  rawParams: Record<string, string>,
  paramActions: Record<string, string | undefined>,
  sessionId: string
): { resource: string; params?: { query: Array<Record<string, string>> } } => {
  const sanitizedParams = sanitizeParams(rawParams, sessionId, true, "payload", paramActions);
  const paramsArray = Object.entries(sanitizedParams).map(([key, value]) => ({ [key]: value }));

  const entry: { resource: string; params?: { query: Array<Record<string, string>> } } = {
    resource: resourceUrl,
  };

  if (paramsArray.length > 0) {
    entry.params = { query: paramsArray };
  }

  return entry;
};

export const generatePdcPayload = (
  selectedAnalytics: AnalyticsOption,
  selectedDataResources: DataResource[],
  analyticsQueryParams: Record<string, string>,
  apiParams: Record<string, Record<string, string>>,
  uploadResourceParams: Record<string, string> | undefined,
  sessionId: string,
  serviceChainResourceParams?: Record<string, Record<string, string>>
): PdcPayload => {
  // Handle service chain analytics
  if (selectedAnalytics.type === "serviceChain") {
    return generateServiceChainPayload(
      selectedAnalytics.data.contract_url,
      selectedAnalytics.data.catalog_id,
      selectedAnalytics.data.embedded_resources,
      serviceChainResourceParams || {},
      sessionId
    );
  }

  // Handle software analytics (existing logic)
  const contract = selectedAnalytics.data.contract_url;
  const purposeId = selectedAnalytics.data.service_offering || "";
  const purposeResource = selectedAnalytics.data.resource_url;

  // Build purposes array with analytics params
  const purposes: Array<{
    resource: string;
    params?: { query: Array<Record<string, string>> };
  }> = [];

  const analyticsParamActions = getParamActionsMap(selectedAnalytics.data.parameters);
  const sanitizedAnalyticsParams = sanitizeParams(
    analyticsQueryParams,
    sessionId,
    true,
    "payload",
    analyticsParamActions
  );
  const analyticsParamsArray = Object.entries(sanitizedAnalyticsParams).map(
    ([key, value]) => ({ [key]: value })
  );

  if (purposeResource) {
    const purposeEntry: {
      resource: string;
      params?: { query: Array<Record<string, string>> };
    } = {
      resource: purposeResource,
    };

    if (analyticsParamsArray.length > 0) {
      purposeEntry.params = {
        query: analyticsParamsArray,
      };
    }

    purposes.push(purposeEntry);
  }

  // Build resources array from selected data resources
  const resources: Array<{
    resource: string;
    params?: { query: Array<Record<string, string>> };
  }> = [];

  let resourceId = "";
  if (selectedDataResources.length > 0) {
    resourceId = selectedDataResources[0].service_offering || "";
  }

  selectedDataResources.forEach((dataResource) => {
    let rawParams: Record<string, string> = {};

    if (dataResource.upload_file && uploadResourceParams) {
      rawParams = { ...uploadResourceParams };
    }

    if (!dataResource.upload_file && apiParams[dataResource.resource_url]) {
      rawParams = { ...apiParams[dataResource.resource_url] };
    }

    const resourceParamActions = getParamActionsMap(dataResource.parameters);
    const sanitizedParams = sanitizeParams(rawParams, sessionId, true, "payload", resourceParamActions);
    const resourceParams = Object.entries(sanitizedParams).map(([key, value]) => ({
      [key]: value,
    }));

    const resourceEntry: {
      resource: string;
      params?: { query: Array<Record<string, string>> };
    } = {
      resource: dataResource.resource_url,
    };

    if (resourceParams.length > 0) {
      resourceEntry.params = {
        query: resourceParams,
      };
    }

    resources.push(resourceEntry);
  });

  return {
    contract,
    purposeId,
    resourceId,
    resources,
    purposes,
  };
};

// Generate payload for service chain analytics
const generateServiceChainPayload = (
  contractUrl: string,
  catalogId: string,
  embeddedResources: ServiceChainEmbeddedResource[],
  resourceParams: Record<string, Record<string, string>>,
  sessionId: string
): PdcPayload => {
  // Sort embedded resources by service_index
  const sortedResources = [...embeddedResources].sort((a, b) => a.service_index - b.service_index);

  if (sortedResources.length === 0) {
    return {
      contract: contractUrl,
      serviceChainId: catalogId,
      resources: [],
      purposes: [],
    };
  }

  // First resource goes to resources array
  const firstResource = sortedResources[0];
  const firstParamActions = getParamActionsMap(firstResource.parameters);
  const firstParams = resourceParams[firstResource.resource_url] || {};
  const resourcesArray = [buildResourceEntry(firstResource.resource_url, firstParams, firstParamActions, sessionId)];

  // Last resource goes to purposes array
  const lastResource = sortedResources[sortedResources.length - 1];
  const lastParamActions = getParamActionsMap(lastResource.parameters);
  const lastParams = resourceParams[lastResource.resource_url] || {};
  const purposesArray = sortedResources.length > 1 
    ? [buildResourceEntry(lastResource.resource_url, lastParams, lastParamActions, sessionId)]
    : [];

  // Middle resources go to serviceChainParams array
  const serviceChainParams: Array<{
    resource: string;
    params?: { query: Array<Record<string, string>> };
  }> = [];

  for (let i = 1; i < sortedResources.length - 1; i++) {
    const middleResource = sortedResources[i];
    const middleParamActions = getParamActionsMap(middleResource.parameters);
    const middleParams = resourceParams[middleResource.resource_url] || {};
    serviceChainParams.push(buildResourceEntry(middleResource.resource_url, middleParams, middleParamActions, sessionId));
  }

  const payload: PdcPayload = {
    contract: contractUrl,
    serviceChainId: catalogId,
    resources: resourcesArray,
    purposes: purposesArray,
  };

  // Only include serviceChainParams if there are middle resources
  if (serviceChainParams.length > 0) {
    payload.serviceChainParams = serviceChainParams;
  }

  return payload;
};
