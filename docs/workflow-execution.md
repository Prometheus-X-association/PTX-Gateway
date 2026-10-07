# Backend workflow execution

Workflows can run through the dashboard, organization-scoped API keys, or multiple signed webhook endpoints. Each accepted request creates a separate durable run. PostgreSQL stores the queue, checkpoints, and execution trace; a dedicated Deno worker executes runs without an open browser.

## Deployment

1. Apply the workflow migrations through `supabase/migrations/20261007200000_workflow_events.sql` using the project's normal migration process.
2. Generate two independent random secrets, for example with `openssl rand -base64 32`. Configure `WORKFLOW_SECRETS_KEY` and `WORKFLOW_INTERNAL_SECRET` on both Supabase functions and every worker. The encryption key must decode to exactly 32 bytes. Keep these values out of frontend environment variables. Existing public result-page tokens also require the functions' configured `PDC_EXECUTE_TOKEN_SECRET` or `SUPABASE_INTERNAL_JWT_SECRET`.
3. Deploy `workflow-runs`, `workflow-webhook`, `workflow-interaction`, and the updated `chat-with-result`, `workflow-api-request`, and `llm-insights` functions. The configuration disables gateway JWT verification for the workflow API, webhook, and interaction functions because they implement user-token/API-key, webhook-signature, and per-run interaction-token authentication themselves. Set `WORKFLOW_INTERACTION_BASE_URL` to the public origin hosting `/workflow/respond` on both the functions and workers. Deploy the frontend to serve this standalone page; no gateway chat/result page is required.
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

For restricted deployments, set `execution.allowedOutboundHosts` in saved workflow configuration to exact hostnames or subdomain rules such as `*.example.com`; the same allowlist covers API nodes and notification callbacks. URL validation rejects local/private destinations, embedded credentials, redirects, and forwarding headers. Because runtime DNS can change after validation, route worker/function traffic through a network egress proxy or firewall that independently blocks private and metadata ranges when protection against DNS rebinding is required.

## API

Standalone runs do not require a gateway process, result page, result URL, browser session, or target-resource assignment. Enable **Allow API execution** or **Allow webhook execution** for the saved workflow. Its own enabled switch remains required; the organization’s **Enable result-page agent chat** switch and **Run chat workflows on backend** option control result-page execution only.

Select **Request data (API / webhook)** on the trigger, or load the **Standalone API / Webhook Input** example. You can leave result-page assignments empty. Incoming JSON objects, arrays, strings, numbers, booleans, and null are supported within the request size limit. The trigger exposes the payload as `input` and the compatible `data` alias; JavaScript plugins receive it as `input.input` and `input.result`. Agent nodes receive it as their workflow context. An API node can fetch its own data when the supplied input is empty.

For example, a workflow configured with Request data can be started at any time with:

```json
{ "action": "start", "workflowId": "saved-workflow-id", "input": [1, 2, 3] }
```

Signed webhooks work the same way: an empty mapping treats the entire JSON body as the workflow input. All runs still use organization-specific authentication, credentials, independent execution state, and execution traces. The backend worker and function gateway must be running; the gateway frontend does not need to be running.

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
| `notifications` | `runId` | Delivery status, attempts and errors for up to 200 notification events |
| `steps` | `runId`, optional `after` sequence | Up to 200 ordered node visits; paginate using the last sequence |
| `list` | Optional `workflowId` | Latest 50 accessible runs |
| `resume` | `runId`, `nodeId`, `answer`, optional `waitingVersion` | Atomically queues continuation of a waiting question |
| `signal` | `runId`, `signalName`, optional JSON `payload` | Delivers an encrypted external event and atomically queues its waiting run |
| `state` | `runId` | Admin-only masked state plus state/signal metadata timelines |
| `artifact` | `runId`, `artifactId` | Admin-only content for a non-sensitive run artifact |
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

Workers atomically claim separate runs. A workflow definition is never locked for the duration of its execution. A short database transaction prevents two workers from claiming the same run. There is no workflow or organization parallel-run cap and administrators do not configure execution counts. Each worker uses four execution slots by default, managed by the deployment operator through `WORKFLOW_WORKER_CONCURRENCY`; additional worker instances add capacity. Excess work remains queued until a worker slot is available. Each run has its own inputs, checkpoint, lease, output, and logs.

Each node visit receives its own sequence number, including loops and repeated questions. Traces include input/output summaries, start/end timestamps, duration, selected outgoing connections and errors. The dashboard displays the failed/current/last node and can focus it on the canvas. If the current graph has changed, a historical node ID may no longer exist on that canvas; the run trace retains its original name/type.

