import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { StudioElement } from '@/services/studioApi';
import { resolveStudioBinding, studioCodeDocument } from '@/lib/studioBuilder';
import { outputTable } from '@/lib/applicationPrototype';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import './StudioElements.css';

export function StudioCode({ element, input, result }: { element: StudioElement; input: unknown; result: unknown }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const { content, css, javascript } = element;
  const document = useMemo(() => studioCodeDocument({ content, css, javascript }, channel), [content, css, javascript, channel]);
  const send = () => frame.current?.contentWindow?.postMessage({ type: 'studio:context', channel, context: { input, result } }, '*'); // Opaque sandbox origin; exact destination window, no credentials.
  useEffect(() => { frame.current?.contentWindow?.postMessage({ type: 'studio:context', channel, context: { input, result } }, '*'); }, [input, result, channel]);
  return <iframe ref={frame} title={element.label || 'Custom component'} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={document} onLoad={send} className="w-full rounded border bg-white" style={{ height: element.appearance?.minHeight || 320 }} />;
}
export function StudioElementContent({ element, input, result, payload, onPayloadChange, onAction, busy, chat, scope = 'preview' }: {
  element: StudioElement; input: unknown; result: unknown; payload: string; onPayloadChange?: (value: string) => void;
  onAction?: (id: string) => void; busy?: boolean; chat?: ReactNode; scope?: string;
}) {
  const bound = resolveStudioBinding(element.binding, { input, result });
  const content = element.binding ? bound == null ? '' : typeof bound === 'string' ? bound : JSON.stringify(bound) : element.content || element.label;
  if (element.type === 'heading') return <h2 className="text-2xl font-semibold">{content}</h2>;
  if (element.type === 'text') return <p className="whitespace-pre-wrap">{content}</p>;
  if (element.type === 'json-input') return <div><Label htmlFor={`${scope}-${element.id}`}>{element.label}</Label><Textarea id={`${scope}-${element.id}`} className="min-h-36 font-mono" value={payload} onChange={(event) => onPayloadChange?.(event.target.value)} readOnly={!onPayloadChange} /></div>;
  if (element.type === 'workflow-button') return <Button disabled={busy || !onAction} onClick={() => onAction?.(element.id)}>{element.label}</Button>;
  if (element.type === 'html') return <StudioCode element={element} input={input} result={result} />;
  if (element.type === 'chat') return chat || <div className="rounded border border-dashed p-6 text-sm">Chat drawer: {element.chatId || 'Choose a published drawer in properties'}</div>;
  return <StudioResult value={element.binding ? bound : result} title={element.label} />;
}
export function StudioResult({ value, title }: { value: unknown; title: string }) {
  const table = outputTable(value);
  return <section className="space-y-2"><h3 className="font-medium">{title}</h3>{value == null ? <p className="text-sm text-muted-foreground">No result yet.</p> : <>{table && <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{table.columns.map((column) => <th className="border-b p-2" key={column}>{column}</th>)}</tr></thead><tbody>{table.rows.map((row, index) => <tr key={index}>{table.columns.map((column) => <td className="border-b p-2" key={column}>{typeof row[column] === 'string' ? row[column] as string : JSON.stringify(row[column])}</td>)}</tr>)}</tbody></table><p className="text-xs text-muted-foreground">Showing up to 100 rows and 20 columns.</p></div>}<details open={!table}><summary className="cursor-pointer text-sm">Complete JSON output</summary><pre className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(value, null, 2)}</pre></details></>}</section>;
}
