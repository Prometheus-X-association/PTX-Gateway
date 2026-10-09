import { supabase } from "@/integrations/supabase/client";
import type { StudioDefinition, StudioKind } from "../../supabase/functions/_shared/studioSchema";
export type { StudioDefinition, StudioKind, StudioElement } from "../../supabase/functions/_shared/studioSchema";
export interface StudioItem {
  id: string; organization_id: string; kind: StudioKind; parent_id: string | null; slug: string;
  draft: StudioDefinition; revision: number; active: boolean; published_release_id: string | null;
  created_at: string; updated_at: string;
}
export interface PublishedStudioItem { id: string; kind: StudioKind; slug: string; parentId: string | null; releaseId: string; definition: StudioDefinition }
export interface StudioResponse {
  ok: boolean; items?: StudioItem[]; item?: StudioItem; pages?: PublishedStudioItem[];
  releases?: Array<{ id: string; item_id: string; revision: number; created_at: string }>;
  runId?: string;
}
export async function studioApi<T = StudioResponse>(action: string, organizationId?: string, body: Record<string, unknown> = {}, idempotencyKey?: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke("studio-api", {
    headers: { ...(organizationId ? { "x-organization-id": organizationId } : {}), ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
    body: { ...body, action },
  });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message || "Studio request failed.");
  }
  if (!data?.ok) throw new Error(data?.error || "Studio request failed.");
  return data as T;
}
export function emptyStudioDefinition(title: string): StudioDefinition {
  return { schemaVersion: 1, title, description: "", elements: [], pageIds: [], layout: "tabs", targetResourceId: "", agentIds: [], workflowIds: [], prompts: [], allowedOrigins: [], allowEmbedding: false };
}
export function studioItemUrl(item: StudioItem, items: StudioItem[], orgSlug: string): string | null {
  const root = `/o/${encodeURIComponent(orgSlug)}`;
  if (item.kind === "application") return `${root}/apps/${item.slug}`;
  if (item.kind === "page") {
    const parent = items.find((candidate) => candidate.id === item.parent_id);
    return parent ? `${root}/apps/${parent.slug}/${item.slug}` : null;
  }
  return item.kind === "canvas" ? `${root}/canvas/${item.slug}` : `${root}/chat/${item.id}`;
}
