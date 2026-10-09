# Application platform — batch two

This batch implements the organization application registry and publishing foundation (phase 3), plus reusable managed chat. It retains PDC Config, Resources, Global Settings, the result page and legacy gateway routes. The Appsmith-style drag-and-drop designer, prompt-to-page generation, arbitrary JavaScript editor, and managed knowledge-graph/RAG database catalogue remain later phases. The current page editor uses validated JSON and isolated HTML/CSS elements.

## Admin workflow

1. Open **Organization Studio → Applications & Pages** and create an application.
2. Create pages under that application. Configure heading, text, JSON input, workflow button, result, HTML, or chat elements in the definition editor. A workflow button references an existing enabled workflow with API execution enabled. A chat element references a published Chat Drawer ID.
3. Save and publish each page, then publish the application. The application captures the currently published page releases. To promote a later page change, publish the page and republish its application/canvas.
4. Open the generated member-authenticated URL. Create a canvas to compose published pages using tabs or a responsive grid. Canvas pages require their parent application to be active and published.
5. Use release history to roll back a published pointer; the editable draft remains intact. Activation controls runtime availability. Archiving removes access while retaining release history. Concurrent edits fail with a revision conflict instead of overwriting another administrator's work.

Runtime URLs:

- `/o/:orgSlug/apps/:appSlug` and `/o/:orgSlug/apps/:appSlug/:pageSlug`
- `/o/:orgSlug/canvas/:canvasSlug`
- `/o/:orgSlug/chat/:chatId` (standalone authenticated chat)

Workflow buttons execute encrypted server-side snapshots captured at page publication. Disabling/deleting a workflow still blocks new runs. Runs retain page, element, page-release and container-release provenance, support cancellation and input continuations, and reconnect within the browser session. Arbitrary page HTML is sandboxed with restrictive CSP; workflow credentials and runtime ciphertext are never included in member responses.

## Managed chat drawers

Open **Organization Studio → Chat Drawers** to create, edit, publish, activate, archive and roll back a profile. Set its title, prompts and explicit agent/workflow IDs. These assignments work without a dataspace resource. An optional target resource supplies legacy assignments when the corresponding explicit ID list is empty. An empty list without a resource supplies no assigned items. Free chat and providers follow the organization's shared chat engine configuration.

The original result-page drawer and managed chat share `ChatDrawer`. Streaming responses, agent/workflow selection, uploads, local retrieval, result updates and document context reuse that implementation. Managed chat mounts it inline with its own conversation/upload session. It fetches current configuration and checks active published profile assignments at the backend. Page workflow buttons use publication snapshots; chat workflows intentionally follow the latest enabled workflow configuration.

For Studio, add an element such as:

```json
{"id":"assistant","type":"chat","label":"Assistant","chatId":"PUBLISHED_CHAT_UUID"}
```

For external applications, enable embedding, add exact allowed origins to the profile, and issue an organization embed token through the existing Embed administration. The token's origin must also be allowed there. Publish the profile. Copy either integration from its admin panel:

```html
<script src="https://gateway.example/ptx-chat.js" defer></script>
<ptx-chat id="assistant" src="https://gateway.example"
  org="my-organization" drawer-id="PUBLISHED_CHAT_UUID"
  token="ISSUED_EMBED_TOKEN" style="display:block;height:640px"></ptx-chat>
<script>
customElements.whenDefined('ptx-chat').then(() => {
  const chat = document.querySelector('#assistant');
  chat.context = { resultData: [{ skill: 'Analysis' }], docText: 'Source evidence' };
  chat.addEventListener('ptx-chat:result-change', event => console.log(event.detail));
  // chat.open(); chat.close(); after readiness
});
</script>
```

Or use plain HTML:

```html
<iframe id="assistant" title="AI assistant"
  src="https://gateway.example/chat/embed/my-organization/PUBLISHED_CHAT_UUID#token=URL_ENCODED_EMBED_TOKEN"
  referrerpolicy="strict-origin-when-cross-origin"
  style="width:100%;height:640px;border:0"></iframe>
```

This is a hosted component: both integrations load the same gateway chat runtime, and require reachable configured backend services. The custom element isolates its styling with a shadow root and iframe. The host must preserve a referrer origin. Production origins require HTTPS; localhost HTTP is supported for development. Hosting CSP/frame-ancestors must permit the intended integration origin.

### Host bridge

After `ptx-chat:ready`, an iframe host can send `{type:'ptx-chat:context', detail:{resultData,docText}}` to the iframe using the exact gateway origin as `postMessage` target. Both sender window identity and origin are checked. Context is limited to 1 MiB; organization identity, credentials and agent configuration cannot be overridden through context. Updates replace the supplied context.