Run statuses are `queued`, `running`, `waiting_for_input`, `waiting_for_event`, `manual_review`, `succeeded`, `failed`, `cancelled`, `timed_out`, and `incomplete`. An unconnected branch ends as `incomplete`. Backend runs stop on node errors. New runs have no whole-run deadline. Individual JavaScript and HTTP operations retain their node timeouts; cancellation, lease recovery, and graph visit limits still apply. Legacy active runs may retain their previously accepted deadline, measured in active time. Concurrent resume or signal requests accept one matching continuation. Cancellation of an active request is cooperative and cannot undo an external action already performed.

Run definitions and provider credentials are encrypted snapshots. Trace summaries redact configured secrets and sensitive field names, and are truncated for readability. Final outputs preserve their full arrays and strings while redacting secrets. Run inputs and checkpoints are private database records, accessible only to the backend service. No direct table access is granted to anonymous or authenticated clients.

Workers heartbeat their leases. If a worker dies, a subsequent worker claim marks the interrupted run and active node failed with an explanatory stop reason. It does not replay the run automatically: a remote action might have completed before its response was lost. Review external effects before submitting a new run. Automatic node retries are not enabled. Question/reminder/completion notifications use the durable outbox and bounded retries described below.

Operators can override organization limits and retention windows in `workflow_execution_policies`. By default, terminal successful/cancelled/timed-out/incomplete runs are retained for 30 days and failed runs for 90 days; the worker performs hourly bounded cleanup sweeps. Queued, running, and waiting runs are never deleted. Rotating `WORKFLOW_SECRETS_KEY` requires re-encrypting stored webhook secrets and run snapshots; keep the key stable until that migration is performed.

Monitor the admin health summary or the service-only `workflow_health()` RPC. Alert when there are no live workers, the oldest queued run exceeds the expected start delay, expired leases are present, manual-review runs accumulate, or notification backlog grows continuously. Worker logs are structured JSON containing event, worker/run/organization identifiers, and sanitized errors. Runs stopped during an uncertain non-idempotent action enter `manual_review`; an administrator can confirm completion with an assumed output, explicitly retry after checking the target system, or terminate the run.

Encryption-key rotation is an operator migration: stop new admissions, keep workers on the old key, decrypt and re-encrypt every `workflow_webhooks.secret_ciphertext` and `workflow_runs.snapshot.ciphertext` into a new column/key version, verify samples, deploy all functions and workers with the new key, then resume admissions. Never replace `WORKFLOW_SECRETS_KEY` in place while old ciphertext remains.

`update_result` returns replacement result data. An attached result-page chat applies it to the displayed table; API/webhook execution returns it as the final output without implicitly modifying another user's result page.

## Verification

- `npm run test:workflow` checks API/webhook authentication, ownership, concurrent/idempotent starts, signatures, multiple endpoints, key revocation and resume races.
- `npm run test:workflow:backend` checks sandbox permissions/deadlines, concurrent graph execution, checkpoint continuation, routing, errors, encryption and redaction.
- `npm run test:workflow:worker` starts the real Deno worker against a temporary localhost PostgREST/agent contract server and verifies persisted concurrent execution, failed-node traces, signed agent calls and paused-run continuation. It requires Deno on PATH, or `DENO_BIN` pointing to a Deno executable.
- Run `scripts/workflow-database-regression.sql` after the migration in a disposable database to verify independent claims, organization foreign keys, privilege restrictions and interrupted-worker traces.
- `npm run build` validates the frontend bundle.

## Execution-scoped state, artifacts, and events

The builder's **Execution state schema** declares typed values shared by nodes in one run. Node read/write mappings make access explicit while avoiding graph edges whose only purpose is carrying shared data. Reducers (`replace`, `merge`, append variants, numeric reducers, and `first`) define deterministic updates. Parallel replacement writers are rejected; per-field reader/writer lists and separate agent/API exposure switches restrict sensitive data.

State and JSON artifacts are encrypted at rest and isolated by organization and run. Artifact fields store small references in checkpoints and load content only for reads configured as **content**. Node commits atomically persist the step, checkpoint, encrypted state version, remaining signals, and metadata audit event. Terminal transitions erase the temporary state ciphertext, pending signal payloads, and artifact content; metadata-only timelines remain for operations review.

The **Wait for Event** node supports two modes:

