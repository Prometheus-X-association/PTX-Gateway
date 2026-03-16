import { useEffect, useState, useCallback, useRef } from "react";
import { Loader2, CheckCircle2, AlertCircle, Copy, Check, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { isDebugMode } from "@/config/global.config";
import { ResultUrlInfo, formatResultUrlWithParams, buildResultRequestBody } from "@/utils/resultUrlResolver";
interface PdcPayload {
  contract: string;
  purposeId?: string;
  resourceId?: string;
  serviceChainId?: string;
  resources: Array<{
    resource: string;
    params?: { query: Array<Record<string, string>> };
  }>;
  purposes: Array<{
    resource: string;
    params?: { query: Array<Record<string, string>> };
  }>;
  serviceChainParams?: Array<{
    resource: string;
    params?: { query: Array<Record<string, string>> };
  }>;
}

// Recursively search for success: true in nested objects
const findSuccessInResponse = (obj: unknown): boolean => {
  if (obj === null || typeof obj !== 'object') return false;
  
  const record = obj as Record<string, unknown>;
  
  // Check if this level has success: true
  if (record.success === true) return true;
  
  // Recursively check nested objects
  for (const value of Object.values(record)) {
    if (findSuccessInResponse(value)) return true;
  }
  
  return false;
};

// Recursively search for status string in nested objects
const findStatusInResponse = (obj: unknown): string | null => {
  if (obj === null || typeof obj !== 'object') return null;
  
  const record = obj as Record<string, unknown>;
  
  // Check if this level has a status string
  if (typeof record.status === 'string') return record.status;
  
  // Recursively check nested objects (prioritize 'content' key)
  if (record.content && typeof record.content === 'object') {
    const found = findStatusInResponse(record.content);
    if (found) return found;
  }
  
  for (const value of Object.values(record)) {
    const found = findStatusInResponse(value);
    if (found) return found;
  }
  
  return null;
};

// Detect async-accepted responses where processing is still running remotely.
// Looks for an object that includes:
// - message: "30 sec Timeout reached."
// - dataExchange.status: "PENDING"
const hasPendingTimeoutSignature = (obj: unknown): boolean => {
  if (obj === null || typeof obj !== 'object') return false;

  const record = obj as Record<string, unknown>;

  const hasTimeoutMessage = record.message === "30 sec Timeout reached.";
  const dataExchange = record.dataExchange as Record<string, unknown> | undefined;
  const hasPendingStatus = dataExchange?.status === "PENDING";

  if (hasTimeoutMessage && hasPendingStatus) {
    return true;
  }

  for (const value of Object.values(record)) {
    if (hasPendingTimeoutSignature(value)) return true;
  }

  return false;
};

interface PdcConfig {
  organizationId?: string | null;
  orgExecutionToken?: string | null;
}
interface ProcessingViewProps {
  analyticsType: string;
  pdcPayload: PdcPayload;
  pdcConfig: PdcConfig;
  resultUrlInfo?: ResultUrlInfo | null;
  onComplete: () => void;
  onError: (error: unknown) => void;
  onBack?: () => void;
  allowContinueOnPdcError?: boolean;
  onContinueWithDummyResult?: (error: unknown) => void;
}

type ProcessExecutionStatus = "running" | "completed" | "failed";

interface ProcessExecutionRecord {
  status: ProcessExecutionStatus;
  updatedAt: number;
  ownerTabId?: string;
  errorMessage?: string;
}

const getExecutionStorageKey = (executionKey: string) => `ptx_process_execution_${executionKey}`;
const PROCESS_TAB_ID_KEY = "ptx_process_tab_id";
const RUNNING_LOCK_STALE_MS = 30 * 60 * 1000;
const PENDING_TRANSITION_DELAY_MS = 60_000;
const INITIAL_PENDING_POLL_INTERVAL_MS = 10_000;
const RETRY_PENDING_POLL_INTERVAL_MS = 5_000;

const getOrCreateTabId = (): string => {
  if (typeof window === "undefined") return "server";
  const existing = sessionStorage.getItem(PROCESS_TAB_ID_KEY);
  if (existing) return existing;
  const newId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  sessionStorage.setItem(PROCESS_TAB_ID_KEY, newId);
  return newId;
};

const readExecutionRecord = (executionKey: string): ProcessExecutionRecord | null => {
  if (typeof window === "undefined" || !executionKey) return null;
  const raw = localStorage.getItem(getExecutionStorageKey(executionKey));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProcessExecutionRecord;
  } catch {
    return null;
  }
};

