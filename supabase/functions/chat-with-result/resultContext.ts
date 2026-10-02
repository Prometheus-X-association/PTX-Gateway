const RESULT_CHUNK_SIZE_DEFAULT = 12000;

const serializeResultData = (value: unknown): { text: string; format: "json" | "text" } => {
  if (typeof value === "string") return { text: value, format: "text" };
  const serialized = JSON.stringify(value, null, 2);
  return { text: serialized === undefined ? String(value) : serialized, format: "json" };
};

const findResultNodes = (value: unknown): unknown[] => {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  if (Array.isArray(root.nodes)) return root.nodes;
  const data = root.data;
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).nodes)) {
    return (data as Record<string, unknown>).nodes as unknown[];
  }
  const result = root.result;
  if (result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).nodes)) {
    return (result as Record<string, unknown>).nodes as unknown[];
  }
  return [];
};

export const buildChunkedResultPayload = (value: unknown, requestedChunkSize?: number) => {
  const { text, format } = serializeResultData(value);
  const chunkSize = Math.min(Math.max(Math.round(typeof requestedChunkSize === "number" && Number.isFinite(requestedChunkSize) && requestedChunkSize > 0 ? requestedChunkSize : RESULT_CHUNK_SIZE_DEFAULT), 2000), 50000);
  const chunks: Array<{ index: number; start: number; end: number; text: string }> = [];
  for (let start = 0; start < text.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push({ index: chunks.length + 1, start, end, text: text.slice(start, end) });
  }
  const nodes = findResultNodes(value);
  const nodeIndex = nodes.map((node, index) => {
    const record = node && typeof node === "object" ? node as Record<string, unknown> : {};
    const label = record.label === undefined || record.label === null ? undefined : String(record.label);
    const id = record.id === undefined || record.id === null ? undefined : String(record.id);
    const serializedNode = JSON.stringify(node, null, 2);
    const labelNeedle = label ? `"label": ${JSON.stringify(label)}` : "";
    const idNeedle = id ? `"id": ${JSON.stringify(id)}` : "";
    const position = serializedNode && text.includes(serializedNode)
      ? text.indexOf(serializedNode)
      : labelNeedle && text.includes(labelNeedle)
        ? text.indexOf(labelNeedle)
        : idNeedle && text.includes(idNeedle)
          ? text.indexOf(idNeedle)
          : -1;
    const chunkIndex = position >= 0 ? Math.floor(position / chunkSize) + 1 : undefined;
    return {
      index,
      oneBasedIndex: index + 1,
      id,
      label,
      ...(chunkIndex ? { chunkIndex } : {}),
    };
  }).filter((entry) => entry.id || entry.label);

  return {
    __chunked_result_context: true,
    manifest: {
      format,
      totalChars: text.length,
      totalChunks: chunks.length,
      chunkSize,
      ...(nodeIndex.length > 0 ? {
        nodeCount: nodeIndex.length,
        nodeIndex,
      } : {}),
      instruction: "These chunks are ordered and together form one complete resultData payload. Use nodeIndex as the compact map of resultData nodes, labels, and chunk locations before deciding whether a node or label exists.",
    },
    chunks,
  };
};


interface ChunkedContextPayload {
  manifest?: Record<string, unknown>;
  chunks?: Array<{ index?: number; start?: number; end?: number; text?: string }>;
}

export const formatChunkedResultContext = (payload: ChunkedContextPayload, label = "Result data"): string => {
  const manifest = payload.manifest && typeof payload.manifest === "object" && !Array.isArray(payload.manifest)
    ? payload.manifest
    : {};
  const chunks = Array.isArray(payload.chunks) ? payload.chunks : [];
  const manifestJson = JSON.stringify({
    ...manifest,
    totalChunks: typeof manifest.totalChunks === "number" ? manifest.totalChunks : chunks.length,
  }, null, 2);
  const chunkText = chunks
    .map((chunk, idx) => {
      const index = typeof chunk.index === "number" ? chunk.index : idx + 1;
      const start = typeof chunk.start === "number" ? chunk.start : undefined;
      const end = typeof chunk.end === "number" ? chunk.end : undefined;
      const range = start !== undefined && end !== undefined ? ` chars ${start}-${end}` : "";
      return `### Chunk ${index}/${chunks.length}${range}\n${String(chunk.text ?? "")}`;
    })
    .join("\n\n");

  return [
    `\n## ${label} (chunked)`,
    label === "Uploaded document"
    ? "The manifest describes one complete uploaded document split into ordered chunks. Read the chunks in order as one document; chunk boundaries may fall within a sentence or word."
    : "The manifest describes one complete resultData payload split into ordered chunks. Treat every chunk below as part of the same dataset.",
    "If the manifest includes nodeIndex, use it as the compact authoritative index of resultData nodes and labels. For label or index lookup questions, check nodeIndex first, then inspect the referenced chunk if more detail is needed. Do not say a label is unavailable until both nodeIndex and the ordered chunks have been checked.",
    "",
    "### Manifest",
    manifestJson,
    "",
    "### Ordered chunks",
    chunkText || "(no chunks supplied)",
  ].join("\n");
};


/** Preserve ordinary document limits unless the workflow opts into complete ordered chunks. */
export const formatUploadedDocumentContext = (
  docText: string,
  mode: "full" | "chunked",
  chunkSize?: number,
): string => {
  if (mode === "chunked") {
    const payload = buildChunkedResultPayload(docText, chunkSize);
    payload.manifest.instruction = "These chunks are ordered and together form one complete uploaded document. Use all chunks as the document source; preserve exact wording for evidence and quotations.";
    return formatChunkedResultContext(payload, "Uploaded document");
  }
  const clipped = docText.length > 30000 ? `${docText.slice(0, 30000)}\n...<truncated>` : docText;
  return `\nUploaded document:\n${clipped}`;
};
