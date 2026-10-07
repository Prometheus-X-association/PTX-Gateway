import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

function loadTypescript(path) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  const require = (name) => {
    if (name === "../../supabase/functions/_shared/workflowExecutor.ts") return loadTypescript("../supabase/functions/_shared/workflowExecutor.ts");
    if (name === "./workflowSandbox" || name === "@/lib/workflowSandbox") return {
      executeSandboxedJavascript: () => { throw new Error("Agent-only tests must not invoke the browser sandbox"); },
    };
    throw new Error(`Unexpected runtime dependency: ${name}`);
  };
  new Function("exports", "module", "require", outputText)(module.exports, module, require);
  return module.exports;
}

const { resolveSavedWorkflowAgent, resolveWorkflowResultContext } = loadTypescript("../supabase/functions/chat-with-result/workflowAgent.ts");
const { executeWorkflow } = loadTypescript("../src/lib/workflowExecutor.ts");
const { validateSerializableData, MAX_NODE_OUTPUT_BYTES, MAX_CHECKPOINT_BYTES, nodeSideEffectClass } = loadTypescript("../supabase/functions/_shared/workflowExecutor.ts");
const { loadWorkflowForNewRun } = loadTypescript("../src/lib/workflowRun.ts");

const savedWorkflow = (agentId) => ({
  id: "saved-workflow", enabled: true,
  graph: {
    nodes: [
      { id: "start", type: "trigger", data: { inputSources: ["result"], defaultPrompt: `Run ${agentId}` } },
      { id: "agent", type: "agent", data: { mode: "existing", agentId } },
    ],
    edges: [{ id: "edge", source: "start", target: "agent" }],
  },
});

test("workflow persistence rejects oversized, circular and deeply nested values", () => {
  assert.doesNotThrow(() => validateSerializableData({ ok: true }, "Output", MAX_NODE_OUTPUT_BYTES));
  assert.throws(() => validateSerializableData("x".repeat(MAX_NODE_OUTPUT_BYTES + 1), "Output", MAX_NODE_OUTPUT_BYTES), /5 MB limit/);
  const circular = {}; circular.self = circular;
  assert.throws(() => validateSerializableData(circular, "Output", MAX_NODE_OUTPUT_BYTES), /circular reference/);
  let deep = {}; let current = deep;
  for (let index = 0; index < 52; index++) current = current.next = {};
  assert.throws(() => validateSerializableData(deep, "Output", MAX_CHECKPOINT_BYTES), /nesting depth/);
});

test("node side-effect defaults are conservative and operation IDs are stable", async () => {
  const graph = {
    nodes: [
      { id: "start", type: "trigger", data: { inputSources: ["result"] } },
      { id: "get", type: "api", data: { method: "GET" } },
      { id: "post", type: "api", data: { method: "POST" } },
      { id: "agent", type: "agent", data: { mode: "existing", agentId: "saved" } },
    ], edges: [],
  };
  assert.equal(nodeSideEffectClass(graph.nodes[0]), "pure");
  assert.equal(nodeSideEffectClass(graph.nodes[1]), "read_only");
  assert.equal(nodeSideEffectClass(graph.nodes[2]), "non_idempotent");
  assert.equal(nodeSideEffectClass(graph.nodes[3]), "non_idempotent");
  const starts = [];
  await executeWorkflow({ nodes: [graph.nodes[0]], edges: [] }, {
    runId: "run-a", resultData: {}, docText: null, userMessage: "Run",
    onAgentStep: async () => "", onApiRequest: async () => ({}), onStepDone: () => {},
    onStepStart: (_id, _input, execution) => starts.push(execution),
  });
  assert.equal(starts[0].operationId, "run-a.start.1");
  assert.equal(starts[0].sideEffectClass, "pure");
});

