// Data Space Configuration
// Type definitions for PDC connector settings and dataspace contract data
// NOTE: Actual configuration data is now stored in the database and managed via the admin dashboard

// PDC (PTX-Dataspace-Connector) Configuration
// NOTE: Bearer tokens should NEVER be stored in client-side code
// They are securely managed via backend secrets (PDC_BEARER_TOKEN)
export interface PDCConfig {
  url: string;
  // bearerToken is intentionally removed - managed server-side only
}

// Basis Information from ecosystem
export interface BasisInformation {
  ecosystem: string;
  name: string;
  description: string;
}

// Software Resource extracted from contract
export interface SoftwareResource {
  resource: string;
  name: string;
  description: string;
  queryParam: string[];
  provider: string;
  serviceOffering: string;
  basisInformation: BasisInformation;
  contract: string;
}

// API Response Representation for data resources
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

// Data Resource extracted from contract
export interface DataResource {
  resource: string;
  name: string;
  description: string;
  queryParam: string[];
  provider: string;
  serviceOffering: string;
  basisInformation: BasisInformation;
  contract: string;
  apiResponseRepresentation: ApiResponseRepresentation;
  uploadFile: boolean;
}

// Service in a service chain
export interface ServiceChainService {
  participant: string;
  service: string;
  params: string;
  configuration: string;
  pre: string[];
}

// Service Chain extracted from contract
export interface ServiceChain {
  catalogId: string;
  services: ServiceChainService[];
  status: string;
  _id: string;
  basisInformation: BasisInformation;
  contract: string;
}

// Contract data structure (from extraction)
export interface ContractData {
  softwareResources: SoftwareResource[];
  dataResources: DataResource[];
  serviceChains: ServiceChain[];
}

// Result URL Parameter configuration
// Supports special values:
// - #genSessionId: Will be replaced with the current process session ID
// - #ignoreParam: Parameter will be excluded from payload generation
export interface ResultUrlParam {
  paramName: string;
  paramValue: string;
  location: "body" | "query"; // Where to include the parameter
}

// Fallback/Alternative Result URL Configuration
export interface ResultUrlConfig {
  url: string;
  method: "GET" | "POST";
  description: string;
  parameters: ResultUrlParam[];
}

// Main DataSpace Configuration
export interface DataSpaceConfig {
  pdc: PDCConfig;
  contract: ContractData;
  resultUrl: ResultUrlConfig; // Fallback URL for result fetching
}

// NOTE: All configuration data is now stored in the database
// Use the useDataspaceConfig hook or admin dashboard to manage configuration
// The dataSpaceConfig export below is deprecated and will be removed
export const dataSpaceConfig: DataSpaceConfig = {
  pdc: {
    url: "", // Loaded from database
  },
  contract: {
    softwareResources: [], // Loaded from database
    dataResources: [], // Loaded from database
    serviceChains: [], // Loaded from database
  },
  resultUrl: {
    url: "", // Loaded from database
    method: "GET",
    description: "Configured in database",
    parameters: [],
  },
};

// Helper to get PDC config (deprecated - use useDataspaceConfig hook instead)
export const getPDCConfig = (): PDCConfig => {
  return dataSpaceConfig.pdc;
};

// Helper to get all software resources (deprecated - use useDataspaceConfig hook instead)
export const getSoftwareResources = (): SoftwareResource[] => {
  return dataSpaceConfig.contract.softwareResources;
};

// Helper to get all data resources (deprecated - use useDataspaceConfig hook instead)
export const getDataResources = (): DataResource[] => {
  return dataSpaceConfig.contract.dataResources;
};

// Helper to get all service chains (deprecated - use useDataspaceConfig hook instead)
export const getServiceChains = (): ServiceChain[] => {
  return dataSpaceConfig.contract.serviceChains;
};

// Helper to find a specific resource (deprecated - use useDataspaceConfig hook instead)
export const findResource = (
  resourceUrl: string,
): SoftwareResource | DataResource | undefined => {
  const software = dataSpaceConfig.contract.softwareResources.find(
    (r) => r.resource === resourceUrl,
  );
  if (software) return software;
  return dataSpaceConfig.contract.dataResources.find(
    (r) => r.resource === resourceUrl,
  );
};

// Helper to get result URL config (deprecated - use useDataspaceConfig hook instead)
export const getResultUrlConfig = (): ResultUrlConfig => {
  return dataSpaceConfig.resultUrl;
};
