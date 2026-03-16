// Hook to fetch dataspace configuration from backend
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DataspaceConfig,
  PdcConfig,
  SoftwareResource,
  DataResource,
  ServiceChain,
  ResourceParameter,
  ApiResponseRepresentation,
  BasisInformation,
  ServiceChainService,
  ServiceChainEmbeddedResource,
} from "@/types/dataspace";
import { Json } from "@/integrations/supabase/types";

// Helper to safely parse JSONB parameters array
const parseParameters = (params: Json | null): ResourceParameter[] => {
  if (!params || !Array.isArray(params)) return [];
  return params.map((p) => {
    if (typeof p === 'object' && p !== null && !Array.isArray(p)) {
      const obj = p as Record<string, Json>;
      return {
        paramName: String(obj.paramName || ''),
        paramValue: String(obj.paramValue || ''),
        paramAction: obj.paramAction ? String(obj.paramAction) : undefined,
      };
    }
    return { paramName: '', paramValue: '' };
  }).filter(p => p.paramName);
};

// Helper to safely parse API response representation
const parseApiResponseRepresentation = (data: Json | null): ApiResponseRepresentation => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return data as unknown as ApiResponseRepresentation;
};

// Helper to parse basis information
const parseBasisInformation = (data: Json | null): BasisInformation => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return data as unknown as BasisInformation;
};

// Helper to parse services array
const parseServices = (data: Json | null): ServiceChainService[] => {
  if (!data || !Array.isArray(data)) return [];
  return data.map((s) => {
    if (typeof s === 'object' && s !== null && !Array.isArray(s)) {
      const obj = s as Record<string, Json>;
      return {
        participant: String(obj.participant || ''),
        service: String(obj.service || ''),
        params: String(obj.params || ''),
        configuration: String(obj.configuration || ''),
        pre: Array.isArray(obj.pre) ? obj.pre.map(String) : [],
      };
    }
    return { participant: '', service: '', params: '', configuration: '', pre: [] };
  });
};

// Helper to parse embedded resources array
const parseEmbeddedResources = (data: Json | null): ServiceChainEmbeddedResource[] => {
  if (!data || !Array.isArray(data)) return [];
  return data.map((r) => {
    if (typeof r === 'object' && r !== null && !Array.isArray(r)) {
      const obj = r as Record<string, Json>;
      return {
        service_index: Number(obj.service_index || 0),
        resource_type: (String(obj.resource_type || 'data') as 'software' | 'data'),
        resource_url: String(obj.resource_url || ''),
        contract_url: String(obj.contract_url || ''),
        resource_name: obj.resource_name ? String(obj.resource_name) : null,
        resource_description: obj.resource_description ? String(obj.resource_description) : null,
        provider: obj.provider ? String(obj.provider) : null,
        service_offering: obj.service_offering ? String(obj.service_offering) : null,
        parameters: parseParameters(obj.parameters as Json),
        api_response_representation: parseApiResponseRepresentation(obj.api_response_representation as Json),
        visualization_type: obj.visualization_type ? String(obj.visualization_type) as 'upload_document' | 'manual_json_input' | 'data_api' : null,
        upload_url: obj.upload_url ? String(obj.upload_url) : null,
        upload_authorization: obj.upload_authorization ? String(obj.upload_authorization) : null,
        result_url_source: (String(obj.result_url_source || 'contract') as 'contract' | 'fallback' | 'custom'),
        custom_result_url: obj.custom_result_url ? String(obj.custom_result_url) : null,
        result_authorization: obj.result_authorization ? String(obj.result_authorization) : null,
      };
    }
    return {
      service_index: 0,
      resource_type: 'data' as const,
      resource_url: '',
      contract_url: '',
      resource_name: null,
      resource_description: null,
      provider: null,
      service_offering: null,
      parameters: [],
      api_response_representation: {},
      visualization_type: null,
      upload_url: null,
      upload_authorization: null,
      result_url_source: 'contract' as const,
      custom_result_url: null,
      result_authorization: null,
    };
  }).filter(r => r.resource_url);
};

