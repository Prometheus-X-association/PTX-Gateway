# Backend workflow execution

Workflows can run through the dashboard, organization-scoped API keys, or multiple signed webhook endpoints. Each accepted request creates a separate durable run. PostgreSQL stores the queue, checkpoints, and execution trace; a dedicated Deno worker executes runs without an open browser.

## Deployment

1. Apply `supabase/migrations/20261005120000_workflow_execution.sql` using the project's normal migration process.
2. Generate two independent random secrets, for example with `openssl rand -base64 32`. Configure `WORKFLOW_SECRETS_KEY` and `WORKFLOW_INTERNAL_SECRET` on both Supabase functions and every worker. The encryption key must decode to exactly 32 bytes. Keep these values out of frontend environment variables. Existing public result-page tokens also require the functions' configured `PDC_EXECUTE_TOKEN_SECRET` or `SUPABASE_INTERNAL_JWT_SECRET`.
3. Deploy `workflow-runs`, `workflow-webhook`, and the updated `chat-with-result`, `workflow-api-request`, and `llm-insights` functions. The configuration disables gateway JWT verification for the two new functions because they implement user-token/API-key and webhook-signature authentication themselves.
4. Start the worker using the backend environment in [the example](../services/workflow-worker/.env.example). With Deno installed, export those environment values and run `npm run workflow:worker`. For Docker, build from the repository root:

   ```sh
   docker build -f services/workflow-worker/Dockerfile -t ptx-workflow-worker .
   docker run --name ptx-workflow-worker --restart unless-stopped \
     --env-file services/workflow-worker/.env \
     --add-host host.docker.internal:host-gateway \
     --memory=1g --cpus=2 --stop-timeout=900 ptx-workflow-worker
   ```

   Use an environment file accessible only to the deployment operator. The worker needs the service-role key, anon key, Supabase URL, and the two shared secrets. `WORKFLOW_FUNCTIONS_URL` can override the function gateway address. There is no public worker port. Multiple worker instances can share the same database.

5. Open **Admin → Agent Operations → Workflows**, edit a workflow, enable the required execution modes, and save the organization settings. Enable **Run chat workflows on backend** to move that workflow's result-page execution to the worker. Existing workflows retain browser execution until enabled. The builder's canvas debug tests remain browser tests; **Run saved workflow** exercises the backend.
6. Under **Manage integrations and runs**, create organization-specific API keys and as many webhook endpoints as required. New credentials are displayed once; webhook secrets can be rotated and API keys revoked.

Applying the migration and deploying the functions alone does not execute jobs: the worker must be running. Accepted jobs remain queued while it is unavailable. The implementation does not provision a production worker automatically.

