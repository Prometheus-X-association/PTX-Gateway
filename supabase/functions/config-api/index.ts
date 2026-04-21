import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-organization-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ======================
// Input Validation Schemas
// ======================

const PdcConfigSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  pdc_url: z.string().url().max(500),
  bearer_token: z.string().max(1000).optional(),
  fallback_result_url: z.string().url().max(500).optional().nullable(),
  fallback_result_authorization: z.string().max(2000).optional().nullable(),
  export_api_configs: z.array(z.record(z.unknown())).max(50).optional(),
  is_active: z.boolean().optional(),
});

const PdcConfigUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  pdc_url: z.string().url().max(500).optional(),
  bearer_token: z.string().max(1000).optional(),
  fallback_result_url: z.string().url().max(500).optional().nullable(),
  fallback_result_authorization: z.string().max(2000).optional().nullable(),
  export_api_configs: z.array(z.record(z.unknown())).max(50).optional(),
  is_active: z.boolean().optional(),
});

const ResourceParameterSchema = z.object({
  paramName: z.string().max(100),
  paramValue: z.string().max(2000),
  paramAction: z.string().max(100).optional(),
});

const ResourceUpdateSchema = z.object({
  resource_name: z.string().max(200).optional().nullable(),
  resource_description: z.string().max(2000).optional().nullable(),
  llm_context: z.string().max(10000).optional().nullable(),
  resource_url: z.string().url().max(500).optional(),
  contract_url: z.string().url().max(500).optional(),
  provider: z.string().max(200).optional().nullable(),
  service_offering: z.string().max(500).optional().nullable(),
  parameters: z.array(ResourceParameterSchema).max(50).optional(),
  param_actions: z.array(z.string().max(100)).max(20).optional(),
  api_response_representation: z.record(z.unknown()).optional(),
  upload_file: z.boolean().optional(),
  is_visible: z.boolean().optional(),
  visualization_type: z.enum(['upload_document', 'manual_json_input', 'data_api']).optional().nullable(),
}).strict();

const FeaturesSchema = z.object({
  enableFileUpload: z.boolean().optional(),
  enableTextInput: z.boolean().optional(),
  enableApiConnections: z.boolean().optional(),
  enableCustomApi: z.boolean().optional(),
  allowContinueOnPdcError: z.boolean().optional(),
  llmInsights: z.object({
    enabled: z.boolean().optional(),
    provider: z.enum(["openai", "custom"]).optional(),
    apiBaseUrl: z.string().max(500).optional(),
    apiKey: z.string().max(5000).optional(),
    model: z.string().max(200).optional(),
    promptTemplate: z.string().max(50000).optional(),
  }).optional(),
  maxFileSizeMB: z.number().min(1).max(1000).optional(),
  maxFilesCount: z.number().min(1).max(100).optional(),
}).strict();

const LoggingSchema = z.object({
  enabled: z.boolean().optional(),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
}).strict();

const GlobalConfigSchema = z.object({
  app_name: z.string().max(100).optional().nullable(),
  app_version: z.string().max(20).optional().nullable(),
  environment: z.enum(['development', 'staging', 'production']).optional().nullable(),
  features: FeaturesSchema.optional(),
  logging: LoggingSchema.optional(),
}).strict();

const SettingsBackupSchema = z.object({
  schema_version: z.number().optional(),
  exported_at: z.string().optional(),
  organization: z.record(z.unknown()).optional(),
  organization_settings: z.record(z.unknown()).nullable().optional(),
  embed_settings: z.record(z.unknown()).nullable().optional(),
  pdc: z.object({
    configs: z.array(z.record(z.unknown())).optional(),
    bearer_token: z.string().max(4000).optional().nullable(),
  }).optional(),
  resources: z.array(z.record(z.unknown())).optional(),
  service_chains: z.array(z.record(z.unknown())).optional(),
  global_config: z.record(z.unknown()).nullable().optional(),
  llm_settings: z.record(z.unknown()).nullable().optional(),
  result_page_settings: z.record(z.unknown()).nullable().optional(),
}).passthrough();

const ImportSectionsSchema = z.object({
  pdc: z.boolean().optional(),
  resources: z.boolean().optional(),
  serviceChains: z.boolean().optional(),
  globalConfig: z.boolean().optional(),
  resultPageSettings: z.boolean().optional(),
  organizationSettings: z.boolean().optional(),
  embedSettings: z.boolean().optional(),
}).strict();

const CrossOrgImportSchema = z.object({
  sourceOrganizationId: z.string().min(1).max(100),
  sections: ImportSectionsSchema,
}).strict();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sanitizeOrganizationSettingsForBackup = (
  settings: unknown,
): Record<string, unknown> | null => {
  if (!isRecord(settings)) return null;

  const next: Record<string, unknown> = { ...settings };

  if (isRecord(next.embed)) {
    const embedSettings: Record<string, unknown> = { ...next.embed };
    const allowedOrigins = Array.isArray(embedSettings.allowed_origins)
      ? embedSettings.allowed_origins.map((origin) => String(origin)).filter((origin) => origin.trim().length > 0)
      : [];

    // Keep non-token embed settings; remove token registries/history.
    delete embedSettings.persistent_tokens;
    delete embedSettings.issued_tokens;
    delete embedSettings.issued_token_history;
    delete embedSettings.tokens;

    embedSettings.allowed_origins = allowedOrigins;
    next.embed = embedSettings;
  }

  return next;
};

