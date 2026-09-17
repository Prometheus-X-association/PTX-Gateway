import type { UploadConfig } from "@/components/DocumentUploadZone";
import type { DataResource } from "@/types/dataspace";
import { sanitizeParams } from "@/utils/paramSanitizer";

/**
 * Keeps result-page chat uploads available even when the user reached Results
 * through an API/manual resource rather than selecting the document resource.
 */
export const resolveChatUploadConfig = (
  selectedConfig: UploadConfig | null | undefined,
  resources: DataResource[],
  sessionId: string,
): UploadConfig | undefined => {
  if (selectedConfig?.uploadUrl?.trim()) return selectedConfig;

  const resource = resources.find((item) =>
    item.visualization_type === "upload_document" && Boolean(item.upload_url?.trim())
  );
  if (!resource?.upload_url) return undefined;

  const values: Record<string, string> = {};
  const actions: Record<string, string | undefined> = {};
  resource.parameters.forEach((parameter) => {
    values[parameter.paramName] = parameter.paramValue;
    actions[parameter.paramName] = parameter.paramAction;
  });

  return {
    uploadUrl: resource.upload_url,
    authorization: resource.upload_authorization || "",
    queryParams: sanitizeParams(values, sessionId, true, "flowData", actions),
  };
};
