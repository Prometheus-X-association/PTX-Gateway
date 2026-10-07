import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { webcrypto, randomUUID } from "node:crypto";
import { test } from "node:test";
import ts from "typescript";

const env = new Map([["SUPABASE_URL", "http://test.invalid"], ["SUPABASE_SERVICE_ROLE_KEY", "test-service-key"], ["WORKFLOW_SECRETS_KEY", btoa("a".repeat(32))], ["PDC_EXECUTE_TOKEN_SECRET", "test-execution-secret"], ["WORKFLOW_INTERNAL_SECRET", "test-interaction-secret"], ["WORKFLOW_INTERACTION_BASE_URL", "https://workflow.example"]]);
let database;
const modules = new Map();
function load(path) {
  path = resolve(path);
  if (modules.has(path)) return modules.get(path);
  const output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const require = (name) => {
    if (name.includes("http/server.ts")) return { serve: () => {} };
    if (name.includes("supabase-js")) return { createClient: () => database };
    return load(resolve(dirname(path), name));
  };
  new Function("exports", "module", "require", "Deno", "crypto", output)(module.exports, module, require, { env: { get: (key) => env.get(key) } }, webcrypto);
  modules.set(path, module.exports);
  return module.exports;
}
const { handleWorkflowRequest } = load("supabase/functions/workflow-runs/index.ts");
const { handleWorkflowWebhook } = load("supabase/functions/workflow-webhook/index.ts");
const { interactionToken } = load("supabase/functions/_shared/workflowInteraction.ts");
const { handleWorkflowInteraction } = load("supabase/functions/workflow-interaction/index.ts");
const { hash, hmac, encrypt, decryptForOrganization, compileWorkflow, validateGraph, WORKFLOW_COMPILER_VERSION } = load("supabase/functions/_shared/workflowSecurity.ts");

