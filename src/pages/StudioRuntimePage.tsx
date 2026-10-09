import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { studioApi, type PublishedStudioItem } from "@/services/studioApi";
import { workflowBackend, type BackendWorkflowRun } from "@/lib/workflowBackend";
import { customWidgetDocument, outputTable, parseApplicationInput } from "@/lib/applicationPrototype";
import ManagedChat from "@/components/chat/ManagedChat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import UserMenu from "@/components/UserMenu";

interface ResolvedStudio { organization: { id: string; name: string; slug: string }; item: PublishedStudioItem; pages: PublishedStudioItem[] }
export default function StudioRuntimePage({ canvas = false }: { canvas?: boolean }) {
  const params = useParams();
  const { user } = useAuth();
  const [selected, setSelected] = useState("");
  const runtime = useQuery({
    queryKey: ["studio-runtime", user?.id, params.orgSlug, canvas, params.appSlug, params.canvasSlug],
    queryFn: () => studioApi<ResolvedStudio>("resolve", undefined, { orgSlug: params.orgSlug, kind: canvas ? "canvas" : "application", slug: canvas ? params.canvasSlug : params.appSlug }),
    refetchInterval: 30000,
    retry: false,
  });
  if (runtime.error) return <main className="container py-12"><h1 className="text-2xl font-bold">Application unavailable</h1><p role="alert" className="my-4">{runtime.error.message}</p><Button onClick={() => void runtime.refetch()}>Retry</Button></main>;
  if (!runtime.data) return <p role="status" className="p-8">Loading application…</p>;
  const { organization, item, pages } = runtime.data;
  const current = canvas ? pages.find((page) => page.id === selected) || pages[0] : params.pageSlug ? pages.find((page) => page.slug === params.pageSlug) : pages[0];
  const grid = canvas && item.definition.layout === "grid";
  return <main className="container max-w-[1600px] space-y-6 px-4 py-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">{organization.name}</p><h1 className="text-3xl font-bold">{item.definition.title}</h1><p className="mt-2 text-muted-foreground">{item.definition.description}</p></div><UserMenu /></header>
    {!pages.length && <p>No active pages have been published.</p>}
    {!grid && <nav aria-label="Application pages" className="flex flex-wrap gap-2">{pages.map((page) => canvas ? <Button key={page.id} variant={current?.id === page.id ? "default" : "outline"} onClick={() => setSelected(page.id)}>{page.definition.title}</Button> : <Button key={page.id} variant={current?.id === page.id ? "default" : "outline"} asChild><Link to={`/o/${organization.slug}/apps/${params.appSlug}/${page.slug}`} aria-current={current?.id === page.id ? "page" : undefined}>{page.definition.title}</Link></Button>)}</nav>}
    {!grid && pages.length > 0 && !current && <p role="alert">This page is not available.</p>}
    <div className={grid ? "grid items-start gap-6 lg:grid-cols-2" : "space-y-6"}>{(grid ? pages : current ? [current] : []).map((page) => <PublishedPage key={`${user?.id}:${organization.id}:${page.id}:${page.releaseId}`} page={page} container={item} organizationId={organization.id} />)}</div>
  </main>;
}
function PublishedPage({ page, container, organizationId }: { page: PublishedStudioItem; container: PublishedStudioItem; organizationId: string }) {
  const { user } = useAuth();
  const [payload, setPayload] = useState(page.definition.elements.find((element) => element.type === "json-input")?.content || "{}");
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState("");
  const storageKey = `studio-run:${user?.id}:${organizationId}:${page.id}:${page.releaseId}`;
  const [runId, setRunId] = useState<string | null>(() => { try { return sessionStorage.getItem(storageKey); } catch { return null; } });
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const run = useQuery({
    queryKey: ["studio-page-run", user?.id, organizationId, runId], enabled: Boolean(runId),
    queryFn: async () => {
      const data = (await workflowBackend("get", organizationId, { runId })).run as BackendWorkflowRun;
      return data;
    },
    refetchInterval: (query) => query.state.data && ["queued", "running", "waiting_for_input", "waiting_for_event"].includes(query.state.data.status) ? 2000 : false,
  });
  const updateRun = (id: string | null) => { setRunId(id); try { if (id) sessionStorage.setItem(storageKey, id); else sessionStorage.removeItem(storageKey); } catch { /* reconnection is optional */ } };
  const start = useMutation({
    mutationFn: ({ elementId, input, key }: { elementId: string; input: unknown; key: string }) => studioApi("launch", organizationId, { id: page.id, releaseId: page.releaseId, containerId: container.id, containerReleaseId: container.releaseId, elementId, input }, key),
    onSuccess: (data) => { updateRun(data.runId!); setResult(undefined); attempt.current = null; },
  });
  const cancel = useMutation({ mutationFn: () => workflowBackend("cancel", organizationId, { runId }), onSuccess: () => { void run.refetch(); } });
  const active = Boolean(runId && (!run.data || ["queued", "running", "waiting_for_input", "waiting_for_event"].includes(run.data.status)));
  const output = result !== undefined ? result : run.data?.output ?? null;
  const startAction = (elementId: string) => {
    setError("");
    try {
      const input = parseApplicationInput(payload);
      const signature = JSON.stringify({ elementId, input });
      if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
      start.mutate({ elementId, input, key: attempt.current.key });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <Card className="min-w-0"><CardHeader><CardTitle>{page.definition.title}</CardTitle>{page.definition.description && <p className="text-sm text-muted-foreground">{page.definition.description}</p>}</CardHeader><CardContent className="space-y-5">
    {(error || start.error || run.error || cancel.error) && <p role="alert" className="text-destructive">{error || start.error?.message || run.error?.message || cancel.error?.message}</p>}
    {runId && <div className="flex flex-wrap items-center gap-2 text-sm"><span role="status">{run.data?.status || "Loading run…"}</span><span className="break-all text-xs text-muted-foreground">{runId}</span>{active && <Button size="sm" variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Cancel</Button>}<Button size="sm" variant="outline" onClick={() => void run.refetch()}>Refresh</Button>{run.error && <Button size="sm" variant="outline" onClick={() => updateRun(null)}>Dismiss unavailable run</Button>}</div>}
    {run.data?.stopReason && <p>{run.data.stopReason}</p>}
    {run.data?.status === "queued" && <p className="text-sm text-muted-foreground">Waiting for workflow worker capacity.</p>}
    {run.data?.waiting && <RunAnswer organizationId={organizationId} run={run.data} onAnswered={() => void run.refetch()} />}
    {page.definition.elements.map((element) => {
      if (element.type === "heading") return <h2 key={element.id} className="text-2xl font-semibold">{element.content || element.label}</h2>;
      if (element.type === "text") return <p key={element.id} className="whitespace-pre-wrap">{element.content}</p>;
      if (element.type === "json-input") return <div key={element.id}><Label htmlFor={`${page.id}-${element.id}`}>{element.label}</Label><Textarea id={`${page.id}-${element.id}`} className="min-h-36 font-mono" value={payload} onChange={(event) => setPayload(event.target.value)} /></div>;
      if (element.type === "workflow-button") return <Button key={element.id} disabled={active || start.isPending} onClick={() => startAction(element.id)}>{start.isPending ? "Starting…" : element.label}</Button>;
      if (element.type === "html") return <iframe key={element.id} title={element.label || "Custom component"} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={customWidgetDocument(element.content || "")} className="min-h-80 w-full rounded border bg-white" />;
      if (element.type === "chat") return <div key={element.id} className="h-[640px] min-h-80"><ManagedChat id={element.chatId!} organizationId={organizationId} context={{ resultData: output }} onResultDataChange={setResult} /></div>;
      return <ResultDisplay key={element.id} value={output} title={element.label} />;
    })}
  </CardContent></Card>;
}
function RunAnswer({ organizationId, run, onAnswered }: { organizationId: string; run: BackendWorkflowRun; onAnswered: () => void }) {
  const [answer, setAnswer] = useState("");
  const submit = useMutation({ mutationFn: () => workflowBackend("resume", organizationId, { runId: run.id, nodeId: run.waiting!.nodeId, waitingVersion: run.waitingVersion, answer }), onSuccess: onAnswered });
  return <div className="space-y-2 rounded border p-3"><Label htmlFor={`answer-${run.id}`}>{run.waiting!.question}</Label>{run.waiting!.options?.length ? <select id={`answer-${run.id}`} className="w-full rounded border bg-background p-2" value={answer} onChange={(event) => setAnswer(event.target.value)}><option value="">Select an answer</option>{run.waiting!.options.map((value) => <option key={value}>{value}</option>)}</select> : <Textarea id={`answer-${run.id}`} value={answer} onChange={(event) => setAnswer(event.target.value)} />}<Button disabled={!answer.trim() || submit.isPending} onClick={() => submit.mutate()}>Submit answer</Button>{submit.error && <p role="alert">{submit.error.message}</p>}</div>;
}
function ResultDisplay({ value, title }: { value: unknown; title: string }) {
  const table = outputTable(value);
  return <section className="space-y-2"><h3 className="font-medium">{title}</h3>{value == null ? <p className="text-sm text-muted-foreground">No result yet.</p> : <>{table && <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{table.columns.map((column) => <th className="border-b p-2" key={column}>{column}</th>)}</tr></thead><tbody>{table.rows.map((row, index) => <tr key={index}>{table.columns.map((column) => <td className="border-b p-2" key={column}>{typeof row[column] === "string" ? row[column] as string : JSON.stringify(row[column])}</td>)}</tr>)}</tbody></table><p className="text-xs text-muted-foreground">Showing up to 100 rows and 20 columns.</p></div>}<details open={!table}><summary className="cursor-pointer text-sm">Complete JSON output</summary><pre className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(value, null, 2)}</pre></details></>}</section>;
}