test("transient retries are bounded and never replay non-idempotent nodes", async () => {
  const run = async (data) => {
    let calls = 0;
    const result = await executeWorkflow({ nodes: [
      { id: "start", type: "trigger", data: { inputSources: ["result"] } },
      { id: "api", type: "api", data },
      { id: "end", type: "output", data: {} },
    ], edges: [{ id: "a", source: "start", target: "api" }, { id: "b", source: "api", target: "end" }] }, {
      resultData: {}, docText: null, userMessage: "Run", stopOnError: true,
      onAgentStep: async () => "", onStepDone: () => {},
      onApiRequest: async () => { calls++; if (calls < 3) throw Object.assign(new Error("HTTP 503"), { status: 503 }); return { ok: true }; },
    });
    return { calls, result };
  };
  const safe = await run({ method: "GET", retryPolicy: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 } });
  assert.equal(safe.calls, 3); assert.equal(safe.result.results[1].attemptCount, 3); assert.equal(safe.result.error, undefined);
  const unsafe = await run({ method: "POST", retryPolicy: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 } });
  assert.equal(unsafe.calls, 1); assert.match(unsafe.result.error, /503/);
});

test("each new run fetches and executes the latest saved graph", async () => {
  let saved = savedWorkflow("first-agent");
  let fetches = 0;
  const loader = async (id) => { assert.equal(id, saved.id); fetches++; return saved; };
  const agents = [];
  for (const agentId of ["first-agent", "updated-agent"]) {
    saved = savedWorkflow(agentId);
    const latest = await loadWorkflowForNewRun(saved.id, loader);
    assert.equal(latest.graph.nodes[0].data.defaultPrompt, `Run ${agentId}`);
    await executeWorkflow(latest.graph, {
      resultData: {}, docText: null, userMessage: "Run",
      onAgentStep: async (_id, config) => { agents.push(config.agentId); return "Done"; },
      onStepDone: () => {},
    });
  }
  assert.equal(fetches, 2);
  assert.deepEqual(agents, ["first-agent", "updated-agent"]);
});

test("new runs await the saved graph before proceeding", async () => {
  let finishFetch;
  let proceeded = false;
  const pending = loadWorkflowForNewRun("saved-workflow", () => new Promise((resolve) => { finishFetch = resolve; }))
    .then(() => { proceeded = true; });
  await Promise.resolve();
  assert.equal(proceeded, false);
  finishFetch(savedWorkflow("updated-agent"));
  await pending;
  assert.equal(proceeded, true);
});

test("fetch failures and missing loaders reject instead of falling back to a cached graph", async () => {
  await assert.rejects(loadWorkflowForNewRun("saved-workflow", async () => { throw new Error("Network failed"); }), /Network failed/);
  await assert.rejects(loadWorkflowForNewRun("saved-workflow", undefined), /latest saved workflow/);
});

test("deleted, disabled, mismatched and empty saved workflows cannot start", async () => {
  for (const saved of [null, { ...savedWorkflow("agent"), enabled: false },
    { ...savedWorkflow("agent"), id: "another-workflow" },
    { ...savedWorkflow("agent"), graph: { nodes: [], edges: [] } }]) {
    await assert.rejects(loadWorkflowForNewRun("saved-workflow", async () => saved));
  }
});

test("switching to an existing agent clears inline provider overrides but keeps node capabilities", () => {
  const staleRequest = {
    systemPrompt: "Old inline prompt", outputType: "html", fallbackOutputType: "html",
    skillIds: ["node-skill"], providerIds: ["old-provider"], agentProviders: [{ id: "old" }],
  };
  const resolved = { ...staleRequest, ...resolveSavedWorkflowAgent({
    mode: "existing", agentId: "updated-agent", inlineSystemPrompt: "Old inline prompt",
    skillIds: ["node-skill"], mcpServerIds: ["node-mcp"], providerIds: ["old-provider"],
    nodeOutputType: "json", nodeOutputInstructions: "Return { ok: boolean }",
  }) };
  assert.equal(resolved.agentId, "updated-agent");
  assert.equal(resolved.systemPrompt, undefined);
  assert.equal(resolved.outputType, undefined);
  assert.equal(resolved.fallbackOutputType, undefined);
  assert.equal(resolved.providerIds, undefined);
  assert.equal(resolved.agentProviders, undefined);
  assert.deepEqual(resolved.skillIds, ["node-skill"]);
  assert.deepEqual(resolved.mcpServerIds, ["node-mcp"]);
  assert.equal(resolved.nodeOutputType, "json");
  assert.equal(resolved.nodeOutputInstructions, "Return { ok: boolean }");
});

