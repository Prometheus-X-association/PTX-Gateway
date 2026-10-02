import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(readFileSync(new URL("../supabase/functions/chat-with-result/providers.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const module = { exports: {} };
new Function("exports", "module", outputText)(module.exports, module);
const { resolveProviders, resolveAgentProviders } = module.exports;
const first = { id: "first", enabled: true, model: "old-model", apiKey: "old-key", apiBaseUrl: "https://old.example" };
const second = { id: "second", enabled: true, model: "second-model" };

// Both regular agents and inline workflow nodes use this resolver.
test("default agents and inline workflow nodes inherit changed details and global order", () => {
  const agent = { providerIds: [], agentProviders: [] };
  const inlineNode = { providerIds: [], agentProviders: [] };
  const updated = { ...first, model: "new-model", apiKey: "new-key", apiBaseUrl: "https://new.example" };
  for (const consumer of [agent, inlineNode, {}]) {
    assert.deepEqual(resolveAgentProviders(consumer, { providers: [first, second] }), [first, second]);
    assert.deepEqual(resolveAgentProviders(consumer, { providers: [second, updated] }), [second, updated]);
  }
  assert.deepEqual(agent, { providerIds: [], agentProviders: [] });
});

test("explicit selections retain their own order while using updated provider details", () => {
  const selected = { providerIds: ["second", "first"] };
  const updated = { ...first, model: "updated-model", apiKey: "updated-key" };
  assert.deepEqual(resolveAgentProviders(selected, { providers: [updated, second] }), [second, updated]);
});

test("default consumers follow availability, deletion and newly added providers", () => {
  const third = { id: "third", enabled: true, model: "third-model" };
  const config = { providers: [{ ...first, enabled: false }, second, third] };
  assert.deepEqual(resolveProviders(config), [second, third]);
  assert.deepEqual(resolveAgentProviders({}, config), [second, third]);
  assert.deepEqual(resolveAgentProviders({}, { providers: [third] }), [third]);
  assert.deepEqual(resolveAgentProviders({ providerIds: ["first", "missing", "third"] }, config), [third]);
  assert.deepEqual(resolveAgentProviders({}, { providers: [{ ...first, enabled: false }] }), []);
});

test("agent-specific providers precede the current global fallback", () => {
  const custom = { id: "custom", enabled: true, model: "custom-model" };
  const agent = { agentProviders: [custom, { ...first, enabled: false }] };
  assert.deepEqual(resolveAgentProviders(agent, { providers: [second, first] }), [custom, second, first]);
  assert.deepEqual(resolveAgentProviders({ ...agent, providerIds: ["first"] }, { providers: [second, first] }), [custom, first]);
});

test("legacy single-provider settings still resolve", () => {
  assert.deepEqual(resolveProviders({ apiKey: "legacy-key", model: "legacy-model" }), [{
    apiBaseUrl: "https://api.openai.com/v1", apiKey: "legacy-key", model: "legacy-model", enabled: true,
  }]);
});
