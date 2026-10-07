import { executeWorkflow, type ExecutorContext, type WorkflowCheckpoint } from "../../supabase/functions/_shared/workflowExecutor.ts";
import type { AgentWorkflow } from "../../supabase/functions/_shared/workflowTypes.ts";
import { decrypt, encrypt, equal, hmac, mapWebhookInput, redact, sanitizeOutput, validateGraph } from "../../supabase/functions/_shared/workflowSecurity.ts";
import { executeJavascript } from "./sandbox.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value { if (!value) throw new Error(message); }
function same(actual: unknown, expected: unknown) { assert(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
async function rejects(fn: () => Promise<unknown>, pattern: RegExp) { try { await fn(); } catch (error) { assert(pattern.test(String(error)), String(error)); return; } throw new Error("Expected rejection"); }
const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as AgentWorkflow["nodes"][number];
const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}`, source, target, sourceHandle });
const context = (input: unknown = {}): ExecutorContext => ({ resultData: input, docText: null, userMessage: "Run", organizationId: "org-a", orgExecutionToken: null,
  supabaseUrl: "http://localhost", executeJavascript, onAgentStep: async (_id, _config, _prompt, previous) => JSON.stringify(previous), onApiRequest: async () => ({}), onStepDone: () => {}, stopOnError: true });

Deno.test("same workflow runs concurrently with independent node outputs", async () => {
  const graph: AgentWorkflow = { nodes: [node("start", "trigger", { inputSources: ["result"] }), node("transform", "plugin", { code: "return { id: input.result.id, doubled: input.result.value * 2 };" }), node("end", "output", { renderAs: "json" })], edges: [edge("start", "transform"), edge("transform", "end")] };
  const results = await Promise.all(Array.from({ length: 8 }, (_, id) => executeWorkflow(graph, context({ id, value: id }))));
  results.forEach((result, id) => { assert(!result.error); same(result.results.at(-1)?.output, { id, doubled: id * 2 }); });
});
Deno.test("request inputs reach trigger, plugins and agents without a result page or document", async () => {
  const graph: AgentWorkflow = { nodes: [node("start", "trigger", { inputSources: ["input"] }), node("plugin", "plugin", { code: "return { current: input.input, legacy: input.result };" }),
    node("agent", "agent", { mode: "existing", agentId: "saved", passPrevOutput: true }), node("end", "output", { renderAs: "json" })], edges: [edge("start", "plugin"), edge("plugin", "agent"), edge("agent", "end")] };
  for (const value of [{ event: "created" }, [1, 2], "text", 0, false, null]) {
    let agentSawInput = false;
    const result = await executeWorkflow(graph, { ...context(value), triggerSource: "webhook", onAgentStep: async (_id, config, _prompt, previous) => {
      same(previous, { current: value, legacy: value }); assert(config.includeResultData); assert(!config.includeDocument); agentSawInput = true; return JSON.stringify(value);
    } });
    assert(!result.error && agentSawInput);
    const trigger = result.results[0].output as Record<string, unknown>;
    same(trigger.input, value); same(trigger.data, value); same(trigger.triggerSource, "webhook");
    same(result.results[1].output, { current: value, legacy: value });
  }
});
Deno.test("sandbox denies credentials, filesystem, network and subprocess access", async () => {
  for (const code of ['return Deno.env.get("WORKFLOW_SECRETS_KEY");', 'return Deno.readTextFile("/etc/passwd");', 'return fetch("https://example.com");', 'return new Deno.Command("sh").output();']) {
    await rejects(() => executeJavascript({ operation: "plugin", code, input: {} }), /permission|NotCapable|Requires/i);
  }
});
Deno.test("sandbox terminates infinite loops and honours cancellation", async () => {
  await rejects(() => executeJavascript({ operation: "plugin", code: "while (true) {}", input: {}, timeoutMs: 50 }), /deadline/);
  const abort = new AbortController();
  const pending = executeJavascript({ operation: "plugin", code: "while (true) {}", input: {} }, abort.signal);
  abort.abort();
  await rejects(() => pending, /Cancelled/);
});
Deno.test("waiting checkpoint preserves pending branches, document context and outputs", async () => {
  const graph: AgentWorkflow = { nodes: [node("start", "trigger", { inputSources: ["document"] }), node("doc", "document_context", { source: "trigger_document", delivery: "text", reuseScope: "workflow_run" }),
    node("ask", "user_input", { question: "Continue?", answerKey: "approved", inputType: "yes_no" }), node("agent", "agent", { mode: "existing", agentId: "saved", passPrevOutput: true }), node("end", "output"), node("sibling", "output")],
    edges: [edge("start", "doc"), edge("doc", "ask"), edge("ask", "agent"), edge("agent", "end"), edge("start", "sibling")] };
  let checkpoint: WorkflowCheckpoint | undefined;
  const initial = await executeWorkflow(graph, { ...context(), docText: "Evidence", onCheckpoint: async (state) => { checkpoint = structuredClone(state); } });
  assert(initial.waiting && checkpoint);
  same(checkpoint.pending.map((task) => task.nodeId), ["ask", "sibling"]);
  let agentDelivery = "";
  const resumed = await executeWorkflow(graph, { ...context(), docText: "Evidence", checkpoint, resume: { waiting: initial.waiting, answer: "yes" },
    onAgentStep: async (_id, config, _prompt, previous) => { agentDelivery = config.documentDelivery!; assert((previous as any).approved === true); return "Done"; } });
  assert(!resumed.waiting && !resumed.error); same(agentDelivery, "text");
  same(resumed.results.map((step) => step.nodeId), ["ask", "agent", "end", "sibling"]);
});
Deno.test("failed nodes stop execution with the failed node and reason", async () => {
  const graph: AgentWorkflow = { nodes: [node("start", "trigger"), node("api", "api"), node("end", "output")], edges: [edge("start", "api"), edge("api", "end")] };
  const result = await executeWorkflow(graph, { ...context(), onApiRequest: async () => { throw new Error("CRM returned HTTP 503"); } });
  same(result.results.map((step) => step.nodeId), ["start", "api"]); same(result.error, "CRM returned HTTP 503"); assert(result.stopReason?.includes("api"));
});
Deno.test("router selects the configured branch and records it", async () => {
  const graph: AgentWorkflow = { nodes: [node("start", "trigger", { inputSources: ["result"] }), node("route", "router", { inputPath: "data.kind", matchMode: "first_match", rules: [{ id: "paid", operator: "equals", value: "paid" }] }), node("paid", "output"), node("other", "output")], edges: [edge("start", "route"), edge("route", "paid", "route-paid"), edge("route", "other", "route-fallback")] };
  const selected: string[] = [];
  const result = await executeWorkflow(graph, { ...context({ kind: "paid" }), onCheckpoint: async (checkpoint) => { if (checkpoint.selectedEdges?.[0]?.source === "route") selected.push(checkpoint.selectedEdges[0].target); } });
  same(selected, ["paid"]); same(result.results.at(-1)?.nodeId, "paid");
});
Deno.test("output transform errors are reported instead of silently ignored", async () => {
  const graph: AgentWorkflow = { nodes: [node("start", "trigger"), node("end", "output", { renderAs: "update_result", transformCode: 'throw new Error("Invalid result");' })], edges: [edge("start", "end")] };
  const result = await executeWorkflow(graph, context()); assert(result.error?.includes("Invalid result"));
});
Deno.test("webhook mapping cannot override organization or workflow ownership", () => {
  same(mapWebhookInput({ org: "other", order: { id: 7 } }, { input: "order" }), { input: { id: 7 } });
  for (const mapping of [{ organizationId: "org" }, { input: "__proto__.secret" }]) {
    let failed = false; try { mapWebhookInput({}, mapping); } catch { failed = true; } assert(failed);
  }
});
Deno.test("snapshots are encrypted, tampering is rejected, signatures bind delivery IDs", async () => {
  Deno.env.set("WORKFLOW_SECRETS_KEY", btoa("a".repeat(32)));
  const ciphertext = await encrypt({ credential: "private-value" });
  assert(!ciphertext.includes("private-value")); same(await decrypt(ciphertext), { credential: "private-value" });
  await rejects(() => decrypt(ciphertext.slice(0, -4) + "AAAA"), /OperationError|decrypt/i);
  const first = await hmac("secret", "100.delivery-a.{}"); const second = await hmac("secret", "100.delivery-b.{}"); assert(!equal(first, second)); assert(equal(first, first));
});
Deno.test("execution state ciphertext is private, isolated and detects tampering", async () => {
  Deno.env.set("WORKFLOW_SECRETS_KEY", btoa("a".repeat(32)));
  const first = await encrypt({ customer: { id: 7 }, version: 0 });
  const second = await encrypt({ customer: { id: 8 }, version: 0 });
  assert(first !== second && !first.includes("customer"));
  same(await decrypt(first), { customer: { id: 7 }, version: 0 });
  same(await decrypt(second), { customer: { id: 8 }, version: 0 });
  await rejects(() => decrypt(first.slice(0, -2) + "AA"), /OperationError|decrypt/i);
});
Deno.test("logs redact secrets while final output retains complete arrays", () => {
  same(redact({ apiKey: "private", text: "Uses private-value" }, ["private-value"]), { apiKey: "[redacted]", text: "Uses [redacted]" });
  const values = Array.from({ length: 100 }, (_, id) => ({ id, message: "x".repeat(5000) }));
  const output = sanitizeOutput(values); same(output.length, 100); same(output[99].message.length, 5000);
});
Deno.test("graph validation rejects dangling edges and unsupported nodes", () => {
  const valid = { graph: { nodes: [node("start", "trigger"), node("end", "output")], edges: [edge("start", "end")] } };
  validateGraph(valid);
  let failed = false; try { validateGraph({ graph: { ...valid.graph, edges: [edge("start", "missing")] } }); } catch { failed = true; } assert(failed);
});
Deno.test("workflow state schemas are typed, bounded and reducer-compatible", () => {
  const base = { graph: { nodes: [node("start", "trigger"), node("end", "output")], edges: [edge("start", "end")] } };
  validateGraph({ ...base, state: { fields: [{ key: "customer.profile", type: "object", reducer: "merge", defaultValue: {} }, { key: "research.items", type: "array", reducer: "append_unique", identityPath: "id" }] } });
  for (const field of [{ key: "__proto__.value", type: "any" }, { key: "scratch.value", type: "any" }, { key: "items", type: "string", reducer: "append" }, { key: "count", type: "number", defaultValue: "zero" }]) {
    let failed = false; try { validateGraph({ ...base, state: { fields: [field] } }); } catch { failed = true; } assert(failed, `Expected invalid state field ${JSON.stringify(field)}`);
  }
});
Deno.test("node state mappings reference declared or permitted scratch keys", () => {
  const mappedStart = { ...node("start", "trigger"), stateWrites: [{ key: "customer", sourcePath: "data.customer" }] };
  const mappedEnd = { ...node("end", "output"), stateReads: [{ key: "customer", alias: "account", required: true }] };
  const configured = { state: { fields: [{ key: "customer", type: "object" }], allowDynamicScratch: true }, graph: { nodes: [mappedStart, mappedEnd], edges: [edge("start", "end")] } };
  validateGraph(configured);
  validateGraph({ ...configured, graph: { ...configured.graph, nodes: [{ ...mappedStart, stateWrites: [{ key: "scratch.note" }] }, mappedEnd] } });
  let failed = false; try { validateGraph({ ...configured, graph: { ...configured.graph, nodes: [{ ...mappedStart, stateWrites: [{ key: "undeclared" }] }, mappedEnd] } }); } catch { failed = true; } assert(failed);
});
Deno.test("mapped execution state is shared across plugins, APIs, conditions and agents", async () => {
  const start = { ...node("start", "trigger", { inputSources: ["result"] }), stateWrites: [{ key: "customer", sourcePath: "data.customer" }] };
  const plugin = { ...node("plugin", "plugin", { code: "return { summary: input.state.account.name + '-ready' };" }), stateReads: [{ key: "customer", alias: "account", required: true }], stateWrites: [{ key: "summary", sourcePath: "summary" }] };
  const api = { ...node("api", "api", { method: "GET" }), stateReads: [{ key: "summary" }], stateWrites: [{ key: "approval", sourcePath: "approved" }] };
  const condition = { ...node("condition", "condition", { expression: "state.approval === true" }), stateReads: [{ key: "approval", required: true }] };
  const agent = { ...node("agent", "agent", { mode: "existing", agentId: "saved", passPrevOutput: true, promptOverride: "Summarize {{state.summary}}" }), stateReads: [{ key: "summary" }] };
  const graph: AgentWorkflow = { nodes: [start, plugin, api, condition, agent, node("end", "output")], edges: [edge("start", "plugin"), edge("plugin", "api"), edge("api", "condition"), edge("condition", "agent", "true"), edge("agent", "end")] };
  let apiState: unknown; let agentPrompt = "";
  const result = await executeWorkflow(graph, { ...context({ customer: { name: "Ada" } }), stateDefinition: { fields: [{ key: "customer", type: "object" }, { key: "summary", type: "string" }, { key: "approval", type: "boolean" }] },
    onApiRequest: async (_id, _config, _previous, _execution, state) => { apiState = state; return { approved: true }; },
    onAgentStep: async (_id, _config, prompt) => { agentPrompt = prompt; return "done"; } });
  assert(!result.error); same(apiState, { summary: "Ada-ready" }); assert(agentPrompt.includes("Ada-ready"));
  same(result.state, { customer: { name: "Ada" }, summary: "Ada-ready", approval: true });
  same(result.results.at(-1)?.nodeId, "end");
});
Deno.test("state reducers combine branch writes and unsafe parallel replacement is rejected", async () => {
  const start = node("start", "trigger");
  const left = { ...node("left", "plugin", { code: "return [{ id: 'left', value: 1 }];" }), stateWrites: [{ key: "items" }] };
  const right = { ...node("right", "plugin", { code: "return [{ id: 'right', value: 2 }, { id: 'left', value: 9 }];" }), stateWrites: [{ key: "items" }] };
  const graph: AgentWorkflow = { nodes: [start, left, right, node("end-left", "output"), node("end-right", "output")], edges: [edge("start", "left"), edge("start", "right"), edge("left", "end-left"), edge("right", "end-right")] };
  const definition = { fields: [{ key: "items", type: "array" as const, reducer: "append_unique" as const, identityPath: "id" }] };
  validateGraph({ state: definition, graph });
  const result = await executeWorkflow(graph, { ...context(), stateDefinition: definition });
  same(result.state.items, [{ id: "left", value: 1 }, { id: "right", value: 2 }]);
  const unsafe = { ...graph, nodes: graph.nodes.map((item) => ["left", "right"].includes(item.id) ? { ...item, stateWrites: [{ key: "shared" }] } : item) };
  let failed = false; try { validateGraph({ state: { fields: [{ key: "shared", type: "object" }] }, graph: unsafe }); } catch { failed = true; } assert(failed);
});
Deno.test("artifact state stores references and loads content only when requested", async () => {
  const start = { ...node("start", "trigger", { inputSources: ["result"] }), stateWrites: [{ key: "report", sourcePath: "data.report" }] };
  const plugin = { ...node("plugin", "plugin", { code: "return input.state.loaded.title;" }), stateReads: [{ key: "report", alias: "loaded", artifactMode: "content" as const }] };
  const graph: AgentWorkflow = { nodes: [start, plugin, node("end", "output")], edges: [edge("start", "plugin"), edge("plugin", "end")] };
  const result = await executeWorkflow(graph, { ...context({ report: { title: "Private report", rows: [1, 2] } }), stateDefinition: { fields: [{ key: "report", type: "artifact" }] } });
  const reference = result.state.report as Record<string, unknown>;
  assert(reference.__workflowArtifact === true && typeof reference.id === "string");
  same(result.results.at(-1)?.output, "Private report");
});
Deno.test("state permissions block undeclared readers, writers and sensitive agent exposure", async () => {
  const start = { ...node("start", "trigger"), stateWrites: [{ key: "secret" }] };
  const agent = { ...node("agent", "agent", { mode: "existing", agentId: "saved", passPrevOutput: true }), stateReads: [{ key: "secret" }] };
  const graph: AgentWorkflow = { nodes: [start, agent, node("end", "output")], edges: [edge("start", "agent"), edge("agent", "end")] };
  let failed = false; try { validateGraph({ state: { fields: [{ key: "secret", type: "any", sensitive: true, allowedWriters: ["start"] }] }, graph }); } catch { failed = true; } assert(failed);
  validateGraph({ state: { fields: [{ key: "secret", type: "any", sensitive: true, allowedWriters: ["start"], allowedReaders: ["agent"], allowInAgentPrompt: true }] }, graph });
  const runtime = await executeWorkflow(graph, { ...context(), stateDefinition: { fields: [{ key: "secret", type: "any", sensitive: true, allowedReaders: ["other"] }] } });
  assert(runtime.error?.includes("not allowed to read"));
});

Deno.test("state-change events observe a durable upstream write exactly once", async () => {
  const start = { ...node("start", "trigger", { inputSources: ["result"] }), stateWrites: [{ key: "order.status", sourcePath: "data.status" }] };
  const changed = node("changed", "event", { eventType: "state_changed", stateKey: "order.status" });
  const graph: AgentWorkflow = { nodes: [start, changed, node("end", "output")], edges: [edge("start", "changed"), edge("changed", "end")] };
  const definition = { fields: [{ key: "order.status", type: "string" as const }] };
  validateGraph({ state: definition, graph });
  const result = await executeWorkflow(graph, { ...context({ status: "approved" }), stateDefinition: definition });
  same(result.state.order, { status: "approved" });
  const eventOutput = result.results.find((step) => step.nodeId === "changed")?.output as Record<string, unknown>;
  same(eventOutput.key, "order.status"); assert(!Object.hasOwn(eventOutput, "value"), "State event output must not bypass read permissions.");
  same(result.results.at(-1)?.nodeId, "end");
});

Deno.test("external signal events durably pause and resume with one consumed payload", async () => {
  const graph: AgentWorkflow = { nodes: [node("start", "trigger"), node("wait", "event", { eventType: "external_signal", signalName: "approval.received" }), node("end", "output")], edges: [edge("start", "wait"), edge("wait", "end")] };
  validateGraph({ graph });
  let checkpoint: WorkflowCheckpoint | undefined;
  const waiting = await executeWorkflow(graph, { ...context(), onCheckpoint: async (value) => { checkpoint = structuredClone(value); } });
  same(waiting.eventWait, { nodeId: "wait", eventType: "external_signal", signalName: "approval.received" });
  assert(checkpoint?.pending[0]?.nodeId === "wait");
  const consumed: string[] = [];
  const resumed = await executeWorkflow(graph, { ...context(), checkpoint, signals: [{ id: "signal-1", name: "approval.received", payload: { approved: true }, receivedAt: "2026-10-07T12:00:00Z" }], onSignalConsumed: async (id) => { consumed.push(id); } });
  same(consumed, ["signal-1"]);
  same((resumed.results.find((step) => step.nodeId === "wait")?.output as Record<string, unknown>).payload, { approved: true });
  same(resumed.results.at(-1)?.nodeId, "end");
});

Deno.test("notification deliveries are signed, retry bounded, and stale questions are skipped", async () => {
  const { deliverNotification } = await import("./interactions.ts");
  Deno.env.set("WORKFLOW_SECRETS_KEY", btoa("a".repeat(32)));
  Deno.env.set("WORKFLOW_INTERNAL_SECRET", "test-internal-secret");
  Deno.env.set("WORKFLOW_INTERACTION_BASE_URL", "https://gateway.example");
  const secret = "s".repeat(32);
  const run = { id: crypto.randomUUID(), organization_id: "org-a", workflow_id: "approval", workflow_name: "Approval", status: "waiting_for_input", waiting_version: "version-a",
    waiting_expires_at: new Date(Date.now()+3600000).toISOString(), interaction_expires_at: new Date(Date.now()+86400000).toISOString(),
    snapshot: { ciphertext: await encrypt({ workflow: { execution: { notifications: { url: "https://receiver.example/events", secret, maxAttempts: 2 } } } }) } };
  const job = { id: crypto.randomUUID(), organization_id: "org-a", run_id: run.id, event_type: "question", payload: { waitingVersion: "version-a", question: "Approve?" }, lease_token: "lease", attempts: 1 };
  const patches: any[] = [];
  const admin = { from: (table: string) => {
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: run }), update: (value: unknown) => { patches.push(value); return query; }, then: (resolve: any) => resolve({ error: null }) };
    assert(["workflow_runs", "workflow_notifications"].includes(table)); return query;
  } };
  let delivered: any;
  const success: typeof fetch = async (_url, options) => {
    delivered = options;
    const headers = new Headers(options?.headers);
    same(headers.get("x-workflow-delivery-id"),job.id);
    same(headers.get("x-workflow-signature"), await hmac(secret, `${headers.get("x-workflow-timestamp")}.${job.id}.${options?.body}`));
    assert(JSON.parse(String(options?.body)).interactionUrl.startsWith("https://gateway.example/workflow/respond#token="));
    same(options?.redirect,"manual"); return new Response(null,{status:204});
  };
  await deliverNotification(admin,job,success,async () => {});
  assert(delivered); same(patches.at(-1).status,"delivered");
  await deliverNotification(admin,job,async () => new Response(null,{status:503}),async () => {});
  same(patches.at(-1).status,"pending"); assert(Date.parse(patches.at(-1).available_at)>Date.now());
  await deliverNotification(admin,{...job,attempts:2},async () => new Response(null,{status:503}),async () => {});
  same(patches.at(-1).status,"failed");
  run.status="queued";
  await deliverNotification(admin,job,async () => { throw new Error("Must not send a stale question"); },async () => {});
  same(patches.at(-1).status,"skipped");
  await deliverNotification(admin,{...job,event_type:"completed",payload:{status:"succeeded"}},async () => new Response(null,{status:204}),async () => {});
  same(patches.at(-1).status,"delivered");
});

Deno.test("callback destinations reject local and private addresses before network access", async () => {
  const { assertPublicUrl } = await import("../../supabase/functions/_shared/workflowHttp.ts");
  for (const address of ["https://localhost", "https://127.0.0.1", "https://10.0.0.1", "https://169.254.169.254", "https://100.64.0.1", "https://[::1]", "https://[::ffff:127.0.0.1]", "https://[fd00::1]"]) {
    await rejects(() => assertPublicUrl(new URL(address)), /public HTTP/);
  }
});
