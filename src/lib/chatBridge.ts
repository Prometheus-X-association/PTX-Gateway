/** Hosts can supply context and their own converter settings, never organization identity or agent configuration. */
interface BridgeUploadConfig { uploadUrl: string; authorization: string; queryParams: Record<string, string> }
export function readChatContext(value: unknown): { resultData?: unknown; docText?: string; uploadConfig?: BridgeUploadConfig } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Chat context must be an object.");
  const raw = value as Record<string, unknown>;
  if (raw.docText !== undefined && typeof raw.docText !== "string") throw new Error("Document context must be text.");
  if (new TextEncoder().encode(JSON.stringify(value)).length > 1024 * 1024) throw new Error("Chat context exceeds 1 MiB.");
  let uploadConfig: BridgeUploadConfig | undefined;
  if (raw.uploadConfig !== undefined) {
    if (!raw.uploadConfig || typeof raw.uploadConfig !== "object" || Array.isArray(raw.uploadConfig)) throw new Error("Invalid upload configuration.");
    const config = raw.uploadConfig as Record<string, unknown>;
    if (typeof config.uploadUrl !== "string" || config.uploadUrl.length > 2000 || new URL(config.uploadUrl).protocol !== "https:") throw new Error("Document converters require an HTTPS URL.");
    const converterUrl = new URL(config.uploadUrl);
    if (converterUrl.username || converterUrl.password) throw new Error("Use the converter authorization setting instead of URL credentials.");
    if (config.authorization !== undefined && (typeof config.authorization !== "string" || config.authorization.length > 4000)) throw new Error("Invalid converter authorization.");
    const params = config.queryParams ?? {};
    if (!params || typeof params !== "object" || Array.isArray(params) || Object.keys(params).length > 50) throw new Error("Invalid converter parameters.");
    for (const [name, value] of Object.entries(params)) if (name.length > 100 || typeof value !== "string" || value.length > 2000) throw new Error("Invalid converter parameter.");
    uploadConfig = { uploadUrl: config.uploadUrl, authorization: (config.authorization as string) || "", queryParams: params as Record<string, string> };
  }
  return { ...(uploadConfig ? { uploadConfig } : {}), ...(Object.prototype.hasOwnProperty.call(raw, "resultData") ? { resultData: raw.resultData } : {}), ...(raw.docText !== undefined ? { docText: raw.docText as string } : {}) };
}
export function trustedChatMessage(event: Pick<MessageEvent, "origin" | "source">, parent: MessageEventSource | null, origin: string): boolean {
  return Boolean(origin && origin !== "null" && event.source === parent && event.origin === origin);
}
