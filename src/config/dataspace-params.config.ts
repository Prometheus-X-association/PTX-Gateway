// Dataspace Parameters Configuration
// Type definitions and helper functions for resource parameters
// NOTE: Actual parameter data is now stored in the database and managed via the admin dashboard

// Special values:
// - "#genSessionId" - Will be replaced with a generated session ID at runtime
// - "#ignorePayload" - Parameter will be excluded from PDC payload
// - "#ignoreFlowResult" - Parameter will be excluded from result flow

export interface UploadConfigParam {
  paramName: string;
  paramValue: string;
}

export interface DataSpaceParam {
  resource: string;
  contract: string;
  parameters: {
    paramName: string;
    paramValue: string;
    paramAction?: string;
  }[];
  uploads?: UploadConfigParam[];
}

// NOTE: All parameter data is now stored in the database
// Use the admin dashboard to manage resource parameters
// The dataSpaceParams export below is deprecated and kept for backward compatibility
export const dataSpaceParams: DataSpaceParam[] = [];

// Helper function to find parameters for a resource
// NOTE: This function now returns empty results - use database queries instead
export const findResourceParams = (
  resourceUrl: string,
  contractUrl: string,
): { paramName: string; paramValue: string; paramAction?: string }[] | undefined => {
  const match = dataSpaceParams.find((param) => param.resource === resourceUrl && param.contract === contractUrl);
  return match?.parameters;
};

// Helper function to get paramActions map for a resource
// NOTE: This function now returns empty results - use database queries instead
export const getParamActionsMap = (
  resourceUrl: string,
  contractUrl: string,
): Record<string, string | undefined> => {
  const params = findResourceParams(resourceUrl, contractUrl);
  if (!params) return {};
  
  return params.reduce(
    (acc, { paramName, paramAction }) => {
      acc[paramName] = paramAction;
      return acc;
    },
    {} as Record<string, string | undefined>,
  );
};

// Helper function to find upload config for a resource
// NOTE: This function now returns empty results - use database queries instead
export const findUploadConfig = (
  resourceUrl: string,
  contractUrl: string,
): { uploadUrl: string; authorization: string } | undefined => {
  const match = dataSpaceParams.find((param) => param.resource === resourceUrl && param.contract === contractUrl);
  if (!match?.uploads) return undefined;

  const uploadUrlParam = match.uploads.find((u) => u.paramName === "uploadUrl");
  const authParam = match.uploads.find((u) => u.paramName === "Authorization");

  if (!uploadUrlParam) return undefined;

  return {
    uploadUrl: uploadUrlParam.paramValue,
    authorization: authParam?.paramValue || "",
  };
};

// Helper function to convert parameters array to Record<string, string>
// NOTE: This function now returns empty results - use database queries instead
export const getParamsAsRecord = (resourceUrl: string, contractUrl: string): Record<string, string> => {
  const params = findResourceParams(resourceUrl, contractUrl);
  if (!params) return {};

  return params.reduce(
    (acc, { paramName, paramValue }) => {
      acc[paramName] = paramValue;
      return acc;
    },
    {} as Record<string, string>,
  );
};

// Helper to generate session ID (for #genSessionId special value)
export const generateSessionId = (): string => {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

// Helper to resolve special values in parameters
export const resolveParamValue = (value: string): string => {
  if (value === "#genSessionId") {
    return generateSessionId();
  }
  return value;
};

export default dataSpaceParams;
