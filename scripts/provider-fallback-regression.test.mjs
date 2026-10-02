import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const streamModule = { exports: {} };
new Function("exports", "module", compile(readFileSync(new URL("../supabase/functions/chat-with-result/providerStream.ts", import.meta.url), "utf8")))(streamModule.exports, streamModule);
const { assertProviderSuccess, readProviderStream } = streamModule.exports;
const index = readFileSync(new URL("../supabase/functions/chat-with-result/index.ts", import.meta.url), "utf8");
const helpers = compile(index.slice(index.indexOf("const providerErrorDetail ="), index.indexOf("// ─── MCP helpers")));
const providers = [
  { name: "Older model", model: "older", apiKey: "test", apiBaseUrl: "https://api.openai.com/v1" },
  { name: "Fallback", model: "newer", apiKey: "test", apiBaseUrl: "https://api.openai.com/v1" },
];
const messages = [{ role: "user", content: "Hello" }];
const sse = (...events) => new Response(events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join(""));
const success = () => sse({ choices: [{ delta: { content: "Fallback answer" } }] }, "[DONE]");
const load = (responses) => {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url, ...JSON.parse(options.body) });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    assert.ok(response, "Unexpected extra provider attempt");
    return response;
  };
  const api = new Function("fetch", "assertProviderSuccess", "readProviderStream", `${helpers}\nreturn { streamLlm, callLlmOnce };`)(fetch, assertProviderSuccess, readProviderStream);
  return { ...api, requests };
};
const collect = async (stream) => { let text = ""; for await (const token of stream) text += token; return text; };

test("HTTP model compatibility errors and network failures try the next configured provider", async () => {
  for (const failure of [new Response('{"error":{"message":"Model does not support this input"}}', { status: 400 }), new Error("Network failed")]) {
    const api = load([failure, success()]);
    assert.equal(await collect(api.streamLlm(providers, messages)), "Fallback answer");
    assert.deepEqual(api.requests.map((request) => request.model), ["older", "newer"]);
  }
});

test("document Responses API errors inside HTTP 200 streams use the fallback", async () => {
  for (const failure of [{ type: "error", message: "Unsupported model" }, { type: "response.failed", response: { error: { message: "Unsupported model" } } }, { type: "response.incomplete" }]) {
    const api = load([sse(failure), sse({ type: "response.output_text.delta", delta: "Document answer" }, { type: "response.completed" })]);
    const attachments = [{ name: "test.pdf", mimeType: "application/pdf", base64: "dGVzdA==", size: 4 }];
    assert.equal(await collect(api.streamLlm(providers, messages, attachments)), "Document answer");
    assert.ok(api.requests.every((request) => request.url.endsWith("/responses")));
    assert.deepEqual(api.requests[0].input, api.requests[1].input);
  }
});

test("failed partial answers are reset before fallback text is sent", async () => {
  const api = load([sse({ choices: [{ delta: { content: "Failed partial answer" } }] }, { error: { message: "Model failed" } }), success()]);
  const events = [];
  for await (const token of api.streamLlm(providers, messages, [], () => events.push("RESET"))) events.push(token);
  assert.deepEqual(events, ["Failed partial answer", "RESET", "Fallback answer"]);
});

test("empty, malformed and truncated streams also use fallback", async () => {
  for (const response of [sse("[DONE]"), sse("invalid JSON"), sse({ choices: [{ delta: { content: "Truncated" } }] })]) {
    const api = load([response, success()]);
    let text = "";
    for await (const token of api.streamLlm(providers, messages, [], () => { text = ""; })) text += token;
    assert.equal(text, "Fallback answer");
    assert.equal(api.requests.length, 2);
  }
});

test("Anthropic and Gemini stream error events try their configured fallback", async () => {
  for (const providerType of ["anthropic", "gemini"]) {
    const api = load([sse({ type: "error", error: { message: "Model failure" } }), success()]);
    assert.equal(await collect(api.streamLlm([{ ...providers[0], providerType }, providers[1]], messages)), "Fallback answer");
    assert.equal(api.requests.length, 2);
  }
});

test("successful native streams finish without trying the fallback", async () => {
  for (const [providerType, response] of [
    ["anthropic", sse({ type: "content_block_delta", delta: { text: "Native answer" } }, { type: "message_stop" })],
    ["gemini", sse({ candidates: [{ content: { parts: [{ text: "Native answer" }] }, finishReason: "STOP" }] })],
  ]) {
    const api = load([response]);
    assert.equal(await collect(api.streamLlm([{ ...providers[0], providerType }, providers[1]], messages)), "Native answer");
    assert.equal(api.requests.length, 1);
  }
});

test("only exhausted providers produce an error", async () => {
  const api = load([sse({ error: { message: "First failure" } }), sse({ error: { message: "Second failure" } })]);
  await assert.rejects(collect(api.streamLlm(providers, messages)), /All providers failed.*First failure.*Second failure/);
  assert.equal(api.requests.length, 2);
});

test("successful streaming stops before fallback and handles split UTF-8 and final lines", async () => {
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Héllo"}}]}\n\ndata: [DONE]');
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const api = load([new Response(body)]);
  assert.equal(await collect(api.streamLlm(providers, messages)), "Héllo");
  assert.equal(api.requests.length, 1);
});

test("tool-use calls reject embedded errors and empty native responses before fallback", async () => {
  for (const providerType of ["openai", "anthropic", "gemini"]) {
    for (const failure of [{ error: { message: "Unsupported model" } }, {}]) {
      const message = { role: "assistant", content: "", tool_calls: [{ id: "call", type: "function", function: { name: "lookup", arguments: "{}" } }] };
      const api = load([Response.json(failure), Response.json({ choices: [{ message }] })]);
      assert.deepEqual((await api.callLlmOnce([{ ...providers[0], providerType }, providers[1]], messages)).message, message);
      assert.equal(api.requests.length, 2);
    }
  }
});
