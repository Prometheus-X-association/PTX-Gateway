export interface StoredSourceDocument {
  name: string;
  mimeType: string;
  size: number;
  base64: string;
  storedAt: string;
}

const STORAGE_PREFIX = "ptx_source_documents:";
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

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
    localStorage.removeItem(storageKey(sessionId));
    return [];
  }
  localStorage.setItem(storageKey(sessionId), JSON.stringify(documents));
  return documents;
};

export const loadSourceDocuments = (sessionId?: string | null): StoredSourceDocument[] => {
  if (!sessionId || typeof window === "undefined") return [];
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

export const clearSourceDocuments = (sessionId?: string | null): void => {
  if (!sessionId || typeof window === "undefined") return;
  localStorage.removeItem(storageKey(sessionId));
};