export const useDataspaceConfig = (
  organizationId?: string,
  options?: { enabled?: boolean }
) => {
  const enabled = options?.enabled ?? true;
  const [config, setConfig] = useState<DataspaceConfig>({
    pdcConfig: null,
    softwareResources: [],
    dataResources: [],
    serviceChains: [],
    isLoading: true,
    error: null,
  });

  const fetchConfig = useCallback(async () => {
    if (!enabled) {
      setConfig((prev) => ({ ...prev, isLoading: false, error: null }));
      return;
    }

    setConfig((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Fetch all active PDC configs to aggregate export_api_configs
      let pdcQuery = supabase
        .from("dataspace_configs")
        .select("*")
        .eq("is_active", true);
      if (organizationId) {
        pdcQuery = pdcQuery.eq("organization_id", organizationId);
      }
      const { data: allPdcData, error: pdcError } = await pdcQuery;

      if (pdcError) {
        console.error("Error fetching PDC config:", pdcError);
      }

      // Use the first config for PDC settings, but merge export_api_configs from all
      const pdcData = allPdcData && allPdcData.length > 0 ? allPdcData[0] : null;

      // Fetch visible resources (software and data)
      let resourcesQuery = supabase
        .from("dataspace_params")
        .select("*")
        .eq("is_visible", true);
      if (organizationId) {
        resourcesQuery = resourcesQuery.eq("organization_id", organizationId);
      }
      const { data: resourcesData, error: resourcesError } = await resourcesQuery;

      if (resourcesError) {
        throw new Error(`Failed to fetch resources: ${resourcesError.message}`);
      }

      // Fetch visible service chains
      let chainsQuery = supabase
        .from("service_chains")
        .select("*")
        .eq("is_visible", true);
      if (organizationId) {
        chainsQuery = chainsQuery.eq("organization_id", organizationId);
      }
      const { data: chainsData, error: chainsError } = await chainsQuery;

      if (chainsError) {
        throw new Error(`Failed to fetch service chains: ${chainsError.message}`);
      }

      // Aggregate export_api_configs from all active PDC configs
      const allExportApiConfigs = (allPdcData || []).flatMap((d: any) =>
        Array.isArray(d.export_api_configs) ? d.export_api_configs : []
      );

      // Parse PDC config
      const pdcConfig: PdcConfig | null = pdcData
        ? {
            id: pdcData.id,
            name: pdcData.name,
            pdc_url: pdcData.pdc_url,
            bearer_token_secret_name: pdcData.bearer_token_secret_name,
            fallback_result_url: pdcData.fallback_result_url,
            fallback_result_authorization: (pdcData as unknown as { fallback_result_authorization?: string }).fallback_result_authorization ?? null,
            is_active: pdcData.is_active ?? true,
            organization_id: pdcData.organization_id,
            export_api_configs: allExportApiConfigs,
          }
        : null;

      // Parse software resources
      const softwareResources: SoftwareResource[] = (resourcesData || [])
        .filter((r) => r.resource_type === "software")
        .map((r) => ({
          id: r.id,
          resource_url: r.resource_url,
          contract_url: r.contract_url,
          resource_name: r.resource_name,
          resource_description: r.resource_description,
          resource_type: "software" as const,
          provider: r.provider,
          service_offering: r.service_offering,
          parameters: parseParameters(r.parameters),
          param_actions: r.param_actions || [],
          llm_context: (r as unknown as { llm_context?: string | null }).llm_context ?? null,
          is_visible: r.is_visible ?? true,
          organization_id: r.organization_id,
        }));

      // Parse data resources
      const dataResources: DataResource[] = (resourcesData || [])
        .filter((r) => r.resource_type === "data")
        .map((r) => ({
          id: r.id,
          resource_url: r.resource_url,
          contract_url: r.contract_url,
          resource_name: r.resource_name,
          resource_description: r.resource_description,
          resource_type: "data" as const,
          provider: r.provider,
          service_offering: r.service_offering,
          parameters: parseParameters(r.parameters),
          param_actions: r.param_actions || [],
          api_response_representation: parseApiResponseRepresentation(r.api_response_representation),
          upload_file: r.upload_file ?? false,
          is_visible: r.is_visible ?? true,
          visualization_type: r.visualization_type,
          organization_id: r.organization_id,
          upload_url: r.upload_url ?? null,
          upload_authorization: r.upload_authorization ?? null,
          result_url_source: (r as unknown as { result_url_source?: string }).result_url_source as 'contract' | 'fallback' | 'custom' ?? 'contract',
          custom_result_url: (r as unknown as { custom_result_url?: string }).custom_result_url ?? null,
          result_authorization: (r as unknown as { result_authorization?: string }).result_authorization ?? null,
          result_query_params: ((r as unknown as { result_query_params?: Array<{ paramName: string; paramValue: string }> }).result_query_params) ?? [],
        }));

      // Parse service chains
      const serviceChains: ServiceChain[] = (chainsData || []).map((c) => ({
        id: c.id,
        catalog_id: c.catalog_id,
        contract_url: c.contract_url,
        services: parseServices(c.services),
        basis_information: parseBasisInformation(c.basis_information),
        llm_context: (c as unknown as { llm_context?: string | null }).llm_context ?? null,
        status: c.status || "active",
        is_visible: c.is_visible ?? true,
        visualization_type: c.visualization_type,
        organization_id: c.organization_id,
        config_id: c.config_id,
        embedded_resources: parseEmbeddedResources((c as unknown as { embedded_resources?: Json }).embedded_resources),
        result_url_source: ((c as unknown as { result_url_source?: string }).result_url_source as 'contract' | 'fallback' | 'custom') ?? 'contract',
        custom_result_url: (c as unknown as { custom_result_url?: string }).custom_result_url ?? null,
        result_authorization: (c as unknown as { result_authorization?: string }).result_authorization ?? null,
        result_query_params: ((c as unknown as { result_query_params?: Array<{ paramName: string; paramValue: string }> }).result_query_params) ?? [],
      }));

      setConfig({
        pdcConfig,
        softwareResources,
        dataResources,
        serviceChains,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      console.error("Error fetching dataspace config:", err);
      setConfig((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, [enabled, organizationId]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig, enabled]);

  return { ...config, refetch: fetchConfig };
};

export default useDataspaceConfig;
