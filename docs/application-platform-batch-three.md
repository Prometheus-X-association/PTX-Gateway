# Application platform — batch three: responsive visual and code builder

Phase 4 extends **Organization Studio → Applications & Pages → Pages** with a visual editor and HTML/CSS/JavaScript component editor. It follows the component-palette, canvas, properties and binding interaction model of [Appsmith](https://github.com/appsmithorg/appsmith), using the native React/Supabase architecture chosen in batch one. Appsmith is not installed or forked.

## Building a page

1. Create or edit a page under an application.
2. Drag a component from the palette onto the canvas, or click its Add button. Available components are Heading, Text, JSON input, Workflow button, Result, HTML/CSS/JavaScript and Chat drawer.
3. Select its canvas header or element-list entry to edit its label, content, activation, data binding, spacing, colors, alignment and responsive width. Drag list handles to reposition elements, or use **Move up/Move down**. Duplicate and Delete support Undo/Redo.
4. Choose Mobile (375px), Tablet (768px) or Desktop (1280px) to inspect the layout. The preview viewport scrolls inside the editor when wider than the available editing space.
5. Use **Preview page** to interact with input and code using sample data. Workflow execution and live chat are disabled in preview. **Preview sample result** supplies local JSON to bound elements and custom components.
6. Use **Page JSON** for direct schema editing. Invalid JSON produces a visible error; Undo can restore it. Incomplete workflow/chat elements can be configured before saving, but active elements must have valid targets when saved.
7. Save the draft, publish the page, then republish its application or canvas to promote the new page release. Existing publication, rollback and authorization behavior is retained.

The editor has up to 50 undo/redo entries for builder changes, including its Page JSON edits. History is local to the open editor and is not a substitute for saving drafts. Publication history remains the durable rollback mechanism.

## Responsive layout and appearance

Each element has a width of 1–12 columns for mobile, tablet and desktop. The shared editor/runtime CSS uses **container width**, so a page also adapts when displayed inside an organization canvas:

- Below 640px: mobile width.
- 640px through 1023px: tablet width.
- At least 1024px: desktop width.

Elements flow in their saved order with a 16px gap. Older elements default to 12 columns at all sizes. This is a responsive flow grid, not absolute pixel positioning or a nested-container editor.

Appearance supports padding (0–64px), corner radius (0–48px), minimum height (0–1600px), text/background colors and left/center/right alignment. Code defaults to a 320px iframe and chat to 640px; setting minimum height also sizes those embedded components. Inactive elements are visible with reduced opacity while editing, omitted from preview/runtime, and cannot launch workflow actions through the API. Inactive JSON input is excluded from the initial workflow payload.

## Value and action bindings

Heading, Text and Result elements accept read-only dot paths rooted at `input` or `result`. Examples:

- `input.documentId`
- `result.skills`
- `result.0.skill`

Bindings preserve zero, false and null, do not evaluate JavaScript expressions, and cannot traverse inherited/prototype properties. Missing text values display blank; a missing Result binding shows the empty result state.

A Workflow button selects an existing workflow by ID, with organization workflow suggestions, and receives the page's shared JSON input. API execution must be enabled before publication. Chat components select an active published drawer managed in Chat Drawers. The existing server remains authoritative; component settings do not grant permissions.

## Code components

An HTML component exposes separate **HTML**, **CSS** and **JavaScript** source tabs with a live isolated preview. A full custom page can be built as a 12-column code component; standard workflow/result/chat components can sit alongside it.

HTML example:

```html
<h2>Extracted skills</h2>
<ul id="skills"></ul>
```

JavaScript example:

```js
PTX.onContext(({ result }) => {
  const list = document.querySelector('#skills');
  list.replaceChildren();
  for (const skill of Array.isArray(result) ? result : []) {
    const item = document.createElement('li');
    item.textContent = skill.skill;
    list.append(item);
  }
});
```

`PTX.context` exposes `{input, result}`. `PTX.onContext(callback)` immediately invokes the callback and subscribes it to updates; its return value unsubscribes. Use the JavaScript tab for this API. Code context changes do not reload the iframe, preserving its local interactive state. Editing its code does reload it. Script errors from the JavaScript tab are displayed inside the component.

Code runs in an opaque-origin iframe with scripts allowed, without same-origin, form, popup or top-navigation privileges. It receives only explicit page input/result values, never gateway credentials. Resource CSP blocks fetch and external scripts/styles, nested frames and forms. Context messages target the exact iframe window and the receiver checks the parent window and per-instance channel. There is no custom-code-to-host action bridge: use configured Workflow buttons for server operations.

Code is authored by trusted organization administrators. Browser sandboxing does not impose CPU/memory limits or guarantee containment of all self-navigation behavior; do not use it as a hostile-code execution service. The input/result supplied to custom code is application data visible to that component.

## Storage and deployment

The existing schema-version-1 JSON contract is extended with optional element fields:

```json
{
  "id": "skills",
  "type": "result",
  "label": "Skills",
  "enabled": true,
  "binding": "result.skills",
  "responsive": { "mobile": 12, "tablet": 6, "desktop": 4 },
  "appearance": {
    "padding": 16, "radius": 8, "minHeight": 0,
    "color": "", "background": "", "align": "left"
  }
}
```

HTML elements also support `css` and `javascript` alongside the existing `content`. The shared frontend/backend validator bounds dimensions, colors, paths and code size. Limits remain 100 elements, one shared JSON input, 100,000 characters per code field, and the Studio API's total request-size limit.

No new database migration is needed for batch three. Batch two's tables and migration remain prerequisites. Deploy the updated **studio-api** and its shared schema **before** deploying the frontend, so saves retain the new fields and inactive actions are enforced. Redeploy other functions importing the shared schema through the normal backend deployment process. Existing pages render full width until edited; existing releases remain immutable. This implementation does not deploy to a live environment.

Prompt-generated applications and managed knowledge-store administration remain later phases.

## Validation

- `npm run test:applications`: existing prototype/chat bridge tests plus builder schema compatibility, style limits, code serialization, safe bindings and immutable reordering.
- `npm run test:workflow`: existing agent/workflow and Studio API tests, extended with publication round-trip of builder fields, invalid layout rejection and backend refusal to launch inactive elements.
- `npm run test:studio:browser`: real Chromium drag/drop, property editing, typed bindings, duplicate/delete/undo/redo, invalid JSON recovery, HTML/CSS/JavaScript interaction and parent-DOM isolation, saving/publishing, workflow output, bound/custom-code result updates, inactive-element filtering, and runtime checks at 1440px, 900px and 390px. Existing inline/external chat tests run in the same suite.
- Production build, targeted ESLint, and Deno checking of `studio-api` and imported shared modules.
- Full frontend TypeScript comparison: 90 existing diagnostics, with no additional errors in the builder changes.

The browser suite uses deterministic backend fixtures, not live model providers. Separate API contract regressions test server behavior. Database schema and worker execution implementation are unchanged in this batch. Browser setup and optional temporary Playwright installation are described in [batch two](application-platform-batch-two.md). Screenshots are saved under `/tmp/ptx-studio-validation/screenshots/`.
