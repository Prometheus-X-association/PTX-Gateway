import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
function load(file) {
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; new Function('exports', 'module', compiled)(module.exports, module); return module.exports;
}
const { validateStudioDefinition } = load('../supabase/functions/_shared/studioSchema.ts');
const { resolveStudioBinding, reorderStudioElements, studioCodeDocument, studioElementStyle } = load('../src/lib/studioBuilder.ts');
const definition = (elements) => ({ schemaVersion: 1, title: 'Builder page', elements });

test('legacy page definitions render full-width without migration', () => {
  const element = validateStudioDefinition('page', definition([{ id: 'legacy', type: 'text', content: 'Old content' }])).elements[0];
  assert.equal(element.content, 'Old content');
  assert.equal(studioElementStyle(element)['--studio-mobile'], 12);
  assert.equal(studioElementStyle(element)['--studio-desktop'], 12);
});
test('responsive styles, activation, bindings and separated code survive validation', () => {
  const element = { id: 'code', type: 'html', label: 'Widget', content: '<p>Hello</p>', css: 'p{color:red}', javascript: 'console.log("hello")', enabled: false, responsive: { mobile: 12, tablet: 6, desktop: 4 }, appearance: { padding: 12, radius: 8, minHeight: 320, align: 'center', color: '#112233', background: '#ffffff80' }, binding: 'result.skills.0.name' };
  assert.deepEqual(validateStudioDefinition('page', definition([element])).elements[0], element);
  for (const patch of [{ responsive: { desktop: 13 } }, { responsive: { tablet: -1 } }, { appearance: { padding: 1.5 } }, { appearance: { background: 'url(https://evil.example)' } }, { appearance: { minHeight: 99999 } }, { binding: 'result.__proto__.secret' }, { binding: 'result.constructor' }, { binding: 'alert(1)' }, { enabled: 'false' }]) {
    assert.throws(() => validateStudioDefinition('page', definition([{ ...element, ...patch }])));
  }
  assert.throws(() => validateStudioDefinition('page', definition([{ ...element, javascript: 'x'.repeat(100001) }])));
});
test('disabled unconfigured actions can be drafted but active actions need a saved target', () => {
  assert.doesNotThrow(() => validateStudioDefinition('page', definition([{ id: 'action', type: 'workflow-button', enabled: false }])));
  assert.throws(() => validateStudioDefinition('page', definition([{ id: 'action', type: 'workflow-button', enabled: true }])));
  assert.doesNotThrow(() => validateStudioDefinition('page', definition([{ id: 'chat', type: 'chat', enabled: false }])));
});
test('bindings preserve falsy values, null, arrays and never evaluate or traverse inherited properties', () => {
  const context = { input: { count: 0, enabled: false }, result: { skills: [{ name: 'Analysis' }], nullable: null } };
  assert.equal(resolveStudioBinding('input.count', context), 0);
  assert.equal(resolveStudioBinding('input.enabled', context), false);
  assert.equal(resolveStudioBinding('result.nullable', context), null);
  assert.equal(resolveStudioBinding('result.skills.0.name', context), 'Analysis');
  for (const path of ['result.missing.name', 'result.toString', 'result.__proto__', 'result.constructor', 'input["count"]', 'process.env']) assert.equal(resolveStudioBinding(path, context), undefined);
});
test('reordering is immutable, preserves all IDs, and clamps insertion bounds', () => {
  const elements = ['a', 'b', 'c'].map((id) => ({ id, type: 'text', label: id }));
  assert.deepEqual(reorderStudioElements(elements, 'a', 2).map((entry) => entry.id), ['b', 'c', 'a']);
  assert.deepEqual(reorderStudioElements(elements, 'c', -1).map((entry) => entry.id), ['c', 'a', 'b']);
  assert.deepEqual(elements.map((entry) => entry.id), ['a', 'b', 'c']);
  assert.equal(reorderStudioElements(elements, 'missing', 0), elements);
});
test('code document retains sandbox CSP and does not let CSS or serialized JavaScript break out of their containers', () => {
  const doc = studioCodeDocument({ content: '<p>Widget</p>', css: '</style><img src="https://evil.example">', javascript: 'const s = "</script><script>evil()</script>";' }, 'channel-test');
  assert.ok(doc.includes("connect-src 'none'"));
  assert.ok(doc.includes("frame-src 'none'"));
  assert.ok(!doc.includes('</style><img'));
  assert.ok(!doc.includes('</script><script>evil()'));
  assert.ok(doc.includes('event.source !== parent'));
  assert.ok(doc.includes('channel-test'));
});
