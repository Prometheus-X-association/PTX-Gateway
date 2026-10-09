# Batch four — knowledge infrastructure and skill application (phases 5–6)

## Delivered

**Organization Studio → Knowledge & Skills** manages organization-owned RAG stores, knowledge graphs and vector connections. Administrators can create, edit, activate, deactivate and archive stores; bind pages, agents and workflows; configure document-change builds; and enable member editing. Connector bearer tokens are encrypted using the existing organization workflow key infrastructure and never returned to the browser. Changing a connector endpoint requires replacing or clearing its credential.

Managed stores provide PostgreSQL full-text retrieval over overlapping document chunks and a relational evidence graph. **Vector similarity retrieval uses an external REST adapter**; this batch does not install a vector database or generate embeddings. The managed `rag` and `knowledge_graph` types share the same source/evidence infrastructure.

The generated skill application contains four published, editable Studio pages:

1. **Source documents** — text import, URL/type metadata, revisions, actor history and automatic document-change workflow jobs.
2. **Extracted skills** — descriptions, framework/category/expertise fields and mandatory evidence quoting a particular source revision.
3. **Framework mappings** — framework, category and expertise level linked to a saved skill revision.
4. **Job profiles** — occupation descriptions and skill/category/expertise requirements linked to saved skills.

All views share the same store and traceable graph. The **History & evidence** view records who changed a record, when, its original body, and the workflow run responsible for an imported record. **Traceable graph** displays navigable relationships between jobs, mappings, skills and source revisions. Archives preserve history and evidence links while excluding documents from current retrieval. Workflow provenance IDs and workflow names/IDs remain after ordinary workflow-run retention removes execution records.

## Setup and use

1. Create a managed knowledge graph using **New knowledge store**. Set its name and activation; use configuration JSON for page, agent and workflow assignments. Keep `memberWrites: false` for administrator-only editing, or enable it for organization members.
2. Import a text document through **Open skill workspace → Source documents → Add document**. TXT, Markdown, CSV and JSON files can be loaded as text, up to 400 KB. Record a source URL and document type (`course`, `cv`, `occupation`, etc.) when useful.
3. Add a skill with an exact source quote and document ID/revision. Add mappings and job profiles using its ID. The server rejects missing, fabricated, cross-store or cross-organization references.
4. Assign existing enabled workflows using `settings.workflowIds`. Select a workflow in **Knowledge operations**, provide a build request and queue it. The workflow must support API execution and return the output contract below.
5. Set `settings.changeWorkflowId` to one of the assigned workflows to queue an extraction operation on each source-document create/update. The source record and queued job commit in one transaction.
6. Review generated records, then **Apply reviewed records**. The server reads the succeeded run output itself, validates all records/evidence, and commits the import atomically. Applying the same job again is idempotent. A failed import commits no partial records.
7. Click **Create skill application**. This atomically publishes four Studio pages and their application and assigns the pages to the store. Repeating the action opens the existing application. Customize the pages in the visual/code builder. Each contains a new **Skill workspace** component with a store ID and configured view.

Source URLs are metadata, not automatically fetched by the browser. Use existing workflow API nodes and authorized connectors to import external database documents or URL content. Document conversion and live model providers must be configured in those workflows. The application does not pretend to extract skills without a configured extraction workflow.

Example store settings:

```json
{
  "pageIds": [],
  "agentIds": ["saved-agent-id"],
  "workflowIds": ["extract-skills", "classify-skills", "generate-occupations"],
  "changeWorkflowId": "extract-skills",
  "memberWrites": false
}
```

## Build and realtime operations

The new knowledge dispatcher claims jobs with a database lease and starts the existing durable workflow engine. Its stable job idempotency key reconnects the same run after a dispatcher interruption. Document-change inputs include `documentId`, `documentRevision`, `document`, and `name`; all jobs also receive `knowledgeStoreId` and `knowledgeJobId`. Manual build input can contain a prompt, source URL or document request.

Workflow output must be JSON (or a JSON string) containing up to 100 validated records:

```json
{
  "records": [{
    "kind": "skill",
    "name": "Data analysis",
    "body": {
      "description": "Analyze evidence",
      "framework": "Internal",
      "category": "Analytical",
      "level": "Advanced",
      "evidence": [{
        "documentId": "EXISTING_DOCUMENT_UUID",
        "version": 1,
        "quote": "exact text from that source revision"
      }]
    }
  }]
}
```

Mappings use `{skillId, framework, category, level}`. Jobs use `{description, requirements:[{skillId, category, level}]}`. Documents use `{text, url, documentType}`. Skills cited by a mapping or job must already exist; generate/apply skills first, then generate mappings/jobs using their returned IDs. Imports create new records; use the record editor/API to revise existing records. This batch does not automatically reconcile duplicate generated skills.

A completed valid build enters `review`; invalid output or a failed/incomplete run is marked `failed`. Waiting/paused runs remain `running` in the knowledge queue; inspect and resume them in Agent Orchestration. Failed jobs can be requeued with a corrected request/workflow. Review/application requires the initiating member or another authorized store editor to retain access. Record revision history identifies the reviewer who commits the import and its originating workflow run.

The dispatcher checks current organization, member, store and workflow assignment status before continuing work. Store deactivation stops new retrieval/writes and causes pending jobs to fail closed. It does not automatically cancel an already-started workflow; cancel that run in Agent Orchestration when needed.

## Retrieval and agent operations

`knowledge-api` accepts POST JSON with `action`, `storeId` and an organization context. Member calls use the Supabase session and `x-organization-id`; Studio components include `pageId`, which must be assigned to the store. Read/write permissions remain organization/store-wide: page assignments are availability settings, not independent row-level user roles.