The JavaScript sandbox uses fresh Deno workers with `permissions: "none"`, a per-node deadline, and no access to the parent's environment, files, network or subprocesses. This uses Deno's [worker permission controls](https://docs.deno.com/api/web/workers/). The Docker memory/CPU limits bound the entire worker service; each service runs at most `WORKFLOW_WORKER_CONCURRENCY` jobs. Use the tested Deno version pinned in the Dockerfile.

## API

Send requests to `POST <SUPABASE_URL>/functions/v1/workflow-runs`. Use `Authorization: Bearer <workflow-api-key>` for integrations. Signed-in users use their access token and `x-organization-id`. The organization header must match the authenticated identity's membership or key ownership.

Start a run:

```json
{
  "action": "start",
  "workflowId": "saved-workflow-id",
  "input": { "orderId": "order-123" },
  "userMessage": "Analyze this order",
  "docText": "Optional source document text"
}
```

The response is HTTP 202:

```json
{ "ok": true, "runId": "uuid", "status": "queued" }
```

An optional `Idempotency-Key` header deduplicates retries within the organization, caller and workflow. Reusing it with different inputs returns 409. Different users, API keys and webhook endpoints have separate deduplication scopes.

Additional actions:

| Action | Required fields | Result |
|---|---|---|
| `get` | `runId` | Status, stop node/reason, waiting question, final output |
| `steps` | `runId`, optional `after` sequence | Up to 200 ordered node visits; paginate using the last sequence |
| `list` | Optional `workflowId` | Latest 50 accessible runs |
| `resume` | `runId`, `nodeId`, `answer` | Atomically queues continuation of a waiting question |
| `cancel` | `runId` | Cancels queued/waiting runs or requests cancellation of active execution |

Organization admins can inspect all organization runs. Users and API keys can inspect and control their own runs only. An API key is limited to the workflows selected at creation. Webhook runs are visible to organization admins; possessing another integration's key does not grant access to them.

For original document bytes, supply `attachments` using `{name,mimeType,size,base64}`. Attachments are limited to ten files and a 16 MiB total request. No document URL is fetched from a caller-supplied reference.

The frontend uses `source: "dashboard"` for backend chat execution. Public result-page execution also verifies the existing organization execution token, workflow target availability and an independent private browser-session identifier. The browser stores the pending run ID in session storage to reconnect after refreshing the same result page. API/webhook execution does not require a frontend session.

## Multiple webhooks

Each endpoint has an independent ID, signing secret, input mapping and enabled switch:

```text
POST <SUPABASE_URL>/functions/v1/workflow-webhook/<endpoint-id>
```

Required headers:

| Header | Value |
|---|---|
| `x-workflow-timestamp` | Unix timestamp in seconds, within five minutes |
| `x-workflow-delivery-id` | Stable delivery ID, at most 200 characters |
| `x-workflow-signature` | Lowercase hexadecimal HMAC-SHA256 signature |

Compute the signature over the exact UTF-8 bytes of:

```text
timestamp.deliveryId.rawRequestBody
```

The delivery ID is included in the signature to prevent a captured delivery from being submitted under a new ID. Retry with the same delivery ID and payload, updating the timestamp and signature if necessary. A duplicate returns the original run ID. Keep the raw JSON serialization unchanged when signing and sending.

An empty input mapping assigns the whole payload to `input`. For example, `{"input":"order","userMessage":"message"}` selects these paths from the JSON payload. Mappable fields are `input`, `userMessage`, `docText`, and `conversationHistory`. Organization and workflow ownership always come from the endpoint record. Disabling an endpoint prevents new deliveries; accepted runs retain their snapshots.

The admin API actions are `webhooks`, `create_webhook`, `update_webhook`, `rotate_webhook`, `delete_webhook`, `keys`, `create_key`, and `revoke_key`. Key creation accepts `workflowIds` and an optional future `expiresAt`. Lists do not expose key hashes or encrypted secrets.

## Concurrency and traceability

Workers atomically claim separate runs. A workflow definition is never locked for the duration of its execution. A short database transaction serializes claims to enforce concurrency limits across worker instances. Defaults are four worker slots, eight active runs per organization and four active runs per workflow. Configure organization limits identically across worker instances; each workflow has its own saved limit. Excess work remains queued.

Each node visit receives its own sequence number, including loops and repeated questions. Traces include input/output summaries, start/end timestamps, duration, selected outgoing connections and errors. The dashboard displays the failed/current/last node and can focus it on the canvas. If the current graph has changed, a historical node ID may no longer exist on that canvas; the run trace retains its original name/type.

Run statuses are `queued`, `running`, `waiting_for_input`, `succeeded`, `failed`, `cancelled`, `timed_out`, and `incomplete`. An unconnected branch ends as `incomplete`. Backend runs stop on node errors. Execution deadlines count active execution time, excluding queue and user-wait time. Concurrent resume requests accept one answer. Cancellation of an active request is cooperative and cannot undo an external action already performed.

Run definitions and provider credentials are encrypted snapshots. Trace summaries redact configured secrets and sensitive field names, and are truncated for readability. Final outputs preserve their full arrays and strings while redacting secrets. Run inputs and checkpoints are private database records, accessible only to the backend service. No direct table access is granted to anonymous or authenticated clients.

Workers heartbeat their leases. If a worker dies, a subsequent worker claim marks the interrupted run and active node failed with an explanatory stop reason. It does not replay the run automatically: a remote action might have completed before its response was lost. Review external effects before submitting a new run. Automatic node retries and completion-callback deliveries are not enabled in this initial implementation.

Set a database retention policy for completed run records appropriate to your organization. Deleting a run cascades to its steps. Preserve queued/running/waiting runs. Rotating `WORKFLOW_SECRETS_KEY` requires re-encrypting stored webhook secrets and run snapshots; keep the key stable until that migration is performed.

`update_result` returns replacement result data. An attached result-page chat applies it to the displayed table; API/webhook execution returns it as the final output without implicitly modifying another user's result page.

## Verification

- `npm run test:workflow` checks API/webhook authentication, ownership, concurrent/idempotent starts, signatures, multiple endpoints, key revocation and resume races.
- `npm run test:workflow:backend` checks sandbox permissions/deadlines, concurrent graph execution, checkpoint continuation, routing, errors, encryption and redaction.
- `npm run test:workflow:worker` starts the real Deno worker against a temporary localhost PostgREST/agent contract server and verifies persisted concurrent execution, failed-node traces, signed agent calls and paused-run continuation. It requires Deno on PATH, or `DENO_BIN` pointing to a Deno executable.
- Run `scripts/workflow-database-regression.sql` after the migration in a disposable database to verify claim limits, organization foreign keys, privilege restrictions and interrupted-worker traces.
- `npm run build` validates the frontend bundle.
