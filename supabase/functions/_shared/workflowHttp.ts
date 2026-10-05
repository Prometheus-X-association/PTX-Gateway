type KeyValue = { key?: string; value?: string; enabled?: boolean };
type ApiConfig = {
  url?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  queryParams?: KeyValue[];
  headers?: KeyValue[];
  authType?: "none" | "bearer" | "basic" | "api_key";
  bearerToken?: string;
  basicUsername?: string;
  basicPassword?: string;
  apiKeyName?: string;
  apiKeyValue?: string;
  apiKeyLocation?: "header" | "query";
  bodyType?: "none" | "json" | "text" | "form_urlencoded";
  body?: string;
  responseType?: "auto" | "json" | "text";
  outputPath?: string;
};

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const readPath = (value: unknown, path: string): unknown => {
  const normalized = path.trim().replace(/^\$\.?/, "");
  if (!normalized) return value;
  let current = value;
  for (const part of normalized.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const printable = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
};

const interpolate = (template: string, context: { input: unknown; result: unknown; userMessage: string }): string =>
  template.replace(/\{\{\s*(prevOutput|input|result|userMessage)(?:\.([^}]+))?\s*\}\}/g, (_match, root: string, path?: string) => {
    const source = root === "result" ? context.result : root === "userMessage" ? context.userMessage : context.input;
    return printable(path ? readPath(source, path.trim()) : source);
  });

const blockedHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") return true;
  if (host === "::1" || host === "0.0.0.0" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [a, b] = match.slice(1).map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

const assertPublicUrl = async (url: URL): Promise<void> => {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || blockedHostname(url.hostname)) {
    throw new Error("Only public HTTP(S) API URLs without embedded credentials are allowed.");
  }
  const lookups = await Promise.allSettled([
    Deno.resolveDns(url.hostname, "A"),
    Deno.resolveDns(url.hostname, "AAAA"),
  ]);
  const addresses = lookups.flatMap((lookup) => lookup.status === "fulfilled" ? lookup.value : []);
  if (addresses.some(blockedHostname)) throw new Error("API URLs resolving to a private or local network are not allowed.");
};

const forbiddenHeader = (name: string): boolean =>
  ["host", "content-length", "connection", "transfer-encoding", "upgrade", "proxy-authorization", "proxy-authenticate"].includes(name.toLowerCase());

export const runRequest = async (config: ApiConfig, input: unknown, result: unknown, userMessage: string, signal?: AbortSignal) => {
  const context = { input, result, userMessage };
  const rawUrl = interpolate(config.url?.trim() || "", context);
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("API URL is invalid after resolving dynamic values."); }
  await assertPublicUrl(url);

  for (const row of config.queryParams ?? []) {
    if (row.enabled === false || !row.key?.trim()) continue;
    url.searchParams.append(interpolate(row.key, context), interpolate(row.value ?? "", context));
  }

  const headers = new Headers({ Accept: "application/json, text/plain, */*" });
  for (const row of config.headers ?? []) {
    if (row.enabled === false || !row.key?.trim()) continue;
    const name = interpolate(row.key, context).trim();
    if (!name || forbiddenHeader(name)) continue;
    headers.set(name, interpolate(row.value ?? "", context));
  }

  if (config.authType === "bearer" && config.bearerToken) headers.set("Authorization", `Bearer ${config.bearerToken}`);
  if (config.authType === "basic") headers.set("Authorization", `Basic ${btoa(`${config.basicUsername ?? ""}:${config.basicPassword ?? ""}`)}`);
  if (config.authType === "api_key" && config.apiKeyName && config.apiKeyValue) {
    if (config.apiKeyLocation === "query") url.searchParams.set(config.apiKeyName, config.apiKeyValue);
    else headers.set(config.apiKeyName, config.apiKeyValue);
  }

  const method = config.method ?? "GET";
  let requestBody: string | undefined;
  if (method !== "GET" && config.bodyType && config.bodyType !== "none") {
    requestBody = interpolate(config.body ?? "", context);
    if (config.bodyType === "json") {
      try { requestBody = JSON.stringify(JSON.parse(requestBody)); } catch (error) { throw new Error(`Request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    } else if (config.bodyType === "form_urlencoded" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
    } else if (!headers.has("Content-Type")) headers.set("Content-Type", "text/plain; charset=utf-8");
  }

  const started = performance.now();
  const response = await fetch(url, { method, headers, body: requestBody, redirect: "manual", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
  const raw = await response.text();
  if (raw.length > 2_000_000) throw new Error("API response exceeds the 2 MB workflow limit.");
  let data: unknown = raw;
  const responseType = config.responseType ?? "auto";
  if (responseType === "json" || (responseType === "auto" && (response.headers.get("content-type") ?? "").includes("json"))) {
    try { data = raw ? JSON.parse(raw) : null; } catch { if (responseType === "json") throw new Error("API response is not valid JSON."); }
  }
  const safeHeaders: Record<string, string> = {};
  for (const name of ["content-type", "content-length", "etag", "last-modified", "x-request-id"]) {
    const value = response.headers.get(name); if (value) safeHeaders[name] = value;
  }
  const output = readPath(data, config.outputPath ?? "");
  if (config.outputPath?.trim() && output === undefined) throw new Error(`Output data path "${config.outputPath}" was not found in the API response.`);
  return { ok: response.ok, status: response.status, statusText: response.statusText, durationMs: Math.round(performance.now() - started), headers: safeHeaders, data, output, error: response.ok ? undefined : `API returned HTTP ${response.status} ${response.statusText}` };
};