const writeExecutionRecord = (executionKey: string, record: ProcessExecutionRecord): void => {
  if (typeof window === "undefined" || !executionKey) return;
  localStorage.setItem(getExecutionStorageKey(executionKey), JSON.stringify(record));
};

const waitForExecutionTerminalState = async (executionKey: string, timeoutMs = 10 * 60 * 1000): Promise<ProcessExecutionRecord | null> => {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const record = readExecutionRecord(executionKey);
      if (record && record.status !== "running") {
        clearInterval(interval);
        resolve(record);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(interval);
        resolve(null);
      }
    }, 1000);
  });
};

const extractSessionIdFromPayload = (payload: PdcPayload): string | null => {
  const allQueryRecords: Array<Record<string, string>> = [];

  payload.resources.forEach((r) => r.params?.query && allQueryRecords.push(...r.params.query));
  payload.purposes.forEach((p) => p.params?.query && allQueryRecords.push(...p.params.query));
  payload.serviceChainParams?.forEach((s) => s.params?.query && allQueryRecords.push(...s.params.query));

  for (const queryObj of allQueryRecords) {
    for (const value of Object.values(queryObj)) {
      if (typeof value === "string" && value.startsWith("session_")) {
        return value;
      }
    }
  }

  return null;
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
};

const hashString = (input: string): string => {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
};

const getPayloadExecutionKey = (payload: PdcPayload): string => {
  return `payload_${hashString(stableStringify(payload))}`;
};

const processingSteps = [
  "Validating payload",
  "Connecting to PDC",
  "Sending data exchange request",
  "Waiting for response",
  "Processing response",
  "Finalizing",
];

