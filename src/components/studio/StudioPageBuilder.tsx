import { studioElementStyle } from "@/lib/studioBuilder";
import { useState, type DragEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { StudioDefinition, StudioElement, StudioItem } from '@/services/studioApi';
import { validateStudioDefinition } from '../../../supabase/functions/_shared/studioSchema';
import { defaultAppearance, defaultResponsive, elementNames, elementTypes, newStudioElement, reorderStudioElements } from '@/lib/studioBuilder';
import { StudioElementContent } from './StudioElements';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const dragMime = 'application/x-ptx-studio';
function editableDefinition(source: string): StudioDefinition {
  const raw = JSON.parse(source);
  if (!raw || typeof raw !== 'object') throw new Error('A page definition object is required.');
  if (!Array.isArray(raw.elements)) throw new Error('A page requires an elements array.');
  if (raw.elements.some((element: StudioElement) => element?.binding !== undefined && typeof element.binding !== 'string')) throw new Error('Value bindings must be text.');
  // An inserted action can be configured before it is eligible for saving/publishing.
  const normalized = validateStudioDefinition('page', { ...raw, title: raw.title || 'Untitled page', elements: raw.elements.map((element: StudioElement) => ({ ...element, binding: undefined,
    ...(element.type === 'workflow-button' && !element.workflowId ? { workflowId: 'unconfigured' } : {}),
    ...(element.type === 'knowledge' ? { knowledgeId: '00000000-0000-0000-0000-000000000000' } : {}),
    ...(element.type === 'chat' && !element.chatId ? { chatId: '00000000-0000-0000-0000-000000000000' } : {}),
  })) });
  normalized.elements = normalized.elements.map((element, index) => ({ ...element, binding: raw.elements[index].binding,
    ...(element.type === 'workflow-button' ? { workflowId: raw.elements[index].workflowId || '' } : {}),
    ...(element.type === 'chat' ? { chatId: raw.elements[index].chatId || '' } : {}),
    ...(element.type === 'knowledge' ? { knowledgeId: raw.elements[index].knowledgeId || '' } : {}),
  }));
  normalized.title = raw.title;
  return normalized;
}
export default function StudioPageBuilder({ source, onChange, items, organizationId }: {
  source: string; onChange: (source: string) => void; items: StudioItem[]; organizationId?: string;
}) {
  const [mode, setMode] = useState<'visual' | 'preview' | 'json'>('visual');
  const [selectedId, setSelectedId] = useState('');
  const [width, setWidth] = useState(1280);
  const [past, setPast] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [sample, setSample] = useState('[{"skill":"Analysis","source":"Document 1"}]');
  const [previewPayload, setPreviewPayload] = useState<string | null>(null);
  const [codeTab, setCodeTab] = useState<'content' | 'css' | 'javascript'>('content');
  const workflows = useQuery({ queryKey: ['studio-builder-workflows', organizationId], enabled: Boolean(organizationId), queryFn: async () => {
    const { data, error } = await supabase.from('global_configs').select('features').eq('organization_id', organizationId!).maybeSingle();
    if (error) throw error;
    const features = data?.features as { llmInsights?: { workflows?: Array<{ id: string; name: string; enabled?: boolean; deletedAt?: string }> } } | undefined;
    return (features?.llmInsights?.workflows || []).filter((workflow) => workflow.enabled !== false && !workflow.deletedAt);
  } });
  let definition: StudioDefinition | null = null;
  let parseError = '';
  try { definition = editableDefinition(source); } catch (cause) { parseError = cause instanceof Error ? cause.message : String(cause); }
  const elements = definition?.elements || [];
  const selected = elements.find((element) => element.id === selectedId);
  const commit = (next: string) => {
    if (next === source) return;
    setPast((history) => [...history.slice(-49), source]); setFuture([]); onChange(next); setNotice('');
  };
  const changeElements = (next: StudioElement[]) => { if (definition) commit(JSON.stringify({ ...definition, elements: next }, null, 2)); };
  const update = (patch: Partial<StudioElement>) => changeElements(elements.map((element) => element.id === selectedId ? { ...element, ...patch } : element));
  const add = (type: StudioElement['type'], index = elements.length) => {
    if (elements.length >= 100) { setNotice('A page supports up to 100 elements.'); return; }
    if (type === 'json-input' && elements.some((element) => element.type === type)) { setNotice('This page already has its shared JSON input.'); return; }
    const element = newStudioElement(type); const next = [...elements]; next.splice(index, 0, element);
    changeElements(next); setSelectedId(element.id);
  };
  const drop = (event: DragEvent, target: number) => {
    event.preventDefault(); event.stopPropagation();
    try {
      const value = JSON.parse(event.dataTransfer.getData(dragMime));
      if (value.id) { changeElements(reorderStudioElements(elements, value.id, target)); setSelectedId(value.id); }
      else if (elementTypes.includes(value.type)) add(value.type, target);
    } catch { setNotice('Drop an element from this builder.'); }
  };
  const duplicate = () => {
    if (!selected || elements.length >= 100 || selected.type === 'json-input') return;
    const copy = { ...selected, id: `element-${crypto.randomUUID()}`, label: `${selected.label} copy`.slice(0, 160) };
    const next = [...elements]; next.splice(elements.indexOf(selected) + 1, 0, copy); changeElements(next); setSelectedId(copy.id);
  };
  let result: unknown = null; let sampleError = '';
  try { result = JSON.parse(sample); } catch { sampleError = 'Sample result must be valid JSON.'; }
  const payload = previewPayload ?? elements.find((element) => element.type === 'json-input' && element.enabled !== false)?.content ?? '{}';
  let input: unknown = null;
  try { input = JSON.parse(payload); } catch { /* the input editor displays its own raw value */ }
  const appearance = { ...defaultAppearance, ...selected?.appearance };
  const responsive = { ...defaultResponsive, ...selected?.responsive };
  return <section aria-label="Page builder" className="min-w-0 space-y-4 rounded-lg border bg-muted/20 p-3">
    <div className="flex flex-wrap items-center gap-2">
      {(['visual', 'preview', 'json'] as const).map((view) => <Button key={view} size="sm" variant={mode === view ? 'default' : 'outline'} aria-pressed={mode === view} onClick={() => setMode(view)}>{view === 'visual' ? 'Visual builder' : view === 'preview' ? 'Preview page' : 'Page JSON'}</Button>)}
      <Button size="sm" variant="outline" disabled={!past.length} onClick={() => { setFuture((history) => [source, ...history].slice(0, 50)); onChange(past[past.length - 1]); setPast(past.slice(0, -1)); }}>Undo</Button>
      <Button size="sm" variant="outline" disabled={!future.length} onClick={() => { setPast((history) => [...history, source].slice(-50)); onChange(future[0]); setFuture(future.slice(1)); }}>Redo</Button>
      <Label htmlFor="builder-viewport">Viewport</Label><select id="builder-viewport" className="rounded border bg-background p-2 text-sm" value={width} onChange={(event) => setWidth(Number(event.target.value))}><option value={375}>Mobile · 375px</option><option value={768}>Tablet · 768px</option><option value={1280}>Desktop · 1280px</option></select>
    </div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {parseError && <p role="alert" className="text-sm text-destructive">Correct Page JSON to continue: {parseError}</p>}
    {(mode === 'json' || parseError) && <div><Label htmlFor="studio-definition">Definition (JSON)</Label><Textarea id="studio-definition" className="min-h-96 font-mono text-xs" spellCheck={false} value={source} onChange={(event) => commit(event.target.value)} /></div>}
    {definition && mode !== 'json' && <>
      <div className={mode === 'visual' ? 'grid min-w-0 items-start gap-4 xl:grid-cols-[170px_minmax(0,1fr)_260px]' : 'min-w-0'}>
        {mode === 'visual' && <aside className="space-y-4" aria-label="Component palette">
          <h3 className="font-semibold">Components</h3><p className="text-xs text-muted-foreground">Drag onto the canvas or click to add.</p>
          <div className="flex flex-wrap gap-2 xl:flex-col">{elementTypes.map((type) => <Button key={type} variant="outline" size="sm" draggable onDragStart={(event) => event.dataTransfer.setData(dragMime, JSON.stringify({ type }))} disabled={elements.length >= 100 || type === 'json-input' && elements.some((element) => element.type === type)} onClick={() => add(type)}>Add {elementNames[type]}</Button>)}</div>
          <h3 className="font-semibold">Elements · {elements.length}</h3>
          <ol className="space-y-1">{elements.map((element, index) => <li key={element.id} className="flex items-center gap-1"><button type="button" draggable aria-label={`Move ${element.label || element.type}`} onDragStart={(event) => event.dataTransfer.setData(dragMime, JSON.stringify({ id: element.id }))} className="cursor-grab p-1">⠿</button><button type="button" className={`min-w-0 flex-1 truncate rounded p-1 text-left text-xs ${selectedId === element.id ? 'bg-primary text-primary-foreground' : ''}`} onClick={() => setSelectedId(element.id)}>{index + 1}. {element.label || element.type}{element.enabled === false ? ' (inactive)' : ''}</button></li>)}</ol>
        </aside>}
        <div className="min-w-0 space-y-2"><p className="text-xs text-muted-foreground">{width}px preview · workflow actions and chat are inactive here. Save and publish to use live operations.</p>
          <div className="max-w-full overflow-auto rounded border bg-muted p-3" aria-label="Responsive preview viewport">
            <div className="studio-surface bg-background p-4" data-testid="builder-canvas" style={{ width }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, elements.length)}>
              <div className="studio-elements min-h-40">
                {elements.filter((element) => mode === 'visual' || element.enabled !== false).map((element) => <div key={element.id} data-element-id={element.id} className={`studio-element relative ${mode === 'visual' ? `rounded outline outline-1 ${selectedId === element.id ? 'outline-primary' : 'outline-border'}` : ''} ${element.enabled === false ? 'opacity-50' : ''}`} style={studioElementStyle(element)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, elements.indexOf(element))}>
                  {mode === 'visual' && <button type="button" aria-label={`Select ${element.label || element.type}`} className="mb-2 block w-full cursor-pointer border-b bg-muted px-2 py-1 text-left text-xs" onClick={() => setSelectedId(element.id)}>{elementNames[element.type]} · {element.label}</button>}
                  <StudioElementContent element={element} input={input} result={result} payload={payload} onPayloadChange={mode === 'preview' ? setPreviewPayload : undefined} />
                </div>)}
                {!elements.length && <p className="col-span-12 p-8 text-center text-muted-foreground">Drop components here to build your page.</p>}
              </div>
            </div>
          </div>
        </div>
        {mode === 'visual' && <aside aria-label="Element properties" className="min-w-0 space-y-3">
          <h3 className="font-semibold">Element properties</h3>
          {!selected ? <p className="text-sm text-muted-foreground">Select an element from the canvas or list.</p> : <>
            <p className="break-all text-xs text-muted-foreground">{elementNames[selected.type]} · {selected.id}</p>
            <div><Label htmlFor="element-label">Element label</Label><Input id="element-label" value={selected.label} maxLength={160} onChange={(event) => update({ label: event.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.enabled !== false} onChange={(event) => update({ enabled: event.target.checked })} />Element active</label>
            {['heading', 'text', 'json-input'].includes(selected.type) && <div><Label htmlFor="element-content">Content / default value</Label><Textarea id="element-content" value={selected.content || ''} onChange={(event) => update({ content: event.target.value })} /></div>}
            {['heading', 'text', 'result'].includes(selected.type) && <div><Label htmlFor="element-binding">Value binding</Label><Input id="element-binding" placeholder="result.skills or input.title" value={selected.binding || ''} onChange={(event) => {
              // Keep partially typed paths editable; schema validation happens on save.
              const raw = JSON.parse(source); raw.elements = raw.elements.map((element: StudioElement) => element.id === selectedId ? { ...element, binding: event.target.value } : element); commit(JSON.stringify(raw, null, 2));
            }} /><p className="text-xs text-muted-foreground">Use result, input, or a dot path such as result.0.skill.</p></div>}
            {selected.type === 'workflow-button' && <div><Label htmlFor="element-workflow">Workflow ID</Label><Input id="element-workflow" list="builder-workflows" value={selected.workflowId || ''} onChange={(event) => update({ workflowId: event.target.value })} /><datalist id="builder-workflows">{workflows.data?.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</datalist><p className="text-xs text-muted-foreground">Receives the shared JSON input. Enable workflow API execution before publishing.</p>{workflows.error && <p role="alert" className="text-xs">Workflow suggestions unavailable. Enter a saved workflow ID.</p>}</div>}
            {selected.type === 'chat' && <div><Label htmlFor="element-chat">Chat drawer</Label><select id="element-chat" className="w-full rounded border bg-background p-2 text-sm" value={selected.chatId || ''} onChange={(event) => update({ chatId: event.target.value })}><option value="">Choose published chat</option>{items.filter((item) => item.kind === 'chat' && item.active && item.published_release_id).map((item) => <option key={item.id} value={item.id}>{item.draft.title}</option>)}{selected.chatId && !items.some((item) => item.id === selected.chatId && item.active && item.published_release_id) && <option value={selected.chatId}>Unavailable drawer ({selected.chatId})</option>}</select></div>}
            {selected.type === 'knowledge' && <div className="space-y-2"><Label htmlFor="element-knowledge">Knowledge store ID</Label><Input id="element-knowledge" value={selected.knowledgeId || ''} onChange={(event) => update({ knowledgeId: event.target.value })} /><Label htmlFor="knowledge-view">Skill view</Label><select id="knowledge-view" className="w-full rounded border bg-background p-2" value={selected.knowledgeView || 'document'} onChange={(event) => update({ knowledgeView: event.target.value as StudioElement['knowledgeView'] })}>{['document','skill','mapping','job'].map(view=><option key={view}>{view}</option>)}</select><p className="text-xs text-muted-foreground">Assign this page to the store in Knowledge & Skills before publishing. Choose the view for this page.</p></div>}
            <fieldset className="space-y-2"><legend className="text-sm font-medium">Responsive width (12 columns)</legend>{(['mobile', 'tablet', 'desktop'] as const).map((size) => <div key={size} className="flex items-center justify-between gap-2"><Label htmlFor={`span-${size}`}>{size}</Label><select id={`span-${size}`} className="rounded border bg-background p-1" value={responsive[size]} onChange={(event) => update({ responsive: { ...responsive, [size]: Number(event.target.value) } })}>{Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>{index + 1} / 12</option>)}</select></div>)}</fieldset>
            {(['padding', 'radius', 'minHeight'] as const).map((field) => <div key={field}><Label htmlFor={`style-${field}`}>{field === 'minHeight' ? 'Minimum height' : field === 'radius' ? 'Corner radius' : 'Padding'} (px)</Label><Input id={`style-${field}`} type="number" min={0} max={field === 'minHeight' ? 1600 : field === 'radius' ? 48 : 64} value={appearance[field]} onChange={(event) => update({ appearance: { ...appearance, [field]: Math.max(0, Math.min(field === 'minHeight' ? 1600 : field === 'radius' ? 48 : 64, Math.round(Number(event.target.value)))) } })} /></div>)}
            {(['color', 'background'] as const).map((field) => <div key={field} className="flex items-center gap-2"><Label htmlFor={`style-${field}`}>{field === 'color' ? 'Text color' : 'Background'}</Label><input id={`style-${field}`} type="color" value={appearance[field].slice(0, 7) || (field === 'color' ? '#111827' : '#ffffff')} onChange={(event) => update({ appearance: { ...appearance, [field]: event.target.value } })} /><Button size="sm" variant="ghost" aria-label={`Reset ${field}`} onClick={() => update({ appearance: { ...appearance, [field]: '' } })}>Reset</Button></div>)}
            <div><Label htmlFor="style-align">Alignment</Label><select id="style-align" className="ml-2 rounded border bg-background p-1" value={appearance.align} onChange={(event) => update({ appearance: { ...appearance, align: event.target.value as 'left' | 'center' | 'right' } })}>{['left', 'center', 'right'].map((value) => <option key={value}>{value}</option>)}</select></div>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={elements.indexOf(selected) === 0} onClick={() => changeElements(reorderStudioElements(elements, selected.id, elements.indexOf(selected) - 1))}>Move up</Button><Button size="sm" variant="outline" disabled={elements.indexOf(selected) === elements.length - 1} onClick={() => changeElements(reorderStudioElements(elements, selected.id, elements.indexOf(selected) + 1))}>Move down</Button><Button size="sm" variant="outline" disabled={selected.type === 'json-input' || elements.length >= 100} onClick={duplicate}>Duplicate element</Button><Button size="sm" variant="destructive" onClick={() => { changeElements(elements.filter((element) => element.id !== selected.id)); setSelectedId(''); }}>Delete element</Button></div>
          </>}
        </aside>}
      </div>
      {selected?.type === 'html' && mode === 'visual' && <section aria-label="Component code editor" className="space-y-2 rounded border bg-background p-3"><h3 className="font-semibold">{selected.label} · Code</h3><div className="flex gap-2">{(['content', 'css', 'javascript'] as const).map((tab) => <Button key={tab} size="sm" variant={codeTab === tab ? 'default' : 'outline'} aria-pressed={codeTab === tab} onClick={() => setCodeTab(tab)}>{tab === 'content' ? 'HTML' : tab === 'css' ? 'CSS' : 'JavaScript'}</Button>)}</div><Label htmlFor="component-code">{codeTab === 'content' ? 'HTML' : codeTab === 'css' ? 'CSS' : 'JavaScript'} source</Label><Textarea id="component-code" spellCheck={false} className="min-h-64 font-mono text-xs" value={selected[codeTab] || ''} maxLength={100000} onChange={(event) => update({ [codeTab]: event.target.value })} /><p className="text-xs text-muted-foreground">Runs in an isolated iframe. Use PTX.onContext(({`{ input, result }`}) =&gt; {'{ … }'}) for values. Network access and application credentials are unavailable. Use a workflow button for server operations.</p></section>}
      <details><summary className="cursor-pointer text-sm">Preview sample result</summary><Label htmlFor="builder-sample">Sample result JSON</Label><Textarea id="builder-sample" className="min-h-28 font-mono text-xs" value={sample} onChange={(event) => setSample(event.target.value)} />{sampleError && <p role="alert" className="text-sm text-destructive">{sampleError}</p>}</details>
    </>}
  </section>;
}
