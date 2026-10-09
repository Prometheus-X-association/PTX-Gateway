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
let debugPage;
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
  const page = await context.newPage(); debugPage = page;
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
  // Phase 4: build and publish a responsive page through the actual editor.
  await page.getByLabel("Item type").selectOption("page");
  await page.getByRole("button", { name: "New page", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Visual skills page");
  await page.getByLabel("URL slug").fill("visual-skills");
  const builderApp = items.find((item) => item.slug === "browser-created");
  await page.getByLabel("Application", { exact: true }).selectOption(builderApp.id);
  const builder = page.getByRole("region", { name: "Page builder", exact: true });
  await builder.getByRole("button", { name: "Add Text", exact: true }).dragTo(builder.getByTestId("builder-canvas"), { targetPosition: { x: 60, y: 60 } });
  await builder.getByLabel("Element label", { exact: true }).fill("Bound skill");
  await builder.getByLabel("Value binding", { exact: true }).pressSequentially("result.0.skill");
  await builder.getByLabel("desktop", { exact: true }).selectOption("6");
  await builder.getByLabel("tablet", { exact: true }).selectOption("6");
  await builder.getByLabel("Padding (px)", { exact: true }).fill("12");
  await builder.getByRole("button", { name: "Duplicate element", exact: true }).click();
  await builder.getByLabel("Element label", { exact: true }).fill("Inactive copy");
  await builder.getByLabel("Element active", { exact: true }).uncheck();
  await builder.getByRole("button", { name: "Delete element", exact: true }).click();
  await builder.getByRole("button", { name: "Undo", exact: true }).click();
  await builder.getByRole("button", { name: "Redo", exact: true }).click();
  await builder.getByRole("button", { name: "Undo", exact: true }).click(); // Retain inactive element to test runtime filtering.
  await builder.getByRole("button", { name: "Add HTML / CSS / JavaScript", exact: true }).click();
  await builder.getByLabel("Element label", { exact: true }).fill("Interactive code");
  await builder.getByLabel("desktop", { exact: true }).selectOption("6");
  await builder.getByRole("button", { name: "JavaScript", exact: true }).click();
  await builder.getByLabel("JavaScript source", { exact: true }).fill("");
  await builder.getByRole("button", { name: "HTML", exact: true }).click();
  await builder.getByLabel("HTML source", { exact: true }).fill('<button id="counter">Count 0</button><p id="context"></p>');
  await builder.getByRole("button", { name: "CSS", exact: true }).click();
  await builder.getByLabel("CSS source", { exact: true }).fill('body { font-family: sans-serif; padding: 12px; } button { background: rgb(12, 34, 56); color: white; padding: 12px; }');
  await builder.getByRole("button", { name: "JavaScript", exact: true }).click();
  await builder.getByLabel("JavaScript source", { exact: true }).fill('let n = 0; document.querySelector("#counter").onclick = e => e.target.textContent = "Count " + ++n; PTX.onContext(({ result }) => document.querySelector("#context").textContent = result?.[0]?.skill || "No result");');
  const codeFrame = builder.frameLocator('iframe[title="Interactive code"]');
  await codeFrame.getByRole("button", { name: "Count 0", exact: true }).click();
  await codeFrame.getByRole("button", { name: "Count 1", exact: true }).waitFor();
  await codeFrame.getByText("Analysis", { exact: true }).waitFor();
  assert.equal(await codeFrame.locator("#counter").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(12, 34, 56)");
  const isolated = await codeFrame.locator("body").evaluate(() => { try { return parent.document.body != null; } catch { return false; } });
  assert.equal(isolated, false, "Custom code must not access the admin DOM");
  await builder.getByRole("button", { name: "Add Workflow button", exact: true }).click();
  await builder.getByLabel("Element label", { exact: true }).fill("Run builder workflow");
  await builder.getByLabel("Workflow ID", { exact: true }).fill("extract");
  await builder.getByRole("button", { name: "Move up", exact: true }).click();
  await builder.getByRole("button", { name: "Page JSON", exact: true }).click();
  const built = JSON.parse(await builder.getByLabel("Definition (JSON)").inputValue());
  assert.equal(built.elements.find((element) => element.label === "Bound skill").binding, "result.0.skill");
  assert.equal(built.elements.find((element) => element.label === "Interactive code").responsive.desktop, 6);
  await builder.getByLabel("Definition (JSON)").fill("{broken");
  await builder.getByRole("alert").filter({ hasText: "Correct Page JSON" }).waitFor();
  await builder.getByRole("button", { name: "Undo", exact: true }).click();
  await builder.getByRole("button", { name: "Preview page", exact: true }).click();
  await builder.getByLabel("Viewport", { exact: true }).selectOption("375");
  assert.equal(await builder.getByRole("button", { name: "Run builder workflow", exact: true }).isDisabled(), true);
  const previewWidth = await builder.getByTestId("builder-canvas").evaluate((element) => element.getBoundingClientRect().width);
  assert.equal(previewWidth, 375);
  assert.equal(await builder.getByTestId("builder-canvas").getByText("Inactive copy", { exact: true }).count(), 0);
  mkdirSync("/tmp/ptx-studio-validation/screenshots", { recursive: true });
  await builder.frameLocator('iframe[title="Interactive code"]').getByRole("button", { name: "Count 0", exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/ptx-studio-validation/screenshots/builder-preview.png", fullPage: true });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const pagePublication = page.waitForResponse((response) => response.url().endsWith("/studio-api") && response.request().postDataJSON()?.action === "publish");
  await page.getByRole("button", { name: "Publish saved draft", exact: true }).click();
  await pagePublication;
  const builtPage = items.find((item) => item.slug === "visual-skills");
  assert.ok(builtPage?.active);
  publish(builderApp); // Container promotion is already exercised by the admin test above.
  await page.goto(`${base}/o/test-org/apps/browser-created/visual-skills`);
  await page.getByRole("button", { name: "Run builder workflow", exact: true }).click();
  await page.getByRole("cell", { name: "Analysis", exact: true }).waitFor();
  const boundId = builtPage.draft.elements.find((element) => element.label === "Bound skill").id;
  const inactiveId = builtPage.draft.elements.find((element) => element.label === "Inactive copy").id;
  await page.locator(`[data-element-id="${boundId}"]`).getByText("Analysis", { exact: true }).waitFor();
  assert.equal(await page.locator(`[data-element-id="${inactiveId}"]`).count(), 0);
  const runtimeCode = page.frameLocator('iframe[title="Interactive code"]');
  await runtimeCode.getByText("Analysis", { exact: true }).waitFor();
  await runtimeCode.getByRole("button", { name: "Count 0", exact: true }).click();
  await runtimeCode.getByRole("button", { name: "Count 1", exact: true }).waitFor();
  for (const [viewport, expectedSpan] of [[1440, 6], [900, 6], [390, 12]]) {
    await page.setViewportSize({ width: viewport, height: 1000 });
    assert.equal(await page.locator(`[data-element-id="${boundId}"]`).evaluate((element) => getComputedStyle(element).gridColumnStart), `span ${expectedSpan}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Builder runtime overflows at ${viewport}px`);
  }
  await page.screenshot({ path: "/tmp/ptx-studio-validation/screenshots/builder-runtime-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log("PASS: visual drag/drop, properties, bindings, undo/redo, code editing/execution/isolation, publication and three responsive runtime sizes");
  await page.goto(`${base}/admin?section=applications`);
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
} catch (error) {
  mkdirSync("/tmp/ptx-studio-validation/screenshots", { recursive: true });
  if (debugPage) { await debugPage.screenshot({ path: "/tmp/ptx-studio-validation/screenshots/failure.png", fullPage: true }); console.log((await debugPage.locator('body').innerText()).slice(-5000)); }
  throw error;
} finally { await browser.close(); }