const sanitizeEmbedSettingsForBackup = (settings: unknown): Record<string, unknown> | null => {
  if (!isRecord(settings)) return null;
  const embedSettings: Record<string, unknown> = { ...settings };
  const allowedOrigins = Array.isArray(embedSettings.allowed_origins)
    ? embedSettings.allowed_origins.map((origin) => String(origin)).filter((origin) => origin.trim().length > 0)
    : [];

  // Embed tokens are credentials and are intentionally not portable.
  delete embedSettings.persistent_tokens;
  delete embedSettings.issued_tokens;
  delete embedSettings.issued_token_history;
  delete embedSettings.tokens;

  embedSettings.allowed_origins = allowedOrigins;
  embedSettings.embed_enabled = embedSettings.embed_enabled !== false;
  return embedSettings;
};

const getEmbedSettingsFromOrganizationSettings = (settings: unknown): Record<string, unknown> | null => {
  if (!isRecord(settings) || !isRecord(settings.embed)) return null;
  return sanitizeEmbedSettingsForBackup(settings.embed);
};

const sanitizeCustomVisualization = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value)) return null;

  const libraryFiles = Array.isArray(value.library_files)
    ? value.library_files
      .filter(isRecord)
      .map((file) => ({
        id: typeof file.id === 'string' ? file.id : crypto.randomUUID(),
        file_name: typeof file.file_name === 'string' ? file.file_name : 'visualization-file',
        file_type: file.file_type === 'css' ? 'css' : 'js',
        mime_type: typeof file.mime_type === 'string' ? file.mime_type : undefined,
        content: typeof file.content === 'string' ? file.content : '',
      }))
      .filter((file) => file.content.trim().length > 0)
    : [];

  return {
    id: typeof value.id === 'string' ? value.id : crypto.randomUUID(),
    name: typeof value.name === 'string' ? value.name : '',
    description: typeof value.description === 'string' ? value.description : '',
    is_active: typeof value.is_active === 'boolean' ? value.is_active : false,
    library_source: value.library_source === 'upload' ? 'upload' : 'url',
    library_url: typeof value.library_url === 'string' ? value.library_url : '',
    library_file_name: typeof value.library_file_name === 'string' ? value.library_file_name : '',
    library_code: typeof value.library_code === 'string' ? value.library_code : '',
    library_files: libraryFiles,
    json_schema: typeof value.json_schema === 'string' ? value.json_schema : '',
    render_code: typeof value.render_code === 'string' ? value.render_code : '',
    target_resources: Array.isArray(value.target_resources)
      ? value.target_resources.map((target) => String(target)).filter((target) => target.trim().length > 0)
      : [],
  };
};

const sanitizeResultPageSettingsForBackup = (settings: unknown): Record<string, unknown> | null => {
  if (!isRecord(settings)) return null;

  const exportApiConfigs = Array.isArray(settings.exportApiConfigs)
    ? settings.exportApiConfigs.filter(isRecord)
    : [];
  const customVisualizations = Array.isArray(settings.customVisualizations)
    ? settings.customVisualizations.map(sanitizeCustomVisualization).filter(isRecord)
    : [];

  return {
    ...settings,
    exportApiConfigs,
    customVisualizations,
  };
};

const getResultPageSettingsFromGlobalConfig = (globalConfig: unknown): Record<string, unknown> | null => {
  if (!isRecord(globalConfig) || !isRecord(globalConfig.features)) return null;
  const resultPage = isRecord(globalConfig.features.resultPage) ? globalConfig.features.resultPage : null;
  return sanitizeResultPageSettingsForBackup(resultPage);
};

const mergeOrganizationSettingsForImport = (
  currentSettings: unknown,
  incomingSettings: unknown,
  incomingEmbedSettings: unknown,
): Record<string, unknown> | null => {
  const current = isRecord(currentSettings) ? currentSettings : {};
  const sanitizedIncoming = incomingSettings === null
    ? null
    : sanitizeOrganizationSettingsForBackup(incomingSettings);
  const sanitizedEmbed = sanitizeEmbedSettingsForBackup(incomingEmbedSettings);

  if (sanitizedIncoming === null && sanitizedEmbed === null) {
    return null;
  }

  const next: Record<string, unknown> = {
    ...current,
    ...(sanitizedIncoming ?? {}),
  };

  const currentEmbed = isRecord(current.embed) ? current.embed : {};
  const incomingEmbed = isRecord(sanitizedIncoming?.embed) ? sanitizedIncoming.embed : {};
  const mergedEmbed = {
    ...currentEmbed,
    ...incomingEmbed,
    ...(sanitizedEmbed ?? {}),
  };

  if (Object.keys(mergedEmbed).length > 0) {
    next.embed = mergedEmbed;
  }

  return next;
};

const sanitizePdcConfig = (value: Record<string, unknown>) => ({
  name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'default',
  pdc_url: typeof value.pdc_url === 'string' ? value.pdc_url : '',
  fallback_result_url: value.fallback_result_url === null || typeof value.fallback_result_url === 'string'
    ? value.fallback_result_url
    : null,
  fallback_result_authorization: value.fallback_result_authorization === null || typeof value.fallback_result_authorization === 'string'
    ? value.fallback_result_authorization
    : null,
  export_api_configs: Array.isArray(value.export_api_configs) ? value.export_api_configs : [],
  is_active: typeof value.is_active === 'boolean' ? value.is_active : false,
});

