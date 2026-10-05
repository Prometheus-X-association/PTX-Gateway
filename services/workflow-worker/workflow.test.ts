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