test("inline nodes use current saved skills, prompts and providers", () => {
  const resolved = resolveSavedWorkflowAgent({ mode: "inline", agentId: "old-agent",
    inlineSystemPrompt: "Updated prompt", inlineOutputType: "auto", inlineFallbackOutputType: "json",
    skillIds: ["new-skill"], providerIds: ["new-provider"], agentProviders: [{ id: "new" }],
  });
  assert.deepEqual(resolved, { agentId: undefined, systemPrompt: "Updated prompt", outputType: "auto",
    fallbackOutputType: "json", skillIds: ["new-skill"], mcpServerIds: [], mcpToolFilter: {},
    providerIds: ["new-provider"], agentProviders: [{ id: "new" }], nodeOutputType: undefined, nodeOutputInstructions: undefined,
  });
});

test("unconfigured existing nodes fail instead of using generic chat", () => {
  assert.throws(() => resolveSavedWorkflowAgent({ mode: "existing", agentId: " " }), /Select an existing agent/);
});

async function runAgent(data, response = "Updated response") {
  const calls = [];
  const result = await executeWorkflow({
    nodes: [
      { id: "start", type: "trigger", data: { inputSources: ["result"] } },
      { id: "agent", type: "agent", data },
    ], edges: [{ id: "edge", source: "start", target: "agent" }],
  }, {
    resultData: { current: true }, userMessage: "Run", docText: null, stopOnError: true,
    onAgentStep: async (...args) => { calls.push(args); return response; },
    onStepDone: () => {},
  });
  return { result, calls };
}

test("executor ignores retained inline settings after switching to an existing agent", async () => {
  const { calls, result } = await runAgent({ mode: "existing", agentId: "updated-agent",
    inlineSystemPrompt: "Using only the uploaded document", skillIds: ["old-skill"],
  });
  assert.equal(result.error, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].agentId, "updated-agent");
  assert.equal(calls[0][1].inline, undefined);
  assert.deepEqual(calls[0][1].overrides.skillIds, ["old-skill"]);
  assert.equal(calls[0][1].includeResultData, true);
});

test("node skills, MCP restrictions, and forced output reach both agent modes", async () => {
  for (const mode of ["existing", "inline"]) {
    const { calls } = await runAgent({ mode, agentId: "saved-agent", inlineSystemPrompt: "Do the work",
      skillIds: ["node-skill"], mcpServerIds: ["reports"], mcpToolFilter: { reports: ["generate"] },
      nodeOutputType: "json", nodeOutputInstructions: "Return exactly { ok: boolean }" });
    assert.deepEqual(calls[0][1].overrides, {
      skillIds: ["node-skill"], mcpServerIds: ["reports"], mcpToolFilter: { reports: ["generate"] },
      nodeOutputType: "json", nodeOutputInstructions: "Return exactly { ok: boolean }",
    });
  }
});

test("forced JSON node contracts preserve structured values and reject invalid output", async () => {
  const valid = await runAgent({ mode: "existing", agentId: "saved", nodeOutputType: "json" }, '{"ok":true}');
  assert.deepEqual(valid.result.results.find((step) => step.nodeId === "agent").output, { ok: true });
  const invalid = await runAgent({ mode: "existing", agentId: "saved", nodeOutputType: "json" }, "not json");
  assert.match(invalid.result.results.find((step) => step.nodeId === "agent").error, /required JSON output contract/);
});

test("executor stops before calling a provider when no existing agent is selected", async () => {
  const { calls, result } = await runAgent({ mode: "existing" });
  assert.equal(calls.length, 0);
  assert.match(result.results.find((step) => step.nodeId === "agent").error, /Select an existing agent/);
});