const sanitizeResource = (value: Record<string, unknown>) => ({
  id: typeof value.id === 'string' ? value.id : null,
  resource_url: typeof value.resource_url === 'string' ? value.resource_url : '',
  contract_url: typeof value.contract_url === 'string' ? value.contract_url : '',
  resource_type: typeof value.resource_type === 'string' ? value.resource_type : 'data',
  resource_name: value.resource_name === null || typeof value.resource_name === 'string' ? value.resource_name : null,
  resource_description: value.resource_description === null || typeof value.resource_description === 'string' ? value.resource_description : null,
  llm_context: value.llm_context === null || typeof value.llm_context === 'string' ? value.llm_context : null,
  provider: value.provider === null || typeof value.provider === 'string' ? value.provider : null,
  service_offering: value.service_offering === null || typeof value.service_offering === 'string' ? value.service_offering : null,
  parameters: Array.isArray(value.parameters) ? value.parameters : [],
  param_actions: Array.isArray(value.param_actions) ? value.param_actions : [],
  api_response_representation: isRecord(value.api_response_representation) ? value.api_response_representation : {},
  upload_file: typeof value.upload_file === 'boolean' ? value.upload_file : false,
  is_visible: typeof value.is_visible === 'boolean' ? value.is_visible : true,
  visualization_type: value.visualization_type === null || typeof value.visualization_type === 'string' ? value.visualization_type : null,
  upload_url: value.upload_url === null || typeof value.upload_url === 'string' ? value.upload_url : null,
  upload_authorization: value.upload_authorization === null || typeof value.upload_authorization === 'string'
    ? value.upload_authorization
    : null,
  result_url_source: typeof value.result_url_source === 'string' ? value.result_url_source : 'contract',
  custom_result_url: value.custom_result_url === null || typeof value.custom_result_url === 'string' ? value.custom_result_url : null,
  result_authorization: value.result_authorization === null || typeof value.result_authorization === 'string'
    ? value.result_authorization
    : null,
  result_query_params: Array.isArray(value.result_query_params) ? value.result_query_params : [],
});

const sanitizeServiceChain = (value: Record<string, unknown>) => ({
  id: typeof value.id === 'string' ? value.id : null,
  catalog_id: typeof value.catalog_id === 'string' ? value.catalog_id : '',
  contract_url: typeof value.contract_url === 'string' ? value.contract_url : '',
  services: Array.isArray(value.services) ? value.services : [],
  basis_information: isRecord(value.basis_information) ? value.basis_information : {},
  llm_context: value.llm_context === null || typeof value.llm_context === 'string' ? value.llm_context : null,
  status: typeof value.status === 'string' ? value.status : 'active',
  is_visible: typeof value.is_visible === 'boolean' ? value.is_visible : true,
  visualization_type: value.visualization_type === null || typeof value.visualization_type === 'string' ? value.visualization_type : null,
  embedded_resources: Array.isArray(value.embedded_resources) ? value.embedded_resources : [],
  result_url_source: typeof value.result_url_source === 'string' ? value.result_url_source : 'contract',
  custom_result_url: value.custom_result_url === null || typeof value.custom_result_url === 'string' ? value.custom_result_url : null,
  result_authorization: value.result_authorization === null || typeof value.result_authorization === 'string'
    ? value.result_authorization
    : null,
  result_query_params: Array.isArray(value.result_query_params) ? value.result_query_params : [],
});

const getResourceImportSignature = (value: {
  resource_url: string;
  contract_url: string;
  resource_type: string;
}) => `${value.resource_type}::${value.contract_url}::${value.resource_url}`;

const settingsErrorResponse = (message: string, status = 500) =>
  new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );

const buildSettingsBackup = async (adminClient: any, organizationId: string) => {
  const [orgResult, pdcResult, resourcesResult, chainsResult, globalResult] = await Promise.all([
    adminClient
      .from('organizations')
      .select('id, name, slug, settings')
      .eq('id', organizationId)
      .single(),
    adminClient
      .from('dataspace_configs')
      .select('*')
      .eq('organization_id', organizationId),
    adminClient
      .from('dataspace_params')
      .select('*')
      .eq('organization_id', organizationId),
    adminClient
      .from('service_chains')
      .select('*')
      .eq('organization_id', organizationId),
    adminClient
      .from('global_configs')
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle(),
  ]);

  if (orgResult.error || pdcResult.error || resourcesResult.error || chainsResult.error) {
    return { data: null, error: 'Failed to export settings' };
  }

  const { data: secretRow, error: secretError } = await adminClient
    .from('organization_pdc_secrets')
    .select('bearer_token')
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (secretError) {
    return { data: null, error: 'Failed to export PDC secrets' };
  }

  const organizationSettings = sanitizeOrganizationSettingsForBackup(
    (orgResult.data?.settings as Record<string, unknown> | null) ?? null,
  );
  const embedSettings = getEmbedSettingsFromOrganizationSettings(
    (orgResult.data?.settings as Record<string, unknown> | null) ?? null,
  );
  const resultPageSettings = getResultPageSettingsFromGlobalConfig(globalResult.data ?? null);
  const llmSettings =
    isRecord(globalResult.data?.features) &&
    isRecord((globalResult.data?.features as Record<string, unknown>).llmInsights)
      ? ((globalResult.data?.features as Record<string, unknown>).llmInsights as Record<string, unknown>)
      : null;

  return {
    data: {
      schema_version: 2,
      exported_at: new Date().toISOString(),
      organization: {
        id: orgResult.data?.id ?? organizationId,
        name: orgResult.data?.name ?? null,
        slug: orgResult.data?.slug ?? null,
      },
      organization_settings: organizationSettings,
      embed_settings: embedSettings,
      pdc: {
        configs: pdcResult.data ?? [],
        bearer_token: secretRow?.bearer_token ?? null,
      },
      resources: resourcesResult.data ?? [],
      service_chains: chainsResult.data ?? [],
      global_config: globalResult.data ?? null,
      llm_settings: llmSettings,
      result_page_settings: resultPageSettings,
    },
    error: null,
  };
};

