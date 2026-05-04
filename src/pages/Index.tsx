import { useState, useCallback, useMemo, useEffect } from "react";
import { Sparkles, Construction, Loader2 } from "lucide-react";
import StepIndicator from "@/components/StepIndicator";
import AnalyticsSelection from "@/components/AnalyticsSelection";
import DataSelection from "@/components/DataSelection";
import ProcessingView from "@/components/ProcessingView";
import ResultsView from "@/components/ResultsView";
import DataspaceConfigPage from "@/components/DataspaceConfigPage";
import HumanValidationPage from "@/components/HumanValidationPage";
import { ProcessSessionProvider, useProcessSession } from "@/contexts/ProcessSessionContext";
import { resolveResultUrl, ResultUrlInfo } from "@/utils/resultUrlResolver";
import { generatePdcPayload, PdcPayload } from "@/utils/pdcPayloadGenerator";
import { useAuth } from "@/contexts/AuthContext";
import UserMenu from "@/components/UserMenu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDataspaceConfig } from "@/hooks/useDataspaceConfig";
import { AnalyticsOption, DataResource } from "@/types/dataspace";
import { UploadConfig } from "@/components/DocumentUploadZone";

interface SelectedDataType {
  files: File[];
  apis: string[];
  textData: string;
  customApiUrl: string;
  apiParams: Record<string, Record<string, string>>;
  selectedDataResources: DataResource[];
  uploadConfig?: UploadConfig;
  uploadResourceParams?: Record<string, string>;
  serviceChainResourceParams?: Record<string, Record<string, string>>;
}

