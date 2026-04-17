import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Sparkles, Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import StepIndicator from "@/components/StepIndicator";
import AnalyticsSelection from "@/components/AnalyticsSelection";
import DataSelection from "@/components/DataSelection";
import ProcessingView from "@/components/ProcessingView";
import ResultsView from "@/components/ResultsView";
import DataspaceConfigPage from "@/components/DataspaceConfigPage";
import HumanValidationPage from "@/components/HumanValidationPage";
import { ProcessSessionProvider } from "@/contexts/ProcessSessionContext";
import { useProcessSession } from "@/contexts/ProcessSessionContext";
import { resolveResultUrl, ResultUrlInfo } from "@/utils/resultUrlResolver";
import { generatePdcPayload, PdcPayload } from "@/utils/pdcPayloadGenerator";
import { useAuth } from "@/contexts/AuthContext";
import UserMenu from "@/components/UserMenu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AnalyticsOption, DataResource, PdcConfig, SoftwareResource, ServiceChain } from "@/types/dataspace";
import { UploadConfig } from "@/components/DocumentUploadZone";
import { supabase } from "@/integrations/supabase/client";
import { Json } from "@/integrations/supabase/types";
import { applyOrganizationVisualizationSettings, getVisualizationSettingsFromOrgSettings } from "@/utils/visualizationSettings";

interface SelectedDataType {
  files: File[];
  apis: string[];
  textData: string;
  customApiUrl: string;
  apiParams: Record<string, Record<string, string>>;
  selectedDataResources: DataResource[];
  uploadConfig?: UploadConfig;
  uploadResourceParams?: Record<string, string>;
  manualJsonData?: string;
  serviceChainResourceParams?: Record<string, Record<string, string>>;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  settings?: Record<string, unknown> | null;
}

// Helper functions for parsing (same as useDataspaceConfig)
const parseParameters = (params: Json | null): { paramName: string; paramValue: string; paramAction?: string }[] => {
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

const parseApiResponseRepresentation = (data: Json | null) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return data as unknown as DataResource['api_response_representation'];
};

const parseBasisInformation = (data: Json | null) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return data as unknown as ServiceChain['basis_information'];
};

const parseServices = (data: Json | null): ServiceChain['services'] => {
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
const parseEmbeddedResources = (data: Json | null): ServiceChain['embedded_resources'] => {
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

type OrgFlowStep = "processing" | "results";

interface PersistedOrgFlowState {
  step: OrgFlowStep;
  sessionId: string;
  analyticsType: string;
  pdcPayload: PdcPayload | null;
  resultUrlInfo: ResultUrlInfo | null;
  llmPromptContext?: string | null;
  forcedResultData?: unknown;
  forcedResultNotice?: string | null;
  updatedAt: number;
}

const getOrgFlowStorageKey = (slug: string) => `ptx_org_gateway_flow_${slug.toLowerCase()}`;

const readPersistedOrgFlow = (slug: string): PersistedOrgFlowState | null => {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(getOrgFlowStorageKey(slug));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedOrgFlowState;
  } catch {
    return null;
  }
};

const writePersistedOrgFlow = (slug: string, flow: PersistedOrgFlowState): void => {
  if (typeof window === "undefined") return;
  localStorage.setItem(getOrgFlowStorageKey(slug), JSON.stringify(flow));
};

const clearPersistedOrgFlow = (slug: string): void => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(getOrgFlowStorageKey(slug));
};

const buildDummySkillResult = (error: unknown, organizationName: string) => {
  const categories = [
    "Data Management",
    "AI Engineering",
    "Analytics",
    "Security",
    "Integration",
    "Operations",
    "Compliance",
    "Visualization",
  ];

  const skills = Array.from({ length: 100 }, (_, index) => {
    const skillNumber = String(index + 1).padStart(3, "0");
    const category = categories[index % categories.length];

    return {
      id: `skill-${skillNumber}`,
      profile: {
        name: `Gateway Skill ${skillNumber}`,
        description: `Dummy capability generated for fallback visualization when PDC execution fails. Skill ${skillNumber} focuses on ${category.toLowerCase()} workflows.`,
        category,
      },
      details: {
        level: (index % 5) + 1,
        tags: [
          "dummy",
          "fallback",
          category.toLowerCase().replace(/\s+/g, "_"),
          `batch_${Math.floor(index / 10) + 1}`,
        ],
      },
    };
  });

  return {
    meta: {
      is_dummy_data: true,
      warning: "Dummy data is shown because PDC execution failed. Do not use this data for production decisions.",
      generated_at: new Date().toISOString(),
      organization: organizationName,
      total_skills: skills.length,
      error_summary: error instanceof Error ? error.message : String(error ?? "Unknown error"),
    },
    data: {
      skills_catalog: {
        categories,
        skills,
      },
    },
  };
};

