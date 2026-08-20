import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, MessageSquareDot, Loader2, Wrench, Zap, Bot, ChevronDown, MessageCircle, Maximize2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import type { RagWorkerHandle } from "@/lib/useRagWorker";
import type { UploadConfig } from "@/components/DocumentUploadZone";

// ─── Types ────────────────────────────────────────────────────────────────────

type MessageRole = "user" | "assistant";

interface ToolEvent {
  name: string;
  result?: string;
}

interface ChatMessageData {
  id: string;
  role: MessageRole;
  content: string;
  htmlViz?: string;
  jsonData?: Record<string, unknown>;
  toolEvents?: ToolEvent[];
  streaming?: boolean;
}

interface SSEEvent {
  type: "token" | "tool_call" | "tool_result" | "done" | "error";
  content?: string;
  name?: string;
  result?: string;
  message?: string;
}

export interface LlmAgentInfo {
  id: string;
  name: string;
  description: string;
  expectedOutput: string;
  defaultPrompts: string[];
  ragSources?: "all" | "result" | "document" | "none";
  ragMode?: "auto" | "chunks" | "none";
  ragTopK?: number;
}

interface ChatDrawerProps {
  resultData: unknown;
  organizationId?: string | null;
  orgExecutionToken?: string | null;
  agents?: LlmAgentInfo[];
  globalPrompts?: string[];
  enabled?: boolean;
  isOpen: boolean;
  onClose: () => void;
  rag?: RagWorkerHandle;
  /** Full raw document text (from upload/selection) for "auto" and full-doc delivery */
  docText?: string | null;
  /** Upload config from the selected data resource — enables the paperclip attachment button */
  uploadConfig?: UploadConfig | null;
  /** Called after a successful in-chat file upload so the parent can persist the extracted text */
  onDocUploaded?: (text: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2);

// Tags that mark the start of an HTML/chart block
const HTML_START_RE = /<(div|script|svg|canvas|html|body|table|thead|tbody|tr|th|td|ul|ol|section|article|figure|form|h[1-6])\b/i;

const extractFencedHtml = (text: string): { prose: string; html: string } | null => {
  // Match ```html ... ``` or ``` ... ``` where content looks like HTML
  const m = text.match(/```(?:html)?\s*\r?\n?([\s\S]*?)```/i);
  if (!m) return null;
  const inner = m[1].trim();
  if (!HTML_START_RE.test(inner)) return null;
  const fenceStart = text.indexOf(m[0]);
  return { prose: text.slice(0, fenceStart).trim(), html: inner };
};

const splitHtmlViz = (text: string): { prose: string; html: string | null } => {
  const fenced = extractFencedHtml(text);
  if (fenced) return { prose: fenced.prose, html: fenced.html };

  // Find first HTML-ish tag
  const match = HTML_START_RE.exec(text);
  if (!match || match.index === undefined) return { prose: text, html: null };
  return {
    prose: text.slice(0, match.index).trim(),
    html: text.slice(match.index).trim(),
  };
};

// Strip ```json ... ``` fences and parse JSON safely
const parseJsonResponse = (text: string): Record<string, unknown> | null => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : text).trim();
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
};

// Route the finished LLM response to { prose, html, json } based on agent output type.
// HTML is ALWAYS detected regardless of agent type — any response containing an HTML/SVG
// block is rendered as a visualization instead of escaped script text.
const routeResponse = (
  text: string,
  outputFormat: string,
): { prose: string; html: string | null; json: Record<string, unknown> | null } => {
  const trimmed = text.trim();

  if (outputFormat === "json") {
    const json = parseJsonResponse(trimmed);
    return { prose: json ? "" : trimmed, html: null, json };
  }

  if (outputFormat === "html") {
    const { prose, html } = splitHtmlViz(trimmed);
    // html agent always produces html — if detection missed, treat entire response as html
    if (!html && trimmed.length > 0) return { prose: "", html: trimmed, json: null };
    return { prose, html, json: null };
  }

  // For mixed, text, or any other format — always try to split out an HTML block.
  // This ensures that visualizations returned by any agent (including free chat) are
  // rendered as iframes rather than escaped code text.
  const { prose, html } = splitHtmlViz(trimmed);
  return { prose, html, json: null };
};

