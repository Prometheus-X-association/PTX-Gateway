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