// A PostgREST contract double; database locking and RLS are tested separately in SQL.
class Query {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; this.operation = "select"; this.columns = "*"; }
  select(columns = "*", options = {}) { this.columns = columns; this.options = options; return this; }
  eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
  is(key, value) { this.filters.push((row) => row[key] === value); return this; }
  in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
  gt(key, value) { this.filters.push((row) => row[key] > value); return this; }
  order(key, options = {}) { this.ordering = [key, options.ascending !== false]; return this; }
  limit(value) { this.maximum = value; return this; }
  insert(value) { this.operation = "insert"; this.value = value; return this; }
  upsert(value) { this.operation = "upsert"; this.value = value; return this; }
  update(value) { this.operation = "update"; this.value = value; return this; }
  delete() { this.operation = "delete"; return this; }
  single() { return this.execute(true); }
  maybeSingle() { return this.execute(true); }
  then(resolve, reject) { return this.execute(false).then(resolve, reject); }
  async execute(single) {
    const table = this.db.tables[this.table] ||= [];
    let rows = table.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.operation === "insert" || this.operation === "upsert") {
      if (this.operation === "upsert") {
        const match = table.find((row) => row.organization_id === this.value.organization_id && row.user_id === this.value.user_id && row.permission === this.value.permission);
        if (match) { Object.assign(match, structuredClone(this.value)); return { data: single ? structuredClone(match) : [structuredClone(match)], count: 1, error: null }; }
      }
      const row = { id: randomUUID(), enabled: true, status: "queued", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...structuredClone(this.value) };
      if (this.table === "workflow_runs" && row.idempotency_key && table.some((item) => item.organization_id === row.organization_id && item.caller_id === row.caller_id && item.workflow_id === row.workflow_id && item.idempotency_key === row.idempotency_key)) return { data: null, error: { code: "23505" } };
      table.push(row); rows = [row];
    }
    if (this.operation === "update") rows.forEach((row) => Object.assign(row, structuredClone(this.value)));
    if (this.operation === "delete") this.db.tables[this.table] = table.filter((row) => !rows.includes(row));
    if (this.ordering) { const [key, asc] = this.ordering; rows.sort((a, b) => (a[key] > b[key] ? 1 : -1) * (asc ? 1 : -1)); }
    const count = rows.length;
    rows = rows.slice(0, this.maximum ?? rows.length).map((row) => this.columns === "*" ? structuredClone(row) : Object.fromEntries(this.columns.split(",").map((key) => [key, row[key]])));
    return { data: this.options?.head ? null : single ? rows[0] ?? null : rows, count, error: null };
  }
}
function setup() {
  const workflow = { id: "shared", name: "Shared", enabled: true, targetResources: ["resource-a"], execution: { backendEnabled: true, apiEnabled: true, webhookEnabled: true },
    graph: { nodes: [{ id: "start", type: "trigger", data: { inputSources: ["result"] } }, { id: "end", type: "output", data: { renderAs: "json" } }], edges: [{ id: "edge", source: "start", target: "end" }] } };
  database = { tables: {
    global_configs: ["org-a", "org-b"].map((organization_id) => ({ organization_id, features: { llmInsights: { enabled: true, workflows: [structuredClone(workflow)], providers: [{ apiKey: "provider-private-key" }] } } })),
    organization_members: [{ organization_id: "org-a", user_id: "admin-a", status: "active" }, { organization_id: "org-a", user_id: "user-a", status: "active" }, { organization_id: "org-a", user_id: "user-b", status: "active" }, { organization_id: "org-b", user_id: "admin-b", status: "active" }],
    user_roles: [{ organization_id: "org-a", user_id: "admin-a", role: "admin" }, { organization_id: "org-b", user_id: "admin-b", role: "admin" }],
    workflow_organization_keys: [], workflow_encryption_delegations: [], workflow_encryption_audit_events: [], profiles: [],
  }, from(table) { return new Query(this, table); }, async rpc(name, args) {
    if (name === "workflow_organization_key_material") {
      const key = (this.tables.workflow_organization_keys ?? []).filter((item) => item.organization_id === args.p_organization_id && (args.p_key_id ? item.id === args.p_key_id : item.status === "active")).sort((a, b) => b.key_version - a.key_version)[0];
      return { data: key ? structuredClone(key) : null, error: null };
    }
    if (name === "activate_workflow_organization_vault_key") {
      const keys = this.tables.workflow_organization_keys;
      const existing = keys.find((key) => key.organization_id === args.p_organization_id && key.status === "active");
      if (args.p_reason === "initialized" && existing) return { data: structuredClone(existing), error: null };
      keys.filter((key) => key.organization_id === args.p_organization_id && key.status === "active").forEach((key) => Object.assign(key, { status: "retired", retired_at: new Date().toISOString() }));
      const bytes = webcrypto.getRandomValues(new Uint8Array(32));
      const key = { id: randomUUID(), organization_id: args.p_organization_id, key_version: Math.max(0, ...keys.filter((item) => item.organization_id === args.p_organization_id).map((item) => item.key_version)) + 1, key_material: btoa(String.fromCharCode(...bytes)), status: "active", activated_at: new Date().toISOString() };
      keys.push(key); return { data: structuredClone(key), error: null };
    }
    if (name === "next_workflow_organization_key_version") return { data: Math.max(0, ...(this.tables.workflow_organization_keys ?? []).filter((key) => key.organization_id === args.p_organization_id).map((key) => key.key_version)) + 1, error: null };
    if (name === "activate_workflow_organization_key") {
      const keys = this.tables.workflow_organization_keys;
      const existing = keys.find((key) => key.organization_id === args.p_organization_id && key.status === "active");
      if (args.p_reason === "initialized" && existing) return { data: structuredClone(existing), error: null };
      keys.filter((key) => key.organization_id === args.p_organization_id && key.status === "active").forEach((key) => Object.assign(key, { status: "retired", retired_at: new Date().toISOString() }));
      const key = { id: args.p_key_id, organization_id: args.p_organization_id, key_version: args.p_key_version, wrapped_key_ciphertext: args.p_wrapped_key_ciphertext, status: "active", activated_at: new Date().toISOString() };
      keys.push(key); return { data: structuredClone(key), error: null };
    }
    if (name === "set_workflow_encryption_delegation") {
      const delegations = this.tables.workflow_encryption_delegations;
      const existing = delegations.find((item) => item.organization_id === args.p_organization_id && item.user_id === args.p_subject_user_id);
      if (args.p_enabled) {
        const value = { organization_id: args.p_organization_id, user_id: args.p_subject_user_id, permission: "manage_workflow_encryption", delegated_by: args.p_actor_user_id, created_at: new Date().toISOString(), revoked_at: null, revoked_by: null };
        existing ? Object.assign(existing, value) : delegations.push(value);
      } else if (existing) Object.assign(existing, { revoked_at: new Date().toISOString(), revoked_by: args.p_actor_user_id });
      this.tables.workflow_encryption_audit_events.push({ id: randomUUID(), organization_id: args.p_organization_id, actor_user_id: args.p_actor_user_id, subject_user_id: args.p_subject_user_id, event_type: args.p_enabled ? "delegate_granted" : "delegate_revoked", created_at: new Date().toISOString() });
      return { data: null, error: null };
    }
    const run = (this.tables.workflow_runs ?? []).find((run) => run.id === args.p_run_id && run.organization_id === args.p_organization_id);
    if (name === "signal_workflow_run") {
      if (!run || run.status !== "waiting_for_event" || run.event_wait?.signalName !== args.p_signal_name) return { data: null, error: { code: "P0001", message: "Run is not waiting for this signal." } };
      const id = randomUUID();
      Object.assign(run, { status: "queued", event_wait: null, pending_signals: [{ id, name: args.p_signal_name, ciphertext: args.p_payload_ciphertext, receivedAt: new Date().toISOString() }] });
      return { data: id, error: null };
    }
    assert.equal(name, "resume_workflow_run");
    if (!run || run.status !== 'waiting_for_input' || run.waiting.nodeId !== args.p_node_id || run.waiting_version !== args.p_waiting_version) return { data: false };
    if (run.waiting_expires_at && Date.parse(run.waiting_expires_at) <= Date.now()) { run.status = 'timed_out'; return { data: false }; }
    Object.assign(run, { status: 'queued', resume_answer: args.p_answer }); return { data: true };
  }, auth: { getUser: async (token) => ({ data: { user: token === "anon" ? null : { id: token } }, error: token === "anon" ? new Error("Anonymous") : null }) } };
  return database;
}
async function api(body, token = "admin-a", org = "org-a", idempotencyKey) {
  const response = await handleWorkflowRequest(new Request("http://test.invalid/workflow-runs", { method: "POST", headers: { Authorization: `Bearer ${token}`, "x-organization-id": org, "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
}
async function hook(id, secret, payload, delivery = "event-1", timestamp = String(Math.floor(Date.now() / 1000))) {
  const raw = JSON.stringify(payload);
  const response = await handleWorkflowWebhook(new Request(`http://test.invalid/workflow-webhook/${id}`, { method: "POST", headers: { "x-workflow-timestamp": timestamp, "x-workflow-delivery-id": delivery, "x-workflow-signature": await hmac(secret, `${timestamp}.${delivery}.${raw}`) }, body: raw }));
  return { status: response.status, body: await response.json() };
}

test("workflow compilation normalizes execution defaults and rejects malformed graphs", () => {
  const workflow = setup().tables.global_configs[0].features.llmInsights.workflows[0];
  const compiled = compileWorkflow(workflow);
  assert.equal(compiled.compilerVersion, WORKFLOW_COMPILER_VERSION);
  assert.equal(compiled.graph.nodes[0].data.label, "trigger");
  assert.throws(() => validateGraph({ ...workflow, graph: { ...workflow.graph, nodes: [...workflow.graph.nodes, { id: "orphan", type: "output", data: {} }] } }), /unreachable/);
  assert.throws(() => validateGraph({ ...workflow, execution: { allowedOutboundHosts: ["https://not-a-host.example"] } }), /hostname/);
});

test("organization admins delegate narrow encryption rotation without exposing key material", async () => {
  setup();
  const before = await api({ action: "encryption_status" });
  assert.equal(before.status, 200); assert.equal(before.body.encryption.initialized, false); assert.equal(before.body.encryption.keyStorage, "supabase_vault");
  assert.equal(before.body.encryption.members.some((member) => member.userId === "admin-a"), false);
  assert.equal((await api({ action: "encryption_delegate", userId: "admin-a" })).status, 400);
  assert.equal((await api({ action: "encryption_delegate", userId: "user-a" })).status, 200);
  assert.equal((await api({ action: "encryption_status" }, "user-a")).status, 200);
  assert.equal((await api({ action: "encryption_delegate", userId: "user-b" }, "user-a")).status, 403);
  const rotated = await api({ action: "encryption_rotate" }, "user-a");
  assert.equal(rotated.status, 200); assert.equal(rotated.body.key.version, 1);
  assert.equal(Object.hasOwn(rotated.body.key, "wrapped_key_ciphertext"), false);
  const started = await api({ action: "start", workflowId: "shared", input: { protected: true } }, "user-a");
  assert.equal(started.status, 202);
  const run = database.tables.workflow_runs.find((item) => item.id === started.body.runId);
  assert.match(run.snapshot.ciphertext, /^wok1\./);
  assert.deepEqual((await decryptForOrganization(database, "org-a", run.snapshot.ciphertext)).workflow.id, "shared");
  assert.equal((await api({ action: "encryption_revoke_delegate", userId: "user-a" })).status, 200);
  assert.equal((await api({ action: "encryption_status" }, "user-a")).status, 403);
});

test("concurrent users start isolated runs of the same organization workflow", async () => {
  setup();
  // Ignore obsolete saved admin limits when starting independent runs.
  Object.assign(database.tables.global_configs[0].features.llmInsights.workflows[0].execution, { maxConcurrentRuns: 1, timeoutSeconds: 10 });
  const requests = await Promise.all([api({ action: "start", workflowId: "shared", input: { id: 1 } }, "user-a"), api({ action: "start", workflowId: "shared", input: { id: 2 } }, "user-b")]);
  requests.forEach((response) => assert.equal(response.status, 202));
  assert.notEqual(requests[0].body.runId, requests[1].body.runId);
  assert.deepEqual(database.tables.workflow_runs.map((run) => run.input.resultData), [{ id: 1 }, { id: 2 }]);
  const run = database.tables.workflow_runs[0];
  assert.equal(run.timeout_seconds, null);
  assert.equal(Object.hasOwn(run, "max_concurrent_runs"), false);
  assert.equal(run.organization_id, "org-a"); assert.ok(!JSON.stringify(run.snapshot).includes("provider-private-key"));
  assert.equal((await decryptForOrganization(database, "org-a", run.snapshot.ciphertext)).llm.providers[0].apiKey, "provider-private-key");
});
test("standalone API and webhook accept arbitrary JSON while result-page chat is disabled", async () => {
  setup();
  const llm = database.tables.global_configs[0].features.llmInsights;
  llm.enabled = false;
  const workflow = llm.workflows[0];
  workflow.targetResources = [];
  workflow.execution.backendEnabled = false;
  workflow.graph.nodes[0].data.inputSources = ["input"];
  const key = await api({ action: "create_key", workflowIds: ["shared"] });
  assert.equal(key.status, 201);
  const endpoint = await api({ action: "create_webhook", workflowId: "shared", name: "Standalone" });
  assert.equal(endpoint.status, 201);
  const values = [{ orderId: "A" }, [1, 2, 3], "plain text", 0, false, null];
  for (const [index, input] of values.entries()) {
    const started = await api({ action: "start", workflowId: "shared", input }, key.body.key);
    assert.equal(started.status, 202);
    const run = database.tables.workflow_runs.find((run) => run.id === started.body.runId);
    assert.deepEqual(run.input.resultData, input);
    assert.equal(run.trigger_source, "api");
    const saved = await decryptForOrganization(database, run.organization_id, run.snapshot.ciphertext);
    assert.equal(saved.llm.enabled, false);
    assert.deepEqual(saved.workflow.targetResources, []);
    const delivery = await hook(endpoint.body.id, endpoint.body.secret, input, `standalone-${index}`);
    assert.equal(delivery.status, 202);
    const webhookRun = database.tables.workflow_runs.find((run) => run.id === delivery.body.runId);
    assert.deepEqual(webhookRun.input.resultData, input);
    assert.equal(webhookRun.trigger_source, "webhook");
  }
  assert.equal((await api({ action: "start", workflowId: "shared", source: "dashboard" })).status, 403);
  workflow.enabled = false;
  assert.equal((await api({ action: "start", workflowId: "shared", input: {} }, key.body.key)).status, 404);
});
test("organization membership and caller ownership protect execution traces", async () => {
  setup();
  const started = await api({ action: "start", workflowId: "shared", input: {} }, "user-a");
  assert.equal((await api({ action: "get", runId: started.body.runId }, "user-b")).status, 404);
  assert.equal((await api({ action: "get", runId: started.body.runId }, "admin-b", "org-b")).status, 404);
  assert.equal((await api({ action: "start", workflowId: "shared" }, "user-a", "org-b")).status, 403);
  const visible = await api({ action: "get", runId: started.body.runId });
  assert.equal(visible.status, 200); assert.ok(!JSON.stringify(visible.body).includes("ciphertext")); assert.ok(!JSON.stringify(visible.body).includes("caller_id"));
});

test("external signals require privileged access and encrypt their payload", async () => {
  setup();
  const started = await api({ action: "start", workflowId: "shared", input: {} }, "user-a");
  const run = database.tables.workflow_runs.find((item) => item.id === started.body.runId);
  Object.assign(run, { status: "waiting_for_event", event_wait: { nodeId: "wait", eventType: "external_signal", signalName: "approval.received" }, pending_signals: [] });
  assert.equal((await api({ action: "signal", runId: run.id, signalName: "approval.received", payload: { approved: true } }, "user-a")).status, 403);
  const delivered = await api({ action: "signal", runId: run.id, signalName: "approval.received", payload: { approved: true } });
  assert.equal(delivered.status, 202);
  assert.equal(run.status, "queued");
  assert.deepEqual(await decryptForOrganization(database, run.organization_id, run.pending_signals[0].ciphertext), { approved: true });
  assert.equal(JSON.stringify(run.pending_signals).includes('"approved":true'), false);
});
test("idempotent concurrent retries create one run and conflicting input returns 409", async () => {
  setup();
  const body = { action: "start", workflowId: "shared", input: { id: 1 } };
  const results = await Promise.all(Array.from({ length: 5 }, () => api(body, "user-a", "org-a", "request-1")));
  assert.equal(new Set(results.map((result) => result.body.runId)).size, 1); assert.equal(database.tables.workflow_runs.length, 1);
  assert.equal((await api({ ...body, input: { id: 2 } }, "user-a", "org-a", "request-1")).status, 409);
});
test("multiple signed webhooks use their configured organization and independent delivery scopes", async () => {
  setup();
  const first = await api({ action: "create_webhook", workflowId: "shared", name: "Orders", inputMapping: { input: "order" } });
  const second = await api({ action: "create_webhook", workflowId: "shared", name: "Payments" });
  const payload = { organizationId: "org-b", workflowId: "other", order: { id: 9 } };
  const results = await Promise.all([hook(first.body.id, first.body.secret, payload), hook(second.body.id, second.body.secret, payload)]);
  results.forEach((result) => assert.equal(result.status, 202)); assert.notEqual(results[0].body.runId, results[1].body.runId);
  assert.ok(database.tables.workflow_runs.every((run) => run.organization_id === "org-a" && run.workflow_id === "shared"));
  assert.deepEqual(database.tables.workflow_runs[0].input.resultData, { id: 9 });
  assert.equal((await hook(first.body.id, first.body.secret, payload)).body.runId, results[0].body.runId);
  assert.equal((await hook(first.body.id, "wrong-secret", payload)).status, 401);
  assert.equal((await hook(first.body.id, first.body.secret, payload, "expired", "1")).status, 401);
  assert.equal((await api({ action: "update_webhook", webhookId: first.body.id, enabled: false })).status, 200);
  assert.equal((await hook(first.body.id, first.body.secret, payload, "new-event")).status, 404);
});
test("API keys are workflow-scoped, revocable and never returned in listings", async () => {
  setup();
  const created = await api({ action: "create_key", workflowIds: ["shared"], name: "Integration" });
  assert.equal(created.status, 201);
  assert.equal((await api({ action: "start", workflowId: "shared" }, created.body.key)).status, 202);
  assert.equal((await api({ action: "start", workflowId: "other" }, created.body.key)).status, 403);
  assert.equal((await api({ action: "start", workflowId: "shared" }, created.body.key, "org-b")).status, 403);
  const keys = await api({ action: "keys" }); assert.ok(!JSON.stringify(keys.body).includes("key_hash"));
  await api({ action: "revoke_key", keyId: created.body.id });
  assert.equal((await api({ action: "start", workflowId: "shared" }, created.body.key)).status, 401);
});
test("one waiting question accepts only one concurrent answer", async () => {
  setup();
  const started = await api({ action: "start", workflowId: "shared" }, "user-a");
  const run = database.tables.workflow_runs[0]; Object.assign(run, { status: "waiting_for_input", waiting_version: randomUUID(), waiting_expires_at: new Date(Date.now()+60000).toISOString(), waiting: { nodeId: "ask", question: "Continue?" } });
  assert.equal((await api({ action: "resume", runId: started.body.runId, nodeId: "ask", answer: "yes" }, "user-a")).status, 400);
  assert.equal((await api({ action: "resume", runId: started.body.runId, nodeId: "ask", waitingVersion: randomUUID(), answer: "yes" }, "user-a")).status, 409);
  const responses = await Promise.all([api({ action: "resume", runId: started.body.runId, nodeId: "ask", waitingVersion: run.waiting_version, answer: "yes" }, "user-a"), api({ action: "resume", runId: started.body.runId, nodeId: "ask", waitingVersion: run.waiting_version, answer: "no" }, "user-a")]);
  assert.deepEqual(responses.map((result) => result.status).sort(), [202, 409]);
  assert.equal(run.status, "queued");
});
test("disabled trigger modes reject runs and invalid mappings are rejected at creation", async () => {
  setup(); database.tables.global_configs[0].features.llmInsights.workflows[0].execution.apiEnabled = false;
  assert.equal((await api({ action: "start", workflowId: "shared" })).status, 403);
  assert.equal((await api({ action: "create_webhook", workflowId: "shared", inputMapping: { organizationId: "org" } })).status, 400);
  assert.equal((await api({ action: "create_key", workflowIds: ["shared"] }, "user-a")).status, 403);
});
test("public result-page sessions do not share run history", async () => {
  setup();
  const header = btoa(JSON.stringify({ alg: "HS256" })).replace(/=+$/, "");
  const payload = btoa(JSON.stringify({ typ: "pdc_exec", org_id: "org-a", exp: Math.floor(Date.now() / 1000) + 300 })).replace(/=+$/, "");
  const digest = await hmac(env.get("PDC_EXECUTE_TOKEN_SECRET"), `${header}.${payload}`);
  const signature = btoa(String.fromCharCode(...digest.match(/../g).map((pair) => parseInt(pair, 16)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const token = `${header}.${payload}.${signature}`;
  const body = { source: "dashboard", org_execution_token: token, workflow_session_id: "a".repeat(72), targetResourceId: "resource-a", workflowId: "shared" };
  const started = await api({ ...body, action: "start" }, "anon"); assert.equal(started.status, 202);
  assert.equal((await api({ ...body, action: "get", runId: started.body.runId, workflow_session_id: "b".repeat(72) }, "anon")).status, 404);
  assert.equal((await api({ ...body, action: "start", targetResourceId: "resource-b" }, "anon")).status, 403);
});

async function interaction(body) {
  const response = await handleWorkflowInteraction(new Request("https://test.invalid/workflow-interaction", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
}
test("hosted interaction tokens isolate runs, expire and expose only the current question", async () => {
  setup();
  const started = await api({ action: 'start', workflowId: 'shared', input: { private: 'not-for-participants' } });
  assert.equal(started.status, 202);
  const token = new URLSearchParams(new URL(started.body.interactionUrl).hash.slice(1)).get('token');
  const run = database.tables.workflow_runs[0];
  Object.assign(run, { status: 'waiting_for_input', waiting_version: randomUUID(), waiting_expires_at: new Date(Date.now()+60000).toISOString(), waiting: { nodeId: 'ask', question: 'Approve?', inputType: 'yes_no', nodeOutputs: { secret: 'never-share' } } });
  const view = await interaction({ action: 'get', token });
  assert.equal(view.status, 200); assert.equal(view.body.run.waiting.question, 'Approve?');
  assert.ok(!JSON.stringify(view.body).includes('never-share')); assert.ok(!JSON.stringify(view.body).includes('not-for-participants'));
  assert.equal((await interaction({ action: 'get', token: token.slice(0,-1)+(token.endsWith('a')?'b':'a') })).status, 401);
  assert.equal((await interaction({ action: 'resume', token, nodeId: 'ask', waitingVersion: randomUUID(), answer: 'yes' })).status, 409);
  assert.equal((await interaction({ action: 'resume', token, nodeId: 'ask', waitingVersion: run.waiting_version, answer: 'maybe' })).status, 400);
  const responses = await Promise.all(['yes','no'].map(answer=>interaction({action:'resume',token,nodeId:'ask',waitingVersion:run.waiting_version,answer})));
  assert.deepEqual(responses.map(response=>response.status).sort(),[202,409]);
  run.interaction_expires_at = new Date(Date.now()-1000).toISOString();
  assert.equal((await interaction({action:'get',token})).status,401);
  const expiredToken=await interactionToken(run);
  assert.equal((await interaction({action:'get',token:expiredToken})).status,410);
});
test("expired questions reject answers even before the background scheduler runs", async () => {
  setup();
  const started = await api({action:'start',workflowId:'shared'});
  const token = new URLSearchParams(new URL(started.body.interactionUrl).hash.slice(1)).get('token');
  const run = database.tables.workflow_runs[0];
  Object.assign(run,{status:'waiting_for_input',waiting_version:randomUUID(),waiting_expires_at:new Date(Date.now()-1000).toISOString(),waiting:{nodeId:'ask',inputType:'text'}});
  assert.equal((await interaction({action:'resume',token,nodeId:'ask',waitingVersion:run.waiting_version,answer:'late'})).status,409);
  assert.equal(run.status,'timed_out');
});
test("response policies and notification configuration are validated before accepting a run", async () => {
  setup(); const workflow=database.tables.global_configs[0].features.llmInsights.workflows[0];
  workflow.graph.nodes.splice(1,0,{id:'ask',type:'user_input',data:{question:'Continue?',inputType:'text',responseTimeoutHours:0}});
  workflow.graph.edges = [{ id: 'start-ask', source: 'start', target: 'ask' }, { id: 'ask-end', source: 'ask', target: 'end' }];
  assert.equal((await api({action:'start',workflowId:'shared'})).status,400);
  workflow.graph.nodes[1].data.responseTimeoutHours=48;
  workflow.execution.notifications={url:'https://receiver.example',secret:'short'};
  assert.equal((await api({action:'start',workflowId:'shared'})).status,400);
  workflow.execution.notifications.secret='x'.repeat(32);
  assert.equal((await api({action:'start',workflowId:'shared'})).status,202);
});
