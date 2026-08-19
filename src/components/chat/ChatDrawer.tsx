import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, MessageSquareDot, Loader2, Wrench, Zap, Bot, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2);

const splitHtmlViz = (text: string): { prose: string; html: string | null } => {
  const fenceMatch = text.match(/```(?:html)?\n?([\s\S]*?)```/i);
  if (fenceMatch) {
    const fencedContent = fenceMatch[1].trim();
    if (/<div\b/i.test(fencedContent)) {
      const fenceStart = text.indexOf(fenceMatch[0]);
      return { prose: text.slice(0, fenceStart).trim(), html: fencedContent };
    }
  }
  const divStart = text.search(/<div\b/i);
  if (divStart === -1) return { prose: text, html: null };
  return { prose: text.slice(0, divStart).trim(), html: text.slice(divStart).trim() };
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

const VizBubble = ({ html }: { html: string }) => (
  <iframe
    srcDoc={buildSrcdoc(html)}
    sandbox="allow-scripts"
    style={{ width: "100%", height: 400, border: "none" }}
    className="mt-2 rounded-xl overflow-hidden border border-border"
    title="AI Chart"
  />
);

// ─── ChatMessageBubble ────────────────────────────────────────────────────────

const ChatMessageBubble = ({ msg }: { msg: ChatMessageData }) => {
  const isUser = msg.role === "user";
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
        {msg.streaming && !msg.content ? (
          <Loader2 className="h-4 w-4 animate-spin opacity-60" />
        ) : (
          <div className="prose-sm break-words" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
        )}
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

const ChatDrawer = ({
  resultData,
  organizationId,
  orgExecutionToken,
  agents = [],
  globalPrompts = [],
  enabled = true,
  isOpen,
  onClose,
}: ChatDrawerProps) => {
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Initialize active agent to first enabled agent
  useEffect(() => {
    if (agents.length > 0 && !activeAgentId) {
      setActiveAgentId(agents[0].id);
    }
  }, [agents, activeAgentId]);

  const activeAgent = agents.find((a) => a.id === activeAgentId) ?? agents[0] ?? null;

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
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 80);
  }, [isOpen]);

  // Close agent picker when clicking outside
  useEffect(() => {
    if (!showAgentPicker) return;
    const close = () => setShowAgentPicker(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showAgentPicker]);

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

      const agentId = overrideAgentId ?? activeAgentId ?? undefined;

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
              result: resultData,
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

        const { prose, html } = splitHtmlViz(accText);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: prose, htmlViz: html ?? undefined, streaming: false, toolEvents }
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
    // Show agent picker when user types '/' at the very start
    if (val === "/") {
      setShowAgentPicker(true);
      setShowPrompts(false);
    } else if (val === "") {
      setShowAgentPicker(false);
      setShowPrompts(true);
    } else {
      setShowAgentPicker(false);
      setShowPrompts(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() === "/") {
        // Just show agent picker, don't send
        setShowAgentPicker(true);
        return;
      }
      void sendMessage(input);
    }
    if (e.key === "Escape") {
      setShowAgentPicker(false);
      setShowPrompts(false);
    }
  };

  const selectAgent = (agentId: string) => {
    setActiveAgentId(agentId);
    setShowAgentPicker(false);
    setInput("");
    setShowPrompts(true);
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
  };

  const panel = (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquareDot className="h-5 w-5 text-primary shrink-0" />
          <span className="font-semibold text-sm">AI Assistant</span>
          {activeAgent && (
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowAgentPicker((v) => !v); }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors hover:opacity-80 ${agentBadgeColor[activeAgent.expectedOutput] || agentBadgeColor.text}`}
              >
                <Bot className="h-3 w-3" />
                {activeAgent.name}
                {agents.length > 1 && <ChevronDown className="h-3 w-3 opacity-60" />}
              </button>
              {showAgentPicker && agents.length > 1 && (
                <div
                  className="absolute left-0 top-full mt-1 w-64 bg-background border border-border rounded-xl shadow-xl overflow-hidden z-50"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="px-3 py-2 border-b border-border bg-muted/40">
                    <span className="text-xs font-medium text-muted-foreground">Switch Agent</span>
                  </div>
                  {agents.map((a) => (
                    <button
                      key={a.id}
                      onMouseDown={(e) => { e.preventDefault(); selectAgent(a.id); }}
                      className={`w-full text-left px-3 py-2.5 hover:bg-muted transition-colors border-b border-border/40 last:border-0 ${a.id === activeAgentId ? "bg-primary/5" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{a.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${agentBadgeColor[a.expectedOutput] || agentBadgeColor.text}`}>
                          {OUTPUT_LABELS[a.expectedOutput] ?? a.expectedOutput}
                        </span>
                      </div>
                      {a.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{a.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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
              {agents.length > 1
                ? "Type / to switch agents, or click the agent badge above."
                : "Click the input to see quick prompts."}
            </p>
          </div>
        )}
        {messages.map((msg) => <ChatMessageBubble key={msg.id} msg={msg} />)}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="px-3 pb-3 pt-2 border-t border-border shrink-0">
        <div className="relative">
          {/* Quick prompts popup — one row per agent showing its top prompt */}
          {showPrompts && !showAgentPicker && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-background border border-border rounded-xl shadow-xl overflow-hidden z-10">
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-muted/40">
                <Zap className="h-3 w-3 text-primary" />
                <span className="text-xs font-medium text-muted-foreground">Quick prompts</span>
              </div>
              <div className="max-h-72 overflow-y-auto">
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
          {showAgentPicker && agents.length > 0 && (
            <div
              className="absolute bottom-full left-0 right-0 mb-2 bg-background border border-border rounded-xl shadow-xl overflow-hidden z-10"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-muted/40">
                <Bot className="h-3 w-3 text-primary" />
                <span className="text-xs font-medium text-muted-foreground">Select an agent</span>
              </div>
              {agents.map((a) => (
                <button
                  key={a.id}
                  onMouseDown={(e) => { e.preventDefault(); selectAgent(a.id); }}
                  className={`w-full text-left px-3 py-2.5 hover:bg-muted transition-colors border-b border-border/40 last:border-0 ${a.id === activeAgentId ? "bg-primary/5" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{a.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${agentBadgeColor[a.expectedOutput] || agentBadgeColor.text}`}>
                      {OUTPUT_LABELS[a.expectedOutput] ?? a.expectedOutput}
                    </span>
                  </div>
                  {a.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2 items-end">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onFocus={() => { if (!input.trim()) setShowPrompts(true); }}
              onBlur={() => setTimeout(() => { setShowPrompts(false); setShowAgentPicker(false); }, 150)}
              onKeyDown={handleKeyDown}
              placeholder={agents.length > 1 ? "Ask… (Enter to send, / to switch agent)" : "Ask about the result… (Enter to send)"}
              className="resize-none text-sm min-h-[56px] max-h-[120px]"
              rows={2}
              disabled={isStreaming}
            />
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
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Powered by org LLM settings · MCP tools available if configured
        </p>
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
