// Hook that manages the RAG Web Worker lifecycle.
// - Create the worker once at the OrgGateway level
// - Fire PRELOAD_MODEL during the Processing step (model loads while API works)
// - Fire INDEX_DATA when result JSON arrives
// - Expose search() for ChatDrawer to call

import { useRef, useState, useCallback, useEffect } from "react";

export type RagStatus =
  | "idle"
  | "loading_model"
  | "model_ready"
  | "indexing"
  | "ready"
  | "syncing"
  | "error";

export interface RagChunk {
  id: string;
  text: string;
  path: string;
  source: "result" | "document";
}

interface PendingSearch {
  resolve: (chunks: RagChunk[]) => void;
  reject: (e: Error) => void;
}

export interface RagWorkerHandle {
  status: RagStatus;
  chunkCount: number;
  sourceCounts: Record<string, number>;
  preloadModel: () => void;
  indexData: (json: unknown, source: "result" | "document") => void;
  patchChunk: (path: string, value: unknown, source: "result" | "document") => void;
  search: (query: string, topK?: number, sources?: Array<"result" | "document">) => Promise<RagChunk[]>;
  getStatus: () => Promise<Record<string, number>>;
  clearSource: (source: "result" | "document") => void;
}

export function useRagWorker(): RagWorkerHandle {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<string, PendingSearch>>(new Map());
  const [status, setStatus] = useState<RagStatus>("idle");
  const [chunkCount, setChunkCount] = useState(0);
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({});
  // Debounce timer for syncing status
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create worker once on mount
  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/ragWorker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as {
        type: string;
        payload?: Record<string, unknown>;
        id?: string;
      };

      if (msg.type === "MODEL_PROGRESS") {
        setStatus("loading_model");
      } else if (msg.type === "MODEL_READY") {
        setStatus("model_ready");
      } else if (msg.type === "INDEX_READY") {
        const n = (msg.payload?.chunks as number) ?? 0;
        const src = msg.payload?.source as string;
        setChunkCount((prev) => prev + n);
        setSourceCounts((prev) => ({ ...prev, [src]: n }));
        setStatus("ready");
      } else if (msg.type === "SEARCH_RESULT") {
        const id = msg.id as string;
        const pending = pendingRef.current.get(id);
        if (pending) {
          pending.resolve((msg.payload?.chunks as RagChunk[]) ?? []);
          pendingRef.current.delete(id);
        }
      } else if (msg.type === "STATUS_RESULT") {
        const id = msg.id as string;
        const pending = pendingRef.current.get(id);
        if (pending) {
          pending.resolve(msg.payload?.sourceCounts as unknown as RagChunk[]);
          pendingRef.current.delete(id);
        }
      } else if (msg.type === "ERROR") {
        console.error("[RAG Worker]", msg.payload?.message);
        setStatus("error");
        // Reject any pending searches
        for (const p of pendingRef.current.values()) {
          p.reject(new Error(String(msg.payload?.message)));
        }
        pendingRef.current.clear();
      }
    };

    worker.onerror = (e) => {
      console.error("[RAG Worker error]", e);
      setStatus("error");
    };

    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const preloadModel = useCallback(() => {
    if (!workerRef.current) return;
    if (status === "idle" || status === "error") {
      setStatus("loading_model");
      workerRef.current.postMessage({ type: "PRELOAD_MODEL" });
    }
  }, [status]);

  const indexData = useCallback((json: unknown, source: "result" | "document") => {
    if (!workerRef.current) return;
    setStatus("indexing");
    setChunkCount(0);
    workerRef.current.postMessage({ type: "INDEX_DATA", payload: { json, source } });
  }, []);

  const patchChunk = useCallback((path: string, value: unknown, source: "result" | "document") => {
    if (!workerRef.current) return;
    // Show syncing indicator briefly
    if (syncTimer.current) clearTimeout(syncTimer.current);
    setStatus("syncing");
    workerRef.current.postMessage({ type: "INDEX_PATCH", payload: { path, value, source } });
    syncTimer.current = setTimeout(() => setStatus("ready"), 2000);
  }, []);

  const search = useCallback((
    query: string,
    topK = 6,
    sources?: Array<"result" | "document">,
  ): Promise<RagChunk[]> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current || status === "idle" || status === "loading_model" || status === "indexing") {
        resolve([]); // Not ready — fall back to full-context injection
        return;
      }
      const id = Math.random().toString(36).slice(2);
      pendingRef.current.set(id, { resolve, reject });
      workerRef.current.postMessage({ type: "SEARCH", payload: { query, topK, sources }, id });
    });
  }, [status]);

  const getStatus = useCallback((): Promise<Record<string, number>> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) { resolve({}); return; }
      const id = Math.random().toString(36).slice(2);
      // Reuse PendingSearch but resolve returns sourceCounts cast via unknown
      pendingRef.current.set(id, {
        resolve: (v) => resolve(v as unknown as Record<string, number>),
        reject,
      });
      workerRef.current.postMessage({ type: "GET_STATUS", id });
    });
  }, []);

  const clearSource = useCallback((source: "result" | "document") => {
    workerRef.current?.postMessage({ type: "CLEAR", payload: { source } });
  }, []);

  return { status, chunkCount, sourceCounts, preloadModel, indexData, patchChunk, search, getStatus, clearSource };
}
