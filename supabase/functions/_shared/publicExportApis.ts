const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};

// Only presentation and request-template fields belong in the public gateway.
// Credentials are resolved from the saved endpoint by result-proxy.
export const publicExportApis = (value: unknown): Record<string, unknown>[] =>
  (Array.isArray(value) ? value : []).map(asRecord)
    .filter((api) => api.is_active !== false && typeof api.id === "string")
    .map((api) => ({
      id: api.id,
      name: api.name,
      url: api.url,
      api_version: api.api_version,
      is_active: api.is_active ?? true,
      import_button_text: api.import_button_text,
      params: api.params,
      body_template: api.body_template,
      target_resources: api.target_resources,
      post_import_button_text: api.post_import_button_text,
      post_import_button_url: api.post_import_button_url,
      server_managed: true,
    }));
