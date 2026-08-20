// Persist uploaded/selected document content in localStorage so it can be
// re-indexed into the browser RAG worker when the result page is opened directly
// (without going through the full DataSelection → Processing flow again).
//
// Key is derived from the BASE result URL (no per-session query params) + method + orgId,
// so it stays stable across re-runs of the same analytics on the same data source.

import type { ResultUrlInfo } from "./resultUrlResolver";

const PREFIX = "ptx_rag_doc_v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface StoredRagDoc {
  savedAt: string;
  content: string;
}

function simpleHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function buildRagDocStorageKey(
  resultUrlInfo: ResultUrlInfo | null | undefined,
  organizationId?: string | null,
): string | null {
  if (!resultUrlInfo?.url) return null;
  const identity = JSON.stringify({
    url: resultUrlInfo.url,   // base URL — stable across sessions
    method: resultUrlInfo.method,
    organizationId: organizationId || "",
  });
  return `${PREFIX}:${simpleHash(identity)}`;
}

export function saveRagDocToStorage(key: string, content: string): void {
  try {
    const record: StoredRagDoc = { savedAt: new Date().toISOString(), content };
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Storage quota exceeded — silently skip
  }
}

export function loadRagDocFromStorage(key: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw) as StoredRagDoc;
    if (Date.now() - new Date(record.savedAt).getTime() > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return record.content;
  } catch {
    return null;
  }
}