- **State changed** is a deterministic in-run event. The compiler requires a reachable upstream writer for the selected state key, and the node emits the new value once for that recorded change.
- **External signal** durably pauses with `waiting_for_event`. An organization admin or a workflow-scoped API key sends `{"action":"signal","runId":"…","signalName":"approval.received","payload":{…}}`. The name must match the waiting node. Payloads are limited to 256 KiB, encrypted before persistence, consumed once, and never included in the metadata audit log.

The operations panel shows masked current state, state-version events, signal receipt/consumption metadata, and a control for sending a signal during administrative testing. Public interaction links can answer user questions but cannot deliver external signals or inspect run state.


## Standalone questions, response deadlines, and callbacks

API and webhook starts return an `interactionUrl` when `WORKFLOW_INTERACTION_BASE_URL` is configured. Open this link in any browser to see the current question, submit an answer, and view completion. It does not require a gateway session or admin login. The token is in the URL fragment, so it is not sent in the page request or referrer. Treat the full URL as a private bearer credential: anyone holding it can answer and see the final output for that one run. Links are scoped by run and organization, expire after seven days by default, and cannot resume terminal runs. Changing the internal signing secret invalidates outstanding links.

In **Ask user → Backend response policy**, configure the response timeout (default 48 hours), reminder interval (12 hours), and maximum reminders (3, or 0 to disable). Values can range from one minute to 30 days; up to 20 reminders are allowed. A response window starts when the node actually pauses, excluding queue and preceding node execution. A new question gets a fresh version and window; submitting invalid answers does not extend it. The deadline is the earlier of the response timeout and the run's link expiry. Expiration stops the run as `timed_out`, records the unanswered node/reason and step status, and rejects late answers. The current timeout behavior stops the run; there is no timeout branch. Exhausting reminders never shortens the response window.

A background scheduler in the worker checks deadlines and claims notification deliveries even when all execution slots are occupied. If every worker is offline, expiration and notifications catch up when a worker returns. Resume also checks the database clock under a row lock, so an expired question cannot resume even before the scheduler catches up. Deadline and reminder work is independent of any open frontend.

In **Workflow → Question notifications and completion callbacks**, configure a public HTTPS endpoint and a signing secret of at least 32 characters. Optionally set a return URL, link lifetime (1–720 hours), and maximum delivery attempts per event (default 6, range 1–10). Save organization settings before starting runs: accepted runs use their saved configuration snapshot. An empty endpoint disables notification delivery, while response deadlines remain active. No emails or messages are sent directly: the receiving platform delivers question/reminder links through its chosen channel. There is no additional workflow node to configure.

Events are `workflow.question`, `workflow.reminder`, and `workflow.completed`. Payloads include `eventId`, `runId`, `organizationId`, `workflowId`, and `workflowName`. Question/reminder events contain the resolved question, input type, options, question version, response deadline and interaction URL; reminders also include their number. Completion includes status, final output, stop reason and failed node. The receiver must verify the signature and deduplicate by `eventId` before acting:

```text
x-workflow-timestamp: Unix seconds
x-workflow-delivery-id: stable event UUID
x-workflow-signature: hex HMAC-SHA256(secret, timestamp + "." + eventId + "." + exactRawBody)
```

Reject old timestamps (for example, outside five minutes) and return a 2xx response promptly. Delivery is at least once. Failures retry with exponential backoff starting at five seconds, capped at one hour, until the saved attempt limit. Retries reuse the event ID. Redirects and private-network destinations are rejected. Answered/expired question notifications are skipped before delivery; a notification already in flight may still arrive, and its response page enforces the current question state. Completion callbacks cover success, failure, cancellation, timeout and incomplete runs. Inspect **Execution history → select run → Notification delivery log**, or use the `notifications` API action, to trace delivery status. Reminder counts represent scheduled reminders, independent of delivery failures.

The hosted page calls `POST /functions/v1/workflow-interaction` with `{ "action": "get", "token": "…" }`. To answer, it sends `{ "action": "resume", "token": "…", "nodeId": "…", "waitingVersion": "…", "answer": "yes" }`. Tokens grant access only to that run's current question/status and final result; they cannot read node traces, original inputs, organization history, or credentials. API clients can continue using their normal authenticated `get` and `resume` actions. The interaction link also works for webhook-created runs, without giving the recipient an organization admin identity.

Run `scripts/workflow-interactions-regression.sql` after all workflow migrations against a disposable database to verify deadlines, reminders, token-independent service permissions, notification leases, and answer/timeout transitions.
