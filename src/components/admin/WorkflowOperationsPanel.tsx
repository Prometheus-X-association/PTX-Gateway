import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { workflowBackend, type BackendWorkflowRun, type BackendWorkflowStep } from "@/lib/workflowBackend";
import type { WorkflowConfig } from "@/types/workflow";

interface Webhook { id: string; name: string; enabled: boolean; input_mapping: Record<string, string> }
interface Key { id: string; name: string; enabled: boolean; workflow_ids: string[]; expires_at?: string }

export function WorkflowOperationsPanel({ config, organizationId, onChange, onFocusNode }: { config: WorkflowConfig; organizationId?: string; onChange: (config: WorkflowConfig) => void; onFocusNode?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<BackendWorkflowRun[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [keys, setKeys] = useState<Key[]>([]);
  const [selected, setSelected] = useState<BackendWorkflowRun | null>(null);
  const [steps, setSteps] = useState<BackendWorkflowStep[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState("");
  const [name, setName] = useState("");
  const [mapping, setMapping] = useState("{}");
  const [payload, setPayload] = useState("{}");
  const [answer, setAnswer] = useState("");
  const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
  const execution = config.execution ?? {};
  const setExecution = (patch: NonNullable<WorkflowConfig["execution"]>) => onChange({ ...config, execution: { ...execution, ...patch } });
  const api = useCallback((action: string, body: Record<string, unknown> = {}) => workflowBackend(action, organizationId, { workflowId: config.id, ...body }), [organizationId, config.id]);
  const refresh = useCallback(async () => {
    const [history, endpoints, credentials] = await Promise.all([api("list"), api("webhooks"), api("keys")]);
    setRuns(history.runs); setWebhooks(endpoints.webhooks); setKeys(credentials.keys.filter((key: Key) => key.workflow_ids.includes(config.id)));
  }, [api, config.id]);
  const loadRun = useCallback(async (id: string) => {
    const detail = await api("get", { runId: id });
    const collected: BackendWorkflowStep[] = [];
    let after = 0;
    do {
      const trace = await api("steps", { runId: id, after });
      collected.push(...trace.steps);
      if (trace.steps.length < 200) break;
      after = trace.steps.at(-1).sequence;
    } while (collected.length < 10_000);
    setSelected(detail.run); setSteps(collected);
  }, [api]);
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await operation(); await refresh(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!open || !organizationId) return;
    let disposed = false; let inFlight = false;
    const update = async () => {
      if (inFlight) return;
      inFlight = true;
      try { await refresh(); if (selected?.id) await loadRun(selected.id); }
      catch (error) { if (!disposed) setError(error instanceof Error ? error.message : String(error)); }
      finally { inFlight = false; }
    };
    void update();
    const timer = window.setInterval(update, 5000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [open, organizationId, refresh, loadRun, selected?.id]);

  return <div className="rounded-lg border p-3 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Label>Backend execution, API and webhooks</Label>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(!open)}>{open ? "Hide execution management" : "Manage integrations and runs"}</Button>
    </div>
    <div className="flex flex-wrap gap-5 text-xs">
      {([['backendEnabled', 'Run chat workflows on backend'], ['apiEnabled', 'Allow API execution'], ['webhookEnabled', 'Allow webhook execution']] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2"><Switch checked={Boolean(execution[key])} onCheckedChange={(checked) => setExecution({ [key]: checked })} />{label}</label>)}
    </div>
    <div className="flex flex-wrap gap-4">
      <label className="text-xs space-y-1">Concurrent runs for this workflow<Input type="number" min={1} max={32} value={execution.maxConcurrentRuns ?? 4} className="w-32 h-8" onChange={(event) => setExecution({ maxConcurrentRuns: Math.max(1, Math.min(32, Number(event.target.value) || 1)) })} /></label>
      <label className="text-xs space-y-1">Run deadline (seconds)<Input type="number" min={10} max={3600} value={execution.timeoutSeconds ?? 900} className="w-32 h-8" onChange={(event) => setExecution({ timeoutSeconds: Math.max(10, Math.min(3600, Number(event.target.value) || 10)) })} /></label>
    </div>
    <p className="text-xs text-muted-foreground">Save the organization settings before using changed execution options or graphs. Each request runs independently.</p>
    {open && <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {revealed && <div className="rounded border p-2 space-y-2"><p className="text-xs">Copy this credential now. It is displayed only after creation or rotation.</p><Textarea readOnly value={revealed} /><Button type="button" size="sm" variant="outline" onClick={() => setRevealed("")}>Dismiss credential</Button></div>}
      <div className="space-y-2">
        <p className="text-sm font-medium">Integration access</p>
        <code className="block break-all text-xs">POST {base}/workflow-runs</code>
        <p className="text-xs text-muted-foreground">Use Authorization: Bearer &lt;API key&gt; with a JSON body containing action: "start", workflowId: "{config.id}", input and userMessage.</p>
        <Input placeholder="Webhook or API key name" value={name} onChange={(event) => setName(event.target.value)} />
        <Label className="text-xs">Webhook input mapping (JSON paths; empty maps the entire payload to input)</Label>
        <Textarea value={mapping} onChange={(event) => setMapping(event.target.value)} placeholder={'{"input":"order","userMessage":"message"}'} />
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={busy || !organizationId} onClick={() => void perform(async () => { const result = await api("create_webhook", { name, inputMapping: JSON.parse(mapping) }); setRevealed(`Endpoint: ${base}/workflow-webhook/${result.id}\nSigning secret: ${result.secret}`); })}>Add webhook</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy || !organizationId} onClick={() => void perform(async () => { const result = await api("create_key", { name, workflowIds: [config.id] }); setRevealed(result.key); })}>Create API key</Button>
        </div>
        <p className="text-xs text-muted-foreground">Webhook headers: x-workflow-timestamp (Unix seconds), x-workflow-delivery-id, x-workflow-signature (hex HMAC-SHA256 over timestamp.deliveryId.rawBody).</p>
        {webhooks.map((hook) => <div key={hook.id} className="rounded border p-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm">{hook.name}</span><Badge variant="outline">{hook.enabled ? "Enabled" : "Disabled"}</Badge>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void perform(async () => { await api("update_webhook", { webhookId: hook.id, enabled: !hook.enabled }); })}>{hook.enabled ? "Disable" : "Enable"}</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void perform(async () => { const result = await api("rotate_webhook", { webhookId: hook.id }); setRevealed(`Endpoint: ${base}/workflow-webhook/${hook.id}\nSigning secret: ${result.secret}`); })}>Rotate secret</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void perform(async () => { await api("delete_webhook", { webhookId: hook.id }); })}>Delete</Button>
          </div>
          <code className="block break-all text-xs">{base}/workflow-webhook/{hook.id}</code>
          <Textarea defaultValue={JSON.stringify(hook.input_mapping, null, 2)} aria-label={`Input mapping for ${hook.name}`} onBlur={(event) => {
            const value = event.target.value;
            if (value !== JSON.stringify(hook.input_mapping, null, 2)) void perform(async () => { await api("update_webhook", { webhookId: hook.id, enabled: hook.enabled, inputMapping: JSON.parse(value) }); });
          }} />
        </div>)}
        {keys.map((key) => <div key={key.id} className="flex items-center gap-2 text-xs"><span>{key.name}</span><Badge variant="outline">{key.enabled ? "Active" : "Revoked"}</Badge>{key.enabled && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void perform(async () => { await api("revoke_key", { keyId: key.id }); })}>Revoke</Button>}</div>)}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Start a backend run</p><Label className="text-xs">Input JSON</Label>
        <Textarea value={payload} onChange={(event) => setPayload(event.target.value)} />
        <Button type="button" size="sm" disabled={busy || !execution.backendEnabled} onClick={() => void perform(async () => { const result = await api("start", { source: "dashboard", input: JSON.parse(payload) }); await loadRun(result.runId); })}>Run saved workflow</Button>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between"><p className="text-sm font-medium">Execution history</p><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void perform(refresh)}>Refresh</Button></div>
        {!runs.length && <p className="text-xs text-muted-foreground">No backend executions yet.</p>}
        <div className="max-h-64 overflow-auto space-y-1">{runs.map((run) => <button type="button" key={run.id} className={`w-full rounded border p-2 text-left text-xs ${selected?.id === run.id ? "bg-muted" : ""}`} onClick={() => void perform(() => loadRun(run.id))}>
          <span className="font-medium">{run.status}</span> · {run.triggerSource} · {new Date(run.createdAt).toLocaleString()}<span className="block break-all text-muted-foreground">{run.id}</span>
          {run.stopReason && <span className="block">{run.failedNodeId || run.currentNodeId || run.lastNodeId}: {run.stopReason}</span>}
        </button>)}</div>
        {selected && <div className="rounded border p-3 space-y-2">
          <p className="text-sm font-medium">Run {selected.id}</p><p className="text-xs">{selected.status} · {selected.stopReason || selected.currentNodeId || "Queued"}</p>
          <p className="text-xs text-muted-foreground">Trigger: {selected.triggerSource}{selected.webhookId ? ` · Webhook: ${selected.webhookId}` : ''}{selected.deliveryId ? ` · Delivery: ${selected.deliveryId}` : ''}</p>
          {(selected.failedNodeId || selected.currentNodeId || selected.lastNodeId) && <Button type="button" size="sm" variant="outline" onClick={() => onFocusNode?.(selected.failedNodeId || selected.currentNodeId || selected.lastNodeId)}>Show stop node on canvas</Button>}
          {['queued', 'running', 'waiting_for_input'].includes(selected.status) && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void perform(async () => { await api("cancel", { runId: selected.id }); await loadRun(selected.id); })}>Cancel run</Button>}
          {selected.waiting && <div className="space-y-2"><p className="text-sm whitespace-pre-wrap">{selected.waiting.question}</p>{selected.waiting.options?.length > 0 && <p className="text-xs">Options: {selected.waiting.options.join(", ")}</p>}<Input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Answer" /><Button type="button" size="sm" disabled={busy || !answer.trim()} onClick={() => void perform(async () => { await api("resume", { runId: selected.id, nodeId: selected.waiting.nodeId, answer }); setAnswer(""); await loadRun(selected.id); })}>Resume</Button></div>}
          {steps.map((step) => <details key={step.id} className="rounded border p-2 text-xs"><summary>{step.sequence}. {step.node_name} · {step.status} {step.duration_ms != null ? `· ${step.duration_ms} ms` : ""}</summary><Button type="button" size="sm" variant="outline" onClick={() => onFocusNode?.(step.node_id)}>Show node on canvas</Button>{step.error && <p className="text-destructive whitespace-pre-wrap">{step.error}</p>}<pre className="max-h-60 overflow-auto whitespace-pre-wrap">{JSON.stringify({ input: step.input_summary, output: step.output_summary, next: step.selected_routes }, null, 2)}</pre></details>)}
          {selected.status === "succeeded" && <details className="text-xs"><summary>Final output</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap">{JSON.stringify(selected.output, null, 2)}</pre></details>}
        </div>}
      </div>
    </div>}
  </div>;
}
