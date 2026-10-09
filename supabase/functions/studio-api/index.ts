import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient, authorize, loadWorkflow } from "../_shared/workflowAccess.ts";
import { createRun, cors, readBody } from "../_shared/workflowRuns.ts";
import { decryptForOrganization, encryptForOrganization, HttpError, object } from "../_shared/workflowSecurity.ts";
import { studioKind, studioSlug, studioUuid, validateStudioDefinition } from "../_shared/studioSchema.ts";

const studioCors = { ...cors, "Access-Control-Allow-Headers": `${cors["Access-Control-Allow-Headers"]}, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version` };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...studioCors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const publicRelease = (item: any, release: any) => ({ id: item.id, kind: item.kind, slug: item.slug, parentId: item.parent_id, releaseId: release.id, definition: release.definition });
const fail = (error: any) => { if (error) throw error; };
export async function publishedItem(admin: any, orgId: string, id: string, kind?: string): Promise<{ item: any; release: any }> {
  const { data: item, error } = await admin.from("studio_items").select("*").eq("organization_id", orgId).eq("id", id).eq("active", true).is("deleted_at", null).maybeSingle();
  fail(error);
  if (!item || !item.published_release_id || (kind && item.kind !== kind)) throw new HttpError(404, "Published item is unavailable.");
  if (item.kind === "page") await publishedItem(admin, orgId, item.parent_id, "application");
  const { data: release, error: releaseError } = await admin.from("studio_releases").select("*").eq("organization_id", orgId).eq("item_id", item.id).eq("id", item.published_release_id).maybeSingle();
  fail(releaseError);
  if (!release) throw new HttpError(404, "Published release is unavailable.");
  return { item, release };
}
async function pinnedPage(admin: any, orgId: string, id: string, releaseId: string) {
  const { item } = await publishedItem(admin, orgId, id, "page");
  const { data: release, error } = await admin.from("studio_releases").select("*").eq("organization_id", orgId).eq("item_id", id).eq("id", releaseId).maybeSingle();
  fail(error);
  if (!release) throw new HttpError(404, "Pinned page release is unavailable.");
  return { item, release };
}
async function externalFunction(name: string, body: unknown) {
  const key = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${name}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new HttpError(response.status >= 400 ? response.status : 403, result.error || "Embed authorization failed.");
  return result;
}
export async function handleStudioRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { headers: studioCors });
  try {
    if (request.method !== "POST") throw new HttpError(405, "Use POST.");
    let body: Record<string, any>;
    try { body = object(JSON.parse(String(await readBody(request, 1024 * 1024)) || "{}")); }
    catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "Invalid JSON."); }
    const admin = adminClient();
    const action = String(body.action || "list");
    let orgId = request.headers.get("x-organization-id") || body.organizationId;
    let org: any;
    if (body.orgSlug) {
      const result = await admin.from("organizations").select("id,slug,name,is_active").eq("slug", studioSlug(body.orgSlug)).eq("is_active", true).maybeSingle();
      fail(result.error); org = result.data;
      if (!org) throw new HttpError(404, "Organization unavailable.");
      if (orgId && orgId !== org.id) throw new HttpError(403, "Organization mismatch.");
      orgId = org.id;
    } else if (orgId) {
      const result = await admin.from("organizations").select("id,slug,name,is_active").eq("id", orgId).eq("is_active", true).maybeSingle();
      fail(result.error); org = result.data;
      if (!org) throw new HttpError(404, "Organization unavailable.");
    }
    if (action === "embed_chat") {
      if (!org || typeof body.parentOrigin !== "string" || !body.parentOrigin || typeof body.token !== "string" || body.token.length > 8192) throw new HttpError(400, "Organization, embed token and parent origin are required.");
      const { item, release } = await publishedItem(admin, org.id, studioUuid(body.id), "chat");
      const definition = validateStudioDefinition("chat", release.definition);
      if (!definition.allowEmbedding || !definition.allowedOrigins.includes(body.parentOrigin)) throw new HttpError(403, "This chat does not allow embedding on this origin.");
      const validated = await externalFunction("embed-auth", { action: "validate", org_slug: org.slug, token: body.token, parent_origin: body.parentOrigin });
      if (validated.organization_id !== org.id || validated.origin !== body.parentOrigin) throw new HttpError(403, "Embed identity mismatch.");
      const execution = await externalFunction("pdc-auth", { action: "issue_public", org_slug: org.slug, ttl_seconds: 900 });
      return json({ ok: true, organization: org, item: publicRelease(item, release), executionToken: execution.token, expiresAt: execution.expires_at });
    }
    // Studio mutations and runtime are member-authenticated; workflow API keys and legacy public tokens cannot access drafts.
    const principal = await authorize(request, { organizationId: orgId }, admin);
    if (!principal.userId || principal.publicToken || principal.keyId) throw new HttpError(403, "Sign in to use Studio.");
    if (action === "resolve" || action === "chat") {
      if (action === "chat") {
        const { item, release } = await publishedItem(admin, principal.orgId, studioUuid(body.id), "chat");
        return json({ ok: true, organization: org, item: publicRelease(item, release) });
      }
      const kind = body.kind === "canvas" ? "canvas" : "application";
      const { data: root, error } = await admin.from("studio_items").select("id").eq("organization_id", principal.orgId).eq("kind", kind).eq("slug", studioSlug(body.slug)).is("deleted_at", null).maybeSingle();
      fail(error); if (!root) throw new HttpError(404, "Application or canvas not found.");
      const resolved = await publishedItem(admin, principal.orgId, root.id, kind);
      const pages: any[] = [];
      for (const pin of resolved.release.definition.pageReleases || []) {
        try {
          const page = await pinnedPage(admin, principal.orgId, pin.id, pin.releaseId);
          pages.push(publicRelease(page.item, page.release));
        } catch (error) {
          // Deactivating one page or its parent removes it from the composition without disabling other pages.
          if (!(error instanceof HttpError) || error.status !== 404) throw error;
        }
      }
      return json({ ok: true, organization: org, item: publicRelease(resolved.item, resolved.release), pages });
    }
    if (action === "launch") {
      const container = await publishedItem(admin, principal.orgId, studioUuid(body.containerId));
      if (!["application", "canvas"].includes(container.item.kind) || body.containerReleaseId !== container.release.id) throw new HttpError(409, "This application was republished. Reload it before starting an action.");
      const pin = (container.release.definition.pageReleases || []).find((entry: any) => entry.id === body.id && entry.releaseId === body.releaseId);
      if (!pin) throw new HttpError(403, "This page action is not part of the published application.");
      const { item, release } = await pinnedPage(admin, principal.orgId, studioUuid(body.id), studioUuid(body.releaseId));
      const element = release.definition.elements.find((entry: any) => entry.id === body.elementId && entry.type === "workflow-button");
      if (!element || !release.runtime_ciphertext) throw new HttpError(403, "This action is not published.");
      // A global disable or deletion still takes effect even though execution uses an immutable release snapshot.
      const live = await loadWorkflow(admin, principal.orgId, element.workflowId);
      if (!live.workflow.execution?.apiEnabled) throw new HttpError(403, "API execution is disabled for this workflow.");
      const snapshot = await decryptForOrganization(admin, principal.orgId, release.runtime_ciphertext);
      const workflow = snapshot.workflows.find((entry: any) => entry.id === element.workflowId);
      if (!workflow) throw new HttpError(409, "Published workflow snapshot is missing.");
      const started = await createRun(admin, principal, { workflowId: workflow.id, input: body.input }, "api", request.headers.get("idempotency-key") || undefined, undefined,
        { workflow, llm: snapshot.llm, studioContext: { pageId: item.id, releaseId: release.id, containerId: container.item.id, containerReleaseId: container.release.id, elementId: element.id } });
      return json({ ok: true, ...started, pageId: item.id, releaseId: release.id }, 202);
    }
    if (!principal.isAdmin) throw new HttpError(403, "Organization administrator required.");
    if (action === "list") {
      const { data, error } = await admin.from("studio_items").select("*").eq("organization_id", principal.orgId).is("deleted_at", null).order("created_at");
      fail(error); return json({ ok: true, items: data || [] });
    }
    if (action === "releases") {
      const { data, error } = await admin.from("studio_releases").select("id,item_id,revision,created_at,created_by").eq("organization_id", principal.orgId).eq("item_id", studioUuid(body.id)).order("created_at", { ascending: false }).limit(100);
      fail(error); return json({ ok: true, releases: data || [] });
    }
    const creating = action === "create";
    const id = creating ? null : studioUuid(body.id);
    let existing: any;
    if (!creating) {
      const { data, error } = await admin.from("studio_items").select("*").eq("organization_id", principal.orgId).eq("id", id).is("deleted_at", null).maybeSingle();
      fail(error); existing = data;
      if (!existing) throw new HttpError(404, "Studio item not found.");
    }
    const kind = studioKind(creating ? body.kind : existing.kind);
    let definition: any = null;
    let runtime: string | null = null;
    if (creating || action === "save") definition = validateStudioDefinition(kind, body.definition);
    if (action === "publish") {
      definition = validateStudioDefinition(kind, existing.draft);
      if (kind === "page") {
        const workflows = [];
        let llm: any = {};
        for (const element of definition.elements) {
          if (element.type === "chat") await publishedItem(admin, principal.orgId, element.chatId, "chat");
          if (element.type === "workflow-button") {
            const loaded = await loadWorkflow(admin, principal.orgId, element.workflowId);
            if (!loaded.workflow.execution?.apiEnabled) throw new HttpError(400, "Enable API execution on each page workflow before publishing.");
            workflows.push(loaded.workflow); llm = loaded.llm;
          }
        }
        if (workflows.length) runtime = await encryptForOrganization(admin, principal.orgId, { workflows, llm: { ...llm, workflows } });
      }
      if (kind === "canvas" || kind === "application") {
        let pageIds = definition.pageIds;
        if (kind === "application") {
          const children = await admin.from("studio_items").select("id,published_release_id").eq("organization_id", principal.orgId).eq("parent_id", existing.id).eq("active", true).is("deleted_at", null).order("created_at");
          fail(children.error);
          definition.pageReleases = (children.data || []).filter((page: any) => page.published_release_id).map((page: any) => ({ id: page.id, releaseId: page.published_release_id }));
        } else {
          definition.pageReleases = [];
          for (const pageId of pageIds) {
            const page = await publishedItem(admin, principal.orgId, pageId, "page");
            definition.pageReleases.push({ id: page.item.id, releaseId: page.release.id });
          }
        }
      }
      if (kind === "chat") {
        for (const workflowId of definition.workflowIds) await loadWorkflow(admin, principal.orgId, workflowId);
        if (definition.agentIds.length) {
          const config = await admin.from("global_configs").select("features").eq("organization_id", principal.orgId).maybeSingle();
          fail(config.error);
          const agents = object(object(config.data?.features).llmInsights).agents || [];
          if (definition.agentIds.some((id: string) => !agents.some((agent: any) => agent.id === id && agent.enabled !== false && !agent.deletedAt))) throw new HttpError(400, "A selected agent is missing or disabled in this organization.");
        }
      }
      if (kind === "chat" && definition.allowEmbedding && !definition.allowedOrigins.length) throw new HttpError(400, "Add at least one allowed origin before enabling embedding.");
    }
    if (!["create", "save", "publish", "rollback", "activate", "delete"].includes(action)) throw new HttpError(400, "Unknown Studio action.");
    if (!creating && (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 1)) throw new HttpError(400, "Expected draft revision is required.");
    const { data, error } = await admin.rpc("studio_mutate", {
      p_org: principal.orgId, p_actor: principal.userId, p_action: action, p_id: id, p_expected: creating ? null : body.expectedRevision,
      p_kind: kind, p_parent: creating && kind === "page" ? studioUuid(body.parentId) : null,
      p_slug: creating ? studioSlug(body.slug) : null, p_definition: definition, p_runtime: runtime,
      p_release: action === "rollback" ? studioUuid(body.releaseId) : null, p_active: action === "activate" ? body.active === true : null,
    });
    if (error) throw new HttpError(error.code === "40001" || error.code === "23505" ? 409 : 400, error.message);
    return json({ ok: true, item: data });
  } catch (error) {
    const known = error instanceof Error;
    return json({ ok: false, error: known ? error.message : "Studio request failed." }, error instanceof HttpError ? error.status : 400);
  }
}
serve(handleStudioRequest);
