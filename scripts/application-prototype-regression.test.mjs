import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/applicationPrototype.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function("exports", "module", compiled)(module.exports, module);
const { parseApplicationInput, outputTable } = module.exports;

test("application requests preserve every supported JSON payload shape", () => {
  for (const value of [null, false, 0, "", "skills", [], [{ skill: "Analysis" }], { documentIds: ["document-1"], request: "Extract" }]) {
    assert.deepEqual(parseApplicationInput(JSON.stringify(value)), value);
  }
  assert.throws(() => parseApplicationInput("{broken}"), /valid JSON/);
  assert.throws(() => parseApplicationInput(""), /valid JSON/);
});

test("preview input limit counts UTF-8 bytes rather than characters", () => {
  assert.equal(parseApplicationInput(JSON.stringify("x".repeat(256 * 1024 - 2))).length, 256 * 1024 - 2);
  assert.throws(() => parseApplicationInput(JSON.stringify("x".repeat(256 * 1024))), /256 KiB/);
  assert.throws(() => parseApplicationInput(JSON.stringify("€".repeat(100_000))), /256 KiB/);
});

test("result tables handle heterogeneous records without treating scalar arrays as rows", () => {
  const records = [{ skill: "Analysis", confidence: 0.9 }, { skill: "Planning", source: { id: "doc-1" } }];
  assert.deepEqual(outputTable(records), { columns: ["skill", "confidence", "source"], rows: records });
  for (const value of [null, [], [null], ["skill"], [[1]], [{ skill: "Analysis" }, 1], { skill: "Analysis" }]) assert.equal(outputTable(value), null);
});

test("large table output is bounded without modifying the underlying result", () => {
  const rows = Array.from({ length: 150 }, (_, index) => Object.fromEntries(Array.from({ length: 25 }, (_, column) => [`field${column}`, index])));
  const before = structuredClone(rows);
  const table = outputTable(rows);
  assert.equal(table.rows.length, 100);
  assert.equal(table.columns.length, 20);
  assert.deepEqual(rows, before);
});

const bridgeCompiled = ts.transpileModule(readFileSync(new URL("../src/lib/chatBridge.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const bridgeModule = { exports: {} };
new Function("exports", "module", bridgeCompiled)(bridgeModule.exports, bridgeModule);
const { readChatContext, trustedChatMessage } = bridgeModule.exports;

test("chat bridge requires both exact parent identity and origin", () => {
  const parent = {};
  assert.equal(trustedChatMessage({ source: parent, origin: "https://portal.example" }, parent, "https://portal.example"), true);
  assert.equal(trustedChatMessage({ source: {}, origin: "https://portal.example" }, parent, "https://portal.example"), false);
  assert.equal(trustedChatMessage({ source: parent, origin: "https://attacker.example" }, parent, "https://portal.example"), false);
  assert.equal(trustedChatMessage({ source: parent, origin: "null" }, parent, "null"), false);
});

test("chat bridge only accepts bounded context and strips attempted credential/configuration overrides", () => {
  assert.deepEqual(readChatContext({ resultData: [1, 2], docText: "Evidence", orgExecutionToken: "forged", workflowId: "override", organizationId: "other-org" }), { resultData: [1, 2], docText: "Evidence" });
  assert.deepEqual(readChatContext({ resultData: null }), { resultData: null });
  assert.throws(() => readChatContext({ docText: {} }), /must be text/);
  assert.throws(() => readChatContext({ docText: "x".repeat(1024 * 1024) }), /1 MiB/);
  assert.throws(() => readChatContext([]), /object/);
});


test("chat bridge validates host-owned document converter configuration", () => {
  const uploadConfig = { uploadUrl: "https://converter.example/parse", authorization: "Bearer host-token", queryParams: { format: "text" } };
  assert.deepEqual(readChatContext({ uploadConfig }), { uploadConfig });
  assert.throws(() => readChatContext({ uploadConfig: { ...uploadConfig, uploadUrl: "http://converter.example" } }), /HTTPS/);
  assert.throws(() => readChatContext({ uploadConfig: { ...uploadConfig, uploadUrl: "https://user:password@converter.example" } }), /credentials/);
  assert.throws(() => readChatContext({ uploadConfig: { ...uploadConfig, queryParams: { invalid: {} } } }), /parameter/);
});