const renderMarkdown = (md: string): string =>
  md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code style="background:rgba(0,0,0,.08);padding:1px 4px;border-radius:3px">$1</code>')
    .replace(/^### (.+)$/gm, "<h3 style='font-weight:700;margin:8px 0 4px'>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2 style='font-weight:700;margin:10px 0 4px'>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1 style='font-weight:700;margin:12px 0 4px'>$1</h1>")
    .replace(/^\s*[-*]\s+(.+)$/gm, "<li style='margin-left:16px;list-style:disc'>$1</li>")
    .replace(/^\s*\d+\.\s+(.+)$/gm, "<li style='margin-left:16px;list-style:decimal'>$1</li>")
    .replace(/\n\n/g, "</p><p style='margin:6px 0'>")
    .replace(/\n/g, "<br>")
    .replace(/^/, "<p style='margin:0'>")
    .replace(/$/, "</p>");

const OUTPUT_LABELS: Record<string, string> = {
  text: "Text",
  echarts: "Chart",
  table: "Table",
  mixed: "Mixed",
};

// ─── VizBubble ────────────────────────────────────────────────────────────────

const buildSrcdoc = (innerHtml: string) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:4px;background:transparent;overflow:hidden}
  div[id]{width:100%!important;height:380px!important}
</style>
</head>
<body>${innerHtml}</body>
</html>`;

const VizBubble = ({ html }: { html: string }) => {
  const [expanded, setExpanded] = useState(false);
  // Floating window position (top-left corner)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 700, h: 480 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Centre on first open
  const handleExpand = () => {
    if (!pos) {
      setPos({
        x: Math.max(24, (window.innerWidth - size.w) / 2),
        y: Math.max(24, (window.innerHeight - size.h) / 2),
      });
    }
    setExpanded(true);
  };

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos!.x, origY: pos!.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - size.w, dragRef.current.origX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - size.h, dragRef.current.origY + dy)),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <>
      <div className="relative mt-2 rounded-xl overflow-hidden border border-border group">
        <iframe
          srcDoc={buildSrcdoc(html)}
          sandbox="allow-scripts"
          style={{ width: "100%", height: 380, border: "none", display: "block" }}
          title="AI Visualization"
        />
        <button
          onClick={handleExpand}
          className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 backdrop-blur-sm border border-border shadow-sm text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          title="Expand visualization"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {expanded && pos && (
        <div
          ref={panelRef}
          className="fixed flex flex-col bg-background border border-border rounded-2xl shadow-2xl overflow-hidden"
          style={{ left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: 999999, minWidth: 320, minHeight: 260 }}
        >
          {/* Drag handle / title bar */}
          <div
            className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/50 shrink-0 cursor-grab active:cursor-grabbing select-none"
            onMouseDown={onDragStart}
          >
            <span className="text-sm font-semibold text-foreground">AI Visualization</span>
            <div className="flex items-center gap-1">
              {/* Size presets */}
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setSize({ w: 520, h: 380 })}
                className="text-[10px] px-2 py-0.5 rounded hover:bg-background transition-colors text-muted-foreground"
                title="Small"
              >S</button>
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setSize({ w: 700, h: 480 })}
                className="text-[10px] px-2 py-0.5 rounded hover:bg-background transition-colors text-muted-foreground"
                title="Medium"
              >M</button>
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setSize({ w: 960, h: 640 })}
                className="text-[10px] px-2 py-0.5 rounded hover:bg-background transition-colors text-muted-foreground"
                title="Large"
              >L</button>
              <div className="w-px h-3 bg-border mx-1" />
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setExpanded(false)}
                className="p-1 rounded hover:bg-background transition-colors text-muted-foreground hover:text-foreground"
                title="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Content — scrollable wrapper around the iframe */}
          <div className="flex-1 overflow-auto min-h-0 bg-background">
            <iframe
              srcDoc={buildSrcdoc(html)}
              sandbox="allow-scripts"
              style={{ width: "100%", height: "100%", border: "none", display: "block" }}
              title="AI Visualization (Expanded)"
            />
          </div>

          {/* Drag hint */}
          <div className="px-3 py-1 border-t border-border bg-muted/30 shrink-0 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground/60">Drag title bar to move</span>
          </div>
        </div>
      )}
    </>
  );
};

// ─── JsonBubble ───────────────────────────────────────────────────────────────

const JsonBubble = ({ data }: { data: Record<string, unknown> }) => {
  const summary = typeof data.summary === "string" ? data.summary : null;
  const insights = Array.isArray(data.insights)
    ? (data.insights as unknown[]).filter((x): x is string => typeof x === "string")
    : null;
  const hasKnownKeys = summary || insights;

  return (
    <div className="mt-2 space-y-2 text-sm">
      {summary && (
        <p className="leading-relaxed">{summary}</p>
      )}
      {insights && insights.length > 0 && (
        <ul className="space-y-1 pl-1">
          {insights.map((ins, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed">
              <span className="text-primary font-bold shrink-0 mt-0.5">·</span>
              <span>{ins}</span>
            </li>
          ))}
        </ul>
      )}
      {!hasKnownKeys && (
        <pre className="text-[10px] font-mono bg-background/40 rounded-md p-2 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
      {hasKnownKeys && Object.keys(data).some((k) => k !== "summary" && k !== "insights") && (
        <details className="text-[10px]">
          <summary className="cursor-pointer text-muted-foreground/70 hover:text-muted-foreground select-none">
            Raw JSON
          </summary>
          <pre className="mt-1 font-mono bg-background/40 rounded-md p-2 overflow-x-auto whitespace-pre-wrap text-muted-foreground">
            {JSON.stringify(data, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
};

// ─── ChatMessageBubble ────────────────────────────────────────────────────────

const ChatMessageBubble = ({ msg, outputFormat }: { msg: ChatMessageData; outputFormat?: string }) => {
  const isUser = msg.role === "user";
  const isVisualAgent = outputFormat === "html" || outputFormat === "mixed" || outputFormat === "json";

  // During streaming for visual agents, don't dump raw HTML/JSON as text —
  // show a spinner with a label instead and let the final routeResponse handle rendering
  const streamingVisual = msg.streaming && isVisualAgent;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted text-foreground rounded-tl-sm"
        }`}
      >
        {msg.toolEvents && msg.toolEvents.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2 opacity-70">
            {msg.toolEvents.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[10px] bg-background/30 rounded-full px-2 py-0.5">
                <Wrench className="h-2.5 w-2.5" />
                {t.name.split("__").pop()}
              </span>
            ))}
          </div>
        )}

        {(msg.streaming && !msg.content) || streamingVisual
          ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {outputFormat === "html" ? "Generating chart…"
                : outputFormat === "json" ? "Generating structured data…"
                : outputFormat === "mixed" ? "Generating analysis…"
                : "Thinking…"}
            </span>
          )
          : msg.jsonData
            ? <JsonBubble data={msg.jsonData} />
            : msg.content
              ? <div className="prose-sm break-words" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
              : null
        }
        {msg.htmlViz && <VizBubble html={msg.htmlViz} />}
      </div>
    </div>
  );
};

