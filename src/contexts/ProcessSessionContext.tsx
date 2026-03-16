import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from "react";
import { sanitizeParams, resolveParamValue } from "@/utils/paramSanitizer";

const PROCESS_SESSION_STORAGE_KEY = "ptx_active_process_session_id";

interface ProcessSessionContextType {
  sessionId: string;
  resolveParamValue: (value: string) => string;
  resolveParams: (params: Record<string, string>) => Record<string, string>;
  sanitizeParams: (params: Record<string, string>) => Record<string, string>;
  resetSession: () => string;
}

const ProcessSessionContext = createContext<ProcessSessionContextType | null>(null);

// Generate a unique session ID
const generateSessionId = (): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `session_${timestamp}_${random}`;
};

interface ProcessSessionProviderProps {
  children: ReactNode;
}

export const ProcessSessionProvider: React.FC<ProcessSessionProviderProps> = ({ children }) => {
  const [sessionId, setSessionId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const existing = localStorage.getItem(PROCESS_SESSION_STORAGE_KEY);
    if (existing) return existing;

    const initial = generateSessionId();
    localStorage.setItem(PROCESS_SESSION_STORAGE_KEY, initial);
    return initial;
  });

  const setAndPersistSessionId = useCallback((newSessionId: string) => {
    setSessionId(newSessionId);
    if (typeof window !== "undefined") {
      localStorage.setItem(PROCESS_SESSION_STORAGE_KEY, newSessionId);
    }
  }, []);

  // Resolve special placeholder values in parameters (only #genSessionId)
  const resolveValue = useCallback((value: string): string => {
    return resolveParamValue(value, sessionId);
  }, [sessionId]);

  // Resolve all parameters in a record (only #genSessionId, keeps #ignoreParam)
  const resolveParams = useCallback((params: Record<string, string>): Record<string, string> => {
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      resolved[key] = resolveValue(value);
    }
    return resolved;
  }, [resolveValue]);

  // Sanitize params - removes #ignoreParam AND resolves #genSessionId
  const sanitize = useCallback((params: Record<string, string>): Record<string, string> => {
    return sanitizeParams(params, sessionId);
  }, [sessionId]);

  // Reset session (generates a new session ID)
  const resetSession = useCallback(() => {
    const newSessionId = generateSessionId();
    setAndPersistSessionId(newSessionId);
    return newSessionId;
  }, [setAndPersistSessionId]);

  const value = useMemo(() => ({
    sessionId,
    resolveParamValue: resolveValue,
    resolveParams,
    sanitizeParams: sanitize,
    resetSession,
  }), [sessionId, resolveValue, resolveParams, sanitize, resetSession]);

  return (
    <ProcessSessionContext.Provider value={value}>
      {children}
    </ProcessSessionContext.Provider>
  );
};

export const useProcessSession = (): ProcessSessionContextType => {
  const context = useContext(ProcessSessionContext);
  if (!context) {
    throw new Error("useProcessSession must be used within a ProcessSessionProvider");
  }
  return context;
};

export default ProcessSessionContext;