Actions include `list`, `create_store`, `save_store`, `delete_store`, `snapshot`, `history`, `graph`, `query`, `save_record`, `delete_record`, `queue`, `review_job`, `apply_job`, and `create_skill_app`. Mutations of existing stores/records require `expectedRevision`. Records and history are bounded/paginated; graph inspection shows up to 500 nodes and 1,000 edges.

Example secure REST query from a workflow integration:

```json
{"action":"query","storeId":"STORE_UUID","workflowId":"ASSIGNED_WORKFLOW_ID","query":"data analysis","limit":8}
```

Send a `wfk_` workflow API key as a Bearer token. The key must permit the requested workflow, and the store must assign that workflow. Workflow keys have **query-only** knowledge access; they cannot read configuration or mutate records. Internal worker calls can instead use the existing signed live-run lease headers. User sessions remain required for management and skill editing.

Authenticated saved-agent chat automatically retrieves from stores assigned to the active agent. Signed worker agent calls retrieve from stores assigned to that workflow. At most five assigned stores are queried, with five matches per store. Retrieved evidence is explicitly labelled as untrusted source content with document/revision identifiers, and retrieval failure is visible. Public gateway/embed execution tokens do not grant private organization knowledge access. Existing browser-local RAG remains separate and unchanged.

### External vector/graph/RAG adapters

Configure an HTTPS endpoint without URL credentials, fragments or query parameters, and optionally save its Bearer token. Add its exact hostname to the backend `KNOWLEDGE_REST_ALLOWED_HOSTS` environment variable (comma-separated). Requests fail closed on missing DNS, private/local addresses, an unapproved host, redirects, timeout or oversized responses. Use a trusted adapter host; DNS screening and an operator allowlist are not a general-purpose hostile-network sandbox.

The adapter receives:

```json
{"action":"query","query":"skills","limit":8,"storeId":"STORE_UUID"}
```

It must return:

```json
{"matches":[{"sourceId":"external-document-id","content":"Retrieved evidence","url":"https://source.example/document","score":0.92}]}
```

Responses are limited to 500 KiB, 20 matches, and 12,000 characters per match. External matches are labelled external and are not silently converted to verified local evidence. Import the original source text/version into the managed store before using it for verified skill citations. Provider-specific embedding, indexing and graph operations belong in the adapter or assigned build workflow.

## Deployment

1. Apply `supabase/migrations/20261009140000_knowledge_skills.sql` after the existing Studio/workflow migrations.
2. Deploy `knowledge-api`, `studio-api`, and `chat-with-result` with their updated shared modules. Redeploy other functions importing the changed shared schema through the normal backend deployment process. `knowledge-api` has `verify_jwt = false` because it explicitly verifies member, scoped workflow-key or signed worker credentials itself.
3. Run **both** the existing workflow worker and the new knowledge dispatcher. The dispatcher uses the same backend environment as `services/workflow-worker/.env`, including Supabase service credentials and organization encryption configuration. With environment variables exported, run `npm run knowledge:worker`. Docker alternative:

   ```sh
   docker build -f services/knowledge-worker/Dockerfile -t ptx-knowledge-worker .
   docker run --name ptx-knowledge-worker --restart unless-stopped \
     --env-file services/workflow-worker/.env \
     --add-host host.docker.internal:host-gateway \
     --memory=512m --cpus=1 ptx-knowledge-worker
   ```

4. Deploy the frontend. The local `run-all.sh` stack now starts/stops the dispatcher alongside the workflow worker; `stop-stack.sh` includes it. Dispatcher logs are at `/tmp/ptx-gateway-knowledge-worker.log` for that local stack.

No live migration or deployment was performed during implementation. No external database or model-provider credentials were configured. Without the dispatcher, jobs remain queued; without the workflow worker, their workflow runs remain queued.

## Validation

- PostgreSQL 15: fresh migration, service-only privileges, admin/member restrictions, revision conflicts, tenant-scoped retrieval, evidence quote validation, source history, mapping/job edges, atomic template provisioning, import rollback/idempotency, archive graph retention, exclusive job claims, and compatibility with workflow-run retention.
- API/dispatcher regressions: tenant isolation, credential redaction, page assignments, disabled stores, workflow-key scopes, durable dispatch/recovery, review-state validation, malformed model output, and encrypted external-adapter credentials with URL/DNS/allowlist rejection.
- Chromium: knowledge store configuration, source/skill/mapping/job editing, provenance navigation, graph links, retrieval, build review/application and the published skill app on desktop/mobile. The same suite reruns the visual builder and inline/external chat flows.
- Production build, targeted ESLint, backend Deno type checks, existing application/workflow tests and existing real-Deno workflow-worker regression. Stack script syntax is checked with `bash -n`.
- Full frontend TypeScript still has 90 pre-existing diagnostics, with no new diagnostics from this batch.

Browser and external-adapter tests use deterministic fixtures. Dispatcher contract tests exercise the real processor against a database double; SQL concurrency/transaction checks run separately in real PostgreSQL. Live embedding models, external databases and provider output quality have not been tested. The complete project stack/Docker deployment was not started against application data.

To repeat SQL tests, use an **empty disposable PostgreSQL database only** and load, in order: `scripts/studio-test-bootstrap.sql`, `scripts/knowledge-test-bootstrap.sql`, the Studio migration, this knowledge migration, and `scripts/knowledge-database-regression.sql`. Use `psql -v ON_ERROR_STOP=1`. These bootstrap files are not production migrations.