const ProcessingView = ({
  analyticsType,
  pdcPayload,
  pdcConfig,
  resultUrlInfo,
  onComplete,
  onError,
  onBack,
  allowContinueOnPdcError = false,
  onContinueWithDummyResult,
}: ProcessingViewProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorResponse, setErrorResponse] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const [observerMessage, setObserverMessage] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [canRetryPendingAvailability, setCanRetryPendingAvailability] = useState(false);
  const executionInFlightRef = useRef(false);

  const probeResultAvailability = useCallback(async (): Promise<boolean> => {
    if (!resultUrlInfo?.url) return false;

    try {
      const fullUrl = formatResultUrlWithParams(resultUrlInfo);
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/result-proxy`;

      const proxyHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "x-result-url": fullUrl,
        "x-result-method": resultUrlInfo.method,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      };

      if (resultUrlInfo.authorization) {
        proxyHeaders["x-result-authorization"] = resultUrlInfo.authorization;
      }

      const fetchOptions: RequestInit = {
        method: "POST",
        headers: proxyHeaders,
      };

      if (resultUrlInfo.method === "POST") {
        const body = buildResultRequestBody(resultUrlInfo);
        if (body) {
          fetchOptions.body = JSON.stringify(body);
        }
      }

      const response = await fetch(proxyUrl, fetchOptions);
      if (!response.ok) return false;

      const result = await response.json();
      if (hasPendingTimeoutSignature(result)) return false;
      return !!result;
    } catch {
      return false;
    }
  }, [resultUrlInfo]);

  const runPendingAvailabilityWindow = useCallback(
    async (pollIntervalMs: number): Promise<boolean> => {
      setHasError(false);
      setErrorResponse(null);
      setCurrentStep(4);
      setProgress((prev) => Math.max(prev, 88));
      setPendingMessage(
        `Status is PENDING. Data is still being processed. Waiting up to 60 seconds and checking result availability every ${
          pollIntervalMs / 1000
        } seconds.`
      );

      const startedAt = Date.now();
      let resultReady = false;

      while (Date.now() - startedAt < PENDING_TRANSITION_DELAY_MS) {
        setProgress((prev) => Math.min(prev + 1, 97));
        resultReady = await probeResultAvailability();
        if (resultReady) break;
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      setPendingMessage(null);
      return resultReady;
    },
    [probeResultAvailability]
  );

  const executePdc = useCallback(async () => {
    if (executionInFlightRef.current) {
      return;
    }
    executionInFlightRef.current = true;

    try {
      setIsExecuting(true);
      setHasError(false);
      setErrorResponse(null);
      setProgress(0);
      setCurrentStep(0);
      setObserverMessage(null);
      setPendingMessage(null);
      setCanRetryPendingAvailability(false);

      const executionKey = getPayloadExecutionKey(pdcPayload);
      const thisTabId = getOrCreateTabId();

    if (executionKey) {
      const existing = readExecutionRecord(executionKey);

      if (existing?.status === "completed") {
        setProgress(100);
        setCurrentStep(processingSteps.length - 1);
        setIsExecuting(false);
        onComplete();
        return;
      }

      const runningStillActive =
        existing?.status === "running" &&
        Date.now() - existing.updatedAt < RUNNING_LOCK_STALE_MS;

      if (runningStillActive) {
        const runningInAnotherTab = existing?.ownerTabId && existing.ownerTabId !== thisTabId;
        setObserverMessage(
          runningInAnotherTab
            ? "An execution with the same payload is already running in another tab. Waiting for completion..."
            : "An execution with the same payload is already running in this browser tab. Waiting for completion..."
        );
        setProgress(85);
        setCurrentStep(3);

        const terminal = await waitForExecutionTerminalState(executionKey);
        if (terminal?.status === "completed") {
          setProgress(100);
          setCurrentStep(processingSteps.length - 1);
          setIsExecuting(false);
          onComplete();
          return;
        }

        if (terminal?.status === "failed") {
          setHasError(true);
          setErrorResponse({
            content: {
              status: terminal.errorMessage || "Process failed in another tab",
            },
          });
          setProgress(100);
          setCurrentStep(processingSteps.length - 1);
          setIsExecuting(false);
          return;
        }
      }
    }

    // Start progress animation - slower initial progress
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        // Progress slowly up to 85% while waiting for response
        if (prev < 85) {
          return prev + 0.5;
        }
        return prev;
      });
    }, 100);

    // Step animation
    const stepInterval = setInterval(() => {
      setCurrentStep((prev) => {
        // Move through steps 0-3 while waiting, hold at 3
        if (prev < 3) {
          return prev + 1;
        }
        return prev;
      });
    }, 1500);

    try {
      if (executionKey) {
        writeExecutionRecord(executionKey, {
          status: "running",
          updatedAt: Date.now(),
          ownerTabId: thisTabId,
        });
      }

      if (isDebugMode()) {
        console.log("Executing PDC request...");
        console.log("PDC Organization:", pdcConfig.organizationId || "public-token");
        console.log("Payload:", JSON.stringify(pdcPayload, null, 2));
      }

      const invokeHeaders: Record<string, string> = {};
      if (pdcConfig.organizationId) {
        invokeHeaders["x-organization-id"] = pdcConfig.organizationId;
      }

      const { data, error } = await supabase.functions.invoke("pdc-execute", {
        headers: invokeHeaders,
        body: {
          org_execution_token: pdcConfig.orgExecutionToken || undefined,
          payload: pdcPayload,
        },
      });

      clearInterval(progressInterval);
      clearInterval(stepInterval);

      if (error) {
        console.error("PDC execution error:", error);
        setHasError(true);
        setErrorResponse({ content: { status: error.message } });
        setProgress(100);
        setCurrentStep(processingSteps.length - 1);
        if (executionKey) {
          writeExecutionRecord(executionKey, {
            status: "failed",
            updatedAt: Date.now(),
            ownerTabId: thisTabId,
            errorMessage: error.message,
          });
        }
        onError(error);
        return;
      }

      if (isDebugMode()) {
        console.log("PDC Response:", data);
      }

      // Recursively check if success: true exists anywhere in the response
      const isSuccess = findSuccessInResponse(data);
      const isPendingTimeout = hasPendingTimeoutSignature(data);

      // Continue to results if:
      // 1) processing already completed (success: true), or
      // 2) exchange is accepted but still pending with timeout marker
      if (isSuccess || isPendingTimeout) {
        if (!isPendingTimeout) {
          // Complete animation quickly for direct success.
          setProgress(100);
          setCurrentStep(processingSteps.length - 1);

          await new Promise((resolve) => setTimeout(resolve, 500));
          if (executionKey) {
            writeExecutionRecord(executionKey, {
              status: "completed",
              updatedAt: Date.now(),
              ownerTabId: thisTabId,
            });
          }
          setIsExecuting(false);
          onComplete();
          return;
        }

        // Pending status flow:
        // - keep progress below 100
        // - notify user
        // - wait up to 60s while polling result URL every 10s
        const resultReady = await runPendingAvailabilityWindow(INITIAL_PENDING_POLL_INTERVAL_MS);

        if (resultReady) {
          setProgress(100);
          setCurrentStep(processingSteps.length - 1);
          if (executionKey) {
            writeExecutionRecord(executionKey, {
              status: "completed",
              updatedAt: Date.now(),
              ownerTabId: thisTabId,
            });
          }
          setIsExecuting(false);
          onComplete();
          return;
        }

        setHasError(true);
        setCanRetryPendingAvailability(true);
        setErrorResponse({
          content: {
            status: "Result is still not available after 60 seconds of polling. Click Retry to run another 60-second availability check every 5 seconds.",
          },
        });
        setCurrentStep(processingSteps.length - 1);
        if (executionKey) {
          writeExecutionRecord(executionKey, {
            status: "failed",
            updatedAt: Date.now(),
            ownerTabId: thisTabId,
            errorMessage: "Pending result not available after 60 seconds",
          });
        }
        setIsExecuting(false);
        onError({ message: "Pending result not available after 60 seconds" });
      } else {
        // Error case - show the response
        setHasError(true);
        setErrorResponse(data);
        setProgress(100);
        setCurrentStep(processingSteps.length - 1);
        if (executionKey) {
          writeExecutionRecord(executionKey, {
            status: "failed",
            updatedAt: Date.now(),
            ownerTabId: thisTabId,
            errorMessage: "PDC response did not contain success signal",
          });
        }
        onError(data);
      }
    } catch (err) {
      clearInterval(progressInterval);
      clearInterval(stepInterval);
      
      console.error("PDC execution failed:", err);
      setHasError(true);
      setErrorResponse({ content: { status: err instanceof Error ? err.message : "Unknown error" } });
      setProgress(100);
      setCurrentStep(processingSteps.length - 1);
      if (executionKey) {
        writeExecutionRecord(executionKey, {
          status: "failed",
          updatedAt: Date.now(),
          ownerTabId: thisTabId,
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        });
      }
      onError(err);
    }
    } finally {
      executionInFlightRef.current = false;
      setIsExecuting(false);
    }
  }, [pdcPayload, pdcConfig, onComplete, onError, runPendingAvailabilityWindow]);

  // Execute PDC on mount
  useEffect(() => {
    executePdc();
  }, [executePdc]);

  const handleCopyResponse = async () => {
    try {
      const textToCopy = isDebugMode() 
        ? JSON.stringify(errorResponse, null, 2)
        : findStatusInResponse(errorResponse) || "Unknown error";
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleRetry = async () => {
    if (!canRetryPendingAvailability) {
      executePdc();
      return;
    }

    setIsExecuting(true);
    const executionKey = getPayloadExecutionKey(pdcPayload);
    const thisTabId = getOrCreateTabId();

    if (executionKey) {
      writeExecutionRecord(executionKey, {
        status: "running",
        updatedAt: Date.now(),
        ownerTabId: thisTabId,
      });
    }

    const resultReady = await runPendingAvailabilityWindow(RETRY_PENDING_POLL_INTERVAL_MS);

    if (resultReady) {
      setCanRetryPendingAvailability(false);
      setProgress(100);
      setCurrentStep(processingSteps.length - 1);
      if (executionKey) {
        writeExecutionRecord(executionKey, {
          status: "completed",
          updatedAt: Date.now(),
          ownerTabId: thisTabId,
        });
      }
      setIsExecuting(false);
      onComplete();
      return;
    }

    setHasError(true);
    setCanRetryPendingAvailability(true);
    setErrorResponse({
      content: {
        status:
          "Result is still not available after another 60 seconds of polling every 5 seconds. You can retry availability check again.",
      },
    });
    setCurrentStep(processingSteps.length - 1);
    if (executionKey) {
      writeExecutionRecord(executionKey, {
        status: "failed",
        updatedAt: Date.now(),
        ownerTabId: thisTabId,
        errorMessage: "Pending result not available after retry availability check",
      });
    }
    setIsExecuting(false);
    onError({ message: "Pending result not available after retry availability check" });
  };

  const handleContinueWithDummyResult = () => {
    if (!allowContinueOnPdcError || !onContinueWithDummyResult) return;
    onContinueWithDummyResult(errorResponse);
  };

  return (
    <div className="animate-fade-in max-w-2xl mx-auto px-4 sm:px-0">
      <div className="text-center mb-8 sm:mb-12">
        <div className="w-20 h-20 sm:w-24 sm:h-24 mx-auto mb-4 sm:mb-6 relative">
          {!hasError ? (
            <>
              <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
              <div className="relative w-full h-full rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center glow-effect">
                <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 text-primary-foreground animate-spin" />
              </div>
            </>
          ) : (
            <div className="relative w-full h-full rounded-full bg-gradient-to-br from-destructive to-destructive/70 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 sm:w-10 sm:h-10 text-destructive-foreground" />
            </div>
          )}
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold mb-2">
          {hasError ? (
            <>PDC Execution <span className="text-destructive">Failed</span></>
          ) : (
            <>Processing <span className="gradient-text">{analyticsType}</span></>
          )}
        </h2>
        <p className="text-sm sm:text-base text-muted-foreground">
          {hasError 
            ? "The data exchange request failed. Please review the error below."
            : "Executing data exchange via PDC connector"
          }
        </p>
        {observerMessage && !hasError && (
          <p className="text-xs text-amber-400 mt-2">{observerMessage}</p>
        )}
        {pendingMessage && !hasError && (
          <p className="text-xs text-amber-300 mt-2">{pendingMessage}</p>
        )}
      </div>

      <div className="glass-card p-4 sm:p-6 mb-6 sm:mb-8">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-medium">Overall Progress</span>
          <span className="text-sm text-primary font-mono">{Math.round(progress)}%</span>
        </div>
        <div className="progress-bar">
          <div
            className={`progress-bar-fill transition-all duration-300 ${hasError ? "bg-destructive" : ""}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="glass-card p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="font-semibold mb-4">Processing Steps</h3>
        <div className="space-y-3 sm:space-y-4">
          {processingSteps.map((step, index) => {
            const isCompleted = index < currentStep;
            const isCurrent = index === currentStep && !hasError;
            const isError = hasError && index === currentStep;
            return (
              <div
                key={step}
                className={`flex items-center gap-3 transition-opacity duration-300 ${
                  index > currentStep ? "opacity-40" : ""
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                  {isCompleted ? (
                    <CheckCircle2 className="w-5 h-5 text-primary" />
                  ) : isError ? (
                    <AlertCircle className="w-5 h-5 text-destructive" />
                  ) : isCurrent ? (
                    <div className="pulse-dot" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-muted" />
                  )}
                </div>
                <span
                  className={`text-sm ${
                    isCurrent ? "text-foreground font-medium" : ""
                  } ${isError ? "text-destructive font-medium" : ""}`}
                >
                  {step}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Error Response Display */}
      {hasError && errorResponse && (
        <div className="glass-card p-4 sm:p-6">
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>PDC Execution Failed</AlertTitle>
            <AlertDescription className="text-sm">
              The data exchange request did not complete successfully. Please report the error below.
            </AlertDescription>
          </Alert>

          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Status</h3>
            <div className="flex items-center gap-2">
              {onBack && (
                <button
                  onClick={onBack}
                  disabled={isExecuting}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 text-secondary-foreground text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Back
                </button>
              )}
              {allowContinueOnPdcError && onContinueWithDummyResult && (
                <button
                  onClick={handleContinueWithDummyResult}
                  disabled={isExecuting}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Continue to Results
                </button>
              )}
              <button
                onClick={handleRetry}
                disabled={isExecuting}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <RefreshCw className="w-4 h-4" />
                {canRetryPendingAvailability ? "Retry Availability Check" : "Retry"}
              </button>
              <button
                onClick={handleCopyResponse}
                className="p-1.5 rounded hover:bg-muted transition-colors"
                title="Copy status"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-primary" />
                ) : (
                  <Copy className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
            </div>
          </div>
          
          <div className="bg-background/50 rounded-lg border border-border/50 p-3 sm:p-4 max-h-60 sm:max-h-80 overflow-auto">
            {isDebugMode() ? (
              <pre className="font-mono text-xs sm:text-sm text-destructive whitespace-pre-wrap break-words">
                {JSON.stringify(errorResponse, null, 2)}
              </pre>
            ) : (
              <p className="font-mono text-xs sm:text-sm text-destructive">
                {findStatusInResponse(errorResponse) || "Unknown error"}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProcessingView;
