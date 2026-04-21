import { useEffect, useState, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Sparkles, Loader2, AlertCircle } from "lucide-react";
import StepIndicator from "@/components/StepIndicator";
import AnalyticsSelection from "@/components/AnalyticsSelection";
import DataSelection from "@/components/DataSelection";
import ProcessingView from "@/components/ProcessingView";
import ResultsView from "@/components/ResultsView";
import { ProcessSessionProvider } from "@/contexts/ProcessSessionContext";
import { useProcessSession } from "@/contexts/ProcessSessionContext";
import { resolveResultUrl, ResultUrlInfo } from "@/utils/resultUrlResolver";
import { generatePdcPayload, PdcPayload } from "@/utils/pdcPayloadGenerator";
import { useDataspaceConfig } from "@/hooks/useDataspaceConfig";
import { AnalyticsOption, DataResource, ServiceChain, SoftwareResource, getParamValuesMap } from "@/types/dataspace";
import { UploadConfig } from "@/components/DocumentUploadZone";
import { supabase } from "@/integrations/supabase/client";
import { isSessionIdPlaceholder } from "@/utils/paramSanitizer";
import { applyOrganizationVisualizationSettings, VisualizationSettings } from "@/utils/visualizationSettings";

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

const findPreselectedAnalytics = (
  searchParams: URLSearchParams,
  softwareResources: SoftwareResource[],
  serviceChains: ServiceChain[],
): AnalyticsOption | null => {
  const softwareId = searchParams.get("software_id");
  const softwareUrl = searchParams.get("software_url");
  const serviceChainId = searchParams.get("service_chain_id");
  const catalogId = searchParams.get("catalog_id");

  if (softwareId) {
    const match = softwareResources.find((item) => item.id === softwareId);
    if (match) return { type: "software", data: match };
  }

  if (softwareUrl) {
    const match = softwareResources.find((item) => item.resource_url === softwareUrl);
    if (match) return { type: "software", data: match };
  }

  if (serviceChainId) {
    const match = serviceChains.find((item) => item.id === serviceChainId);
    if (match) return { type: "serviceChain", data: match };
  }

  if (catalogId) {
    const match = serviceChains.find((item) => item.catalog_id === catalogId);
    if (match) return { type: "serviceChain", data: match };
  }

  return null;
};

const hasPreselectionTarget = (searchParams: URLSearchParams): boolean =>
  Boolean(
    searchParams.get("software_id") ||
    searchParams.get("software_url") ||
    searchParams.get("service_chain_id") ||
    searchParams.get("catalog_id")
  );

const buildPreselectedQueryParams = (
  searchParams: URLSearchParams,
  option: AnalyticsOption,
  sessionId: string,
): Record<string, string> => {
  if (option.type !== "software") return {};

  const defaults = getParamValuesMap(option.data.parameters);
  const next: Record<string, string> = {};

  Object.entries(defaults).forEach(([key, value]) => {
    next[key] = isSessionIdPlaceholder(value) ? sessionId : value;
  });

  Object.keys(defaults).forEach((key) => {
    const incoming = searchParams.get(key);
    if (incoming !== null) {
      next[key] = incoming;
    }
  });

  return next;
};

