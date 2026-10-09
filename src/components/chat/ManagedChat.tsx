import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ChatDrawer, { type LlmAgentInfo } from "./ChatDrawer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { studioApi, type PublishedStudioItem } from "@/services/studioApi";
import { useRagWorker } from "@/lib/useRagWorker";
import type { WorkflowConfig } from "@/types/workflow";
import type { UploadConfig } from "@/components/DocumentUploadZone";
import { Button } from "@/components/ui/button";

export interface ChatContext { resultData?: unknown; docText?: string; uploadConfig?: UploadConfig }
interface ChatBootstrap { item: PublishedStudioItem; organization: { id: string; slug: string }; executionToken?: string; expiresAt?: string }
interface ChatStatus { ok: boolean; enabled: boolean; configured: boolean; freeChatConfigured: boolean; agents: LlmAgentInfo[]; workflows: WorkflowConfig[]; predefinedPrompts: string[] }
export interface ManagedChatProps {
  id: string;
  organizationId?: string;
  orgSlug?: string;
  embed?: { token: string; parentOrigin: string };
  context?: ChatContext;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onResultDataChange?: (value: unknown) => void;
  onDocumentChange?: (text: string) => void;
  onReady?: () => void;
}
export default function ManagedChat({ id, organizationId, orgSlug, embed, context, open = true, onOpenChange, onResultDataChange, onDocumentChange, onReady }: ManagedChatProps) {
  const { user } = useAuth();
  const profile = useQuery({
    queryKey: ["managed-chat", user?.id, organizationId, orgSlug, id, embed?.parentOrigin],
    queryFn: () => studioApi<ChatBootstrap>(embed ? "embed_chat" : "chat", embed ? undefined : organizationId, { id, orgSlug, ...(embed ? { token: embed.token, parentOrigin: embed.parentOrigin } : {}) }),
    refetchInterval: 60000,
    retry: false,
  });
  if (profile.error) return <div role="alert" className="rounded border p-4 text-destructive">Chat unavailable: {profile.error.message}<Button className="ml-3" variant="outline" onClick={() => void profile.refetch()}>Retry</Button></div>;
  if (!profile.data) return <p role="status" className="p-4">Loading chat…</p>;
  return <ChatSession key={`${id}:${profile.data.item.releaseId}:${user?.id || "embed"}`} bootstrap={profile.data} context={context} open={open} onOpenChange={onOpenChange} onResultDataChange={onResultDataChange} onDocumentChange={onDocumentChange} onReady={onReady} />;
}
function ChatSession({ bootstrap, context, open, onOpenChange, onResultDataChange, onDocumentChange, onReady }: {
  bootstrap: ChatBootstrap; context?: ChatContext; open: boolean; onOpenChange?: (open: boolean) => void;
  onResultDataChange?: (value: unknown) => void; onDocumentChange?: (text: string) => void; onReady?: () => void;
}) {
  const { user } = useAuth();
  const [sessionId] = useState(() => `studio-chat:${bootstrap.organization.id}:${bootstrap.item.id}:${crypto.randomUUID()}`);
  const [result, setResult] = useState<unknown>(context?.resultData ?? null);
  const [documentText, setDocumentText] = useState(context?.docText || "");
  const [locallyOpen, setLocallyOpen] = useState(open);
  const rag = useRagWorker();
  const { preloadModel, indexData, clearSource } = rag;
  const definition = bootstrap.item.definition;
  useEffect(() => { setResult(context?.resultData ?? null); }, [context?.resultData]);
  useEffect(() => { setDocumentText(context?.docText || ""); }, [context?.docText]);
  useEffect(() => { setLocallyOpen(open); }, [open]);
  useEffect(() => { if (result != null) { preloadModel(); indexData(result, "result"); } else clearSource("result"); }, [result, preloadModel, indexData, clearSource]);
  useEffect(() => { if (documentText) { preloadModel(); indexData(documentText, "document"); } else clearSource("document"); }, [documentText, preloadModel, indexData, clearSource]);
  const fetchStatus = useCallback(async (): Promise<ChatStatus> => {
    const { data, error } = await supabase.functions.invoke("llm-insights", {
      headers: { "x-organization-id": bootstrap.organization.id },
      body: { action: "status", target_resource_id: definition.targetResourceId || undefined, studio_chat_id: bootstrap.item.id, org_execution_token: bootstrap.executionToken },
    });
    if (error || !data?.ok) throw new Error(data?.error || error?.message || "Chat configuration could not be loaded.");
    return data;
  }, [bootstrap.organization.id, bootstrap.executionToken, bootstrap.item.id, definition.targetResourceId]);
  const status = useQuery({ queryKey: ["managed-chat-status", user?.id, bootstrap.organization.id, bootstrap.item.id, bootstrap.item.releaseId], queryFn: fetchStatus, refetchInterval: 60000, retry: false });
  const loadLatestWorkflow = useCallback(async (workflowId: string) => {
    const latest = await fetchStatus();
    const workflow = latest.workflows?.find((entry) => entry.id === workflowId && entry.enabled && !entry.deletedAt);
    if (!latest.enabled || !workflow) throw new Error("This workflow is no longer available for this chat.");
    return workflow;
  }, [fetchStatus]);
  const configurationReady = Boolean(status.data);
  useEffect(() => { if (configurationReady) onReady?.(); }, [configurationReady, onReady]);
  if (status.error) return <p role="alert" className="p-4 text-destructive">{status.error.message}</p>;
  if (!status.data) return <p role="status" className="p-4">Loading agents and workflows…</p>;
  if (!status.data.enabled || !status.data.configured) return <p className="p-4">Chat is disabled or no model provider is configured. Configure shared chat in Agent Orchestration.</p>;
  if (!locallyOpen) return <Button onClick={() => { setLocallyOpen(true); onOpenChange?.(true); }}>Open {definition.title}</Button>;
  return <ChatDrawer presentation="inline" title={definition.title} isOpen enabled resultData={result}
    onClose={() => { setLocallyOpen(false); onOpenChange?.(false); }}
    onResultDataChange={(value) => { setResult(value); onResultDataChange?.(value); }}
    organizationId={bootstrap.organization.id} studioChatId={bootstrap.item.id} orgExecutionToken={bootstrap.executionToken}
    agents={status.data.agents || []} freeChatEnabled={status.data.freeChatConfigured}
    globalPrompts={[...(definition.prompts || []), ...(status.data.predefinedPrompts || [])]}
    workflows={status.data.workflows || []} loadLatestWorkflow={loadLatestWorkflow}
    targetResourceId={definition.targetResourceId || undefined} rag={rag} docText={documentText}
    processSessionId={sessionId} uploadConfig={context?.uploadConfig}
    onDocUploaded={(text) => { setDocumentText(text); onDocumentChange?.(text); }} />;
}
