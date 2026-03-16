import { useState, useCallback } from "react";
import { sanitizeParams, resolveParamValue } from "@/utils/paramSanitizer";

// Process Session Hook
// Manages a unique session ID for each analytics process
// This ID is used to replace #genSessionId placeholders in query parameters

export const useProcessSession = () => {
  // Generate a unique session ID for this process
  const [sessionId] = useState<string>(() => {
    // Generate a UUID-like session ID
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `session_${timestamp}_${random}`;
  });

  // Resolve special placeholder values in parameters (only #genSessionId)
  const resolveValue = useCallback((value: string): string => {
    return resolveParamValue(value, sessionId);
  }, [sessionId]);

  // Resolve all parameters in a record (only resolves, doesn't filter)
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

  return {
    sessionId,
    resolveParamValue: resolveValue,
    resolveParams,
    sanitizeParams: sanitize,
  };
};

export default useProcessSession;