// ─── Fallback prompts ─────────────────────────────────────────────────────────

const FALLBACK_PROMPTS = [
  "Generate a complete AI insight with visualization for this data",
  "Summarize the key findings in 3 bullet points",
  "Which item has the highest value and why might that be?",
  "Show me a bar chart of the top 10 results",
  "Are there any outliers or anomalies in this data?",
  "What trends do you see?",
];

// ─── Main Component ───────────────────────────────────────────────────────────

const DOC_FULL_LIMIT = 30_000; // chars — below this, send full document text

const ChatDrawer = ({
  resultData,
  organizationId,
  orgExecutionToken,
  agents = [],
  globalPrompts = [],
  enabled = true,
  isOpen,
  onClose,
  rag,
  docText: propDocText,
  uploadConfig,
  onDocUploaded,
}: ChatDrawerProps) => {
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);   // bottom picker (/ command)
  const [showHeaderAgentPicker, setShowHeaderAgentPicker] = useState(false); // top badge picker
  const [activeAgentId, setActiveAgentId] = useState<string>("__free__");
  // Local doc text overrides prop when the user uploads a file directly from the chatbox
  const [localDocText, setLocalDocText] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showDocPopover, setShowDocPopover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Suppresses the onFocus prompt-show when focus is triggered programmatically (e.g. after agent switch)
  const suppressPromptsOnFocusRef = useRef(false);

  const isFreeChatMode = activeAgentId === "__free__";
  const activeAgent = isFreeChatMode ? null : (agents.find((a) => a.id === activeAgentId) ?? agents[0] ?? null);

  // In-chat upload overrides prop doc text
  const docText = localDocText ?? propDocText ?? null;

  // Stable ref to rag so sendMessage doesn't need rag in its dep array
  // (rag.status changes frequently; adding it would recreate sendMessage on every tick)
  const ragRef = useRef(rag);
  useEffect(() => { ragRef.current = rag; }, [rag]);

  const handleFileAttach = useCallback(async (file: File) => {
    if (!uploadConfig) return;
    setIsUploading(true);

    const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-proxy`;
    const formData = new FormData();
    formData.append("file", file);
    Object.entries(uploadConfig.queryParams || {}).forEach(([k, v]) => { if (v) formData.append(k, v); });

    try {
      const resp = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "x-upload-url": uploadConfig.uploadUrl,
          "x-upload-authorization": uploadConfig.authorization || "",
        },
        body: formData,
      });
      const text = await resp.text();
      let result: Record<string, unknown> = {};
      try { result = text ? JSON.parse(text) : {}; } catch { result = { raw: text }; }

      const status = typeof result.status === "number" ? result.status : (resp.ok ? 200 : 500);
      if (resp.ok && status >= 200 && status < 300) {
        const extracted = typeof result.body === "string" ? result.body : JSON.stringify(result.body ?? result);
        if (extracted) {
          setLocalDocText(extracted);
          ragRef.current?.indexData(extracted, "document");
          onDocUploaded?.(extracted);
          // Post a system-style assistant message confirming the upload
          setMessages((prev) => [
            ...prev,
            {
              id: uid(),
              role: "assistant",
              content: `Document **"${file.name}"** attached (${Math.round(file.size / 1024)} KB). You can now ask questions about it.`,
            },
          ]);
        }
      } else {
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: "assistant", content: `Upload failed: ${result.error ?? result.message ?? "unknown error"}` },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "assistant", content: `Upload error: ${err instanceof Error ? err.message : String(err)}` },
      ]);
    } finally {
      setIsUploading(false);
    }
  }, [uploadConfig, onDocUploaded]);

  // One entry per agent: agent name + its top (first) prompt
  const agentMenuItems = agents
    .filter((a) => a.defaultPrompts.length > 0)
    .map((a) => ({ agent: a, topPrompt: a.defaultPrompts[0] }));

  // Flat fallback when no agents have prompts
  const fallbackPrompts = FALLBACK_PROMPTS;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen) {
      // Scroll to the latest message instantly (no animation — user is re-opening, not watching a new message arrive)
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
        inputRef.current?.focus();
      }, 80);
    }
  }, [isOpen]);

  // Close both agent pickers when clicking outside
  useEffect(() => {
    if (!showAgentPicker && !showHeaderAgentPicker) return;
    const close = () => { setShowAgentPicker(false); setShowHeaderAgentPicker(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showAgentPicker, showHeaderAgentPicker]);

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
    };
    if (organizationId) headers["x-organization-id"] = organizationId;
    return headers;
  }, [organizationId]);

  const sendMessage = useCallback(
    async (text: string, overrideAgentId?: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;
      setInput("");
      setShowPrompts(false);
      setShowAgentPicker(false);
      setShowHeaderAgentPicker(false);

      // "__free__" means no agent — send without agentId so backend uses generic LLM
      const resolvedId = overrideAgentId ?? activeAgentId ?? undefined;
      const agentId = resolvedId === "__free__" ? undefined : resolvedId;

      const userMsg: ChatMessageData = { id: uid(), role: "user", content: trimmed };
      const assistantId = uid();
      const assistantMsg: ChatMessageData = { id: assistantId, role: "assistant", content: "", streaming: true, toolEvents: [] };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);
      abortRef.current = new AbortController();

      try {
        const historyForApi = [...messages, userMsg]
          .filter((m) => !m.streaming)
          .map((m) => ({ role: m.role, content: m.content }));

        // Result data is always sent in full.
        // Document context strategy depends on the agent's ragMode setting:
        //   "auto"   → send full doc text if < 30K chars, otherwise fall back to RAG chunks
        //   "chunks" → always use RAG semantic search (for very large documents)
        //   "none"   → no document context
        const currentRag = ragRef.current;
        const ragReady = currentRag && (currentRag.status === "ready" || currentRag.status === "syncing");
        const resolvedAgent = isFreeChatMode ? null : (agents.find((a) => a.id === (overrideAgentId ?? activeAgentId)) ?? agents[0] ?? null);
        const ragMode = isFreeChatMode ? "auto" : (resolvedAgent?.ragMode ?? "auto");

        let contextPayload: unknown = resultData;

        if (ragMode !== "none" && docText) {
          const useFullDoc = ragMode === "auto" && docText.length <= DOC_FULL_LIMIT;
          if (useFullDoc) {
            // Small doc — send full text directly, most reliable for cross-referencing
            contextPayload = {
              __doc_context: true,
              result: resultData,
              docText,
            };
          } else if (ragReady) {
            // Large doc or explicit chunks mode — use RAG search
            const topK = resolvedAgent?.ragTopK ?? 20;
            const chunks = await currentRag.search(trimmed, topK, ["document"]);
            if (chunks.length > 0) {
              contextPayload = {
                __doc_context: true,
                result: resultData,
                docChunks: chunks.map((c) => ({ path: c.path, text: c.text })),
              };
            }
          }
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        const baseHeaders = getAuthHeaders();
        if (token) baseHeaders["Authorization"] = `Bearer ${token}`;

        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-with-result`,
          {
            method: "POST",
            headers: baseHeaders,
            signal: abortRef.current.signal,
            body: JSON.stringify({
              messages: historyForApi,
              result: contextPayload,
              org_execution_token: orgExecutionToken || undefined,
              agentId,
            }),
          }
        );

        if (!resp.ok || !resp.body) {
          throw new Error(await resp.text().catch(() => "Unknown error"));
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accText = "";
        const toolEvents: ToolEvent[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            let event: SSEEvent;
            try { event = JSON.parse(line.slice(5).trim()) as SSEEvent; } catch { continue; }

            if (event.type === "token" && event.content) {
              accText += event.content;
              setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: accText } : m));
            } else if (event.type === "tool_call" && event.name) {
              toolEvents.push({ name: event.name });
              setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, toolEvents: [...toolEvents] } : m));
            } else if (event.type === "tool_result" && event.name) {
              const idx = toolEvents.findLastIndex((t) => t.name === event.name && !t.result);
              if (idx >= 0) toolEvents[idx].result = event.result;
            } else if (event.type === "error") {
              accText += `\n\n*Error: ${event.message}*`;
            }
          }
        }

        const activeAgent = agents.find((a) => a.id === activeAgentId);
        const isFreeChat = activeAgentId === "__free__";
        const { prose, html, json } = routeResponse(accText, isFreeChat ? "mixed" : (activeAgent?.expectedOutput ?? "text"));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: prose, htmlViz: html ?? undefined, jsonData: json ?? undefined, streaming: false, toolEvents }
              : m
          )
        );
      } catch (e) {
        const isAbort = (e as Error).name === "AbortError";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: isAbort ? (m.content || "*Stopped*") : `*Failed: ${String(e)}*`, streaming: false }
              : m
          )
        );
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, isStreaming, resultData, organizationId, orgExecutionToken, getAuthHeaders, activeAgentId]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    if (val === "/") {
      setShowAgentPicker(true);
      setShowPrompts(false);
    } else if (val === "") {
      setShowAgentPicker(false);
    } else {
      setShowAgentPicker(false);
      setShowPrompts(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() === "/") {
        setShowAgentPicker(true);
        return;
      }
      if (input.trim().toLowerCase() === "/rag") {
        e.preventDefault();
        setInput("");
        void (async () => {
          const currentRag = ragRef.current;
          if (!currentRag || currentRag.status === "idle" || currentRag.status === "loading_model") {
            setMessages((prev) => [...prev, {
              id: uid(), role: "assistant",
              content: "RAG is not ready yet. Model is still loading or no data has been indexed.",
            }]);
            return;
          }
          const counts = await currentRag.getStatus();
          const total = Object.values(counts).reduce((s, n) => s + n, 0);
          const lines = total === 0
            ? ["No data indexed yet. Upload a document or wait for the result data to be indexed."]
            : [
                `**RAG index status** — ${total} chunk${total !== 1 ? "s" : ""} total`,
                "",
                ...Object.entries(counts).map(([src, n]) => `- **${src}**: ${n} chunk${n !== 1 ? "s" : ""}`),
                "",
                `Model: \`Xenova/all-MiniLM-L6-v2\` · Status: \`${currentRag.status}\``,
              ];
          setMessages((prev) => [...prev, {
            id: uid(), role: "assistant",
            content: lines.join("\n"),
          }]);
        })();
        return;
      }
      void sendMessage(input);
    }
    if (e.key === "Escape") {
      setShowAgentPicker(false);
      setShowHeaderAgentPicker(false);
      setShowPrompts(false);
    }
  };

  const selectAgent = (agentId: string) => {
    setActiveAgentId(agentId);
    setShowAgentPicker(false);
    setShowHeaderAgentPicker(false);
    setInput("");
    setShowPrompts(false);
    suppressPromptsOnFocusRef.current = true;
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleStop = () => abortRef.current?.abort();
  const handleClear = () => { if (isStreaming) handleStop(); setMessages([]); };

  if (!enabled || !isOpen) return null;

  const agentBadgeColor: Record<string, string> = {
    text: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    echarts: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    table: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    mixed: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    html: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    json: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    __free__: "bg-muted text-muted-foreground",
  };

  const panel = (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquareDot className="h-5 w-5 text-primary shrink-0" />
          <span className="font-semibold text-sm">AI Assistant</span>
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowHeaderAgentPicker((v) => !v); setShowAgentPicker(false); }}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors hover:opacity-80 ${
                isFreeChatMode
                  ? agentBadgeColor.__free__
                  : (agentBadgeColor[activeAgent?.expectedOutput ?? "text"] || agentBadgeColor.text)
              }`}
            >
              {isFreeChatMode ? <MessageCircle className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
              {isFreeChatMode ? "Free Chat" : (activeAgent?.name ?? "Agent")}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
            {showHeaderAgentPicker && (
              <div
                className="absolute left-0 top-full mt-1 w-64 bg-background border border-border rounded-xl shadow-xl overflow-hidden z-50"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-2 border-b border-border bg-muted/40">
                  <span className="text-xs font-medium text-muted-foreground">Switch Agent</span>
                </div>
                {/* Free Chat option */}
                <button
                  onMouseDown={(e) => { e.preventDefault(); selectAgent("__free__"); }}
                  className={`w-full text-left px-3 py-2.5 hover:bg-muted transition-colors border-b border-border/40 ${isFreeChatMode ? "bg-primary/5" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium">Free Chat</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">generic</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 pl-5">Plain LLM — no data context, no constraints</p>
                </button>
                {/* Specialized agents */}
                {agents.map((a) => (
                  <button
                    key={a.id}
                    onMouseDown={(e) => { e.preventDefault(); selectAgent(a.id); }}
                    className={`w-full text-left px-3 py-2.5 hover:bg-muted transition-colors border-b border-border/40 last:border-0 ${a.id === activeAgentId ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium">{a.name}</span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${agentBadgeColor[a.expectedOutput] || agentBadgeColor.text}`}>
                        {OUTPUT_LABELS[a.expectedOutput] ?? a.expectedOutput}
                      </span>
                    </div>
                    {a.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 pl-5 line-clamp-1">{a.description}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={handleClear}>Clear</Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-muted-foreground">
            <MessageSquareDot className="h-10 w-10 opacity-30" />
            <p className="text-sm">Ask anything about the result data.</p>
            <p className="text-xs opacity-70">
              Type <kbd className="font-mono bg-muted px-1 rounded">/</kbd> to switch agents or use Free Chat mode.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessageBubble
            key={msg.id}
            msg={msg}
            outputFormat={msg.streaming ? (activeAgent?.expectedOutput ?? "text") : undefined}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="px-3 pb-3 pt-2 border-t border-border shrink-0">
        <div className="relative">
          {/* Quick prompts popup — one row per agent showing its top prompt */}
          {showPrompts && !showAgentPicker && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-background border border-border rounded-xl shadow-xl overflow-hidden z-10 flex flex-col max-h-[60dvh] lg:max-h-[30vh]">
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-muted/40 shrink-0">
                <Zap className="h-3 w-3 text-primary" />
                <span className="text-xs font-medium text-muted-foreground">Quick prompts</span>
              </div>
              <div className="overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:hsl(var(--border))_transparent]">
                {/* Per-agent rows: name header + top prompt */}
                {agentMenuItems.length > 0 ? agentMenuItems.map(({ agent: a, topPrompt }) => (
                  <button
                    key={a.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setShowPrompts(false);
                      setActiveAgentId(a.id);
                      void sendMessage(topPrompt, a.id);
                    }}
                    className={`w-full text-left px-3 py-2.5 hover:bg-muted transition-colors border-b border-border/40 last:border-0 ${a.id === activeAgentId ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Bot className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                        {a.name}
                      </span>
                    </div>
                    <p className="text-sm leading-snug pl-[18px]">{topPrompt}</p>
                  </button>
                )) : fallbackPrompts.map((p, i) => (
                  <button
                    key={i}
                    onMouseDown={(e) => { e.preventDefault(); setShowPrompts(false); void sendMessage(p); }}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors border-b border-border/40 last:border-0"
                  >
                    {p}
                  </button>
                ))}

                {/* General prompts section — not tied to any agent */}
                {globalPrompts.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-t border-border">
                      <Zap className="h-3 w-3 text-muted-foreground" />
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">General</span>
                    </div>
                    {globalPrompts.map((p, i) => (
                      <button
                        key={i}
                        onMouseDown={(e) => { e.preventDefault(); setShowPrompts(false); void sendMessage(p); }}
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors border-b border-border/40 last:border-0"
                      >
                        {p}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Agent picker popup (triggered by '/' from input) */}
          {showAgentPicker && (
            <div
              className="absolute bottom-full left-0 right-0 mb-2 bg-background border border-border rounded-xl shadow-xl overflow-hidden z-10 flex flex-col max-h-[60dvh] lg:max-h-[30vh]"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-muted/40 shrink-0">
                <Bot className="h-3 w-3 text-primary" />
                <span className="text-xs font-medium text-muted-foreground">Select an agent</span>
              </div>
              <div className="overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:hsl(var(--border))_transparent]">
              {/* Free Chat entry */}
              <button
                onMouseDown={(e) => { e.preventDefault(); selectAgent("__free__"); }}
                className={`w-full text-left px-3 py-2.5 hover:bg-muted transition-colors border-b border-border/40 ${isFreeChatMode ? "bg-primary/5" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium">Free Chat</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">generic</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 pl-5">Plain LLM — no data context, no constraints</p>
              </button>
              {agents.map((a) => (
                <button
                  key={a.id}
                  onMouseDown={(e) => { e.preventDefault(); selectAgent(a.id); }}
                  className={`w-full text-left px-3 py-2.5 hover:bg-muted transition-colors border-b border-border/40 last:border-0 ${a.id === activeAgentId ? "bg-primary/5" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium">{a.name}</span>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${agentBadgeColor[a.expectedOutput] || agentBadgeColor.text}`}>
                      {OUTPUT_LABELS[a.expectedOutput] ?? a.expectedOutput}
                    </span>
                  </div>
                  {a.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 pl-5">{a.description}</p>
                  )}
                </button>
              ))}
              </div>
            </div>
          )}

          {/* Hidden file input for document attachment */}
          {uploadConfig && (
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".txt,.json,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileAttach(file);
                e.target.value = "";
              }}
            />
          )}
          <div className="flex gap-2 items-end">
            {/* Show paperclip when a doc is attached OR when upload is available */}
            {(docText || uploadConfig) && (
              <div className="relative shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-10 w-10 ${
                    isUploading ? "text-primary"
                    : docText ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground"
                  }`}
                  title={docText ? "Document attached" : "Attach document"}
                  disabled={isUploading || isStreaming}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (docText) {
                      // Toggle info popover when a doc is already attached
                      setShowDocPopover((v) => !v);
                    } else {
                      // No doc yet — open the file picker
                      fileInputRef.current?.click();
                    }
                  }}
                >
                  {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                </Button>

                {/* Doc-info popover */}
                {showDocPopover && docText && (
                  <div className="absolute bottom-12 left-0 z-50 w-64 rounded-lg border border-border bg-popover shadow-lg p-3 text-xs">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-foreground">Document attached</span>
                      <button
                        className="text-muted-foreground hover:text-foreground"
                        onMouseDown={(e) => { e.preventDefault(); setShowDocPopover(false); }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="text-muted-foreground mb-2">
                      {localDocText ? "Uploaded in this session" : "Loaded from selection"}
                      {" · "}{Math.round(docText.length / 1024)} KB
                    </p>
                    {uploadConfig && (
                      <button
                        className="text-primary hover:underline text-xs"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setShowDocPopover(false);
                          fileInputRef.current?.click();
                        }}
                      >
                        Replace with a different file
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <Textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onFocus={() => {
                if (suppressPromptsOnFocusRef.current) { suppressPromptsOnFocusRef.current = false; return; }
                if (!input.trim() && messages.length === 0) setShowPrompts(true);
              }}
              onBlur={() => setTimeout(() => { setShowPrompts(false); setShowAgentPicker(false); setShowHeaderAgentPicker(false); setShowDocPopover(false); }, 150)}
              onKeyDown={handleKeyDown}
              placeholder={agents.length > 1 ? "Ask… (Enter to send, / to switch agent)" : "Ask about the result… (Enter to send)"}
              className="resize-none text-sm min-h-[56px] max-h-[120px]"
              rows={2}
              disabled={isStreaming}
            />
            {/* Quick-prompts toggle — only shown when there are already messages */}
            {messages.length > 0 && !isStreaming && (
              <Button
                variant="ghost"
                size="icon"
                className={`h-10 w-10 shrink-0 ${showPrompts ? "text-primary bg-primary/10" : "text-muted-foreground"}`}
                title="Quick prompts"
                onMouseDown={(e) => { e.preventDefault(); setShowPrompts((v) => !v); setShowAgentPicker(false); }}
              >
                <Zap className="h-4 w-4" />
              </Button>
            )}
            {isStreaming ? (
              <Button variant="destructive" size="icon" className="h-10 w-10 shrink-0" onClick={handleStop}>
                <X className="h-4 w-4" />
              </Button>
            ) : (
              <Button size="icon" className="h-10 w-10 shrink-0" onClick={() => void sendMessage(input)} disabled={!input.trim() || input === "/"}>
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-[10px] text-muted-foreground">
            Powered by org LLM settings · MCP tools available if configured
          </p>
          {rag && (
            <span className={`flex items-center gap-1 text-[10px] ${
              rag.status === "ready" ? "text-emerald-600 dark:text-emerald-400"
              : rag.status === "error" ? "text-destructive"
              : "text-muted-foreground"
            }`}>
              {rag.status === "loading_model" || rag.status === "indexing" || rag.status === "syncing"
                ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                : rag.status === "ready"
                  ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                  : null}
              {rag.status === "loading_model" ? "Loading AI model…"
                : rag.status === "indexing" ? "Indexing context…"
                : rag.status === "syncing" ? "Syncing…"
                : rag.status === "ready" ? `${rag.chunkCount} chunks indexed`
                : rag.status === "error" ? "RAG unavailable"
                : null}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Backdrop — dark on mobile, invisible on desktop */}
      <div
        className="fixed inset-0 bg-black/50 lg:bg-transparent"
        style={{ zIndex: 9998 }}
        onClick={onClose}
      />

      {/* Mobile: full-screen panel */}
      <div
        className="fixed inset-0 flex flex-col lg:hidden"
        style={{ zIndex: 9999 }}
        onClick={(e) => e.stopPropagation()}
      >
        {panel}
      </div>

      {/* Desktop: floating bottom-right panel, 50vh height */}
      <div
        className="hidden lg:flex fixed bottom-5 right-4 w-[400px] flex-col rounded-2xl border border-border shadow-2xl overflow-hidden"
        style={{ zIndex: 9999, height: "50vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {panel}
      </div>
    </>
  );
};

export default ChatDrawer;