const importSettingsIntoOrganization = async ({
  incoming,
  orgId,
  userId,
  supabase,
  adminClient,
  sections,
}: {
  incoming: z.infer<typeof SettingsBackupSchema>;
  orgId: string;
  userId: string;
  supabase: any;
  adminClient: any;
  sections?: z.infer<typeof ImportSectionsSchema>;
}) => {
  const shouldImport = (key: keyof z.infer<typeof ImportSectionsSchema>) => sections?.[key] ?? true;
  const shouldImportOrganizationSettings = shouldImport('organizationSettings');
  const shouldImportEmbedSettings = shouldImport('embedSettings');
  const shouldImportGlobalConfig = shouldImport('globalConfig');
  const shouldImportResultPageSettings = shouldImport('resultPageSettings');
  const summary = {
    organizationSettingsImported: false,
    globalConfigImported: false,
    resultPageSettingsImported: false,
    embedSettingsImported: false,
    pdcConfigsCreated: 0,
    pdcConfigsUpdated: 0,
    pdcBearerTokenImported: false,
    resourcesCreated: 0,
    resourcesUpdated: 0,
    serviceChainsCreated: 0,
    serviceChainsUpdated: 0,
    embeddedResourcesRemapped: 0,
  };
  const fail = (message: string, status?: number) => ({
    errorResponse: settingsErrorResponse(message, status),
    summary: null,
  });

  if (
    (shouldImportOrganizationSettings && incoming.organization_settings !== undefined) ||
    (shouldImportEmbedSettings && (incoming.embed_settings !== undefined || incoming.organization_settings !== undefined))
  ) {
    const { data: currentOrg, error: currentOrgError } = await supabase
      .from('organizations')
      .select('settings')
      .eq('id', orgId)
      .single();

    if (currentOrgError) {
      return fail('Failed to load current organization settings');
    }

    let incomingOrganizationSettings = shouldImportOrganizationSettings
      ? incoming.organization_settings
      : undefined;

    if (
      !shouldImportEmbedSettings &&
      isRecord(incomingOrganizationSettings) &&
      isRecord(incomingOrganizationSettings.embed)
    ) {
      incomingOrganizationSettings = { ...incomingOrganizationSettings };
      delete (incomingOrganizationSettings as Record<string, unknown>).embed;
    }

    const legacyEmbedSettings =
      shouldImportEmbedSettings && incoming.embed_settings === undefined
        ? getEmbedSettingsFromOrganizationSettings(incoming.organization_settings)
        : null;
    const incomingEmbedSettings = shouldImportEmbedSettings
      ? incoming.embed_settings ?? legacyEmbedSettings
      : undefined;

    const hasOrganizationSettingsToImport = incomingOrganizationSettings !== undefined;
    const hasEmbedSettingsToImport = incomingEmbedSettings !== undefined && incomingEmbedSettings !== null;

    if (hasOrganizationSettingsToImport || hasEmbedSettingsToImport) {
      const mergedOrgSettings = mergeOrganizationSettingsForImport(
        currentOrg?.settings,
        incomingOrganizationSettings,
        incomingEmbedSettings,
      );

      const { error: orgUpdateError } = await supabase
        .from('organizations')
        .update({ settings: mergedOrgSettings })
        .eq('id', orgId);

      if (orgUpdateError) {
        return fail('Failed to import organization settings');
      }

      if (shouldImportOrganizationSettings && hasOrganizationSettingsToImport) {
        summary.organizationSettingsImported = true;
      }
      if (shouldImportEmbedSettings && hasEmbedSettingsToImport) {
        summary.embedSettingsImported = true;
      }
    }
  }

  if (shouldImportGlobalConfig && isRecord(incoming.global_config)) {
    const globalInput = incoming.global_config;
    const incomingFeatures = isRecord(globalInput.features) ? { ...globalInput.features } : {};
    const incomingLlmSettings = isRecord(incoming.llm_settings) ? incoming.llm_settings : null;
    if (incomingLlmSettings) {
      incomingFeatures.llmInsights = incomingLlmSettings;
    }
    let importedResultPageSettings: Record<string, unknown> | null = null;
    if (shouldImportResultPageSettings) {
      importedResultPageSettings =
        sanitizeResultPageSettingsForBackup(incoming.result_page_settings) ??
        sanitizeResultPageSettingsForBackup(incomingFeatures.resultPage);
      if (importedResultPageSettings) {
        incomingFeatures.resultPage = importedResultPageSettings;
      }
    } else {
      const { data: currentGlobal, error: currentGlobalError } = await supabase
        .from('global_configs')
        .select('features')
        .eq('organization_id', orgId)
        .maybeSingle();

      if (currentGlobalError) {
        return fail('Failed to load current result page settings');
      }

      const currentFeatures = isRecord(currentGlobal?.features) ? currentGlobal.features : {};
      if (isRecord(currentFeatures.resultPage)) {
        incomingFeatures.resultPage = currentFeatures.resultPage;
      } else {
        delete incomingFeatures.resultPage;
      }
    }
    const globalUpsert = {
      organization_id: orgId,
      app_name: typeof globalInput.app_name === 'string' ? globalInput.app_name : null,
      app_version: typeof globalInput.app_version === 'string' ? globalInput.app_version : null,
      environment: typeof globalInput.environment === 'string' ? globalInput.environment : null,
      features: incomingFeatures,
      logging: isRecord(globalInput.logging) ? globalInput.logging : {},
    };

    const { error: globalError } = await supabase
      .from('global_configs')
      .upsert(globalUpsert, { onConflict: 'organization_id' });

    if (globalError) {
      return fail('Failed to import global config');
    }

    summary.globalConfigImported = true;
    if (importedResultPageSettings) {
      summary.resultPageSettingsImported = true;
    }
  } else if (shouldImportResultPageSettings) {
    const incomingResultPageSettings =
      sanitizeResultPageSettingsForBackup(incoming.result_page_settings) ??
      getResultPageSettingsFromGlobalConfig(incoming.global_config);

    if (incomingResultPageSettings) {
      const { data: currentGlobal, error: currentGlobalError } = await supabase
        .from('global_configs')
        .select('*')
        .eq('organization_id', orgId)
        .maybeSingle();

      if (currentGlobalError) {
        return fail('Failed to load current global config');
      }

      const currentFeatures = isRecord(currentGlobal?.features) ? currentGlobal.features : {};
      const { error: globalError } = await supabase
        .from('global_configs')
        .upsert({
          organization_id: orgId,
          app_name: typeof currentGlobal?.app_name === 'string' ? currentGlobal.app_name : null,
          app_version: typeof currentGlobal?.app_version === 'string' ? currentGlobal.app_version : null,
          environment: typeof currentGlobal?.environment === 'string' ? currentGlobal.environment : null,
          features: {
            ...currentFeatures,
            resultPage: incomingResultPageSettings,
          },
          logging: isRecord(currentGlobal?.logging) ? currentGlobal.logging : {},
        }, { onConflict: 'organization_id' });

      if (globalError) {
        return fail('Failed to import result page settings');
      }

      summary.resultPageSettingsImported = true;
    }
  }

  if (shouldImport('pdc')) {
    const incomingPdcConfigs = Array.isArray(incoming.pdc?.configs) ? incoming.pdc!.configs : [];
    if (incomingPdcConfigs.length > 0) {
      const { data: existingPdcConfigs, error: existingPdcError } = await supabase
        .from('dataspace_configs')
        .select('*')
        .eq('organization_id', orgId);

      if (existingPdcError) {
        return fail('Failed to load existing PDC configs');
      }

      const existingList = existingPdcConfigs ?? [];
      let importedActiveConfigId: string | null = null;

      for (const rawConfig of incomingPdcConfigs) {
        if (!isRecord(rawConfig)) continue;
        const cfg = sanitizePdcConfig(rawConfig);
        if (!cfg.pdc_url) continue;

        const incomingId = typeof rawConfig.id === 'string' ? rawConfig.id : null;
        const match = existingList.find((c: any) =>
          (incomingId && c.id === incomingId) ||
          (!!cfg.name && c.name === cfg.name)
        );

        const payload = {
          organization_id: orgId,
          name: cfg.name,
          pdc_url: cfg.pdc_url,
          fallback_result_url: cfg.fallback_result_url,
          fallback_result_authorization: cfg.fallback_result_authorization,
          export_api_configs: cfg.export_api_configs,
          is_active: cfg.is_active,
          bearer_token_secret_name: incoming.pdc?.bearer_token ? 'organization_pdc_secrets' : null,
        };

        if (match) {
          const { data: updated, error: updateErr } = await supabase
            .from('dataspace_configs')
            .update(payload)
            .eq('id', match.id)
            .eq('organization_id', orgId)
            .select('id')
            .single();
          if (updateErr) {
            return fail('Failed to update PDC config during import');
          }
          summary.pdcConfigsUpdated += 1;
          if (cfg.is_active) importedActiveConfigId = updated.id;
        } else {
          const { data: inserted, error: insertErr } = await supabase
            .from('dataspace_configs')
            .insert(payload)
            .select('id')
            .single();
          if (insertErr) {
            return fail('Failed to create PDC config during import');
          }
          summary.pdcConfigsCreated += 1;
          if (cfg.is_active) importedActiveConfigId = inserted.id;
        }
      }

      if (importedActiveConfigId) {
        await supabase
          .from('dataspace_configs')
          .update({ is_active: false })
          .eq('organization_id', orgId)
          .neq('id', importedActiveConfigId);
        await supabase
          .from('dataspace_configs')
          .update({ is_active: true })
          .eq('organization_id', orgId)
          .eq('id', importedActiveConfigId);
      }
    }

    if (typeof incoming.pdc?.bearer_token === 'string' && incoming.pdc.bearer_token.trim()) {
      const { error: secretError } = await adminClient
        .from('organization_pdc_secrets')
        .upsert({
          organization_id: orgId,
          bearer_token: incoming.pdc.bearer_token.trim(),
          updated_by: userId,
        }, { onConflict: 'organization_id' });

      if (secretError) {
        return fail('Failed to import PDC bearer token');
      }

      summary.pdcBearerTokenImported = true;
    }
  }

  const { data: activeConfig } = await supabase
    .from('dataspace_configs')
    .select('id')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .maybeSingle();

  const importedResourceMap = new Map<string, ReturnType<typeof sanitizeResource>>();

  if (shouldImport('resources')) {
    const incomingResources = Array.isArray(incoming.resources) ? incoming.resources : [];
    if (incomingResources.length > 0) {
      const { data: existingResources, error: existingResourcesError } = await supabase
        .from('dataspace_params')
        .select('*')
        .eq('organization_id', orgId);

      if (existingResourcesError) {
        return fail('Failed to load existing resources');
      }

      const existing = existingResources ?? [];
      for (const raw of incomingResources) {
        if (!isRecord(raw)) continue;
        const res = sanitizeResource(raw);
        if (!res.resource_url || !res.contract_url) continue;

        const signature = getResourceImportSignature(res);
        const match = existing.find((item: any) =>
          (res.id && item.id === res.id) ||
          (
            item.resource_url === res.resource_url &&
            item.contract_url === res.contract_url &&
            item.resource_type === res.resource_type
          )
        );

        const payload = {
          organization_id: orgId,
          config_id: activeConfig?.id ?? null,
          resource_url: res.resource_url,
          contract_url: res.contract_url,
          resource_type: res.resource_type,
          resource_name: res.resource_name,
          resource_description: res.resource_description,
          llm_context: res.llm_context,
          provider: res.provider,
          service_offering: res.service_offering,
          parameters: res.parameters,
          param_actions: res.param_actions,
          api_response_representation: res.api_response_representation,
          upload_file: res.upload_file,
          is_visible: res.is_visible,
          visualization_type: res.visualization_type,
          upload_url: res.upload_url,
          upload_authorization: res.upload_authorization,
          result_url_source: res.result_url_source,
          custom_result_url: res.custom_result_url,
          result_authorization: res.result_authorization,
          result_query_params: res.result_query_params,
        };

        if (match) {
          const { error: updateErr } = await supabase
            .from('dataspace_params')
            .update(payload)
            .eq('id', match.id)
            .eq('organization_id', orgId);
          if (updateErr) {
            return fail('Failed to update resource during import');
          }
          summary.resourcesUpdated += 1;
        } else {
          const { error: insertErr } = await supabase
            .from('dataspace_params')
            .insert(payload);
          if (insertErr) {
            return fail('Failed to insert resource during import');
          }
          summary.resourcesCreated += 1;
        }

        importedResourceMap.set(signature, res);
      }
    }
  }

  if (shouldImport('serviceChains')) {
    const incomingChains = Array.isArray(incoming.service_chains) ? incoming.service_chains : [];
    if (incomingChains.length > 0) {
      const { data: existingChains, error: existingChainsError } = await supabase
        .from('service_chains')
        .select('*')
        .eq('organization_id', orgId);

      if (existingChainsError) {
        return fail('Failed to load existing service chains');
      }

      const existing = existingChains ?? [];
      for (const raw of incomingChains) {
        if (!isRecord(raw)) continue;
        const chain = sanitizeServiceChain(raw);
        if (!chain.catalog_id || !chain.contract_url) continue;

        const match = existing.find((item: any) =>
          (chain.id && item.id === chain.id) ||
          (item.catalog_id === chain.catalog_id && item.contract_url === chain.contract_url)
        );

        const normalizedEmbeddedResources = chain.embedded_resources.map((resource) => {
          if (!isRecord(resource)) return resource;

          const resourceSignature = getResourceImportSignature({
            resource_url: typeof resource.resource_url === 'string' ? resource.resource_url : '',
            contract_url: typeof resource.contract_url === 'string' ? resource.contract_url : '',
            resource_type: typeof resource.resource_type === 'string' ? resource.resource_type : 'data',
          });
          const importedResource = importedResourceMap.get(resourceSignature);

          if (!importedResource) {
            return resource;
          }

          summary.embeddedResourcesRemapped += 1;

          return {
            ...resource,
            resource_name: importedResource.resource_name,
            resource_description: importedResource.resource_description,
            provider: importedResource.provider,
            service_offering: importedResource.service_offering,
            parameters: importedResource.parameters,
            api_response_representation: importedResource.api_response_representation,
            visualization_type: importedResource.visualization_type,
            upload_url: importedResource.upload_url,
            upload_authorization: importedResource.upload_authorization,
            result_url_source: importedResource.result_url_source,
            custom_result_url: importedResource.custom_result_url,
            result_authorization: importedResource.result_authorization,
            result_query_params: importedResource.result_query_params,
          };
        });

        const payload = {
          organization_id: orgId,
          config_id: activeConfig?.id ?? null,
          catalog_id: chain.catalog_id,
          contract_url: chain.contract_url,
          services: chain.services,
          basis_information: chain.basis_information,
          llm_context: chain.llm_context,
          status: chain.status,
          is_visible: chain.is_visible,
          visualization_type: chain.visualization_type,
          embedded_resources: normalizedEmbeddedResources,
          result_url_source: chain.result_url_source,
          custom_result_url: chain.custom_result_url,
          result_authorization: chain.result_authorization,
          result_query_params: chain.result_query_params,
        };

        if (match) {
          const { error: updateErr } = await supabase
            .from('service_chains')
            .update(payload)
            .eq('id', match.id)
            .eq('organization_id', orgId);
          if (updateErr) {
            return fail('Failed to update service chain during import');
          }
          summary.serviceChainsUpdated += 1;
        } else {
          const { error: insertErr } = await supabase
            .from('service_chains')
            .insert(payload);
          if (insertErr) {
            return fail('Failed to insert service chain during import');
          }
          summary.serviceChainsCreated += 1;
        }
      }
    }
  }

  return { errorResponse: null, summary };
};

