// RAG Web Worker — runs Transformers.js embeddings off the main thread.
// Receives messages from the main thread, embeds text, manages an in-memory
// vector store, and returns search results.

import { pipeline, env } from "@huggingface/transformers";

// Use CDN-hosted model weights so no bundling is needed
env.allowLocalModels = false;

// ─── Types (mirrored in src/lib/ragTypes.ts for main-thread use) ──────────────

interface Chunk {
  id: string;
  text: string;
  path: string;
  source: "result" | "document";
  embedding: number[];
}

type WorkerInMessage =
  | { type: "PRELOAD_MODEL" }
  | { type: "INDEX_DATA"; payload: { json: unknown; source: "result" | "document" } }
  | { type: "INDEX_PATCH"; payload: { path: string; value: unknown; source: "result" | "document" } }
  | { type: "SEARCH"; payload: { query: string; topK: number; sources?: Array<"result" | "document"> }; id: string }
  | { type: "CLEAR"; payload: { source: "result" | "document" } }
  | { type: "GET_STATUS"; id: string };

type WorkerOutMessage =
  | { type: "MODEL_READY" }
  | { type: "MODEL_PROGRESS"; payload: { pct: number } }
  | { type: "INDEX_READY"; payload: { source: string; chunks: number } }
  | { type: "SEARCH_RESULT"; payload: { chunks: Chunk[] }; id: string }
  | { type: "STATUS_RESULT"; payload: { sourceCounts: Record<string, number> }; id: string }
  | { type: "ERROR"; payload: { message: string } };

// ─── State ────────────────────────────────────────────────────────────────────

let embedder: Awaited<ReturnType<typeof pipeline>> | null = null;
let modelLoading = false;
const chunks: Chunk[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function post(msg: WorkerOutMessage) {
  self.postMessage(msg);
}

async function getEmbedder() {
  if (embedder) return embedder;
  if (modelLoading) {
    // Wait until loaded
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (embedder) { clearInterval(check); resolve(); }
      }, 100);
    });
    return embedder!;
  }
  modelLoading = true;
  post({ type: "MODEL_PROGRESS", payload: { pct: 0 } });
  embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    progress_callback: (p: unknown) => {
      const pct = Math.round((p as { progress?: number }).progress ?? 0);
      post({ type: "MODEL_PROGRESS", payload: { pct } });
    },
  });
  modelLoading = false;
  post({ type: "MODEL_READY" });
  return embedder;
}

async function embed(text: string): Promise<number[]> {
  const model = await getEmbedder();
  // @ts-expect-error: pipeline output typing is generic
  const output = await model(text, { pooling: "mean", normalize: true });
  // output.data is a Float32Array
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return Array.from(output.data as Float32Array) as number[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
}

// ─── JSON chunker ─────────────────────────────────────────────────────────────

function chunkJson(
  node: unknown,
  source: "result" | "document",
  path = "",
  out: Array<{ path: string; text: string }> = [],
  depth = 0,
): Array<{ path: string; text: string }> {
  if (node === null || node === undefined) return out;

  // Leaf or small object — emit as one chunk
  const json = JSON.stringify(node);
  if (depth > 0 && json.length < 800) {
    out.push({ path: path || "root", text: `${path}: ${json}` });
    return out;
  }

  if (Array.isArray(node)) {
    // Group small items into batches of 5 to avoid too many tiny chunks
    const items = node as unknown[];
    for (let i = 0; i < items.length; i += 5) {
      const slice = items.slice(i, i + 5);
      const slicePath = `${path}[${i}–${Math.min(i + 4, items.length - 1)}]`;
      if (JSON.stringify(slice).length < 1200 || depth > 2) {
        out.push({ path: slicePath, text: `${slicePath}: ${JSON.stringify(slice)}` });
      } else {
        for (let j = i; j < Math.min(i + 5, items.length); j++) {
          chunkJson(items[j], source, `${path}[${j}]`, out, depth + 1);
        }
      }
    }
  } else if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      chunkJson(obj[key], source, path ? `${path}.${key}` : key, out, depth + 1);
    }
  } else {
    out.push({ path: path || "root", text: `${path}: ${String(node)}` });
  }

  return out;
}

function chunkText(text: string, source: "result" | "document"): Array<{ path: string; text: string }> {
  // Split on double newlines (paragraphs), keep chunks ~500 chars
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const result: Array<{ path: string; text: string }> = [];
  let buf = "";
  let idx = 0;
  for (const para of paragraphs) {
    if ((buf + para).length > 600 && buf) {
      result.push({ path: `${source}.para${idx++}`, text: buf.trim() });
      buf = para;
    } else {
      buf = buf ? `${buf}\n\n${para}` : para;
    }
  }
  if (buf) result.push({ path: `${source}.para${idx}`, text: buf.trim() });
  return result;
}

// ─── Indexing ─────────────────────────────────────────────────────────────────

async function indexData(json: unknown, source: "result" | "document") {
  // Remove existing chunks for this source
  clearSource(source);

  const rawChunks =
    typeof json === "string"
      ? chunkText(json, source)
      : chunkJson(json, source);

  for (let i = 0; i < rawChunks.length; i++) {
    const { path, text } = rawChunks[i];
    const embedding = await embed(text);
    chunks.push({ id: `${source}:${path}`, text, path, source, embedding });
  }

  post({ type: "INDEX_READY", payload: { source, chunks: rawChunks.length } });
}

async function patchChunk(path: string, value: unknown, source: "result" | "document") {
  const id = `${source}:${path}`;
  const text = `${path}: ${JSON.stringify(value)}`;
  const embedding = await embed(text);
  const idx = chunks.findIndex((c) => c.id === id);
  const entry: Chunk = { id, text, path, source, embedding };
  if (idx >= 0) chunks[idx] = entry;
  else chunks.push(entry);
}

function clearSource(source: "result" | "document") {
  let i = chunks.length;
  while (i--) {
    if (chunks[i].source === source) chunks.splice(i, 1);
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  try {
    if (msg.type === "PRELOAD_MODEL") {
      await getEmbedder();
    } else if (msg.type === "INDEX_DATA") {
      await indexData(msg.payload.json, msg.payload.source);
    } else if (msg.type === "INDEX_PATCH") {
      await patchChunk(msg.payload.path, msg.payload.value, msg.payload.source);
    } else if (msg.type === "SEARCH") {
      const model = await getEmbedder();
      if (!model) { post({ type: "SEARCH_RESULT", payload: { chunks: [] }, id: msg.id }); return; }
      const qEmbed = await embed(msg.payload.query);
      const pool = msg.payload.sources
        ? chunks.filter((c) => msg.payload.sources!.includes(c.source))
        : chunks;
      const scored = pool
        .map((c) => ({ chunk: c, score: cosine(qEmbed, c.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, msg.payload.topK)
        .map((s) => s.chunk);
      post({ type: "SEARCH_RESULT", payload: { chunks: scored }, id: msg.id });
    } else if (msg.type === "GET_STATUS") {
      const sourceCounts: Record<string, number> = {};
      for (const c of chunks) {
        sourceCounts[c.source] = (sourceCounts[c.source] ?? 0) + 1;
      }
      post({ type: "STATUS_RESULT", payload: { sourceCounts }, id: msg.id });
    } else if (msg.type === "CLEAR") {
      clearSource(msg.payload.source);
    }
  } catch (err) {
    post({ type: "ERROR", payload: { message: String(err) } });
  }
};
