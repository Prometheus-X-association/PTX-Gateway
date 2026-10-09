import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient, authorize } from "../_shared/workflowAccess.ts";
import { cors, readBody } from "../_shared/workflowRuns.ts";
import { hash, HttpError, object } from "../_shared/workflowSecurity.ts";
import { studioSlug, studioUuid } from "../_shared/studioSchema.ts";
import {
  authoringSystemPrompt,
  authoringText,
  type LegacyInventory,
  legacyMigration,
  parseAuthoringResponse,
  validateAuthoringManifest,
} from "../_shared/studioAuthoring.ts";
import { generateStudioProposal } from "../_shared/studioAuthoringProvider.ts";
import { resolveProviders } from "../chat-with-result/providers.ts";
const headers = {
  ...cors,
  "Access-Control-Allow-Headers": `${
    cors["Access-Control-Allow-Headers"]
  }, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version`,
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers });
const check = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};
export async function handleAuthoringRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  try {
    if (request.method !== "POST") throw new HttpError(405, "Use POST.");
    const body = object(JSON.parse(String(await readBody(request, 600000))));
    const admin = adminClient();
    const principal = await authorize(request, {
      organizationId: request.headers.get("x-organization-id") ||
        body.organizationId,
    }, admin);
    if (
      !principal.userId || !principal.isAdmin || principal.keyId ||
      principal.publicToken
    ) throw new HttpError(403, "Organization administrator required.");
    const orgId = principal.orgId;
    const actor = principal.userId;
    const action = body.action;
    const org = await admin.from("organizations").select("id,name,is_active")
      .eq("id", orgId).eq("is_active", true).maybeSingle();
    check(org.error);
    if (!org.data) throw new HttpError(404, "Organization unavailable.");
    if (action === "list") {
      const proposals = await admin.from("studio_authoring_proposals").select(
        "*",
      ).eq("organization_id", orgId).order("created_at", { ascending: false })
        .limit(50);
      check(proposals.error);
      const rollout = await admin.from("studio_gateway_rollout").select("*").eq(
        "organization_id",
        orgId,
      ).maybeSingle();
      check(rollout.error);
      return json({
        ok: true,
        proposals: proposals.data || [],
        rollout: rollout.data,
      });
    }
    if (action === "rollout") {
      if (
        !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0
      ) throw new HttpError(400, "Rollout revision is required.");
      const result = await admin.rpc("studio_set_rollout", {
        p_org: orgId,
        p_actor: actor,
        p_application: body.applicationId
          ? studioUuid(body.applicationId)
          : null,
        p_expected: body.expectedRevision,
      });
      if (result.error) {
        throw new HttpError(
          result.error.code === "40001" ? 409 : 400,
          result.error.message,
        );
      }
      return json({ ok: true, rollout: result.data });
    }
    const [config, chats, stores, resources, chains] = await Promise.all([
      admin.from("global_configs").select("features").eq(
        "organization_id",
        orgId,
      ).maybeSingle(),
      admin.from("studio_items").select("id,slug,published_release_id").eq(
        "organization_id",
        orgId,
      ).eq("kind", "chat").eq("active", true).is("deleted_at", null),
      admin.from("knowledge_stores").select("id,name").eq(
        "organization_id",
        orgId,
      ).eq("active", true).is("deleted_at", null),
      admin.from("dataspace_params").select("id,resource_name,resource_type")
        .eq("organization_id", orgId).order("id"),
      admin.from("service_chains").select("id,catalog_id").eq(
        "organization_id",
        orgId,
      ).order("id"),
    ]);
    for (const result of [config, chats, stores, resources, chains]) {
      check(result.error);
    }
    const features = object(config.data?.features);
    const llm = object(features.llmInsights);
    const providers = resolveProviders(llm).map((provider, index) => ({
      ...provider,
      id: provider.id || `provider-${index}`,
    }));
    const workflows = (Array.isArray(llm.workflows) ? llm.workflows : []).map(
      object,
    ).filter((workflow) =>
      workflow.enabled !== false && !workflow.deletedAt &&
      object(workflow.execution).apiEnabled === true
    ).map((workflow) => ({
      id: String(workflow.id),
      name: String(workflow.name || workflow.id),
    }));
    const catalog = {
      workflows,
      chats: (chats.data || []).filter((row) => row.published_release_id).map(
        (row) => ({ id: row.id, name: row.slug }),
      ),
      knowledge: stores.data || [],
    };
    const inventory: LegacyInventory = {
      organizationName: org.data.name,
      resources: (resources.data || []).map((row) => ({
        id: row.id,
        name: row.resource_name || row.id,
        type: row.resource_type,
      })),
      chains: (chains.data || []).map((row) => ({
        id: row.id,
        name: row.catalog_id || row.id,
      })),
      featureNames: Object.keys(features).filter((key) => key !== "llmInsights")
        .sort(),
    };
    const sourceHash = await hash(JSON.stringify(inventory));
    if (action === "catalog") {
      return json({
        ok: true,
        catalog,
        inventory,
        providers: providers.map((provider) => ({
          id: provider.id,
          name: provider.name || provider.model,
          model: provider.model,
        })),
      });
    }
    if (action === "apply" || action === "discard") {
      const proposal = await admin.from("studio_authoring_proposals").select(
        "*",
      ).eq("organization_id", orgId).eq("id", studioUuid(body.id))
        .maybeSingle();
      check(proposal.error);
      const row = proposal.data;
      if (!row) throw new HttpError(404, "Proposal not found.");
      if (action === "apply" && row.status === "applied") {
        return json({ ok: true, result: row.result });
      }
      if (
        action === "apply" && row.source_hash && row.source_hash !== sourceHash
      ) {
        throw new HttpError(
          409,
          "Legacy inventory changed. Create a new migration proposal.",
        );
      }
      const manifest = action === "apply"
        ? validateAuthoringManifest(
          body.manifest,
          catalog,
          row.allow_code,
          row.kind === "migration",
        )
        : null;
      const result = await admin.rpc("studio_apply_proposal", {
        p_org: orgId,
        p_actor: actor,
        p_id: row.id,
        p_manifest: manifest,
        p_discard: action === "discard",
      });
      if (result.error) {
        throw new HttpError(
          ["40001", "23505"].includes(result.error.code) ? 409 : 400,
          result.error.message,
        );
      }
      return json({ ok: true, result: result.data });
    }
    if (action !== "generate" && action !== "migrate") {
      throw new HttpError(400, "Unknown authoring action.");
    }
    const allowCode = action === "generate" && body.allowCode === true;
    let base = null;
    let parent = null;
    if (action === "generate" && body.pageId) {
      const result = await admin.from("studio_items").select("*").eq(
        "organization_id",
        orgId,
      ).eq("id", studioUuid(body.pageId)).eq("kind", "page").is(
        "deleted_at",
        null,
      ).maybeSingle();
      check(result.error);
      base = result.data;
      if (!base) throw new HttpError(404, "Target page unavailable.");
      const app = await admin.from("studio_items").select("*").eq(
        "organization_id",
        orgId,
      ).eq("id", base.parent_id).is("deleted_at", null).maybeSingle();
      check(app.error);
      parent = app.data;
      if (!parent) throw new HttpError(404, "Parent unavailable.");
    }
    let manifest;
    let warnings: string[] = [];
    let providerName = null;
    const prompt = action === "generate"
      ? authoringText(body.prompt, 12000, true)
      : "";
    if (action === "migrate") {
      const mappings: Record<string, string> = {};
      for (const [key, value] of Object.entries(object(body.mappings))) {
        mappings[key] = authoringText(value, 200, true);
      }
      const result = legacyMigration(
        inventory,
        catalog,
        studioSlug(body.slug),
        mappings,
      );
      manifest = result.manifest;
      warnings = result.warnings;
    } else {
      const provider = providers.find((candidate) =>
        candidate.id === body.providerId
      );
      if (!provider) {
        throw new HttpError(400, "Select an enabled saved model provider.");
      }
      providerName = provider.name || provider.model;
      const output = await generateStudioProposal(
        provider,
        authoringSystemPrompt,
        JSON.stringify({
          request: prompt,
          allowCode,
          catalog,
          existingPage: base
            ? { slug: base.slug, definition: base.draft }
            : null,
          application: parent
            ? { slug: parent.slug, definition: parent.draft }
            : null,
        }),
      );
      manifest = validateAuthoringManifest(
        parseAuthoringResponse(output),
        catalog,
        allowCode,
      );
      if (
        base &&
        (manifest.pages.length !== 1 || manifest.pages[0].slug !== base.slug)
      ) {
        throw new HttpError(
          400,
          "Refinement must return exactly the selected page with its original slug.",
        );
      }
      warnings = [
        "Review every element and workflow input before applying. Applying creates or updates drafts only. Knowledge components add page access to the referenced stores.",
      ];
      if (allowCode) {
        warnings.push(
          "Custom code was allowed. Review HTML, CSS and JavaScript before previewing or publishing.",
        );
      }
    }
    const saved = await admin.from("studio_authoring_proposals").insert({
      organization_id: orgId,
      kind: action === "migrate" ? "migration" : "prompt",
      prompt,
      provider_name: providerName,
      manifest,
      warnings,
      allow_code: allowCode,
      base_item_id: base?.id || null,
      base_revision: base?.revision || null,
      base_definition: base?.draft || null,
      source_hash: action === "migrate" ? sourceHash : null,
      created_by: actor,
    }).select("*").single();
    check(saved.error);
    return json({ ok: true, proposal: saved.data });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Authoring failed.",
    }, error instanceof HttpError ? error.status : 400);
  }
}
serve(handleAuthoringRequest);
