import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { workflowBackend, type BackendWorkflowRun, type BackendWorkflowStep, type WorkflowBackendHealth, type WorkflowBackendState } from "@/lib/workflowBackend";
import type { WorkflowConfig, WorkflowStateField, WorkflowStateReducer, WorkflowStateValueType } from "@/types/workflow";

interface Webhook { id: string; name: string; enabled: boolean; input_mapping: Record<string, string> }
interface Key { id: string; name: string; enabled: boolean; workflow_ids: string[]; expires_at?: string }

export function WorkflowOperationsPanel({ config, organizationId, onChange, onFocusNode }: { config: WorkflowConfig; organizationId?: string; onChange: (config: WorkflowConfig) => void; onFocusNode?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<BackendWorkflowRun[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [keys, setKeys] = useState<Key[]>([]);
  const [selected, setSelected] = useState<BackendWorkflowRun | null>(null);
  const [notifications, setNotifications] = useState<Array<{ id: string; event_type: string; status: string; attempts: number; last_error?: string }>>([]);
  const [steps, setSteps] = useState<BackendWorkflowStep[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState("");
  const [name, setName] = useState("");
  const [mapping, setMapping] = useState("{}");
  const [payload, setPayload] = useState("{}");
  const [answer, setAnswer] = useState("");
  const [signalPayload, setSignalPayload] = useState("{}");
  const [health, setHealth] = useState<WorkflowBackendHealth | null>(null);
  const [runState, setRunState] = useState<WorkflowBackendState | null>(null);
  const [assumedOutput, setAssumedOutput] = useState("null");
  const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
  const execution = config.execution ?? {};
  const notificationSettings = execution.notifications ?? {};
  const setNotificationsConfig = (patch: NonNullable<NonNullable<WorkflowConfig["execution"]>["notifications"]>) => setExecution({ notifications: { ...notificationSettings, ...patch } });
  const setExecution = (patch: NonNullable<WorkflowConfig["execution"]>) => onChange({ ...config, execution: { ...execution, ...patch } });
  const stateDefinition = config.state ?? { fields: [], allowDynamicScratch: false };
  const setStateDefinition = (patch: Partial<typeof stateDefinition>) => onChange({ ...config, state: { ...stateDefinition, ...patch } });
  const patchStateField = (index: number, patch: Partial<WorkflowStateField>) => setStateDefinition({ fields: stateDefinition.fields.map((field, current) => current === index ? { ...field, ...patch } : field) });
  const api = useCallback((action: string, body: Record<string, unknown> = {}) => workflowBackend(action, organizationId, { workflowId: config.id, ...body }), [organizationId, config.id]);
  const refresh = useCallback(async () => {
    const [history, endpoints, credentials, healthResult] = await Promise.all([api("list"), api("webhooks"), api("keys"), api("health")]);
    setRuns(history.runs); setWebhooks(endpoints.webhooks); setKeys(credentials.keys.filter((key: Key) => key.workflow_ids.includes(config.id)));
    setHealth(healthResult.health);
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
    const [deliveries, stateResult] = await Promise.all([api("notifications", { runId: id }), api("state", { runId: id })]);
    setNotifications(deliveries.notifications);
    setRunState(stateResult as WorkflowBackendState);
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
    <p className="text-xs text-muted-foreground">API and webhook execution work independently of the result page and its chat switch. A workflow can have no result-page assignments. Choose Request data in its trigger to process the payload supplied by the caller.</p>
    <p className="text-xs text-muted-foreground">Every request has separate inputs, state, and execution logs. Runs start automatically as backend capacity becomes available; no parallel-run count or whole-run deadline needs to be configured.</p>
    <details className="rounded border p-3 space-y-2 text-xs">
      <summary className="cursor-pointer font-medium">Execution state schema</summary>
      <p className="text-muted-foreground">Declare typed values shared during one run. Dotted keys are supported; values are encrypted and never shared across runs.</p>
      <label className="flex items-center gap-2"><Switch checked={Boolean(stateDefinition.allowDynamicScratch)} onCheckedChange={(allowDynamicScratch) => setStateDefinition({ allowDynamicScratch })} />Allow dynamic <code>scratch.*</code> keys</label>
      <div className="space-y-2">{stateDefinition.fields.map((field, index) => <div key={`${field.key}-${index}`} className="grid gap-2 rounded border p-2 md:grid-cols-6">
        <Input className="md:col-span-2" value={field.key} placeholder="customer.profile" onChange={(event) => patchStateField(index, { key: event.target.value })} />
        <select className="rounded-md border bg-background px-2" value={field.type} onChange={(event) => patchStateField(index, { type: event.target.value as WorkflowStateValueType })}>{["string","number","boolean","object","array","any","artifact"].map((value) => <option key={value}>{value}</option>)}</select>
        <select className="rounded-md border bg-background px-2" value={field.reducer ?? "replace"} onChange={(event) => patchStateField(index, { reducer: event.target.value as WorkflowStateReducer })}>{["replace","merge","append","append_unique","sum","min","max","first"].map((value) => <option key={value}>{value}</option>)}</select>
        <label className="flex items-center gap-1"><Switch checked={Boolean(field.sensitive)} onCheckedChange={(sensitive) => patchStateField(index, { sensitive })} />Sensitive</label>
        <Button type="button" size="sm" variant="outline" onClick={() => setStateDefinition({ fields: stateDefinition.fields.filter((_, current) => current !== index) })}>Remove</Button>
        {field.reducer === "append_unique" && <Input className="md:col-span-2" value={field.identityPath ?? ""} placeholder="Unique identity path, e.g. id" onChange={(event) => patchStateField(index, { identityPath: event.target.value })} />}
        <label className="flex items-center gap-1"><Switch checked={Boolean(field.required)} onCheckedChange={(required) => patchStateField(index, { required })} />Required</label>
        <label className="md:col-span-2 flex items-center gap-1">Max bytes<Input type="number" min={1} max={5242880} value={field.maxBytes ?? 524288} onChange={(event) => patchStateField(index, { maxBytes: Math.max(1, Math.min(5242880, Number(event.target.value) || 1)) })} /></label>
        <Input className="md:col-span-3" value={(field.allowedReaders ?? []).join(", ")} placeholder="Allowed reader node IDs (empty = all)" onChange={(event) => patchStateField(index, { allowedReaders: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} />
        <Input className="md:col-span-3" value={(field.allowedWriters ?? []).join(", ")} placeholder="Allowed writer node IDs (empty = all)" onChange={(event) => patchStateField(index, { allowedWriters: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} />
        <label className="md:col-span-2 flex items-center gap-1"><Switch checked={field.allowInAgentPrompt ?? !field.sensitive} onCheckedChange={(allowInAgentPrompt) => patchStateField(index, { allowInAgentPrompt })} />Allow in agent prompts</label>
        <label className="md:col-span-2 flex items-center gap-1"><Switch checked={field.allowInApiRequest ?? !field.sensitive} onCheckedChange={(allowInApiRequest) => patchStateField(index, { allowInApiRequest })} />Allow in API requests</label>
      </div>)}</div>
      <Button type="button" size="sm" variant="outline" onClick={() => setStateDefinition({ fields: [...stateDefinition.fields, { key: `value_${stateDefinition.fields.length + 1}`, type: "any", reducer: "replace", maxBytes: 524288 }] })}>Add state field</Button>
    </details>
    <details className="rounded border p-3 space-y-2 text-xs">
      <summary className="cursor-pointer font-medium">Outbound hostname allowlist</summary>
      <p className="text-muted-foreground">Optional, one hostname per line. Use an entry such as <code>*.example.com</code> to allow subdomains. Applies to API nodes and notification callbacks.</p>
      <Textarea value={(execution.allowedOutboundHosts ?? []).join("\n")} placeholder={"api.example.com\n*.trusted.example"} onChange={(event) => setExecution({ allowedOutboundHosts: event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) })} />
    </details>
    <p className="text-xs text-muted-foreground">Save the organization settings before using changed execution options or graphs. Each request runs independently.</p>
    <details className="rounded border p-3 space-y-2 text-xs">
      <summary className="cursor-pointer font-medium">Question notifications and completion callbacks</summary>
      <p className="text-muted-foreground">Send signed question, reminder, and completion events to your platform. It can deliver the supplied response link through email or messaging. Leave the endpoint empty to disable notifications.</p>
      <label className="block space-y-1">Notification endpoint (HTTPS)<Input value={notificationSettings.url ?? ""} placeholder="https://your-platform.example/workflow-events" onChange={(event) => setNotificationsConfig({ url: event.target.value })} /></label>
      <label className="block space-y-1">Signing secret<Input type="password" autoComplete="new-password" value={notificationSettings.secret ?? ""} placeholder="At least 32 characters" onChange={(event) => setNotificationsConfig({ secret: event.target.value })} /></label>
      <Button type="button" size="sm" variant="outline" onClick={() => setNotificationsConfig({ secret: `${crypto.randomUUID()}${crypto.randomUUID()}` })}>Generate signing secret</Button>
      <label className="block space-y-1">Return URL (optional HTTPS)<Input value={notificationSettings.returnUrl ?? ""} placeholder="https://your-platform.example/requests" onChange={(event) => setNotificationsConfig({ returnUrl: event.target.value })} /></label>
      <label className="block space-y-1">Response link lifetime (hours)<Input type="number" min={1} max={720} value={notificationSettings.interactionTtlHours ?? 168} onChange={(event) => setNotificationsConfig({ interactionTtlHours: Math.max(1, Math.min(720, Math.floor(Number(event.target.value) || 1))) })} /></label>
      <label className="block space-y-1">Maximum delivery attempts per event<Input type="number" min={1} max={10} value={notificationSettings.maxAttempts ?? 6} onChange={(event) => setNotificationsConfig({ maxAttempts: Math.max(1, Math.min(10, Math.floor(Number(event.target.value) || 1))) })} /></label>
    </details>
    {open && <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {revealed && <div className="rounded border p-2 space-y-2"><p className="text-xs">Copy this credential now. It is displayed only after creation or rotation.</p><Textarea readOnly value={revealed} /><Button type="button" size="sm" variant="outline" onClick={() => setRevealed("")}>Dismiss credential</Button></div>}
      {health && <div className="grid grid-cols-2 gap-2 rounded border p-2 text-xs md:grid-cols-4"><span>Workers: {health.workers.length}</span><span>Queue: {health.queueDepth}</span><span>Running: {health.runningRuns}</span><span>Waiting: {health.waitingRuns}</span><span>Manual review: {health.manualReviewRuns}</span><span>Expired leases: {health.expiredLeases}</span><span>Notifications: {health.notificationBacklog}</span>{health.oldestQueuedAt && <span>Oldest: {new Date(health.oldestQueuedAt).toLocaleString()}</span>}</div>}
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
          {['queued', 'running', 'waiting_for_input', 'waiting_for_event'].includes(selected.status) && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void perform(async () => { await api("cancel", { runId: selected.id }); await loadRun(selected.id); })}>Cancel run</Button>}
          {selected.interactionUrl && <Button asChild type="button" size="sm" variant="outline"><a href={selected.interactionUrl} target="_blank" rel="noreferrer">Open response page</a></Button>}
          {selected.waitingExpiresAt && selected.status === 'waiting_for_input' && <p className="text-xs">Response deadline: {new Date(selected.waitingExpiresAt).toLocaleString()} · Reminders scheduled: {selected.reminderCount ?? 0} / {selected.reminderLimit ?? 0}</p>}
          {selected.status === "waiting_for_input" && selected.waiting && <div className="space-y-2"><p className="text-sm whitespace-pre-wrap">{selected.waiting.question}</p>{selected.waiting.options?.length > 0 && <p className="text-xs">Options: {selected.waiting.options.join(", ")}</p>}<Input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Answer" /><Button type="button" size="sm" disabled={busy || !answer.trim()} onClick={() => void perform(async () => { await api("resume", { runId: selected.id, nodeId: selected.waiting.nodeId, waitingVersion: selected.waitingVersion, answer }); setAnswer(""); await loadRun(selected.id); })}>Resume</Button></div>}
          {selected.status === "waiting_for_event" && selected.eventWait && <div className="space-y-2 rounded border border-blue-500/30 bg-blue-500/5 p-2"><p className="text-xs">Waiting for signal <code>{selected.eventWait.signalName}</code>.</p><Textarea className="font-mono text-xs" value={signalPayload} onChange={(event) => setSignalPayload(event.target.value)} placeholder="Signal payload JSON" /><Button type="button" size="sm" disabled={busy} onClick={() => void perform(async () => { await api("signal", { runId: selected.id, signalName: selected.eventWait!.signalName, payload: JSON.parse(signalPayload) }); await loadRun(selected.id); })}>Send signal</Button></div>}
          {selected.status === "manual_review" && <div className="space-y-2 rounded border border-amber-500/40 bg-amber-500/5 p-2"><p className="text-xs">The worker stopped during an action whose external outcome is unknown. Inspect the target system before choosing.</p><Textarea className="font-mono text-xs" value={assumedOutput} onChange={(event) => setAssumedOutput(event.target.value)} placeholder="JSON output when the action completed" /><div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy} onClick={() => void perform(async () => { await api("recover", { runId: selected.id, resolution: "continue", assumedOutput: JSON.parse(assumedOutput) }); await loadRun(selected.id); })}>Action completed — continue</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void perform(async () => { await api("recover", { runId: selected.id, resolution: "retry" }); await loadRun(selected.id); })}>Retry action</Button><Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void perform(async () => { await api("recover", { runId: selected.id, resolution: "terminate" }); await loadRun(selected.id); })}>Terminate</Button></div></div>}
          {runState && <details className="rounded border p-2 text-xs"><summary>Execution state · version {runState.stateVersion}</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap py-2">{JSON.stringify(runState.state, null, 2)}</pre>{runState.sensitiveKeys.length > 0 && <p className="text-muted-foreground">Sensitive values hidden: {runState.sensitiveKeys.join(", ")}</p>}<div className="mt-2 space-y-1">{runState.events.map((event) => <button type="button" key={`${event.state_version}-${event.node_id}`} className="block w-full rounded border p-1 text-left" onClick={() => onFocusNode?.(event.node_id)}>v{event.state_version} · {event.node_id} · {event.changed_keys.join(", ")} · {new Date(event.created_at).toLocaleString()}</button>)}</div>{runState.signalEvents?.length > 0 && <div className="mt-2 space-y-1"><p className="font-medium">External signals</p>{runState.signalEvents.map((event) => <button type="button" key={event.id} className="block w-full rounded border p-1 text-left" onClick={() => event.consumed_by_node_id && onFocusNode?.(event.consumed_by_node_id)}>{event.signal_name} · {event.consumed_at ? `consumed ${new Date(event.consumed_at).toLocaleString()}` : "pending"}</button>)}</div>}</details>}
          {steps.map((step) => <details key={step.id} className="rounded border p-2 text-xs"><summary>{step.sequence}. {step.node_name} · {step.status} {step.duration_ms != null ? `· ${step.duration_ms} ms` : ""}</summary><Button type="button" size="sm" variant="outline" onClick={() => onFocusNode?.(step.node_id)}>Show node on canvas</Button>{step.error && <p className="text-destructive whitespace-pre-wrap">{step.error}</p>}<pre className="max-h-60 overflow-auto whitespace-pre-wrap">{JSON.stringify({ input: step.input_summary, output: step.output_summary, next: step.selected_routes }, null, 2)}</pre></details>)}
          {notifications.length > 0 && <details className="text-xs"><summary>Notification delivery log</summary><div className="space-y-2 pt-2">{notifications.map((notification) => <div key={notification.id} className="rounded border p-2">{notification.event_type} · {notification.status} · {notification.attempts} attempts{notification.last_error && <p className="text-muted-foreground">{notification.last_error}</p>}</div>)}</div></details>}
          {selected.status === "succeeded" && <details className="text-xs"><summary>Final output</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap">{JSON.stringify(selected.output, null, 2)}</pre></details>}
        </div>}
      </div>
    </div>}
  </div>;
}
