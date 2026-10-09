import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { workflowBackend, type BackendWorkflowRun } from "@/lib/workflowBackend";
import { customWidgetDocument, outputTable, parseApplicationInput, type ApplicationPageDefinition } from "@/lib/applicationPrototype";
import type { WorkflowConfig } from "@/types/workflow";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const INITIAL_WIDGET = `<style>body { font: 16px system-ui; padding: 16px; color: #172554; } article { border: 1px solid #cbd5e1; border-radius: 12px; padding: 20px; } button { padding: 8px 16px; }</style>
<article><h2>Skill review</h2><p>A custom HTML, CSS and JavaScript component.</p><button onclick="this.textContent = 'Reviewed'">Review example</button></article>`;
const activeStatuses = ["queued", "running", "waiting_for_input", "waiting_for_event"];

export default function ApplicationPrototype({ standalone = false }: { standalone?: boolean }) {
  const { user } = useAuth();
  const organizationId = user?.organization?.id;
  const [workflowId, setWorkflowId] = useState("");
  const [payload, setPayload] = useState('{\n  "documentIds": [],\n  "request": "Extract skills from the selected documents"\n}');
  const [runId, setRunId] = useState<string | null>(null);
  const [inputError, setInputError] = useState("");
  const [widgetSource, setWidgetSource] = useState(INITIAL_WIDGET);
  const [widgetPreview, setWidgetPreview] = useState(INITIAL_WIDGET);
  const workflows = useQuery({
    queryKey: ["application-preview-workflows", user?.id, organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.from("global_configs").select("features").eq("organization_id", organizationId!).maybeSingle();
      if (error) throw error;
      const features = data?.features as { llmInsights?: { workflows?: WorkflowConfig[] } } | null;
      return (features?.llmInsights?.workflows || []).filter((workflow) => !workflow.deletedAt && workflow.enabled && workflow.execution?.apiEnabled);
    },
  });
  const selectedWorkflow = workflows.data?.find((workflow) => workflow.id === workflowId);
  const run = useQuery({
    queryKey: ["application-preview-run", user?.id, organizationId, runId],
    enabled: Boolean(organizationId && runId),
    queryFn: async () => (await workflowBackend("get", organizationId, { runId })).run as BackendWorkflowRun,
    refetchInterval: (query) => query.state.data && activeStatuses.includes(query.state.data.status) ? 2000 : false,
  });
  const start = useMutation({
    mutationFn: (input: unknown) => workflowBackend("start", organizationId, { workflowId, input }),
    onSuccess: (data) => setRunId(data.runId),
  });
  const cancel = useMutation({
    mutationFn: () => workflowBackend("cancel", organizationId, { runId }),
    onSuccess: () => { void run.refetch(); },
  });
  const running = Boolean(runId && (!run.data || activeStatuses.includes(run.data.status)));
  const definition: ApplicationPageDefinition = {
    schemaVersion: 1, id: "workflow-preview", organizationId: organizationId || "", title: "Workflow application preview", access: "organization-admin",
    elements: [{ id: "payload", type: "json-input", label: "Request data" }, { id: "run", type: "workflow-button", label: "Run workflow" }, { id: "output", type: "run-output", label: "Result" }, { id: "custom", type: "custom-widget", label: "Custom widget" }],
    action: { event: "submit", workflowId, inputBinding: "payload" },
  };
  const table = outputTable(run.data?.output);
  const submit = () => {
    setInputError("");
    if (!organizationId || !selectedWorkflow) return;
    try { const input = parseApplicationInput(payload); cancel.reset(); start.mutate(input); }
    catch (error) { setInputError(error instanceof Error ? error.message : String(error)); }
  };
  if (!organizationId) return <p>Select an organization to preview an application.</p>;
  return <div className="space-y-6">
    <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Applications &amp; Pages</CardTitle><Badge variant="secondary">Architecture preview</Badge></div><CardDescription>Test a responsive application page connected to a saved workflow. Preview edits last until you leave this page; publishing and page management arrive in the next batch.</CardDescription></CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button variant="outline" asChild><Link to={standalone ? "/admin?section=applications" : `/admin/application-preview/${organizationId}`}>{standalone ? "Back to applications" : "Open standalone preview"}</Link></Button>
        <Button variant="outline" asChild><Link to="/admin?section=llm">Configure workflows</Link></Button>
      </CardContent>
    </Card>
    <div className="grid gap-6 xl:grid-cols-2">
      <Card><CardHeader><CardTitle>Workflow action</CardTitle><CardDescription>Runs use your signed-in account and the active organization. Enable API execution and select Request data on your workflow trigger.</CardDescription></CardHeader><CardContent className="space-y-4">
        <div className="space-y-2"><Label htmlFor="preview-workflow">Saved workflow</Label><select id="preview-workflow" className="w-full rounded-md border bg-background p-2" value={workflowId} disabled={running || start.isPending} onChange={(event) => { setWorkflowId(event.target.value); start.reset(); }}><option value="">Select a workflow</option>{workflows.data?.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select></div>
        {workflows.isPending && <p role="status">Loading workflows…</p>}
        {workflows.error && <p role="alert" className="text-destructive">{workflows.error.message}</p>}
        {workflows.data?.length === 0 && <p className="text-sm text-muted-foreground">No enabled workflows allow API execution. Configure one in Agent Orchestration, then refresh this list.</p>}
        <Button size="sm" variant="outline" onClick={() => void workflows.refetch()} disabled={workflows.isFetching}>Refresh workflows</Button>
        <div className="space-y-2"><Label htmlFor="preview-payload">Request data (JSON)</Label><Textarea id="preview-payload" className="min-h-48 font-mono" value={payload} onChange={(event) => setPayload(event.target.value)} /></div>
        <Button onClick={submit} disabled={!selectedWorkflow || start.isPending || running}>{start.isPending ? "Starting…" : "Run workflow"}</Button>
        {(inputError || start.error) && <p role="alert" className="text-destructive">{inputError || start.error?.message}</p>}
        <p className="text-xs text-muted-foreground">This starts a real backend operation. The server validates the saved workflow and its execution permissions.</p>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Run output</CardTitle><CardDescription>Run status updates automatically while this page is open.</CardDescription></CardHeader><CardContent className="space-y-4">
        {!runId && <p className="text-muted-foreground">Start a workflow to see its result here.</p>}
        {runId && <><p className="break-all text-xs">Run: {runId}</p><Button size="sm" variant="outline" onClick={() => void run.refetch()}>Refresh status</Button></>}
        {run.isFetching && !run.data && runId && <p role="status">Loading run…</p>}
        {run.error && <p role="alert" className="text-destructive">{run.error.message}</p>}
        {run.data && <><p role="status"><Badge>{run.data.status}</Badge> <span className="ml-2 text-sm">{run.data.workflowName}</span></p>{run.data.stopReason && <p>{run.data.stopReason}</p>}
          {run.data.status === "queued" && <p className="text-sm text-muted-foreground">Waiting for backend capacity. A workflow worker must be running.</p>}
          {run.data.waiting && <p>Input requested: {run.data.waiting.question}. Open the workflow’s Manage runs window to respond.</p>}
          {run.data.status === "waiting_for_event" && <p>Waiting for an external event. Manage this run in Agent Orchestration.</p>}
          {running && <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Cancel run</Button>}
          {run.data.output !== undefined && <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs">{JSON.stringify(run.data.output, null, 2)}</pre>}
        </>}
        {cancel.error && <p role="alert" className="text-destructive">{cancel.error.message}</p>}
      </CardContent></Card>
    </div>
    {table && <Card><CardHeader><CardTitle>Result table</CardTitle><CardDescription>Preview of up to 100 rows and 20 columns. Complete output is available above.</CardDescription></CardHeader><CardContent className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{table.columns.map((column) => <th className="border-b p-2" key={column}>{column}</th>)}</tr></thead><tbody>{table.rows.map((row, index) => <tr key={index}>{table.columns.map((column) => <td className="border-b p-2" key={column}>{typeof row[column] === "string" ? row[column] as string : JSON.stringify(row[column])}</td>)}</tr>)}</tbody></table></CardContent></Card>}
    <Card><CardHeader><CardTitle>Custom component preview</CardTitle><CardDescription>Try HTML, CSS and JavaScript in an isolated component. This preview has no access to application credentials or backend data.</CardDescription></CardHeader><CardContent className="grid gap-4 lg:grid-cols-2"><div className="space-y-3"><Label htmlFor="widget-source">Component source</Label><Textarea id="widget-source" className="min-h-64 font-mono text-xs" value={widgetSource} onChange={(event) => setWidgetSource(event.target.value)} /><Button variant="outline" onClick={() => setWidgetPreview(widgetSource)}>Update component preview</Button></div><iframe title="Custom application component" sandbox="allow-scripts" referrerPolicy="no-referrer" className="min-h-72 w-full rounded-lg border bg-white" srcDoc={customWidgetDocument(widgetPreview)} /></CardContent></Card>
    <details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">Page definition preview</summary><pre className="mt-3 overflow-auto text-xs">{JSON.stringify(definition, null, 2)}</pre></details>
  </div>;
}
