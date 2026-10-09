import { HttpError } from "./workflowSecurity.ts";
import { studioUuid, validateStudioDefinition, type StudioDefinition } from "./studioSchema.ts";
import type { adminClient } from "./workflowAccess.ts";

export async function loadStudioChatPolicy(admin: ReturnType<typeof adminClient>, organizationId: string, id: unknown): Promise<StudioDefinition> {
  let chatId: string;
  try { chatId = studioUuid(id); } catch { throw new HttpError(400, "Invalid chat drawer ID."); }
  const { data: item, error } = await admin.from("studio_items").select("id,published_release_id").eq("organization_id", organizationId).eq("id", chatId).eq("kind", "chat").eq("active", true).is("deleted_at", null).maybeSingle();
  if (error || !item?.published_release_id) throw new HttpError(403, "This chat drawer is unavailable.");
  const { data: release, error: releaseError } = await admin.from("studio_releases").select("definition").eq("organization_id", organizationId).eq("item_id", item.id).eq("id", item.published_release_id).maybeSingle();
  if (releaseError || !release) throw new HttpError(403, "Chat release is unavailable.");
  return validateStudioDefinition("chat", release.definition);
}
export function allowsStudioChatItem(policy: StudioDefinition, type: "agent" | "workflow", item: { id?: string; targetResources?: string[] }): boolean {
  const ids = type === "agent" ? policy.agentIds : policy.workflowIds;
  return ids.length ? ids.includes(item.id || "") : Boolean(policy.targetResourceId && item.targetResources?.includes(policy.targetResourceId));
}
