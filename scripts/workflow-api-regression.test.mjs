import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { webcrypto, randomUUID } from "node:crypto";
import { test } from "node:test";
import ts from "typescript";

const env = new Map([["SUPABASE_URL", "http://test.invalid"], ["SUPABASE_SERVICE_ROLE_KEY", "test-service-key"], ["WORKFLOW_SECRETS_KEY", btoa("a".repeat(32))], ["PDC_EXECUTE_TOKEN_SECRET", "test-execution-secret"]]);
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
const { hash, hmac, encrypt, decrypt } = load("supabase/functions/_shared/workflowSecurity.ts");

// A PostgREST contract double; database locking and RLS are tested separately in SQL.
class Query {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; this.operation = "select"; this.columns = "*"; }
  select(columns = "*", options = {}) { this.columns = columns; this.options = options; return this; }
  eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
  in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
  gt(key, value) { this.filters.push((row) => row[key] > value); return this; }
  order(key, options = {}) { this.ordering = [key, options.ascending !== false]; return this; }
  limit(value) { this.maximum = value; return this; }
  insert(value) { this.operation = "insert"; this.value = value; return this; }
  update(value) { this.operation = "update"; this.value = value; return this; }
  delete() { this.operation = "delete"; return this; }
  single() { return this.execute(true); }
  maybeSingle() { return this.execute(true); }
  then(resolve, reject) { return this.execute(false).then(resolve, reject); }
  async execute(single) {
    const table = this.db.tables[this.table] ||= [];
    let rows = table.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.operation === "insert") {
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
  }, from(table) { return new Query(this, table); }, auth: { getUser: async (token) => ({ data: { user: token === "anon" ? null : { id: token } }, error: token === "anon" ? new Error("Anonymous") : null }) } };
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

test("concurrent users start isolated runs of the same organization workflow", async () => {
  setup();
  const requests = await Promise.all([api({ action: "start", workflowId: "shared", input: { id: 1 } }, "user-a"), api({ action: "start", workflowId: "shared", input: { id: 2 } }, "user-b")]);
  requests.forEach((response) => assert.equal(response.status, 202));
  assert.notEqual(requests[0].body.runId, requests[1].body.runId);
  assert.deepEqual(database.tables.workflow_runs.map((run) => run.input.resultData), [{ id: 1 }, { id: 2 }]);
  const run = database.tables.workflow_runs[0];
  assert.equal(run.organization_id, "org-a"); assert.ok(!JSON.stringify(run.snapshot).includes("provider-private-key"));
  assert.equal((await decrypt(run.snapshot.ciphertext)).llm.providers[0].apiKey, "provider-private-key");
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
  const run = database.tables.workflow_runs[0]; Object.assign(run, { status: "waiting_for_input", waiting: { nodeId: "ask", question: "Continue?" } });
  const responses = await Promise.all([api({ action: "resume", runId: started.body.runId, nodeId: "ask", answer: "yes" }, "user-a"), api({ action: "resume", runId: started.body.runId, nodeId: "ask", answer: "no" }, "user-a")]);
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
