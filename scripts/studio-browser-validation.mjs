/** Browser integration with deterministic API fixtures. Server authorization and real SQL are tested separately. */
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.STUDIO_TEST_URL || "http://127.0.0.1:4173";
const apiUrl = process.env.STUDIO_TEST_API_URL || readFileSync(".env.local", "utf8").match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)?.[1];
if (!apiUrl) throw new Error("Provide STUDIO_TEST_API_URL or .env.local with VITE_SUPABASE_URL.");
const org = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", slug: "test-org", name: "Studio Test Organization", settings: {}, is_active: true };
const user = { id: "11111111-1111-4111-8111-111111111111", email: "studio@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const definition = (title, extra = {}) => ({ schemaVersion: 1, title, description: "", elements: [], pageIds: [], layout: "tabs", targetResourceId: "", prompts: [], allowedOrigins: [], allowEmbedding: false, ...extra });
const items = [];
const releases = new Map();
function seed(kind, slug, draft, parent_id = null) {
  const item = { id: randomUUID(), organization_id: org.id, kind, slug, draft, parent_id, revision: 1, active: false, published_release_id: null, created_at: new Date().toISOString() };
  items.push(item); return item;
}
function publish(item) {
  const published = structuredClone(item.draft);
  if (item.kind === "application") published.pageReleases = items.filter((page) => page.parent_id === item.id && page.active).map((page) => ({ id: page.id, releaseId: page.published_release_id }));
  if (item.kind === "canvas") published.pageReleases = item.draft.pageIds.map((id) => ({ id, releaseId: items.find((page) => page.id === id).published_release_id }));
  const release = { id: randomUUID(), item_id: item.id, revision: item.revision, definition: published, created_at: new Date().toISOString() };
  releases.set(release.id, release); item.published_release_id = release.id; item.active = true; item.revision++;
}
function view(item, releaseId = item.published_release_id) { const release = releases.get(releaseId); return { id: item.id, kind: item.kind, slug: item.slug, parentId: item.parent_id, releaseId, definition: release.definition }; }
const chat = seed("chat", "assistant", definition("Skills Assistant", { allowEmbedding: true, allowedOrigins: ["http://localhost:4173"] })); publish(chat);
const app = seed("application", "skills", definition("Skill Management"));
const pageItem = seed("page", "extract", definition("Extracted Skills", { elements: [
  { id: "intro", type: "text", label: "Introduction", content: "Review extracted skills and their evidence." },
  { id: "input", type: "json-input", label: "Document request", content: '{"documentIds":["doc-1"]}' },
  { id: "extract", type: "workflow-button", label: "Extract skills", workflowId: "extract" },
  { id: "result", type: "result", label: "Skill results" },
  { id: "chat", type: "chat", label: "Assistant", chatId: chat.id },
] }), app.id); publish(pageItem); publish(app);
const canvas = seed("canvas", "workspace", definition("Organization workspace", { pageIds: [pageItem.id], layout: "grid" })); publish(canvas);
const chatRequests = [];
const browserErrors = [];
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
async function fixtures(context, authenticated = true) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const json = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value), headers: { "access-control-allow-origin": "*" } });
    if (url.origin === new URL(apiUrl).origin) {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
      if (url.pathname.includes("/auth/v1/user")) return json(user);
      if (url.pathname.includes("/auth/v1/")) return json({});
      if (url.pathname.includes("/rest/v1/")) {
        const table = url.pathname.split("/").at(-1);
        let rows = [];
        if (table === "profiles") rows = [{ id: "profile", user_id: user.id, email: user.email, full_name: "Studio Tester" }];
        if (table === "organizations") rows = [org];
        if (table === "organization_members") rows = [{ organization_id: org.id, user_id: user.id, status: "active" }];
        if (table === "user_roles") rows = [{ organization_id: org.id, user_id: user.id, role: "admin" }];
        if (table === "global_configs") rows = [{ id: "config", organization_id: org.id, features: { llmInsights: { enabled: true, providers: [], agents: [], workflows: [] } } }];
        return json(route.request().headers().accept?.includes("object") ? rows[0] || null : rows);
      }
      const body = route.request().postDataJSON() || {};
      if (url.pathname.endsWith("studio-api")) {
        const item = items.find((entry) => entry.id === body.id);
        if (body.action === "list") return json({ ok: true, items });
        if (body.action === "create") { const created = seed(body.kind, body.slug, body.definition, body.parentId || null); return json({ ok: true, item: created }); }
        if (body.action === "save") { item.draft = body.definition; item.revision++; return json({ ok: true, item }); }
        if (body.action === "publish") { publish(item); return json({ ok: true, item }); }
        if (body.action === "activate") { item.active = body.active; item.revision++; return json({ ok: true, item }); }
        if (body.action === "delete") { items.splice(items.indexOf(item), 1); return json({ ok: true, item }); }
        if (body.action === "releases") return json({ ok: true, releases: [...releases.values()].filter((entry) => entry.item_id === item.id) });
        if (body.action === "rollback") { item.published_release_id = body.releaseId; item.revision++; return json({ ok: true, item }); }
        if (body.action === "resolve") {
          const root = items.find((entry) => entry.slug === body.slug && entry.kind === (body.kind || "application"));
          return json({ ok: true, organization: org, item: view(root), pages: releases.get(root.published_release_id).definition.pageReleases.map((pin) => view(items.find((entry) => entry.id === pin.id), pin.releaseId)) });
        }
        if (body.action === "chat" || body.action === "embed_chat") {
          if (!item.active || (body.action === "embed_chat" && (body.token !== "test-token" || body.parentOrigin !== "http://localhost:4173"))) return json({ ok: false, error: "Embed denied" }, 403);
          return json({ ok: true, organization: org, item: view(item), executionToken: body.action === "embed_chat" ? "test-execution" : undefined });
        }
        if (body.action === "launch") return json({ ok: true, runId: "run-1" }, 202);
      }
      if (url.pathname.endsWith("workflow-runs")) return json({ ok: true, run: { id: "run-1", status: "succeeded", output: [{ skill: "Analysis", source: "doc-1" }] } });
      if (url.pathname.endsWith("llm-insights")) return json({ ok: true, enabled: true, configured: true, freeChatConfigured: true, agents: [], workflows: [], predefinedPrompts: ["Summarize skills"] });
      if (url.pathname.endsWith("chat-with-result")) {
        chatRequests.push(body);
        return route.fulfill({ contentType: "text/event-stream", headers: { "access-control-allow-origin": "*" }, body: 'data: {"type":"token","content":"Validated chat reply"}\n\ndata: {"type":"done"}\n\n' });
      }
      return json({ ok: true });
    }
    if (url.hostname === "localhost" && url.pathname === "/__chat-host") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><script src="${base}/ptx-chat.js"></script><ptx-chat id="chat" src="${base}" org="test-org" drawer-id="${chat.id}" token="test-token"></ptx-chat><script>window.chatEvents=[];document.querySelector('ptx-chat').addEventListener('ptx-chat:ready',()=>window.chatEvents.push('ready'));</script></body></html>` });
    if (["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "4173") return route.continue();
    return route.abort(); // Never contact external providers or model downloads during this deterministic test.
  });
  if (authenticated) await context.addInitScript(({ apiUrl, org, user }) => {
    const token = `${btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }))}.fixture`;
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    localStorage.setItem(`sb-${new URL(apiUrl).hostname.split(".")[0]}-auth-token`, JSON.stringify({ access_token: token, refresh_token: "fixture", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user }));
    localStorage.setItem("pdc_active_org_id", org.id);
  }, { apiUrl, org, user });
  context.on("page", (page) => page.on("pageerror", (error) => browserErrors.push(error.stack || error.message)));
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await fixtures(context);
  const page = await context.newPage();
  await page.goto(`${base}/admin?section=applications`);
  await page.getByRole("button", { name: "New application", exact: true }).waitFor();
  await page.getByRole("button", { name: "New application", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Browser-created application");
  await page.getByLabel("URL slug").fill("browser-created");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByRole("button", { name: "Publish saved draft", exact: true }).waitFor();
  await page.getByRole("button", { name: "Publish saved draft", exact: true }).click();
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  assert.ok(items.some((item) => item.slug === "browser-created" && item.active));
  await page.getByRole("tab", { name: "Chat Drawers", exact: true }).click();
  await page.getByRole("button", { name: "New chat", exact: true }).waitFor();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Target resource or service-chain ID").waitFor();
  assert.ok((await page.locator("textarea[readonly]").inputValue()).includes("<ptx-chat"));
  await page.goto(`${base}/o/test-org/apps/skills/extract`);
  await page.getByRole("button", { name: "Extract skills", exact: true }).click();
  await page.getByRole("cell", { name: "Analysis", exact: true }).waitFor();
  await page.getByRole("button", { name: "Send message", exact: true }).waitFor();
  const chatPanel = page.getByRole("region", { name: "Skills Assistant" });
  await chatPanel.locator("textarea").fill("Explain these skills");
  await chatPanel.getByRole("button", { name: "Send message", exact: true }).click();
  await chatPanel.getByText("Validated chat reply", { exact: true }).waitFor();
  assert.equal(chatRequests.at(-1).result[0].skill, "Analysis");
  await page.goto(`${base}/o/test-org/canvas/workspace`);
  await page.getByRole("heading", { name: "Organization workspace", exact: true }).waitFor();
  await page.getByRole("button", { name: "Extract skills", exact: true }).waitFor();
  mkdirSync("/tmp/ptx-studio-validation/screenshots", { recursive: true });
  await page.screenshot({ path: "/tmp/ptx-studio-validation/screenshots/studio-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Mobile runtime overflows viewport");
  await page.screenshot({ path: "/tmp/ptx-studio-validation/screenshots/studio-mobile.png", fullPage: true });
  console.log("PASS: admin create/publish, chat management, published workflow output, inline chat, canvas and mobile layout");
  const external = await browser.newContext({ viewport: { width: 1000, height: 850 } });
  // This test uses two loopback origins; Chromium requires explicit local-network permission.
  await external.grantPermissions(["local-network-access"], { origin: "http://localhost:4173" });
  await fixtures(external, false);
  const host = await external.newPage(); await host.goto("http://localhost:4173/__chat-host");
  try { await host.waitForFunction(() => window.chatEvents?.includes("ready"), undefined, { timeout: 10000 }); }
  catch (error) { for (const frame of host.frames()) console.log("FRAME", frame.url().split("#")[0], await frame.locator("body").innerText().catch(() => "unavailable")); console.log("HOST", await host.content()); console.log("SHADOW", await host.locator("ptx-chat").evaluate((element) => element.shadowRoot?.innerHTML)); console.log("ERRORS", browserErrors); throw error; }
  await host.evaluate(() => { document.querySelector("ptx-chat").context = { resultData: { marker: "trusted-context" }, docText: "Host evidence" }; });
  const frame = host.frames().find((entry) => entry.url().includes("/chat/embed/")); assert.ok(frame);
  await frame.getByRole("button", { name: "Send message", exact: true }).waitFor();
  await frame.evaluate(() => window.dispatchEvent(new MessageEvent("message", { source: window.parent, origin: "https://evil.example", data: { type: "ptx-chat:context", detail: { resultData: { marker: "forged-context" } } } })));
  await frame.locator("textarea").fill("Explain host context");
  await frame.getByRole("button", { name: "Send message", exact: true }).click();
  await frame.getByText("Validated chat reply", { exact: true }).waitFor();
  assert.equal(chatRequests.at(-1).result.result.marker, "trusted-context");
  assert.ok(chatRequests.at(-1).result.docText.includes("Host evidence"));
  await frame.locator('input[type="file"]').setInputFiles({ name: "skills.txt", mimeType: "text/plain", buffer: Buffer.from("Uploaded evidence: planning skills") });
  await frame.getByRole("button", { name: "Document attached", exact: true }).waitFor();
  await frame.locator("textarea").fill("Explain uploaded evidence");
  await frame.getByRole("button", { name: "Send message", exact: true }).click();
  await host.waitForTimeout(150);
  assert.equal(chatRequests.at(-1).attachments[0].name, "skills.txt");
  await host.evaluate(() => document.querySelector("ptx-chat").close());
  await frame.getByRole("button", { name: "Open Skills Assistant", exact: true }).waitFor();
  await host.evaluate(() => document.querySelector("ptx-chat").open());
  await frame.getByRole("button", { name: "Send message", exact: true }).waitFor();
  const forbidden = await external.newPage(); await forbidden.goto(`${base}/chat/embed/test-org/${chat.id}#token=test-token`);
  await forbidden.getByRole("alert").filter({ hasText: "authorized iframe" }).waitFor();
  const signedOut = await external.newPage(); await signedOut.goto(`${base}/o/test-org/apps/skills`); await signedOut.waitForURL("**/login");
  assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join("; ")}`);
  console.log("PASS: external cross-origin web component/iframe, context bridge, forged-origin rejection, uploads, close/open, missing-parent denial and login protection");
} finally { await browser.close(); }
