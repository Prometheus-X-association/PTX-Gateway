// Dataspace Types - Backend-driven data structures
// All types are derived from the Supabase database schema

export type VisualizationType = 'upload_document' | 'manual_json_input' | 'data_api';

// PDC Configuration from dataspace_configs table
// Export API configuration for admin-managed endpoints
export interface ExportApiConfig {
  name: string;
  url: string;
  authorization?: string;
  params?: Array<{ key: string; value: string }>;
  body_template?: string;
}

export interface PdcConfig {
  id: string;
  name: string;
  pdc_url: string;
  bearer_token_secret_name: string | null;
  fallback_result_url: string | null;
  fallback_result_authorization: string | null;
  is_active: boolean;
  organization_id: string | null;
  export_api_configs?: ExportApiConfig[];
}

// Parameter structure (stored as JSONB)
export interface ResourceParameter {
  paramName: string;
  paramValue: string;
  paramAction?: string;
}

// API Response Representation (stored as JSONB)
export interface ApiResponseRepresentation {
  _id?: string;
  resourceID?: string;
  fileType?: string;
  type?: string;
  url?: string;
  sqlQuery?: string;
  className?: string;
  method?: string;
  credential?: string;
  mimeType?: string;
  queryParams?: string[];
  input?: {
    format?: string;
    description?: string;
    snippet?: string;
    size?: string;
  };
  output?: {
    format?: string;
    description?: string;
    snippet?: string;
  };
  processingTime?: string;
  createdAt?: string;
  updatedAt?: string;
  __v?: number;
}

// Result URL source options
export type ResultUrlSource = 'contract' | 'fallback' | 'custom';

// Data Resource from dataspace_params table (resource_type = 'data')
export interface DataResource {
  id: string;
  resource_url: string;
  contract_url: string;
  resource_name: string | null;
  resource_description: string | null;
  resource_type: 'data';
  provider: string | null;
  service_offering: string | null;
  parameters: ResourceParameter[];
  param_actions: string[];
  api_response_representation: ApiResponseRepresentation;
  upload_file: boolean;
  is_visible: boolean;
  visualization_type: VisualizationType | null;
  organization_id: string | null;
  // Upload configuration for visualization_type = 'upload_document'
  upload_url: string | null;
  upload_authorization: string | null;
  // Result URL configuration
  result_url_source: ResultUrlSource;
  custom_result_url: string | null;
  result_authorization: string | null;
  result_query_params: ResultQueryParam[];
  // Legacy field (deprecated, use result_url_source instead)
  use_fallback_result_url?: boolean;
}

// Software Resource from dataspace_params table (resource_type = 'software')
export interface SoftwareResource {
  id: string;
  resource_url: string;
  contract_url: string;
  resource_name: string | null;
  resource_description: string | null;
  resource_type: 'software';
  provider: string | null;
  service_offering: string | null;
  parameters: ResourceParameter[];
  param_actions: string[];
  llm_context?: string | null;
  is_visible: boolean;
  organization_id: string | null;
}

// Embedded Resource in Service Chain (extracted resource details)
export interface ServiceChainEmbeddedResource {
  service_index: number;
  resource_type: 'software' | 'data';
  resource_url: string;
  contract_url: string;
  resource_name: string | null;
  resource_description: string | null;
  provider: string | null;
  service_offering: string | null;
  parameters: ResourceParameter[];
  api_response_representation: ApiResponseRepresentation;
  visualization_type: VisualizationType | null;
  upload_url: string | null;
  upload_authorization: string | null;
  result_url_source: ResultUrlSource;
  custom_result_url: string | null;
  result_authorization: string | null;
}

// Service Chain Service (from services JSONB array)
export interface ServiceChainService {
  participant: string;
  service: string;
  params: string;
  configuration: string;
  pre: string[];
}

// Basis Information for service chains
export interface BasisInformation {
  ecosystem?: string;
  name?: string;
  description?: string;
}

// Result query parameter for service chains
export interface ResultQueryParam {
  paramName: string;
  paramValue: string;
}

// Service Chain from service_chains table
export interface ServiceChain {
  id: string;
  catalog_id: string;
  contract_url: string;
  services: ServiceChainService[];
  basis_information: BasisInformation;
  llm_context?: string | null;
  status: string;
  is_visible: boolean;
  visualization_type: VisualizationType | null;
  organization_id: string | null;
  config_id: string | null;
  embedded_resources: ServiceChainEmbeddedResource[];
  result_url_source?: ResultUrlSource;
  custom_result_url?: string | null;
  result_authorization?: string | null;
  result_query_params?: ResultQueryParam[];
}

// Analytics option for selection - can be software or service chain
export type AnalyticsOption = 
  | { type: "software"; data: SoftwareResource }
  | { type: "serviceChain"; data: ServiceChain };

// Complete dataspace configuration from backend
export interface DataspaceConfig {
  pdcConfig: PdcConfig | null;
  softwareResources: SoftwareResource[];
  dataResources: DataResource[];
  serviceChains: ServiceChain[];
  isLoading: boolean;
  error: string | null;
}

// Helper to extract query param names from parameters array
export const getQueryParamNames = (parameters: ResourceParameter[]): string[] => {
  return parameters.map(p => p.paramName);
};

// Helper to get param actions map
export const getParamActionsMap = (parameters: ResourceParameter[]): Record<string, string | undefined> => {
  return parameters.reduce((acc, p) => {
    acc[p.paramName] = p.paramAction;
    return acc;
  }, {} as Record<string, string | undefined>);
};

// Helper to get pre-filled param values
export const getParamValuesMap = (parameters: ResourceParameter[]): Record<string, string> => {
  return parameters.reduce((acc, p) => {
    acc[p.paramName] = p.paramValue;
    return acc;
  }, {} as Record<string, string>);
};
