# Application platform: batch one

Status: architecture prototype and admin restructuring implemented. No database migration or Appsmith deployment is required for this batch.

## Delivered

- `/admin` opens Agent Orchestration, with Workflows selected. Sidebar destinations use `?section=` and support browser back/forward and deep links.
- Overview reads real organization-scoped worker health, queue counts and waiting runs; failures remain visible rather than being represented as zero activity.
- Applications & Pages provides a responsive authenticated workflow application prototype with JSON input, a run action, polling, cancellation, JSON output and a table for record arrays.
- `/admin/application-preview/:organizationId` opens the prototype outside the admin layout. It requires admin authentication and a matching active organization.
- A custom HTML/CSS/JavaScript preview uses an opaque-origin sandboxed iframe and restrictive resource CSP. It receives no application tokens or data. No iframe message bridge is introduced.
- Existing PDC Configuration, Resources and Global Settings remain available. Analytics Selection, Data Selection, Processing and Results settings are grouped under Legacy Gateway. Visualization, Embed, OIDC, user and organization settings retain their existing access rules under Global Settings.
- Legacy result-page chat configuration remains available in a collapsible section of Agent Orchestration. Agent Skills is labelled Agent Capabilities to distinguish it from occupational skills in future applications.

The application preview is explicitly temporary. It does not claim to provide persisted apps, releases, arbitrary end-user access, drag-and-drop editing, prompt generation or managed knowledge stores. These belong to subsequent batches. Navigating away resets preview edits and run selection; backend runs continue and remain accessible in Manage runs. The standalone preview opens a fresh prototype, not a saved copy of the current editor.

## Architecture decision

Retain the native React/Supabase runtime and existing Deno workflow execution service. Adopt Appsmith's editor interaction model (component palette, element tree, canvas, property inspector and action/data bindings), without importing or forking its runtime in this batch.

| Option | Fit | Remaining evidence needed |
| --- | --- | --- |
| Integrate self-hosted Appsmith | Established widget editor; separate service and identity lifecycle | Validate private embedding entitlement, SSO, organization boundary enforcement, responsive layouts, version promotion and operational costs in a dedicated trial |
| Native editor and runtime | Reuses current organization identity, API and workflow infrastructure; application contracts remain under project control | Prototype drag/drop, accessibility and responsive layout in the builder batch |
| Fork Appsmith | Maximum source control | Assess upgrade burden and maintained integration surface before considering a fork |

Decision for the prototype: native. This is not a claim that Appsmith integration has been installed or tested. The earlier documentation review found custom HTML/CSS/JS widgets and private embedding labelled Enterprise:

- https://github.com/appsmithorg/appsmith
- https://docs.appsmith.com/reference/widgets/custom
- https://docs.appsmith.com/advanced-concepts/embed-appsmith-into-existing-application

The prototype exercises the native path: authenticated action, workflow result table, responsive containers and isolated custom code. A full visual editor remains a separate milestone.

## Page and action contract

`src/lib/applicationPrototype.ts` defines version 1 of a minimal `ApplicationPageDefinition`: page ID, organization ID, title, access policy, stable element IDs and types, and a submit action bound to a workflow ID and the JSON input element. The preview exposes the definition for inspection. It is not yet a persisted or published schema.

The browser invokes the existing `workflow-runs` endpoint with the authenticated session and `x-organization-id`. It sends `{action: "start", workflowId, input}` and deliberately does not use `source: "dashboard"`, which is reserved for legacy result-page execution. The backend enforces organization membership, saved workflow state and API execution enablement. It snapshots the workflow at run creation; this prototype does not add release-pinned workflow versions.

The UI limits input to 256 KiB, accepts every valid JSON shape, polls active/waiting runs and escapes output through React. Backend request validation remains authoritative. Record-array results display at most 100 rows and 20 columns; the complete JSON output remains available. Page labels and organization IDs in a future saved definition must never grant permissions by themselves.

The custom widget is admin-authored preview code. Its sandbox omits same-origin, popup, form and top-navigation privileges. Resource CSP blocks ordinary external resource loads and fetch connections. This is not a production containment guarantee for arbitrary untrusted code: browser resource exhaustion and self-navigation require further evaluation before publishing custom widgets for general authors. Future widget bindings need an explicit, validated capability bridge; never pass session tokens to custom code.

## Route and permission plan

Current prototype routes are admin-only. Existing `/:slug`, `/embed` and `/workflow/respond` behavior is preserved.

Batch two should add:

- `/o/:organization/apps/:application/:page` for published application pages.
- `/o/:organization/canvas/:canvas` for organization compositions.
- Organization-owned applications, pages, immutable page versions, releases and action bindings with row-level access policies.
- Independent draft/published and active/inactive state; optimistic concurrency on edits; rollback by release pointer.
- Explicit viewer, builder, publisher and operator permissions. Viewer routes must resolve authorized published definitions server-side.
- Release-pinned workflow references and input schemas, validated action APIs, scoped run visibility and event subscriptions.
- Organization/user-scoped reconnection for active runs and a versioned custom-widget input/output interface.

Use additive tables and migrations. Keep legacy organization settings and gateway routes intact during rollout. Knowledge collections, graph assertions and vector indexes should be organization-owned backend objects in the later knowledge batch. A PDC node should reference existing configuration/resources and validated payload templates; this batch preserves those integration settings without introducing a new node type.

## Acceptance walkthrough

1. Start the normal local stack with its database migrations and worker. Sign in as an organization administrator.
2. Open `/admin`; verify Agent Orchestration and Workflows are selected.
3. Verify PDC, Resources and Global Settings still load, and all four gateway settings can be reached through Legacy Gateway.
4. Save an enabled workflow with API execution enabled, a Request data trigger and an output node. A simple trigger-to-output workflow is sufficient; no external model credentials are needed for that case.
5. Open Applications & Pages, refresh workflows, select it and enter `[{"skill":"Analysis","sourceDocumentId":"document-1"}]`.
6. Run the workflow. Verify queued/running status followed by succeeded and the returned JSON/table. Disable result-page chat and confirm this standalone operation still works.
7. Try malformed JSON, a failed workflow, a waiting workflow and cancellation. Stop the worker and verify queued state is explicit.
8. Open standalone preview. An organization ID different from the active organization must display a mismatch; signed-out access must require login.
9. Preview custom code and verify it cannot access parent DOM/session storage. Inspect the iframe sandbox and CSP; test at mobile and desktop widths with keyboard navigation.
10. Switch organizations and confirm prior organization workflow selections, output and admin component state are reset.

Automated checks: `npm run test:applications`, `npm run test:workflow`, `npm run test:workflow:worker`, `npm run build`, and targeted ESLint. The API regression covers authenticated prototype execution, disabled legacy chat, output retrieval, API-mode enforcement and organization isolation using the existing backend contract double. Full browser/live-backend acceptance requires the running stack and an authenticated test account.
