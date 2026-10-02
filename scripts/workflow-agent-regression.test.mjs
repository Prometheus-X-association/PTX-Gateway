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
    if (name === "@/lib/workflowSandbox") return {
      executeSandboxedJavascript: () => { throw new Error("Agent-only tests must not invoke the browser sandbox"); },
    };
    throw new Error(`Unexpected runtime dependency: ${name}`);
  };
  new Function("exports", "module", "require", outputText)(module.exports, module, require);
  return module.exports;
}

const { resolveSavedWorkflowAgent } = loadTypescript("../supabase/functions/chat-with-result/workflowAgent.ts");
const { executeWorkflow } = loadTypescript("../src/lib/workflowExecutor.ts");
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

test("switching to an existing agent clears every stale inline override", () => {
  const staleRequest = {
    systemPrompt: "Old inline prompt", outputType: "html", fallbackOutputType: "html",
    skillIds: ["old-skill"], providerIds: ["old-provider"], agentProviders: [{ id: "old" }],
  };
  const resolved = { ...staleRequest, ...resolveSavedWorkflowAgent({
    mode: "existing", agentId: "updated-agent", inlineSystemPrompt: "Old inline prompt",
    skillIds: ["old-skill"], providerIds: ["old-provider"],
  }) };
  assert.equal(resolved.agentId, "updated-agent");
  for (const key of Object.keys(staleRequest)) assert.equal(resolved[key], undefined, key);
});

test("inline nodes use current saved skills, prompts and providers", () => {
  const resolved = resolveSavedWorkflowAgent({ mode: "inline", agentId: "old-agent",
    inlineSystemPrompt: "Updated prompt", inlineOutputType: "auto", inlineFallbackOutputType: "json",
    skillIds: ["new-skill"], providerIds: ["new-provider"], agentProviders: [{ id: "new" }],
  });
  assert.deepEqual(resolved, { agentId: undefined, systemPrompt: "Updated prompt", outputType: "auto",
    fallbackOutputType: "json", skillIds: ["new-skill"], providerIds: ["new-provider"], agentProviders: [{ id: "new" }],
  });
});

test("unconfigured existing nodes fail instead of using generic chat", () => {
  assert.throws(() => resolveSavedWorkflowAgent({ mode: "existing", agentId: " " }), /Select an existing agent/);
});

async function runAgent(data) {
  const calls = [];
  const result = await executeWorkflow({
    nodes: [
      { id: "start", type: "trigger", data: { inputSources: ["result"] } },
      { id: "agent", type: "agent", data },
    ], edges: [{ id: "edge", source: "start", target: "agent" }],
  }, {
    resultData: { current: true }, userMessage: "Run", docText: null, stopOnError: true,
    onAgentStep: async (...args) => { calls.push(args); return "Updated response"; },
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
  assert.equal(calls[0][1].includeResultData, true);
});

test("executor stops before calling a provider when no existing agent is selected", async () => {
  const { calls, result } = await runAgent({ mode: "existing" });
  assert.equal(calls.length, 0);
  assert.match(result.results.find((step) => step.nodeId === "agent").error, /Select an existing agent/);
});