Optional host-owned document conversion settings can be passed as `context.uploadConfig`:

```js
{ uploadUrl: 'https://converter.example/parse', authorization: 'Bearer HOST_CONVERTER_TOKEN', queryParams: { format: 'text' } }
```

This preserves the original drawer's converter upload path; the URL must use HTTPS. The converter must support browser CORS. These are browser-visible host credentials, not private gateway provider credentials. Plain-text uploads do not need a converter.

Inbound messages: `ptx-chat:context`, `ptx-chat:open`, `ptx-chat:close`.
Outbound messages/custom DOM events: `ptx-chat:ready`, `ptx-chat:result-change`, `ptx-chat:document-change` (`{text}`), `ptx-chat:opened`, `ptx-chat:closed`, `ptx-chat:error` (`{message}`). Iframe hosts must also validate incoming `event.source` and exact gateway `event.origin`.

Embedding requires an active published profile, its exact origin allowlist, and a valid existing organization embed token. Tokens travel in the iframe fragment, not the HTTP URL query. Bootstrap refreshes every 60 seconds, and issues an execution token lasting 15 minutes. Profile assignments are checked for requests carrying the profile ID. **Existing execution tokens are organization-scoped; this batch does not introduce profile-scoped credentials.** A token holder retains the permissions of the existing gateway execution token, including calls without a profile ID. Revocation is checked on subsequent bootstrap; an issued execution token can remain valid until expiry. Do not treat an origin allowlist as user authentication.

## Deployment

Apply `supabase/migrations/20261009120000_studio_applications.sql` through the project's normal migration process, after existing migrations. Deploy `studio-api`, `llm-insights`, `chat-with-result`, `workflow-api-request`, and `workflow-runs` with the changed shared modules. Redeploy other functions that bundle `_shared/workflowRuns.ts` as part of the normal function deployment. Deploy the frontend including `public/ptx-chat.js`, and retain SPA route fallback for deep links.

Studio uses existing Supabase service credentials, organization workflow encryption configuration, `embed-auth`, `pdc-auth`, and the workflow worker. The new API has `verify_jwt = false` in the function configuration because it explicitly validates member credentials or embed tokens itself. Studio tables and mutation RPC are service-role-only; organization-admin and optimistic revision checks also run inside the mutation RPC.

The migration and functions have **not** been applied to a live environment by this implementation. Back up and follow the project's normal deployment procedure before enabling Studio for users.

## Validation

- `npm run test:applications`: prototype rendering limits and chat bridge origin/context/converter checks.
- `npm run test:workflow`: existing agent/workflow regressions plus Studio API publication, tenant isolation, snapshot, rollback, origin/token, and direct chat assignment tests.
- `npm run test:workflow:worker`: worker concurrency, continuation and failure handling (requires Deno).
- Deno type checks for all four directly changed function entrypoints.
- Real PostgreSQL 15 migration and `scripts/studio-database-regression.sql`: privileges, admin enforcement, revision conflicts, atomic publication, draft separation, rollback, tenant constraints and archive history.
- `npm run test:studio:browser`: Chromium admin creation/publication, runtime workflow output, canvas/mobile layout, inline streamed chat, cross-origin custom element, context bridge, text upload, open/close, unauthorized access and forged-origin rejection. API responses are deterministic fixtures; this does not exercise live providers, model downloads or production CORS.

Browser validation requires a dev server at `http://127.0.0.1:4173`, Playwright/Chromium, and `.env.local` with `VITE_SUPABASE_URL` or `STUDIO_TEST_API_URL`. Playwright 1.64.0 was installed outside the repository for validation. Set `PLAYWRIGHT_MODULE` to its `index.mjs` path and `PLAYWRIGHT_BROWSERS_PATH` when using a temporary install. Browser output screenshots go to `/tmp/ptx-studio-validation/screenshots`.

For SQL validation, use an **empty disposable database only**: load `scripts/studio-test-bootstrap.sql`, the new migration, then `scripts/studio-database-regression.sql`, with `psql -v ON_ERROR_STOP=1`. The bootstrap supplies a minimal related schema and is not a production migration.

The production build passes. The repository-wide frontend TypeScript check still reports 90 pre-existing diagnostics; the pristine baseline had 92 (two duplicate ChatDrawer keys were fixed). No new frontend diagnostics were introduced. Targeted lint is used for the new frontend/schema files; a full-repository lint cleanup is outside this batch.
