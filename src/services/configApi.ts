import { supabase } from "@/integrations/supabase/client";
import { VisualizationType } from "@/types/auth";
import { ExportApiConfig } from "@/types/dataspace";

const CONFIG_API_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/config-api`;

interface ConfigApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  path?: string;
  organizationId?: string;
}

async function configApiRequest<T>(options: ConfigApiOptions): Promise<{ data: T | null; error: Error | null }> {
  const { method = 'GET', body, path = '', organizationId } = options;

  const session = await supabase.auth.getSession();
  if (!session.data.session?.access_token) {
    return { data: null, error: new Error('Not authenticated') };
  }

  try {
    const response = await fetch(`${CONFIG_API_BASE}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${session.data.session.access_token}`,
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        ...(organizationId ? { 'x-organization-id': organizationId } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const result = await response.json();

    if (!response.ok) {
      return { data: null, error: new Error(result.error || 'Request failed') };
    }

    return { data: result.data ?? result, error: null };
  } catch (err) {
    return { data: null, error: err as Error };
  }
}

// PDC Configuration
export interface PdcConfigData {
  id?: string;
  name?: string;
  pdc_url: string;
  bearer_token?: string;
  fallback_result_url?: string;
  fallback_result_authorization?: string;
  export_api_configs?: ExportApiConfig[];
  is_active?: boolean;
}

export const getPdcConfig = (organizationId?: string) =>
  configApiRequest<PdcConfigData>({ path: '/pdc', organizationId });

export const createPdcConfig = (data: PdcConfigData, organizationId?: string) =>
  configApiRequest<PdcConfigData>({ method: 'POST', path: '/pdc', body: data, organizationId });

export const updatePdcConfig = (id: string, data: Partial<PdcConfigData>, organizationId?: string) =>
  configApiRequest<PdcConfigData>({ method: 'PUT', path: `/pdc/${id}`, body: data, organizationId });

// Resources Configuration
export interface ResourceConfigData {
  id: string;
  resource_url: string;
  contract_url: string;
  resource_type: 'software' | 'data' | 'service_chain';
  resource_name?: string;
  resource_description?: string;
  llm_context?: string | null;
  provider?: string;
  service_offering?: string;
  parameters?: Array<{ paramName: string; paramValue: string; paramAction?: string }>;
  api_response_representation?: Record<string, unknown>;
  upload_file?: boolean;
  is_visible?: boolean;
  visualization_type?: VisualizationType;
  param_actions?: string[];
}

export const getResources = () => configApiRequest<ResourceConfigData[]>({ path: '/resources' });

export const updateResource = (id: string, data: Partial<ResourceConfigData>) =>
  configApiRequest<ResourceConfigData>({ method: 'PUT', path: `/resources/${id}`, body: data });

// Global Configuration
export interface GlobalConfigData {
  id?: string;
  app_name?: string;
  app_version?: string;
  environment?: 'development' | 'staging' | 'production';
  features?: {
    enableFileUpload?: boolean;
    enableApiConnections?: boolean;
    enableTextInput?: boolean;
    enableCustomApi?: boolean;
    allowContinueOnPdcError?: boolean;
    llmInsights?: {
      enabled?: boolean;
      provider?: 'openai' | 'custom';
      apiBaseUrl?: string;
      apiKey?: string;
      model?: string;
      promptTemplate?: string;
    };
    maxFileSizeMB?: number;
    maxFilesCount?: number;
  };
  logging?: {
    enabled?: boolean;
    level?: 'debug' | 'info' | 'warn' | 'error';
  };
}

export const getGlobalConfig = () => configApiRequest<GlobalConfigData>({ path: '/global' });

export const updateGlobalConfig = (data: GlobalConfigData) =>
  configApiRequest<GlobalConfigData>({ method: 'PUT', path: '/global', body: data });

// All config at once
export interface AllConfigData {
  dataspaceConfigs: PdcConfigData[];
  dataspaceParams: ResourceConfigData[];
  serviceChains: unknown[];
  globalConfig: GlobalConfigData | null;
}

export const getAllConfig = () => configApiRequest<AllConfigData>({ path: '' });

export interface SettingsBackupData {
  schema_version: number;
  exported_at: string;
  organization: {
    id: string;
    name: string | null;
    slug: string | null;
  };
  organization_settings: Record<string, unknown> | null;
  pdc: {
    configs: Array<Record<string, unknown>>;
    bearer_token: string | null;
  };
  resources: Array<Record<string, unknown>>;
  service_chains: Array<Record<string, unknown>>;
  global_config: Record<string, unknown> | null;
  llm_settings?: Record<string, unknown> | null;
}

export const exportSettingsBackup = (organizationId?: string) =>
  configApiRequest<SettingsBackupData>({ path: '/settings/export', organizationId });

export const importSettingsBackup = (settings: SettingsBackupData, organizationId?: string) =>
  configApiRequest<{ ok: boolean; summary?: ImportSettingsSummary | null }>({
    method: 'POST',
    path: '/settings/import',
    body: { settings },
    organizationId,
  });

export interface CrossOrgImportOptions {
  sourceOrganizationId: string;
  sections: {
    pdc?: boolean;
    resources?: boolean;
    serviceChains?: boolean;
    globalConfig?: boolean;
    organizationSettings?: boolean;
  };
}

export interface ImportSettingsSummary {
  organizationSettingsImported?: boolean;
  globalConfigImported?: boolean;
  pdcConfigsCreated?: number;
  pdcConfigsUpdated?: number;
  pdcBearerTokenImported?: boolean;
  resourcesCreated?: number;
  resourcesUpdated?: number;
  serviceChainsCreated?: number;
  serviceChainsUpdated?: number;
  embeddedResourcesRemapped?: number;
}

export const importSettingsFromOrganization = (
  options: CrossOrgImportOptions,
  organizationId?: string,
) =>
  configApiRequest<{ ok: boolean; summary?: ImportSettingsSummary | null }>({
    method: 'POST',
    path: '/settings/import-from-organization',
    body: options,
    organizationId,
  });