const IndexContent = () => {
  const { user, isAdmin, isAuthenticated, isLoading: authLoading } = useAuth();
  
  // Debug mode from user session (per-user, not global)
  const isDebugMode = isAdmin && user?.isDebugMode;
  const showConfigPage = isDebugMode;
  const showHumanValidation = isDebugMode;
  
  const { sessionId, resetSession } = useProcessSession();

  // Fetch dataspace configuration from backend
  const { 
    pdcConfig, 
    softwareResources, 
    dataResources, 
    serviceChains,
    customVisualizations,
    dataSelectionSettings,
    processingPageSettings,
    isLoading: configLoading, 
    error: configError 
  } = useDataspaceConfig();

  // Check if backend has any configured data
  const hasBackendData = softwareResources.length > 0 || dataResources.length > 0 || serviceChains.length > 0;

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
  const [transitionDirection, setTransitionDirection] = useState<"forward" | "back">("forward");
  const [selectedAnalytics, setSelectedAnalytics] = useState<AnalyticsOption | null>(null);
  const [analyticsQueryParams, setAnalyticsQueryParams] = useState<Record<string, string>>({});
  const [selectedData, setSelectedData] = useState<SelectedDataType | null>(null);

  // Calculate actual step indices based on config
  const getStepIndex = useCallback((stepName: string): number => {
    return steps.indexOf(stepName);
  }, [steps]);

  const goToStep = useCallback((nextStep: number) => {
    setCurrentStep((prevStep) => {
      if (nextStep === prevStep) return prevStep;
      setTransitionDirection(nextStep > prevStep ? "forward" : "back");
      return nextStep;
    });
  }, []);

  // Get display name for selected analytics
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
    // Reset query params when selection changes
    setAnalyticsQueryParams({});
  };

  const handleDataSelect = (data: SelectedDataType) => {
    setSelectedData(data);
    goToStep(getStepIndex(showHumanValidation ? "Validation" : "Processing"));
  };

  const handleValidationApprove = () => {
    goToStep(getStepIndex("Processing"));
  };

  const handleValidationReject = () => {
    goToStep(getStepIndex("Choose Data"));
  };

  const handleProcessingComplete = useCallback(() => {
    goToStep(getStepIndex("Results"));
  }, [getStepIndex, goToStep]);

  const handleProcessingError = useCallback((error: unknown) => {
    console.error("Processing error:", error);
    // Stay on processing page - error will be displayed there
  }, []);

  const handleProcessingBack = useCallback(() => {
    const processingIndex = getStepIndex("Processing");
    const previousIndex = Math.max(0, processingIndex - 1);
    goToStep(previousIndex);
  }, [getStepIndex, goToStep]);

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

  const llmPromptContext = useMemo(() => {
    if (!selectedAnalytics) return null;
    return selectedAnalytics.type === "software"
      ? (selectedAnalytics.data.llm_context ?? null)
      : (selectedAnalytics.data.llm_context ?? null);
  }, [selectedAnalytics]);

  const handleRestart = () => {
    goToStep(showConfigPage ? 0 : getStepIndex("Select Type"));
    setSelectedAnalytics(null);
    setAnalyticsQueryParams({});
    setSelectedData(null);
  };

  // Determine which component to render based on current step
  const getCurrentStepName = (): string => steps[currentStep];

  // Show loading state
  if (authLoading || configLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Show "under construction" notice if no backend data is configured
  // Only for non-debug users (non-logged-in or logged-in without debug mode)
  if (!hasBackendData && !isDebugMode) {
    return (
      <div className="min-h-screen bg-background relative">
        {/* Background Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] opacity-30 pointer-events-none">
          <div className="absolute inset-0" style={{ background: "var(--gradient-glow)" }} />
        </div>

        <div className="relative z-10 container mx-auto px-4 py-8 max-w-5xl">
          {/* Header - Only show UserMenu for authenticated admins in debug mode */}
          <header className="text-center mb-12 relative">
            {isDebugMode && (
              <div className="absolute top-0 right-0">
                <UserMenu />
              </div>
            )}
            
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm text-primary font-medium">Data Analytics Platform</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              Transform Your Data Into{" "}
              <span className="gradient-text">Insights</span>
            </h1>
          </header>

          {/* Under Construction Notice */}
          <Card className="max-w-lg mx-auto glass-card">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Construction className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">Dataspace Gateway Under Construction</CardTitle>
              <CardDescription className="text-base">
                The gateway is being configured. Please check back later.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-sm text-muted-foreground">
                Administrators are setting up the data resources and analytics services.
                Once configured, you'll be able to access the full analytics platform here.
              </p>
            </CardContent>
          </Card>

          {/* Footer */}
          <footer className="text-center mt-8 text-sm text-muted-foreground">
            <p>Built with modern analytics technology</p>
          </footer>
        </div>
      </div>
    );
  }

  // PDC config for processing
  const pdcConfigForProcessing = useMemo(() => (
    pdcConfig ? {
      organizationId: pdcConfig.organization_id,
    } : { organizationId: null }
  ), [pdcConfig]);
  const isVerticalProgress = processingPageSettings?.stepProgressLayout === "vertical_right";
  const verticalRailGap = "1.25rem";
  const stepTransitionClass = isVerticalProgress
    ? transitionDirection === "forward"
      ? "step-transition-vertical-forward"
      : "step-transition-vertical-back"
    : transitionDirection === "forward"
      ? "step-transition-horizontal-forward"
      : "step-transition-horizontal-back";

  return (
      <div className="min-h-screen bg-background relative">
        {/* Background Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] opacity-30 pointer-events-none">
          <div className="absolute inset-0" style={{ background: "var(--gradient-glow)" }} />
        </div>

        <div className="relative z-10 container mx-auto px-4 py-5 max-w-[90vw]">
          {/* Header with User Menu - Only show for debug mode users */}
          <header className="text-center mb-4 relative h-[clamp(96px,15vh,140px)] overflow-hidden flex flex-col justify-center">
            {isDebugMode && (
              <div className="absolute top-0 right-0">
                <UserMenu />
              </div>
            )}
            
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 mb-2 mx-auto">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-[clamp(11px,1.2vh,13px)] text-primary font-medium">Data Analytics Platform</span>
            </div>
            <h1 className="text-[clamp(1.35rem,2.9vh,2.2rem)] font-bold mb-1 leading-tight">
              Transform Your Data Into{" "}
              <span className="gradient-text">Insights</span>
            </h1>
            <p className="text-[clamp(11px,1.35vh,15px)] text-muted-foreground max-w-2xl mx-auto leading-snug">
              Upload your data, select your analysis type, and let our platform
              generate actionable insights in minutes
            </p>
          </header>

          {isVerticalProgress ? (
            <div className="lg:hidden">
              <StepIndicator steps={steps} currentStep={currentStep} />
            </div>
          ) : (
            <StepIndicator steps={steps} currentStep={currentStep} />
          )}
          <div className={isVerticalProgress ? "grid grid-cols-1 lg:grid-cols-[max-content_minmax(0,1fr)] gap-6 items-start" : ""}>
            {isVerticalProgress ? (
              <aside className="hidden lg:block self-start sticky w-max max-w-[320px]" style={{ top: verticalRailGap }}>
                <div
                  className="relative pr-4"
                  style={{
                    height: `calc(100dvh - clamp(96px, 15vh, 140px) - (2 * ${verticalRailGap}))`,
                  }}
                >
                  <div className="absolute right-0 top-0 w-px bg-border/60" style={{ bottom: verticalRailGap }} />
                  <StepIndicator steps={steps} currentStep={currentStep} orientation="vertical" />
                </div>
              </aside>
            ) : null}
            <main
              key={`${currentStep}-${isVerticalProgress ? "vertical" : "horizontal"}`}
              className={`glass-card p-8 text-[clamp(11px,1.25vh,14px)] leading-relaxed ${stepTransitionClass}`}
            >
            {getCurrentStepName() === "Config" && (
              <DataspaceConfigPage onNext={() => goToStep(getStepIndex("Select Type"))} />
            )}
            {getCurrentStepName() === "Select Type" && (
              <AnalyticsSelection
                selected={selectedAnalytics}
                onSelect={handleAnalyticsSelect}
                onNext={() => goToStep(getStepIndex("Choose Data"))}
                queryParams={analyticsQueryParams}
                onQueryParamChange={setAnalyticsQueryParams}
                softwareResources={softwareResources}
                serviceChains={serviceChains}
                isDebugMode={isDebugMode}
              />
            )}
            {getCurrentStepName() === "Choose Data" && (
              <DataSelection
                onNext={handleDataSelect}
                onBack={() => goToStep(getStepIndex("Select Type"))}
                dataResources={dataResources}
                selectedAnalytics={selectedAnalytics}
                isDebugMode={isDebugMode}
                dataSelectionSettings={dataSelectionSettings}
              />
            )}
            {getCurrentStepName() === "Validation" && selectedData && selectedAnalytics && (
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
            {getCurrentStepName() === "Processing" && selectedAnalytics && pdcPayload && (
            <ProcessingView
              analyticsType={getAnalyticsDisplayName()}
              pdcPayload={pdcPayload}
              pdcConfig={pdcConfigForProcessing}
              resultUrlInfo={resultUrlInfo}
              onComplete={handleProcessingComplete}
              onError={handleProcessingError}
              onBack={handleProcessingBack}
              pendingWaitSeconds={processingPageSettings?.pendingWaitSeconds}
            />
          )}
            {getCurrentStepName() === "Results" && selectedAnalytics && (
              <ResultsView
                analyticsType={getAnalyticsDisplayName()}
                onRestart={handleRestart}
                resultUrlInfo={resultUrlInfo}
                exportApiConfigs={pdcConfig?.export_api_configs}
                organizationId={pdcConfig?.organization_id ?? null}
                llmPromptContext={llmPromptContext}
                selectedAnalytics={selectedAnalytics}
                selectedDataResources={selectedData?.selectedDataResources || []}
                customVisualizations={customVisualizations}
                showDebugApiExportConfig={isDebugMode}
              />
            )}
            </main>
          </div>

          {/* Footer */}
          <footer className="text-center mt-8 text-sm text-muted-foreground">
            <p>Built with modern analytics technology</p>
          </footer>
        </div>
      </div>
  );
};

const Index = () => {
  return (
    <ProcessSessionProvider>
      <IndexContent />
    </ProcessSessionProvider>
  );
};

export default Index;