const OrgGatewayContent = ({ 
  organization,
  pdcConfig,
  orgExecutionToken,
  softwareResources,
  dataResources,
  serviceChains,
}: {
  organization: Organization;
  pdcConfig: PdcConfig | null;
  orgExecutionToken: string | null;
  softwareResources: SoftwareResource[];
  dataResources: DataResource[];
  serviceChains: ServiceChain[];
}) => {
  const { user, isAdmin, isAuthenticated
 } = useAuth();
  const isDebugMode = isAdmin && user?.isDebugMode;
  const showConfigPage = isDebugMode;
  const showHumanValidation = isDebugMode;

  const { sessionId, resetSession } = useProcessSession();

  // Build dynamic steps based on config
  const steps = useMemo(() => {
    const baseSteps = ["Select Type", "Choose Data", "Processing", "Results"];
    let dynamicSteps = [...baseSteps];

    if (showHumanValidation) {
      dynamicSteps.splice(2, 0, "Validation");
    }
    if (showConfigPage) {
      dynamicSteps.unshift("Config");
    }

    return dynamicSteps;
  }, [showConfigPage, showHumanValidation]);

  const [currentStep, setCurrentStep] = useState(0);
  const [selectedAnalytics, setSelectedAnalytics] = useState<AnalyticsOption | null>(null);
  const [analyticsQueryParams, setAnalyticsQueryParams] = useState<Record<string, string>>({});
  const [selectedData, setSelectedData] = useState<SelectedDataType | null>(null);
  const [persistedFlow, setPersistedFlow] = useState<PersistedOrgFlowState | null>(null);
  const [processingFailed, setProcessingFailed] = useState(false);
  const [allowContinueOnPdcError, setAllowContinueOnPdcError] = useState(false);
  const [forcedResultData, setForcedResultData] = useState<unknown | null>(null);
  const [forcedResultNotice, setForcedResultNotice] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchGlobalFeatureFlags = async () => {
      const { data } = await supabase
        .from("global_configs")
        .select("features")
        .eq("organization_id", organization.id)
        .maybeSingle();

      const features = (data?.features as Record<string, unknown> | null) ?? null;
      if (!isMounted) return;
      setAllowContinueOnPdcError(Boolean(features?.allowContinueOnPdcError));
    };

    void fetchGlobalFeatureFlags();
    return () => {
      isMounted = false;
    };
  }, [organization.id]);

  // Calculate actual step indices based on config
  const getStepIndex = useCallback((stepName: string): number => {
    return steps.indexOf(stepName);
  }, [steps]);

  const analyticsDisplayName = useMemo((): string => {
    if (!selectedAnalytics) return "";
    if (selectedAnalytics.type === "software") {
      return selectedAnalytics.data.resource_name || "Analytics";
    }
    return selectedAnalytics.data.basis_information?.name || selectedAnalytics.data.catalog_id;
  }, [selectedAnalytics]);

  const llmPromptContext = useMemo((): string | null => {
    if (!selectedAnalytics) return null;
    return selectedAnalytics.type === "software"
      ? (selectedAnalytics.data.llm_context ?? null)
      : (selectedAnalytics.data.llm_context ?? null);
  }, [selectedAnalytics]);

  const handleAnalyticsSelect = (option: AnalyticsOption) => {
    // New process session starts when user picks software/service chain.
    resetSession();
    clearPersistedOrgFlow(organization.slug);
    setPersistedFlow(null);
    setProcessingFailed(false);
    setForcedResultData(null);
    setForcedResultNotice(null);
    setSelectedAnalytics(option);
    setAnalyticsQueryParams({});
  };

  const handleDataSelect = (data: SelectedDataType) => {
    setProcessingFailed(false);
    setForcedResultData(null);
    setForcedResultNotice(null);
    setSelectedData(data);
    setCurrentStep(getStepIndex(showHumanValidation ? "Validation" : "Processing"));
  };

  const handleValidationApprove = () => {
    setProcessingFailed(false);
    setForcedResultData(null);
    setForcedResultNotice(null);
    setCurrentStep(getStepIndex("Processing"));
  };

  const handleValidationReject = () => {
    setCurrentStep(getStepIndex("Choose Data"));
  };

  const handleProcessingComplete = useCallback(() => {
    setProcessingFailed(false);
    setForcedResultData(null);
    setForcedResultNotice(null);
    setCurrentStep(getStepIndex("Results"));
  }, [getStepIndex]);

  const handleProcessingError = useCallback((error: unknown) => {
    console.error("Processing error:", error);
    setProcessingFailed(true);
    setForcedResultData(null);
    setForcedResultNotice(null);
    clearPersistedOrgFlow(organization.slug);
    setPersistedFlow(null);
  }, [organization.slug]);

  const handleProcessingBack = useCallback(() => {
    setProcessingFailed(false);
    clearPersistedOrgFlow(organization.slug);
    setPersistedFlow(null);
    setForcedResultData(null);
    setForcedResultNotice(null);

    const processingIndex = getStepIndex("Processing");
    const previousIndex = Math.max(0, processingIndex - 1);
    setCurrentStep(previousIndex);
  }, [organization.slug, getStepIndex]);

  // Generate PDC payload when we have analytics and data selected
  const pdcPayload: PdcPayload | null = useMemo(() => {
    if (!selectedAnalytics || !selectedData) return null;
    return generatePdcPayload(
      selectedAnalytics,
      selectedData.selectedDataResources,
      analyticsQueryParams,
      selectedData.apiParams,
      selectedData.uploadResourceParams,
      sessionId,
      selectedData.serviceChainResourceParams
    );
  }, [selectedAnalytics, selectedData, analyticsQueryParams, sessionId]);

  // Resolve result URL when we have analytics and data selected
  const resultUrlInfo: ResultUrlInfo | null = useMemo(() => {
    if (!selectedAnalytics || !selectedData) return null;
    return resolveResultUrl(
      selectedAnalytics,
      selectedData.selectedDataResources,
      selectedData.apiParams,
      selectedData.uploadResourceParams,
      sessionId,
      pdcConfig?.fallback_result_url || undefined,
      pdcConfig?.fallback_result_authorization || undefined
    );
  }, [selectedAnalytics, selectedData, sessionId, pdcConfig]);

  const handleRestart = () => {
    resetSession();
    clearPersistedOrgFlow(organization.slug);
    setPersistedFlow(null);
    setProcessingFailed(false);
    setForcedResultData(null);
    setForcedResultNotice(null);
    setCurrentStep(showConfigPage ? 0 : getStepIndex("Select Type"));
    setSelectedAnalytics(null);
    setAnalyticsQueryParams({});
    setSelectedData(null);
  };

  const handleContinueWithDummyResult = useCallback((error: unknown) => {
    const dummyData = buildDummySkillResult(error, organization.name);
    setProcessingFailed(false);
    setForcedResultData(dummyData);
    setForcedResultNotice(
      "Dummy data is displayed because PDC execution failed. This is sample fallback data for testing only."
    );
    setCurrentStep(getStepIndex("Results"));
  }, [organization.name, getStepIndex]);

  const currentStepName = steps[currentStep];

  // PDC config for processing
  const pdcConfigForProcessing = useMemo(() => (
    pdcConfig ? {
      organizationId: pdcConfig.organization_id,
      orgExecutionToken,
    } : { organizationId: null, orgExecutionToken }
  ), [pdcConfig, orgExecutionToken]);

  useEffect(() => {
    const existing = readPersistedOrgFlow(organization.slug);
    if (!existing || existing.sessionId !== sessionId) return;
    setPersistedFlow(existing);
    setForcedResultData(existing.forcedResultData ?? null);
    setForcedResultNotice(existing.forcedResultNotice ?? null);
    setCurrentStep(getStepIndex(existing.step === "processing" ? "Processing" : "Results"));
  }, [organization.slug, sessionId, getStepIndex]);

  useEffect(() => {
    const storageKey = getOrgFlowStorageKey(organization.slug);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;

      const latest = readPersistedOrgFlow(organization.slug);
      if (!latest || latest.sessionId !== sessionId) return;

      setPersistedFlow(latest);
      setForcedResultData(latest.forcedResultData ?? null);
      setForcedResultNotice(latest.forcedResultNotice ?? null);
      setCurrentStep(getStepIndex(latest.step === "processing" ? "Processing" : "Results"));
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [organization.slug, sessionId, getStepIndex]);

  useEffect(() => {
    if (currentStepName !== "Processing" && currentStepName !== "Results") {
      return;
    }
    if (currentStepName === "Processing" && processingFailed) {
      return;
    }

    const flowToPersist: PersistedOrgFlowState | null =
      currentStepName === "Processing" && pdcPayload
        ? {
            step: "processing",
            sessionId,
            analyticsType: analyticsDisplayName || persistedFlow?.analyticsType || "Analytics",
            pdcPayload,
            resultUrlInfo,
            llmPromptContext,
            forcedResultData: null,
            forcedResultNotice: null,
            updatedAt: 0,
          }
        : currentStepName === "Results"
          ? {
              step: "results",
              sessionId,
              analyticsType: analyticsDisplayName || persistedFlow?.analyticsType || "Analytics",
              pdcPayload: pdcPayload ?? persistedFlow?.pdcPayload ?? null,
              resultUrlInfo: resultUrlInfo ?? persistedFlow?.resultUrlInfo ?? null,
              llmPromptContext: llmPromptContext ?? persistedFlow?.llmPromptContext ?? null,
              forcedResultData: forcedResultData ?? persistedFlow?.forcedResultData ?? null,
              forcedResultNotice: forcedResultNotice ?? persistedFlow?.forcedResultNotice ?? null,
              updatedAt: 0,
            }
          : null;

    if (!flowToPersist) return;

    const existing = readPersistedOrgFlow(organization.slug);
    const isSameAsExisting =
      existing?.step === flowToPersist.step &&
      existing?.sessionId === flowToPersist.sessionId &&
      existing?.analyticsType === flowToPersist.analyticsType &&
      JSON.stringify(existing?.pdcPayload ?? null) === JSON.stringify(flowToPersist.pdcPayload ?? null) &&
      JSON.stringify(existing?.resultUrlInfo ?? null) === JSON.stringify(flowToPersist.resultUrlInfo ?? null) &&
      (existing?.llmPromptContext ?? null) === (flowToPersist.llmPromptContext ?? null) &&
      JSON.stringify(existing?.forcedResultData ?? null) === JSON.stringify(flowToPersist.forcedResultData ?? null) &&
      (existing?.forcedResultNotice ?? null) === (flowToPersist.forcedResultNotice ?? null);

    if (isSameAsExisting) {
      if (!persistedFlow) {
        setPersistedFlow(existing);
      }
      return;
    }

    const flowWithTimestamp: PersistedOrgFlowState = {
      ...flowToPersist,
      updatedAt: Date.now(),
    };

    writePersistedOrgFlow(organization.slug, flowWithTimestamp);
    setPersistedFlow(flowWithTimestamp);
  }, [
    organization.slug,
    sessionId,
    analyticsDisplayName,
    pdcPayload,
    resultUrlInfo,
    persistedFlow?.analyticsType,
    persistedFlow?.pdcPayload,
    persistedFlow?.resultUrlInfo,
    persistedFlow?.llmPromptContext,
    persistedFlow?.forcedResultData,
    persistedFlow?.forcedResultNotice,
    persistedFlow,
    currentStepName,
    processingFailed,
    llmPromptContext,
    forcedResultData,
    forcedResultNotice,
  ]);

  const activeAnalyticsType = analyticsDisplayName || persistedFlow?.analyticsType || "";
  const activePdcPayload = pdcPayload ?? persistedFlow?.pdcPayload ?? null;
  const activeResultUrlInfo = resultUrlInfo ?? persistedFlow?.resultUrlInfo ?? null;
  const activeLlmPromptContext = llmPromptContext ?? persistedFlow?.llmPromptContext ?? null;
  const activeForcedResultData = forcedResultData ?? persistedFlow?.forcedResultData ?? null;
  const activeForcedResultNotice = forcedResultNotice ?? persistedFlow?.forcedResultNotice ?? null;

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] opacity-30 pointer-events-none">
        <div className="absolute inset-0" style={{ background: "var(--gradient-glow)" }} />
      </div>

      <div className="relative z-10 container mx-auto px-4 py-8 max-w-5xl">
        {/* Header with User Menu */}
        <header className="text-center mb-12 relative">
          {isAuthenticated && (
            <div className="absolute top-0 right-0">
              <UserMenu />
            </div>
          )}

          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm text-primary font-medium">{organization.name}</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Transform Your Data Into{" "}
            <span className="gradient-text">Insights</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Upload your data, select your analysis type, and let our platform
            generate actionable insights in minutes
          </p>
        </header>

        {/* Step Indicator */}
        <StepIndicator steps={steps} currentStep={currentStep} />

        {/* Step Content */}
        <main className="glass-card p-8">
          {currentStepName === "Config" && (
            <DataspaceConfigPage onNext={() => setCurrentStep(getStepIndex("Select Type"))} />
          )}
          {currentStepName === "Select Type" && (
            <AnalyticsSelection
              selected={selectedAnalytics}
              onSelect={handleAnalyticsSelect}
              onNext={() => setCurrentStep(getStepIndex("Choose Data"))}
              queryParams={analyticsQueryParams}
              onQueryParamChange={setAnalyticsQueryParams}
              softwareResources={softwareResources}
              serviceChains={serviceChains}
              isDebugMode={isDebugMode}
            />
          )}
          {currentStepName === "Choose Data" && (
            <DataSelection
              onNext={handleDataSelect}
              onBack={() => setCurrentStep(getStepIndex("Select Type"))}
              dataResources={dataResources}
              selectedAnalytics={selectedAnalytics}
              isDebugMode={isDebugMode}
            />
          )}
          {currentStepName === "Validation" && selectedData && selectedAnalytics && (
            <HumanValidationPage
              selectedData={selectedData}
              selectedAnalytics={selectedAnalytics}
              analyticsQueryParams={analyticsQueryParams}
              sessionId={sessionId}
              pdcUrl={pdcConfig?.pdc_url}
              onApprove={handleValidationApprove}
              onReject={handleValidationReject}
            />
          )}
          {currentStepName === "Processing" && activeAnalyticsType && activePdcPayload && (
            <ProcessingView
              analyticsType={activeAnalyticsType}
              pdcPayload={activePdcPayload}
              pdcConfig={pdcConfigForProcessing}
              resultUrlInfo={activeResultUrlInfo}
              onComplete={handleProcessingComplete}
              onError={handleProcessingError}
              onBack={handleProcessingBack}
              allowContinueOnPdcError={allowContinueOnPdcError}
              onContinueWithDummyResult={handleContinueWithDummyResult}
            />
          )}
          {currentStepName === "Results" && activeAnalyticsType && (
            <ResultsView
              analyticsType={activeAnalyticsType}
              onRestart={handleRestart}
              resultUrlInfo={activeResultUrlInfo}
              exportApiConfigs={pdcConfig?.export_api_configs}
              forcedResultData={activeForcedResultData ?? undefined}
              forcedResultNotice={activeForcedResultNotice}
              organizationId={organization.id}
              orgExecutionToken={orgExecutionToken}
              llmPromptContext={activeLlmPromptContext}
            />
          )}
        </main>

        {/* Footer */}
        <footer className="text-center mt-8 text-sm text-muted-foreground">
          <p>Built with modern analytics technology</p>
        </footer>
      </div>
    </div>
  );
};

