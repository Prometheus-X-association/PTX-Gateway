import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import ManagedChat, { type ChatContext } from "@/components/chat/ManagedChat";
import { readChatContext, trustedChatMessage } from "@/lib/chatBridge";

export default function ChatComponentPage({ embedded = false }: { embedded?: boolean }) {
  const { orgSlug, chatId } = useParams();
  return <ChatHost key={`${orgSlug}:${chatId}:${embedded}`} orgSlug={orgSlug || ""} chatId={chatId || ""} embedded={embedded} />;
}
function ChatHost({ orgSlug, chatId, embedded }: { orgSlug: string; chatId: string; embedded: boolean }) {
  const [context, setContext] = useState<ChatContext>({});
  const [open, setOpen] = useState(true);
  const [error, setError] = useState("");
  const [embed] = useState(() => {
    if (!embedded) return undefined;
    let parentOrigin = "";
    try { parentOrigin = document.referrer ? new URL(document.referrer).origin : ""; } catch { /* fail closed */ }
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    return { parentOrigin, token };
  });
  const send = useCallback((type: string, detail?: unknown) => {
    if (embed?.parentOrigin && window.parent !== window) window.parent.postMessage({ type, detail }, embed.parentOrigin);
  }, [embed?.parentOrigin]);
  useEffect(() => {
    if (!embed) return;
    const receive = (event: MessageEvent) => {
      if (!trustedChatMessage(event, window.parent, embed.parentOrigin)) return;
      if (event.data?.type === "ptx-chat:context") {
        try { setContext(readChatContext(event.data.detail)); setError(""); }
        catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); setError(message); send("ptx-chat:error", { message }); }
      }
      if (event.data?.type === "ptx-chat:open") setOpen(true);
      if (event.data?.type === "ptx-chat:close") setOpen(false);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [embed, send]);
  const ready = useCallback(() => send("ptx-chat:ready"), [send]);
  if (embedded && (!embed?.token || !embed.parentOrigin || window.parent === window)) return <p role="alert" className="p-4">Open this chat in an authorized iframe with an embed token and a referrer origin.</p>;
  return <main className="flex h-dvh min-h-80 flex-col bg-background p-2">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="min-h-0 flex-1"><ManagedChat id={chatId} orgSlug={orgSlug} embed={embed} context={context} open={open} onReady={ready}
      onOpenChange={(value) => { setOpen(value); send(value ? "ptx-chat:opened" : "ptx-chat:closed"); }}
      onResultDataChange={(value) => send("ptx-chat:result-change", value)} onDocumentChange={(text) => send("ptx-chat:document-change", { text })} /></div>
  </main>;
}
