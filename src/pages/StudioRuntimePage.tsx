import { studioElementStyle } from "@/lib/studioBuilder";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { studioApi, type PublishedStudioItem } from "@/services/studioApi";
import { workflowBackend, type BackendWorkflowRun } from "@/lib/workflowBackend";
import { parseApplicationInput } from "@/lib/applicationPrototype";
import { StudioElementContent } from "@/components/studio/StudioElements";
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
  const [payload, setPayload] = useState(page.definition.elements.find((element) => element.type === "json-input" && element.enabled !== false)?.content || "{}");
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
    <div className="studio-surface"><div className="studio-elements">{page.definition.elements.filter((element) => element.enabled !== false).map((element) => <div key={element.id} className="studio-element" data-element-id={element.id} style={studioElementStyle(element)}>
      <StudioElementContent element={element} input={(() => { try { return JSON.parse(payload); } catch { return null; } })()} result={output} payload={payload} onPayloadChange={setPayload}
        onAction={startAction} busy={active || start.isPending} scope={page.id}
        chat={element.type === "chat" ? <div className="min-h-80" style={{ height: element.appearance?.minHeight || 640 }}><ManagedChat id={element.chatId!} organizationId={organizationId} context={{ resultData: output }} onResultDataChange={setResult} /></div> : undefined} />
    </div>)}</div></div>
  </CardContent></Card>;
}
function RunAnswer({ organizationId, run, onAnswered }: { organizationId: string; run: BackendWorkflowRun; onAnswered: () => void }) {
  const [answer, setAnswer] = useState("");
  const submit = useMutation({ mutationFn: () => workflowBackend("resume", organizationId, { runId: run.id, nodeId: run.waiting!.nodeId, waitingVersion: run.waitingVersion, answer }), onSuccess: onAnswered });
  return <div className="space-y-2 rounded border p-3"><Label htmlFor={`answer-${run.id}`}>{run.waiting!.question}</Label>{run.waiting!.options?.length ? <select id={`answer-${run.id}`} className="w-full rounded border bg-background p-2" value={answer} onChange={(event) => setAnswer(event.target.value)}><option value="">Select an answer</option>{run.waiting!.options.map((value) => <option key={value}>{value}</option>)}</select> : <Textarea id={`answer-${run.id}`} value={answer} onChange={(event) => setAnswer(event.target.value)} />}<Button disabled={!answer.trim() || submit.isPending} onClick={() => submit.mutate()}>Submit answer</Button>{submit.error && <p role="alert">{submit.error.message}</p>}</div>;
}
