export interface StoredSourceDocument {
  name: string;
  mimeType: string;
  size: number;
  base64: string;
  storedAt: string;
}

interface SourceDocumentRecord {
  sessionId: string;
  documents: StoredSourceDocument[];
  savedAt: string;
}

const STORAGE_PREFIX = "ptx_source_documents:";
const DB_NAME = "ptx-source-documents";
const STORE_NAME = "documents";
const DB_VERSION = 1;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const inferMimeType = (file: File): string => {
  if (file.type) return file.type;
  const extension = file.name.toLowerCase().split(".").pop();
  return ({
    pdf: "application/pdf", txt: "text/plain", md: "text/markdown", markdown: "text/markdown",
    csv: "text/csv", json: "application/json", jsonl: "application/x-ndjson", xml: "application/xml",
    html: "text/html", htm: "text/html", yaml: "application/yaml", yml: "application/yaml",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  } as Record<string, string>)[extension || ""] || "application/octet-stream";
};

const storageKey = (sessionId: string) => `${STORAGE_PREFIX}${sessionId}`;

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const value = String(reader.result || "");
    resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
  };
  reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`));
  reader.readAsDataURL(file);
});

const openSourceDocumentDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (typeof indexedDB === "undefined") {
    reject(new Error("IndexedDB is unavailable"));
    return;
  }

  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: "sessionId" });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("Could not open source document storage"));
});

const runStoreRequest = <T>(
  mode: IDBTransactionMode,
  buildRequest: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => openSourceDocumentDb().then((db) => new Promise<T>((resolve, reject) => {
  let result: T;
  let settled = false;
  const settleReject = (error: unknown) => {
    if (settled) return;
    settled = true;
    reject(error);
  };
  const transaction = db.transaction(STORE_NAME, mode);
  const request = buildRequest(transaction.objectStore(STORE_NAME));
  request.onsuccess = () => { result = request.result; };
  request.onerror = () => settleReject(request.error || transaction.error || new Error("Source document storage failed"));
  transaction.oncomplete = () => {
    db.close();
    if (settled) return;
    settled = true;
    resolve(result);
  };
  transaction.onabort = () => {
    db.close();
    settleReject(transaction.error || new Error("Source document storage transaction aborted"));
  };
  transaction.onerror = () => {
    db.close();
    settleReject(transaction.error || new Error("Source document storage transaction failed"));
  };
}));

const putRecord = (record: SourceDocumentRecord): Promise<IDBValidKey> => runStoreRequest("readwrite", (store) => store.put(record));
const getRecord = (sessionId: string): Promise<SourceDocumentRecord | undefined> => runStoreRequest("readonly", (store) => store.get(sessionId));
const deleteRecord = (sessionId: string): Promise<undefined> => runStoreRequest("readwrite", (store) => store.delete(sessionId));
const clearIndexedDbRecords = (): Promise<undefined> => runStoreRequest("readwrite", (store) => store.clear());

const pruneOldIndexedDbRecords = async (): Promise<void> => {
  try {
    const db = await openSourceDocumentDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const record = cursor.value as Partial<SourceDocumentRecord>;
        const savedAt = record.savedAt || record.documents?.[0]?.storedAt;
        if (savedAt && Date.now() - new Date(savedAt).getTime() > MAX_AGE_MS) {
          cursor.delete();
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error("Could not prune old source documents"));
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error || new Error("Source document pruning aborted"));
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error("Source document pruning failed"));
      };
    });
  } catch {
    // Pruning is opportunistic; never block upload or chat restore on it.
  }
};

const loadLegacyDocuments = (sessionId: string): StoredSourceDocument[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(sessionId)) || "[]") as StoredSourceDocument[];
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.name === "string" && typeof item.base64 === "string" && item.base64.length > 0)
      : [];
  } catch {
    localStorage.removeItem(storageKey(sessionId));
    return [];
  }
};

const clearOldLegacyEntries = (): void => {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Ignore unavailable localStorage.
  }
};

const saveLegacyDocuments = (sessionId: string, documents: StoredSourceDocument[]): void => {
  localStorage.setItem(storageKey(sessionId), JSON.stringify(documents));
};

export const saveSourceDocuments = async (sessionId: string, files: File[]): Promise<StoredSourceDocument[]> => {
  if (!sessionId || typeof window === "undefined") return [];
  const supported = files.filter((file) => file.size <= MAX_DOCUMENT_BYTES);
  const documents = await Promise.all(supported.map(async (file) => ({
    name: file.name,
    mimeType: inferMimeType(file),
    size: file.size,
    base64: await fileToBase64(file),
    storedAt: new Date().toISOString(),
  })));
  if (documents.length === 0) {
    await clearSourceDocuments(sessionId);
    return [];
  }

  const record: SourceDocumentRecord = {
    sessionId,
    documents,
    savedAt: new Date().toISOString(),
  };

  try {
    await putRecord(record);
    clearOldLegacyEntries();
    void pruneOldIndexedDbRecords();
  } catch (indexedDbError) {
    try {
      saveLegacyDocuments(sessionId, documents);
    } catch {
      throw indexedDbError;
    }
  }

  return documents;
};

export const loadSourceDocuments = async (sessionId?: string | null): Promise<StoredSourceDocument[]> => {
  if (!sessionId || typeof window === "undefined") return [];
  try {
    const record = await getRecord(sessionId);
    if (record?.savedAt && Date.now() - new Date(record.savedAt).getTime() > MAX_AGE_MS) {
      await deleteRecord(sessionId);
      return [];
    }
    if (Array.isArray(record?.documents)) {
      return record.documents.filter((item) => item && typeof item.name === "string" && typeof item.base64 === "string" && item.base64.length > 0);
    }
  } catch {
    // Fall through to legacy localStorage for older sessions or browsers without IndexedDB.
  }

  const legacyDocuments = loadLegacyDocuments(sessionId);
  if (legacyDocuments.length > 0) {
    try {
      await putRecord({ sessionId, documents: legacyDocuments, savedAt: new Date().toISOString() });
      localStorage.removeItem(storageKey(sessionId));
    } catch {
      // Keep the legacy copy if migration cannot complete.
    }
  }
  return legacyDocuments;
};

export const clearSourceDocuments = async (sessionId?: string | null): Promise<void> => {
  if (!sessionId || typeof window === "undefined") return;
  try {
    await deleteRecord(sessionId);
  } catch {
    // Ignore unavailable IndexedDB.
  }
  try {
    localStorage.removeItem(storageKey(sessionId));
  } catch {
    // Ignore unavailable localStorage.
  }
};

export const clearAllSourceDocuments = async (): Promise<void> => {
  if (typeof window === "undefined") return;
  try {
    await clearIndexedDbRecords();
  } catch {
    // Ignore unavailable IndexedDB.
  }
  clearOldLegacyEntries();
};