// Helper to create validation error response
const validationErrorResponse = (error: z.ZodError) => {
  return new Response(
    JSON.stringify({ 
      error: 'Validation failed', 
      details: error.errors.map(e => ({ path: e.path.join('.'), message: e.message }))
    }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = claimsData.claims.sub;
    const requestedOrgId = req.headers.get("x-organization-id");
    const url = new URL(req.url);
    const method = req.method;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Server not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      serviceRoleKey
    );

    // Get user's organization
    let membershipQuery = supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (requestedOrgId) {
      membershipQuery = membershipQuery.eq('organization_id', requestedOrgId);
    }

    const { data: membership } = await membershipQuery.limit(1).maybeSingle();

    if (!membership?.organization_id) {
      return new Response(
        JSON.stringify({ error: 'No organization found' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const orgId = membership.organization_id;

    // Check if user is admin
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('organization_id', orgId)
      .single();

    const isAdmin = roleData?.role === 'admin' || roleData?.role === 'super_admin';

    // Route handling
    const path = url.pathname.replace('/config-api', '');

    // GET /config - Get all config for organization
    if (method === 'GET' && (path === '' || path === '/')) {
      const [configsResult, paramsResult, chainsResult, globalResult] = await Promise.all([
        supabase.from('dataspace_configs').select('*').eq('organization_id', orgId),
        supabase.from('dataspace_params').select('*').eq('organization_id', orgId),
        supabase.from('service_chains').select('*').eq('organization_id', orgId),
        supabase.from('global_configs').select('*').eq('organization_id', orgId).single(),
      ]);

      return new Response(
        JSON.stringify({
          dataspaceConfigs: configsResult.data || [],
          dataspaceParams: paramsResult.data || [],
          serviceChains: chainsResult.data || [],
          globalConfig: globalResult.data || null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GET /config/pdc - Get active PDC config
    if (method === 'GET' && path === '/pdc') {
      const { data, error } = await supabase
        .from('dataspace_configs')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .single();

      if (error && error.code !== 'PGRST116') {
        return new Response(
          JSON.stringify({ error: 'Failed to fetch configuration' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Mask bearer token if present
      if (data?.bearer_token_secret_name) {
        data.bearer_token_secret_name = '***';
      }

      return new Response(
        JSON.stringify({ data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Admin-only routes below
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GET /config/settings/export - Export complete admin settings as JSON
    if (method === 'GET' && path === '/settings/export') {
      const { data: exported, error } = await buildSettingsBackup(adminClient, orgId);
      if (error || !exported) {
        return settingsErrorResponse(error || 'Failed to export settings');
      }

      return new Response(
        JSON.stringify({ data: exported }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // POST /config/settings/import - Import settings backup JSON
    if (method === 'POST' && path === '/settings/import') {
      let body;
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid JSON body' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const parsed = SettingsBackupSchema.safeParse(body);
      if (!parsed.success) {
        return validationErrorResponse(parsed.error);
      }

      const settingsPayload = isRecord(parsed.data.settings) ? parsed.data.settings : parsed.data;
      const safeSettings = SettingsBackupSchema.safeParse(settingsPayload);
      if (!safeSettings.success) {
        return validationErrorResponse(safeSettings.error);
      }
      const importResult = await importSettingsIntoOrganization({
        incoming: safeSettings.data,
        orgId,
        userId,
        supabase,
        adminClient,
      });
      if (importResult?.errorResponse) {
        return importResult.errorResponse;
      }

      return new Response(
        JSON.stringify({ data: { ok: true, summary: importResult?.summary ?? null } }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // POST /config/settings/import-from-organization - Copy selected settings from another org
    if (method === 'POST' && path === '/settings/import-from-organization') {
      let body;
      try {
        body = await req.json();
      } catch {
        return settingsErrorResponse('Invalid JSON body', 400);
      }

      const parsed = CrossOrgImportSchema.safeParse(body);
      if (!parsed.success) {
        return validationErrorResponse(parsed.error);
      }

      const { sourceOrganizationId, sections } = parsed.data;
      if (sourceOrganizationId === orgId) {
        return settingsErrorResponse('Source organization must be different from target organization', 400);
      }

      const selectedSections = Object.values(sections).some(Boolean);
      if (!selectedSections) {
        return settingsErrorResponse('Select at least one settings section to import', 400);
      }

      const { data: sourceRole, error: sourceRoleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('organization_id', sourceOrganizationId)
        .in('role', ['admin', 'super_admin'])
        .maybeSingle();

      if (sourceRoleError) {
        return settingsErrorResponse('Failed to validate source organization access');
      }

      if (!sourceRole?.role) {
        return settingsErrorResponse('Admin access required in the source organization', 403);
      }

      const { data: exported, error } = await buildSettingsBackup(adminClient, sourceOrganizationId);
      if (error || !exported) {
        return settingsErrorResponse(error || 'Failed to read source organization settings');
      }

      const importResult = await importSettingsIntoOrganization({
        incoming: exported,
        orgId,
        userId,
        supabase,
        adminClient,
        sections,
      });
      if (importResult?.errorResponse) {
        return importResult.errorResponse;
      }

      return new Response(
        JSON.stringify({ data: { ok: true, summary: importResult?.summary ?? null } }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // POST /config/pdc - Create/Update PDC config
    if (method === 'POST' && path === '/pdc') {
      let body;
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid JSON body' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const parseResult = PdcConfigSchema.safeParse(body);
      if (!parseResult.success) {
        return validationErrorResponse(parseResult.error);
      }

      const {
        name,
        pdc_url,
        bearer_token,
        fallback_result_url,
        fallback_result_authorization,
        export_api_configs,
        is_active
      } = parseResult.data;

      // Deactivate other configs if this one is active
      if (is_active) {
        await supabase
          .from('dataspace_configs')
          .update({ is_active: false })
          .eq('organization_id', orgId);
      }

      const { data, error } = await supabase
        .from('dataspace_configs')
        .insert({
          organization_id: orgId,
          name: name || 'default',
          pdc_url,
          bearer_token_secret_name: bearer_token ? 'organization_pdc_secrets' : null,
          fallback_result_url,
          fallback_result_authorization,
          export_api_configs: export_api_configs ?? [],
          is_active: is_active ?? true,
        })
        .select()
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ error: 'Failed to create configuration' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (bearer_token) {
        const { error: secretError } = await adminClient
          .from('organization_pdc_secrets')
          .upsert({
            organization_id: orgId,
            bearer_token,
            updated_by: userId,
          }, { onConflict: 'organization_id' });

        if (secretError) {
          return new Response(
            JSON.stringify({ error: 'Failed to store bearer token' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      return new Response(
        JSON.stringify({ data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // PUT /config/pdc/:id - Update PDC config
    if (method === 'PUT' && path.startsWith('/pdc/')) {
      const configId = path.replace('/pdc/', '');
      
      // Validate UUID format
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(configId)) {
        return new Response(
          JSON.stringify({ error: 'Invalid configuration ID' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let body;
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid JSON body' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const parseResult = PdcConfigUpdateSchema.safeParse(body);
      if (!parseResult.success) {
        return validationErrorResponse(parseResult.error);
      }

      const {
        name,
        pdc_url,
        bearer_token,
        fallback_result_url,
        fallback_result_authorization,
        export_api_configs,
        is_active
      } = parseResult.data;

      // Deactivate other configs if this one is active
      if (is_active) {
        await supabase
          .from('dataspace_configs')
          .update({ is_active: false })
          .eq('organization_id', orgId)
          .neq('id', configId);
      }

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (pdc_url !== undefined) updateData.pdc_url = pdc_url;
      if (fallback_result_url !== undefined) updateData.fallback_result_url = fallback_result_url;
      if (fallback_result_authorization !== undefined) updateData.fallback_result_authorization = fallback_result_authorization;
      if (export_api_configs !== undefined) updateData.export_api_configs = export_api_configs;
      if (is_active !== undefined) updateData.is_active = is_active;
      if (bearer_token) {
        updateData.bearer_token_secret_name = 'organization_pdc_secrets';
      }

      const { data, error } = await supabase
        .from('dataspace_configs')
        .update(updateData)
        .eq('id', configId)
        .eq('organization_id', orgId)
        .select()
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ error: 'Failed to update configuration' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (bearer_token) {
        const { error: secretError } = await adminClient
          .from('organization_pdc_secrets')
          .upsert({
            organization_id: orgId,
            bearer_token,
            updated_by: userId,
          }, { onConflict: 'organization_id' });

        if (secretError) {
          return new Response(
            JSON.stringify({ error: 'Failed to store bearer token' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      return new Response(
        JSON.stringify({ data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GET /config/resources - Get all resources
    if (method === 'GET' && path === '/resources') {
      const { data, error } = await supabase
        .from('dataspace_params')
        .select('*')
        .eq('organization_id', orgId);

      if (error) {
        return new Response(
          JSON.stringify({ error: 'Failed to fetch resources' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // PUT /config/resources/:id - Update resource config
    if (method === 'PUT' && path.startsWith('/resources/')) {
      const resourceId = path.replace('/resources/', '');
      
      // Validate UUID format
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resourceId)) {
        return new Response(
          JSON.stringify({ error: 'Invalid resource ID' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let body;
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid JSON body' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const parseResult = ResourceUpdateSchema.safeParse(body);
      if (!parseResult.success) {
        return validationErrorResponse(parseResult.error);
      }

      const { data, error } = await supabase
        .from('dataspace_params')
        .update(parseResult.data)
        .eq('id', resourceId)
        .eq('organization_id', orgId)
        .select()
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ error: 'Failed to update resource' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GET /config/global - Get global config
    if (method === 'GET' && path === '/global') {
      const { data, error } = await supabase
        .from('global_configs')
        .select('*')
        .eq('organization_id', orgId)
        .single();

      if (error && error.code !== 'PGRST116') {
        return new Response(
          JSON.stringify({ error: 'Failed to fetch global configuration' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // PUT /config/global - Update global config
    if (method === 'PUT' && path === '/global') {
      let body;
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid JSON body' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const parseResult = GlobalConfigSchema.safeParse(body);
      if (!parseResult.success) {
        return validationErrorResponse(parseResult.error);
      }

      const { data, error } = await supabase
        .from('global_configs')
        .upsert({
          ...parseResult.data,
          organization_id: orgId,
        })
        .eq('organization_id', orgId)
        .select()
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ error: 'Failed to update global configuration' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    // Log error without exposing internal details
    console.error('Config API error:', error instanceof Error ? error.message : 'Unknown error');
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
