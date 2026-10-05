import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createCipheriv, randomBytes, randomUUID, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

const encryptionKey = Buffer.alloc(32, 97);
function snapshot(workflow) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ workflow, llm: { enabled: false, workflows: [workflow] } })), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext: `${iv.toString("base64")}.${body.toString("base64")}` };
}
const node = (id, type, data = {}) => ({ id, type, data: { label: id, ...data } });
const edges = (...ids) => ids.slice(1).map((target, index) => ({ id: `${ids[index]}-${target}`, source: ids[index], target }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("worker persists concurrent runs, agent results, failures and paused continuations", { timeout: 40_000 }, async () => {
  const runs = []; const steps = []; let claimed = 0; let maximumActive = 0; let maintenanceCalls = 0;
  const org = randomUUID();
  const graph = { nodes: [node("start", "trigger", { inputSources: ["input"] }), node("plugin", "plugin", { code: "return { id: input.input.id };" }), node("agent", "agent", { mode: "existing", agentId: "saved", passPrevOutput: true }), node("end", "output", { renderAs: "json" })], edges: edges("start", "plugin", "agent", "end") };
  function addRun(graph, id) {
    const workflow = { id: "shared", name: "Shared", graph };
    const run = { id: randomUUID(), organization_id: org, workflow_id: workflow.id, snapshot: snapshot(workflow), status: "queued", timeout_seconds: null, execution_ms: 0,
      input: { resultData: { id }, userMessage: "Run", docText: null, attachments: [] }, trigger_source: "api" };
    runs.push(run); return run;
  }
  const concurrent = Array.from({ length: 4 }, (_, id) => addRun(graph, id));
  const waiting = addRun({ nodes: [node("start", "trigger", { inputSources: ["result"] }), node("ask", "user_input", { question: "Approve?", inputType: "yes_no", answerKey: "approved" }), node("end", "output", { renderAs: "json" })], edges: edges("start", "ask", "end") }, 9);
  const failed = addRun({ nodes: [node("start", "trigger"), node("fail", "plugin", { code: 'throw new Error("Expected node failure");' }), node("end", "output")], edges: edges("start", "fail", "end") }, 10);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      let raw = ""; for await (const chunk of request) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      response.setHeader("Content-Type", "application/json");
      if (url.pathname === "/rest/v1/rpc/maintain_workflow_interactions") { maintenanceCalls++; response.end("null"); return; }
      if (url.pathname === "/rest/v1/rpc/claim_workflow_notification") { response.end("[]"); return; }
      if (url.pathname === "/rest/v1/rpc/claim_workflow_run") {
        assert.deepEqual(body, {}, "Claims must not impose an organization or workflow cap");
        const run = runs.find((run) => run.status === "queued");
        if (run) { Object.assign(run, { status: "running", lease_token: randomUUID(), lease_expires_at: new Date(Date.now() + 60_000).toISOString(), started_at: run.started_at || new Date().toISOString() }); claimed++; }
        maximumActive = Math.max(maximumActive, runs.filter((run) => run.status === "running").length);
        response.end(JSON.stringify(run ? [run] : [])); return;
      }
      if (url.pathname === "/functions/v1/chat-with-result") {
        const run = runs.find((run) => run.id === request.headers["x-workflow-run-id"]);
        assert.ok(run);
        assert.equal(request.headers["x-workflow-signature"], createHmac("sha256", "test-internal-secret").update(`${run.id}.${run.lease_token}`).digest("hex"));
        await sleep(80); // Keep concurrent agent calls active together.
        response.setHeader("Content-Type", "text/event-stream");
        response.end(`data: ${JSON.stringify({ type: "token", content: JSON.stringify(body.inputData) })}\n\ndata: {"type":"done"}\n\n`); return;
      }
      const table = url.pathname.endsWith("workflow_runs") ? runs : url.pathname.endsWith("workflow_run_steps") ? steps : null;
      assert.ok(table, `Unexpected route ${url.pathname}`);
      let rows = table.filter((row) => Array.from(url.searchParams).every(([key, value]) => {
        if (["select", "order", "limit"].includes(key)) return true;
        const dot = value.indexOf("."); const operation = value.slice(0, dot); const expected = value.slice(dot + 1);
        if (operation === "eq") return String(row[key]) === expected;
        if (operation === "gt") return String(row[key]) > expected;
        throw new Error(`Unexpected filter ${value}`);
      }));
      if (request.method === "POST") { const row = { id: randomUUID(), ...body }; table.push(row); rows = [row]; }
      if (request.method === "PATCH") rows.forEach((row) => Object.assign(row, body));
      if (url.searchParams.get("order")?.startsWith("sequence.desc")) rows.sort((a, b) => b.sequence - a.sequence);
      if (url.searchParams.has("limit")) rows = rows.slice(0, Number(url.searchParams.get("limit")));
      const columns = url.searchParams.get("select");
      const output = rows.map((row) => columns && columns !== "*" ? Object.fromEntries(columns.split(",").map((key) => [key, row[key]])) : row);
      const single = String(request.headers.accept || "").includes("application/vnd.pgrst.object+json");
      if (single && !output.length) { response.statusCode = 406; response.end(JSON.stringify({ code: "PGRST116", details: "The result contains 0 rows" })); return; }
      response.end(JSON.stringify(single ? output[0] : output));
    } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ message: String(error) })); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  const child = spawn(process.env.DENO_BIN || "deno", ["run", "--no-prompt", "--unstable-worker-options", "--allow-net", "--allow-env", "services/workflow-worker/main.ts"], {
    env: { ...process.env, SUPABASE_URL: url, SUPABASE_ANON_KEY: "test-anon", SUPABASE_SERVICE_ROLE_KEY: "test-service", WORKFLOW_SECRETS_KEY: encryptionKey.toString("base64"), WORKFLOW_INTERNAL_SECRET: "test-internal-secret", WORKFLOW_WORKER_CONCURRENCY: "4" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  child.stdout.on("data", (chunk) => diagnostics += chunk); child.stderr.on("data", (chunk) => diagnostics += chunk);
  let spawnError; child.on("error", (error) => { spawnError = error; });
  async function until(predicate) {
    const deadline = Date.now() + 20_000;
    while (!predicate()) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`Worker did not reach expected state: ${diagnostics}\n${JSON.stringify(runs.map((run) => ({ status: run.status, reason: run.stop_reason })))}`);
      await sleep(50);
    }
  }
  try {
    await until(() => concurrent.every((run) => run.status === "succeeded") && waiting.status === "waiting_for_input" && failed.status === "failed");
    concurrent.forEach((run, id) => assert.deepEqual(run.output, { id }));
    assert.ok(maximumActive > 1); assert.equal(failed.failed_node_id, "fail"); assert.match(failed.stop_reason, /Expected node failure/);
    assert.equal(steps.filter((step) => step.run_id === failed.id).at(-1).status, "failed");
    assert.equal(waiting.checkpoint.pending[0].nodeId, "ask");
    assert.deepEqual(waiting.waiting.policy, { responseTimeoutSeconds: 172800, reminderIntervalSeconds: 43200, maxReminders: 3 });
    assert.ok(maintenanceCalls > 0, "Background waiting maintenance must execute independently");
    Object.assign(waiting, { status: "queued", resume_answer: "yes" });
    await until(() => waiting.status === "succeeded");
    assert.equal(waiting.output.approved, true); assert.equal(claimed, 7);
    assert.deepEqual(steps.filter((step) => step.run_id === waiting.id).map((step) => [step.node_id, step.status]), [["start", "succeeded"], ["ask", "waiting"], ["ask", "succeeded"], ["end", "succeeded"]]);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "close").catch(() => {}), sleep(2000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  }
});