const { buildChunkedResultPayload, formatUploadedDocumentContext } = loadTypescript("../supabase/functions/chat-with-result/resultContext.ts");

test("workflow delivery settings reach callbacks for existing and inline agents", async () => {
  for (const mode of ["existing", "inline"]) {
    for (const resultContextMode of ["full", "chunked"]) {
      const { calls } = await runAgent({ mode, agentId: "saved-agent", resultContextMode, resultChunkSize: 2000 });
      assert.equal(calls[0][1].resultContextMode, resultContextMode);
      assert.equal(calls[0][1].resultChunkSize, 2000);
    }
  }
});

test("saved workflow settings override stale requests and allow inheritance", () => {
  const staleRequest = { resultContextMode: "chunked", resultChunkSize: 9000 };
  assert.deepEqual({ ...staleRequest, ...resolveWorkflowResultContext({ resultContextMode: "full", resultChunkSize: 1000 }) },
    { resultContextMode: "full", resultChunkSize: 2000 });
  assert.deepEqual({ ...staleRequest, ...resolveWorkflowResultContext({}) },
    { resultContextMode: undefined, resultChunkSize: undefined });
});

test("ordered chunks preserve large JSON and text completely, including the tail", () => {
  for (const value of [{ nodes: [{ id: "a", label: "First", data: "x".repeat(45000) }, { id: "b", label: "Last" }] }, "x".repeat(45000) + "THE END"]) {
    const payload = buildChunkedResultPayload(value, 2000);
    const serialized = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    assert.equal(payload.chunks.map((chunk) => chunk.text).join(""), serialized);
    assert.equal(payload.manifest.totalChars, serialized.length);
    assert.equal(payload.manifest.totalChunks, payload.chunks.length);
    payload.chunks.forEach((chunk, index) => {
      assert.equal(chunk.index, index + 1);
      assert.equal(chunk.start, index * 2000);
      assert.equal(chunk.end, Math.min((index + 1) * 2000, serialized.length));
    });
    if (typeof value !== "string") {
      const last = payload.manifest.nodeIndex.find((node) => node.id === "b");
      assert.equal(last.label, "Last");
      assert.ok(payload.chunks[last.chunkIndex - 1].text.includes('"Last"'));
    }
  }
});

test("chunk sizes are bounded and invalid values use the default", () => {
  for (const [requested, expected] of [[1, 2000], [100000, 50000], [NaN, 12000], [Infinity, 12000], [undefined, 12000]]) {
    assert.equal(buildChunkedResultPayload("hello", requested).manifest.chunkSize, expected);
  }
});

test("uploaded documents in chunked mode preserve evidence beyond the full-mode cutoff", () => {
  const evidence = "Final evidence: München — verified at the end.";
  const docText = "Introduction\n" + "Document passage.\n".repeat(4000) + evidence;
  const formatted = formatUploadedDocumentContext(docText, "chunked", 2000);
  assert.ok(formatted.includes("## Uploaded document (chunked)"));
  assert.ok(formatted.includes("### Manifest"));
  assert.ok(formatted.includes('"format": "text"'));
  assert.ok(formatted.includes(`"totalChars": ${docText.length}`));
  assert.ok(formatted.includes('"chunkSize": 2000'));
  assert.ok(formatted.includes(evidence));
  assert.ok(!formatted.includes("<truncated>"));
  const chunks = [...formatted.matchAll(/### Chunk \d+\/\d+ chars \d+-\d+\n([\s\S]*?)(?=\n\n### Chunk |$)/g)].map((match) => match[1]);
  assert.equal(chunks.join(""), docText);
  const full = formatUploadedDocumentContext(docText, "full", 2000);
  assert.ok(full.includes("<truncated>"));
  assert.ok(!full.includes(evidence));
  assert.equal(formatUploadedDocumentContext("Short document.", "full"), "\nUploaded document:\nShort document.");
});