const EmbedGatewayContent = () => {
  const [searchParams] = useSearchParams();
  const theme = searchParams.get('theme');
  const orgSlug = searchParams.get("org");
  const embedToken = searchParams.get("token");
  const [embedAllowed, setEmbedAllowed] = useState(false);
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [validatedOrgId, setValidatedOrgId] = useState<string | undefined>(undefined);
  const [orgExecutionToken, setOrgExecutionToken] = useState<string | null>(null);
  const themeCleanupRef = useRef<(() => void) | null>(null);
  
  const { sessionId, resetSession } = useProcessSession();

  // Fetch dataspace config from backend
  const { 
    pdcConfig, 
    softwareResources, 
    dataResources, 
    serviceChains,
    customVisualizations,
    isLoading 
  } = useDataspaceConfig(validatedOrgId, { enabled: embedAllowed && !!validatedOrgId });

  const revealEmbedDocument = () => {
    document.documentElement.removeAttribute("data-ptx-embed-pending");
  };

  useEffect(() => {
    return () => {
      themeCleanupRef.current?.();
      themeCleanupRef.current = null;
      revealEmbedDocument();
    };
  }, []);

  useEffect(() => {
    const toUserFriendlyEmbedError = (err: unknown): string => {
      const message = err instanceof Error ? err.message : "Embed access denied";
      const normalized = message.toLowerCase();

      if (normalized.includes("deleted")) {
        return "This gateway access has been deleted. Contact your administrator to create a new token.";
      }

      if (normalized.includes("revoked")) {
        return "This gateway access has been revoked. Contact your administrator to reactivate it.";
      }

      if (normalized.includes("expired")) {
        return "This gateway access has expired. Contact your administrator to issue a new token.";
      }

      if (normalized.includes("invalid token") || normalized.includes("non-2xx")) {
        return "This gateway access is no longer valid. Contact your administrator for a fresh embed token.";
      }

      return message;
    };

    const validateEmbedAccess = async () => {
      if (!orgSlug) {
        setEmbedError("Missing org parameter");
        revealEmbedDocument();
        return;
      }
      if (!embedToken) {
        setEmbedError("Missing embed token");
        revealEmbedDocument();
        return;
      }

      try {
        const referrerOrigin = (() => {
          try {
            return document.referrer ? new URL(document.referrer).origin : "";
          } catch {
            return "";
          }
        })();

        const { data, error } = await supabase.functions.invoke("embed-auth", {
          body: {
            action: "validate",
            org_slug: orgSlug,
            token: embedToken,
            parent_origin: referrerOrigin || undefined,
          },
        });

        if (error || !data?.ok) {
          throw new Error(data?.error || error?.message || "Embed access denied");
        }

        themeCleanupRef.current?.();
        themeCleanupRef.current = null;

        const themeCleanup = await applyOrganizationVisualizationSettings(
          (data.visualization_settings || {}) as VisualizationSettings
        );

        themeCleanupRef.current = themeCleanup;
        revealEmbedDocument();
        setValidatedOrgId(data.organization_id as string);

        const { data: tokenData, error: tokenError } = await supabase.functions.invoke("pdc-auth", {
          body: {
            action: "issue_public",
            org_slug: orgSlug,
            ttl_seconds: 3600,
          },
        });

        if (tokenError || !tokenData?.ok || !tokenData?.token) {
          throw new Error(tokenData?.error || tokenError?.message || "Failed to initialize processing token");
        }

        setOrgExecutionToken(tokenData.token as string);
        setEmbedAllowed(true);
      } catch (err) {
        setEmbedError(toUserFriendlyEmbedError(err));
        revealEmbedDocument();
      }
    };

    validateEmbedAccess();
  }, [embedToken, orgSlug]);

  // Optional legacy light/dark override for hand-written embeds.
  useEffect(() => {
    if (!theme) return;
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, [theme]);

  const steps = useMemo(() => ["Select Type", "Choose Data", "Processing", "Results"], []);

  const [currentStep, setCurrentStep] = useState(0);
  const [selectedAnalytics, setSelectedAnalytics] = useState<AnalyticsOption | null>(null);
  const [analyticsQueryParams, setAnalyticsQueryParams] = useState<Record<string, string>>({});
  const [selectedData, setSelectedData] = useState<SelectedDataType | null>(null);
  const hasPreselection = hasPreselectionTarget(searchParams);
  const skipSelection = hasPreselection && searchParams.get("skip_selection") !== "false";

  const getStepIndex = (stepName: string): number => steps.indexOf(stepName);

  const getAnalyticsDisplayName = (): string => {
    if (!selectedAnalytics) return "";
    if (selectedAnalytics.type === "software") {
      return selectedAnalytics.data.resource_name || "Analytics";
    }
    return selectedAnalytics.data.basis_information?.name || selectedAnalytics.data.catalog_id;
  };

  const handleAnalyticsSelect = (option: AnalyticsOption) => {
    // New process session starts when user picks software/service chain.
    resetSession();
    setSelectedAnalytics(option);
    setAnalyticsQueryParams({});
  };

  const handleDataSelect = (data: SelectedDataType) => {
    setSelectedData(data);
    setCurrentStep(getStepIndex("Processing"));
  };

  const handleProcessingComplete = () => {
    setCurrentStep(getStepIndex("Results"));
  };

  const handleProcessingError = (error: unknown) => {
    console.error("Processing error:", error);
  };

  const handleProcessingBack = () => {
    const processingIndex = getStepIndex("Processing");
    const previousIndex = Math.max(0, processingIndex - 1);
    setCurrentStep(previousIndex);
  };

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

  const llmPromptContext = useMemo(() => {
    if (!selectedAnalytics) return null;
    return selectedAnalytics.type === "software"
      ? (selectedAnalytics.data.llm_context ?? null)
      : (selectedAnalytics.data.llm_context ?? null);
  }, [selectedAnalytics]);

  const handleRestart = () => {
    const preselected = skipSelection
      ? findPreselectedAnalytics(searchParams, softwareResources, serviceChains)
      : null;

    resetSession();
    setSelectedData(null);
    if (preselected) {
      setSelectedAnalytics(preselected);
      setAnalyticsQueryParams(buildPreselectedQueryParams(searchParams, preselected, sessionId));
      setCurrentStep(getStepIndex("Choose Data"));
      return;
    }
    setCurrentStep(0);
    setSelectedAnalytics(null);
    setAnalyticsQueryParams({});
  };

  const getCurrentStepName = (): string => steps[currentStep];

  // Send postMessage events for parent window integration
  useEffect(() => {
    const message = {
      type: 'pdc-gateway-step-change',
      step: getCurrentStepName(),
      stepIndex: currentStep,
    };
    window.parent.postMessage(message, '*');
  }, [currentStep]);

  const pdcConfigForProcessing = useMemo(() => (
    pdcConfig ? {
      organizationId: pdcConfig.organization_id,
      orgExecutionToken,
    } : { organizationId: null, orgExecutionToken }
  ), [pdcConfig, orgExecutionToken]);

  useEffect(() => {
    if (!skipSelection || selectedAnalytics) return;

    const preselected = findPreselectedAnalytics(searchParams, softwareResources, serviceChains);
    if (!preselected) return;

    resetSession();
    setSelectedAnalytics(preselected);
    setAnalyticsQueryParams(buildPreselectedQueryParams(searchParams, preselected, sessionId));
    setCurrentStep(getStepIndex("Choose Data"));
  }, [
    skipSelection,
    selectedAnalytics,
    searchParams,
    softwareResources,
    serviceChains,
    resetSession,
    sessionId,
  ]);

  if (embedError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{embedError}</p>
        </div>
      </div>
    );
  }

  if (!embedAllowed || !validatedOrgId || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        {/* Compact Header for Embed */}
        <header className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 mb-3">
            <Sparkles className="w-3 h-3 text-primary" />
            <span className="text-xs text-primary font-medium">PDC Gateway</span>
          </div>
          <h1 className="text-2xl font-bold">Data Analytics</h1>
        </header>

        {selectedAnalytics && (
          <div className="text-center mb-4">
            <p className="text-sm text-muted-foreground">
              Selected analytics:{" "}
              <span className="font-medium text-foreground">{getAnalyticsDisplayName()}</span>
            </p>
          </div>
        )}

        {/* Step Indicator */}
        <StepIndicator steps={steps} currentStep={currentStep} />

        {/* Step Content */}
        <main className="glass-card p-6 mt-6">
          {getCurrentStepName() === "Select Type" && (
            <AnalyticsSelection
              selected={selectedAnalytics}
              onSelect={handleAnalyticsSelect}
              onNext={() => setCurrentStep(getStepIndex("Choose Data"))}
              queryParams={analyticsQueryParams}
              onQueryParamChange={setAnalyticsQueryParams}
              softwareResources={softwareResources}
              serviceChains={serviceChains}
            />
          )}
          {getCurrentStepName() === "Choose Data" && (
            <DataSelection
              onNext={handleDataSelect}
              onBack={() => setCurrentStep(getStepIndex("Select Type"))}
              dataResources={dataResources}
              selectedAnalytics={selectedAnalytics}
            />
          )}
          {getCurrentStepName() === "Processing" && selectedAnalytics && pdcPayload && (
            <ProcessingView
              analyticsType={getAnalyticsDisplayName()}
              pdcPayload={pdcPayload}
              pdcConfig={pdcConfigForProcessing}
              resultUrlInfo={resultUrlInfo}
              onComplete={handleProcessingComplete}
              onError={handleProcessingError}
              onBack={handleProcessingBack}
            />
          )}
          {getCurrentStepName() === "Results" && selectedAnalytics && (
            <ResultsView
              analyticsType={getAnalyticsDisplayName()}
              onRestart={handleRestart}
              resultUrlInfo={resultUrlInfo}
              exportApiConfigs={pdcConfig?.export_api_configs}
              organizationId={validatedOrgId}
              orgExecutionToken={orgExecutionToken}
              llmPromptContext={llmPromptContext}
              selectedAnalytics={selectedAnalytics}
              customVisualizations={customVisualizations}
            />
          )}
        </main>
      </div>
    </div>
  );
};

const EmbedGateway = () => {
  return (
    <ProcessSessionProvider>
      <EmbedGatewayContent />
    </ProcessSessionProvider>
  );
};

export default EmbedGateway;
