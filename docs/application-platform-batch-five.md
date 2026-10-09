# Batch five — prompt authoring and migration (phase 7)

## Delivered

**Organization Studio → Prompt & Migration** provides prompt-generated applications, refinement of an existing page, reviewable migration proposals, and reversible gateway rollout.

Prompt authoring uses an enabled model provider already saved in the organization’s orchestration configuration. OpenAI-compatible chat completions, Anthropic messages and Gemini generateContent adapters are supported. The provider must have a model, API key and public HTTPS endpoint; redirects and private/local endpoints are rejected. Requests time out after 60 seconds; input context, model responses, proposal size and page counts are bounded. Live providers still need an environment-specific smoke test: automated validation uses deterministic provider responses.

The model receives the administrator’s prompt, allowed workflow/store/chat names and IDs, and the selected page/application definition when refining a page. It does not receive provider credentials in the prompt, PDC credentials, raw legacy settings, source documents or knowledge records. Provider credentials are used only in outbound server headers. Provider errors are reduced to status messages. Avoid entering secrets into prompts or page definitions.

Generated output is validated against Studio’s schema and the current organization’s catalog. Unknown workflow IDs, inactive knowledge stores, unpublished chat drawers, invalid input JSON and unapproved custom code are rejected. Generated applications support 1–16 pages. HTML/CSS/JavaScript requires an explicit checkbox and uses the existing isolated code component. Preview is explicit; workflow buttons, chat, knowledge and legacy components do not execute operations in the preview.

## Review and publish

1. Select a provider and either **New application** or an existing page to refine.
2. Describe the desired pages, responsive layout, workflow actions and knowledge views. For example: “Build four pages for source documents, extracted skills, framework mappings and job profiles using the Skills knowledge store.”
3. Generate a proposal. Generation stores a private proposal and creates no Studio items or releases.
4. Review warnings, the structural change summary, original draft (for refinement), and proposed JSON. Edit JSON and explicitly preview it. A validation error disables application.
5. **Apply to drafts** atomically creates an inactive application and pages, or updates the selected page draft. Refinement checks the original draft revision, preserves the page URL and leaves its published release unchanged. Applying the same proposal again returns its original result. Duplicate URLs or a failure in any page roll back the entire application.
6. Knowledge components add their resulting page IDs to referenced active stores in the same transaction. This grants the page the existing store access required for publication; other settings remain intact.
7. Open **Applications & Pages**, review workflow input contracts and access, publish each page, then publish the application. Existing visual/code editing and release rollback continue to work.

The latest 50 proposals appear in history. Private audit records preserve the prompt, provider name, initial manifest, warnings, base revision/definition, reviewed applied manifest, creator, applying/discarding actor, timestamps and resulting application/page IDs. Applying edited JSON preserves both the original proposal and the applied version. Discarded proposals cannot be applied.

## Legacy migration

The wizard reads a sanitized inventory: organization name, resource IDs/names/types, service-chain IDs/catalog identifiers and feature section names. It does not copy connection details, payload configuration or credentials.

Every migration creates a **Legacy gateway** compatibility page, containing the current organization’s existing gateway in an iframe. Analytics, data selection, processing, results and chat retain their legacy behavior there. Its source is constructed by the runtime as `/:orgSlug?legacy=1`; definitions cannot supply an arbitrary iframe URL. The original gateway is not deleted or rewritten.

Administrators may map software resources and service chains to existing enabled API workflows. Each mapping creates a native Studio page with request JSON, a workflow button and a result component. The initial request contains `legacyTargetId`; adapt it to the workflow’s real input contract before publishing. Up to 15 targets can be mapped per migration application. Unmapped targets remain in the compatibility page and appear in warnings.

This is a compatibility-led migration, **not an automatic conversion of legacy PDC payloads, upload flows, exports, authorization plugins or custom charts**. Those operations need explicit workflows or manual visual/code work. PDC Config, Resources and Global Settings remain available. Migration does not change existing gateway links, public embeds, tokens or settings. The sanitized inventory fingerprint is rechecked when applying; a changed inventory requires a new proposal. Changes to credentials and raw legacy settings are not part of that fingerprint because compatibility continues to use the live legacy configuration.

## Gateway rollout and rollback

After publication, **Set gateway default** selects an active published application with published pages. It changes only the entry point for signed-in organization members visiting the bare `/:orgSlug` route.

- Anonymous users, `/embed`, and URLs with query parameters continue to the legacy gateway.
- `?legacy=1` explicitly bypasses Studio, including inside the compatibility iframe.
- Direct Studio URLs and organization canvases continue to work independently.
- An unavailable application or an application with no available pinned pages falls back to the legacy gateway.
- Select **Legacy gateway (revert rollout)** to restore the old default. Optimistic revisions reject stale rollout changes; each change records the old/new application, actor and time.

## Deployment

Apply `supabase/migrations/20261009160000_studio_authoring.sql` after the Studio and knowledge migrations. Deploy the new `studio-authoring` function and updated `studio-api` with shared modules, then the frontend. The function uses the existing Supabase URL/service-role configuration and saved organization providers. Its JWT gateway setting is disabled in `supabase/config.toml` because the handler performs user-token, active-membership and administrator checks itself. Proposal/rollout tables and mutation RPCs are service-role-only.

No live migration, deployment, provider request or gateway rollout was performed during implementation. Deployment does not automatically generate proposals, publish pages or change defaults.

## Validation

- Production frontend build passes (existing large-chunk warnings remain).
- Deno type checks pass for both edge functions; targeted ESLint passes for new TypeScript/React files.
- `npm run test:applications` and `npm run test:workflow` pass, including authoring schema/reference validation, code opt-in, provider adapters, response limits, role/organization restrictions, draft-only generation, stale inventory and rollout fallback.
- Real disposable PostgreSQL 15 checks pass for the new migration: private grants, role isolation, atomic rollback, idempotent application, knowledge bindings, stale refinement, publication preservation, rollout revision conflicts and rollback audit. Earlier Studio and knowledge SQL regressions also pass.
- `npm run test:studio:browser` passes with mocked backend/provider fixtures: generate/review/edit/preview/apply, existing-page refinement, compatibility migration, rollout/bypass/revert, mobile layout, and all earlier builder, knowledge and embedded-chat flows. Browser tests do not replace the independent API and SQL tests.
- Full frontend TypeScript checking reports the same 90 pre-existing diagnostics as batch four, with no new diagnostics.

Repeat SQL checks only in an **empty disposable database**, loading `scripts/studio-test-bootstrap.sql`, `scripts/knowledge-test-bootstrap.sql`, the Studio and knowledge migrations, this migration, and `scripts/studio-authoring-database-regression.sql` with `psql -v ON_ERROR_STOP=1`. Bootstrap scripts must never run against an application database.
