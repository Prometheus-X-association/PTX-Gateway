import type { CSSProperties } from "react";
import type { StudioElement } from '../../supabase/functions/_shared/studioSchema';

export const elementTypes: StudioElement['type'][] = ['heading', 'text', 'json-input', 'workflow-button', 'result', 'html', 'chat', 'knowledge'];
export const elementNames: Record<StudioElement['type'], string> = { heading: 'Heading', text: 'Text', 'json-input': 'JSON input', 'workflow-button': 'Workflow button', result: 'Result', html: 'HTML / CSS / JavaScript', chat: 'Chat drawer', knowledge: 'Skill workspace' };
export const defaultAppearance = { padding: 0, radius: 0, color: '', background: '', align: 'left' as const, minHeight: 0 };
export const defaultResponsive = { mobile: 12, tablet: 12, desktop: 12 };
export function newStudioElement(type: StudioElement['type']): StudioElement {
  return { id: `element-${crypto.randomUUID()}`, type, label: elementNames[type], enabled: true,
    content: type === 'heading' ? 'New heading' : type === 'text' ? 'Write your content here.' : type === 'json-input' ? '{}' : type === 'html' ? '<button id="counter">Clicked 0 times</button>' : '',
    ...(type === 'html' ? { css: 'body { font-family: system-ui; padding: 16px; }\nbutton { padding: 12px; border-radius: 8px; }', javascript: "let count = 0;\ndocument.querySelector('#counter').onclick = event => { event.target.textContent = `Clicked ${++count} times`; };" } : {}),
    ...(type === 'workflow-button' ? { workflowId: '' } : {}), ...(type === 'chat' ? { chatId: '' } : {}), ...(type === 'knowledge' ? { knowledgeId: '', knowledgeView: 'document' as const } : {}),
    responsive: { ...defaultResponsive }, appearance: { ...defaultAppearance } };
}
/** Safe lookup, never evaluates JavaScript expressions or traverses prototypes. */
export function resolveStudioBinding(binding: string | undefined, context: { input: unknown; result: unknown }): unknown {
  if (!binding || !/^(input|result)(\.[a-zA-Z0-9_-]+)*$/.test(binding)) return undefined;
  let current: unknown = context;
  for (const part of binding.split('.')) {
    if (['__proto__', 'prototype', 'constructor'].includes(part) || current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
export function reorderStudioElements(elements: StudioElement[], id: string, target: number): StudioElement[] {
  const index = elements.findIndex((entry) => entry.id === id);
  if (index < 0) return elements;
  const next = elements.slice(); const [entry] = next.splice(index, 1);
  next.splice(Math.max(0, Math.min(next.length, target)), 0, entry);
  return next;
}
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
/** Opaque-origin code receives only explicit preview/runtime values, never application credentials. */
export function studioCodeDocument(element: Pick<StudioElement, "content" | "css" | "javascript">, channel: string): string {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;overflow-wrap:anywhere}*{box-sizing:border-box}${(element.css || '').replace(/</g, '\\3c ')}</style></head><body>${element.content || ''}<script>
  (() => {
    window.addEventListener('error', event => { const error = document.createElement('pre'); error.setAttribute('role', 'alert'); error.style.color = '#b91c1c'; error.textContent = 'Component error: ' + event.message; document.body.append(error); });
    const listeners = new Set();
    window.PTX = { context: {input:null,result:null}, onContext(callback) { listeners.add(callback); callback(window.PTX.context); return () => listeners.delete(callback); } };
    window.addEventListener('message', event => {
      if (event.source !== parent || event.data?.channel !== ${safeJson(channel)} || event.data?.type !== 'studio:context') return;
      window.PTX.context = event.data.context;
      for (const listener of listeners) listener(window.PTX.context);
    });
    const script = document.createElement('script'); script.textContent = ${safeJson(element.javascript || '')}; document.body.append(script);
  })();
  </script></body></html>`;
}

export function studioElementStyle(element: StudioElement): CSSProperties {
  const size = { ...defaultResponsive, ...element.responsive };
  const look = { ...defaultAppearance, ...element.appearance };
  return { '--studio-mobile': size.mobile, '--studio-tablet': size.tablet, '--studio-desktop': size.desktop, padding: look.padding, borderRadius: look.radius, minHeight: look.minHeight || undefined, color: look.color || undefined, background: look.background || undefined, textAlign: look.align } as CSSProperties;
}