const OrgGateway = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [pdcConfig, setPdcConfig] = useState<PdcConfig | null>(null);
  const [orgExecutionToken, setOrgExecutionToken] = useState<string | null>(null);
  const [softwareResources, setSoftwareResources] = useState<SoftwareResource[]>([]);
  const [dataResources, setDataResources] = useState<DataResource[]>([]);
  const [serviceChains, setServiceChains] = useState<ServiceChain[]>([]);
  const themeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      themeCleanupRef.current?.();
      themeCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const fetchOrgData = async () => {
      if (!slug) {
        setError("Organization not specified");
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        setOrganization(null);
        setPdcConfig(null);
        setOrgExecutionToken(null);
        setSoftwareResources([]);
        setDataResources([]);
        setServiceChains([]);

        themeCleanupRef.current?.();
        themeCleanupRef.current = null;

        // Fetch organization
        const { data: orgData, error: orgError } = await supabase
          .from("organizations")
          .select("id, name, slug, settings")
          .eq("slug", slug.toLowerCase())
          .eq("is_active", true)
          .maybeSingle();

        if (orgError) throw orgError;

        if (!orgData) {
          setError("Organization not found");
          setIsLoading(false);
          return;
        }

        const themeCleanup = await applyOrganizationVisualizationSettings(
          getVisualizationSettingsFromOrgSettings(orgData.settings)
        );

        if (!mounted) {
          themeCleanup();
          return;
        }

        themeCleanupRef.current = themeCleanup;
        setOrganization(orgData);

        // Issue short-lived org execution token for public gateway processing.
        const { data: tokenData, error: tokenError } = await supabase.functions.invoke("pdc-auth", {
          body: {
            action: "issue_public",
            org_slug: orgData.slug,
            ttl_seconds: 3600,
          },
        });

        if (tokenError || !tokenData?.ok || !tokenData?.token) {
          throw new Error(tokenData?.error || tokenError?.message || "Failed to initialize processing token");
        }
        setOrgExecutionToken(tokenData.token as string);

        // Fetch PDC config for this organization
        const { data: pdcData } = await supabase
          .from("dataspace_configs")
          .select("*")
          .eq("organization_id", orgData.id)
          .eq("is_active", true)
          .maybeSingle();

        if (pdcData) {
          const exportConfigs = Array.isArray((pdcData as any).export_api_configs) 
            ? (pdcData as any).export_api_configs 
            : [];
          setPdcConfig({
            id: pdcData.id,
            name: pdcData.name,
            pdc_url: pdcData.pdc_url,
            bearer_token_secret_name: pdcData.bearer_token_secret_name,
            fallback_result_url: pdcData.fallback_result_url,
            fallback_result_authorization: (pdcData as unknown as { fallback_result_authorization?: string }).fallback_result_authorization ?? null,
            is_active: pdcData.is_active ?? true,
            organization_id: pdcData.organization_id,
            export_api_configs: exportConfigs,
          });
        }

        // Fetch visible resources for this organization
        const { data: resourcesData } = await supabase
          .from("dataspace_params")
          .select("*")
          .eq("organization_id", orgData.id)
          .eq("is_visible", true);

        if (resourcesData) {
          const software: SoftwareResource[] = resourcesData
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

          const data: DataResource[] = resourcesData
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

          setSoftwareResources(software);
          setDataResources(data);
        }

        // Fetch visible service chains for this organization
        const { data: chainsData } = await supabase
          .from("service_chains")
          .select("*")
          .eq("organization_id", orgData.id)
          .eq("is_visible", true);

        if (chainsData) {
          const chains: ServiceChain[] = chainsData.map((c) => ({
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
            embedded_resources: parseEmbeddedResources(c.embedded_resources),
            result_url_source: (c.result_url_source as 'contract' | 'fallback' | 'custom') ?? 'contract',
            custom_result_url: c.custom_result_url ?? null,
            result_authorization: c.result_authorization ?? null,
            result_query_params: (c.result_query_params as Array<{ paramName: string; paramValue: string }>) ?? [],
          }));
          setServiceChains(chains);
        }

        setIsLoading(false);
      } catch (err) {
        console.error("Error fetching organization data:", err);
        setError("Failed to load organization data");
        setIsLoading(false);
      }
    };

    void fetchOrgData();

    return () => {
      mounted = false;
    };
  }, [slug]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-slate-900">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-slate-700 mx-auto mb-4" />
          <p className="text-slate-500">Loading gateway...</p>
        </div>
      </div>
    );
  }

  if (error || !organization) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle className="text-2xl">Organization Not Found</CardTitle>
            <CardDescription>
              {error || `The organization "${slug}" could not be found or is not active.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate("/")} variant="outline" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if organization has any configured resources
  const hasResources = softwareResources.length > 0 || dataResources.length > 0 || serviceChains.length > 0;

  if (!hasResources) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">{organization.name}</CardTitle>
            <CardDescription>
              This gateway is currently being configured. Please check back later.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate("/")} variant="outline" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ProcessSessionProvider>
      <OrgGatewayContent
        organization={organization}
        pdcConfig={pdcConfig}
        orgExecutionToken={orgExecutionToken}
        softwareResources={softwareResources}
        dataResources={dataResources}
        serviceChains={serviceChains}
      />
    </ProcessSessionProvider>
  );
};

export default OrgGateway;
