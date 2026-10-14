import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

type Interaction = {
  run: { id: string; workflowName: string; status: string; waitingVersion?: string; waitingExpiresAt?: string;
    waiting?: { nodeId: string; question: string; inputType: string; options?: string[] }; output?: unknown; stopReason?: string };
  returnUrl?: string;
};
const terminal = new Set(["succeeded", "failed", "cancelled", "timed_out", "incomplete"]);

export default function WorkflowInteractionPage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
  const [detail, setDetail] = useState<Interaction | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const mounted = useRef(true);
  const fetching = useRef(false);
  const lastVersion = useRef<string>();
  const call = useCallback(async (action: string, values: Record<string, unknown> = {}) => {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/workflow-interaction`, {
      method: "POST", cache: "no-store", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, token, ...values }),
    });
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 401 || response.status === 410) setClosed(true);
      throw new Error(body.error || "Unable to load this workflow.");
    }
    return body;
  }, [token]);
  const refresh = useCallback(async () => {
    if (!token || fetching.current) return;
    fetching.current = true;
    try {
      const body: Interaction = await call("get");
      if (!mounted.current) return;
      if (lastVersion.current !== body.run.waitingVersion) { setAnswer(""); lastVersion.current = body.run.waitingVersion; }
      setDetail(body);
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Unable to load this workflow."); }
    finally { fetching.current = false; }
  }, [call, token]);
  useEffect(() => {
    mounted.current = true;
    const meta = document.createElement("meta"); meta.name = "referrer"; meta.content = "no-referrer"; document.head.appendChild(meta);
    void refresh();
    return () => { mounted.current = false; meta.remove(); };
  }, [refresh]);
  useEffect(() => {
    if (closed || (detail && terminal.has(detail.run.status))) return;
    const timer = window.setInterval(() => { setNow(Date.now()); void refresh(); }, 2500);
    return () => window.clearInterval(timer);
  }, [closed, detail, refresh]);
  const run = detail?.run;
  const waiting = run?.status === "waiting_for_input" ? run.waiting : null;
  const expired = Boolean(run?.waitingExpiresAt && Date.parse(run.waitingExpiresAt) <= now);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!waiting || !run || busy || expired) return;
    setBusy(true); setError("");
    try {
      await call("resume", { nodeId: waiting.nodeId, waitingVersion: run.waitingVersion, answer });
      setAnswer(""); setDetail((previous) => previous ? { ...previous, run: { ...previous.run, status: "queued", waiting: undefined } } : previous); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to submit answer."); await refresh(); }
    finally { setBusy(false); }
  };
  return <main className="min-h-screen bg-muted/30 px-4 py-12">
    <Card className="mx-auto max-w-xl">
      <CardHeader><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Workflow response</p><CardTitle>{run?.workflowName || "Respond to a workflow"}</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        {!token && <p role="alert">This link is missing its access token. Open the full link provided for your workflow.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {token && !closed && !run && !error && <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading workflow…</p>}
        {!closed && waiting && <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <Label htmlFor="workflow-answer" className="block whitespace-pre-wrap text-base leading-relaxed">{waiting.question}</Label>
          {run?.waitingExpiresAt && <p className="text-xs text-muted-foreground">Respond by {new Date(run.waitingExpiresAt).toLocaleString()}.</p>}
          {(waiting.inputType === "yes_no" || waiting.inputType === "select") ? <select id="workflow-answer" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={answer} disabled={busy || expired} required onChange={(event) => setAnswer(event.target.value)}>
            <option value="">Choose an answer</option>{(waiting.inputType === "yes_no" ? ["yes", "no"] : waiting.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
          </select> : <Input id="workflow-answer" value={answer} maxLength={100000} disabled={busy || expired} required onChange={(event) => setAnswer(event.target.value)} />}
          {expired ? <p role="status" className="text-sm">The response deadline has passed. This question is closed.</p> : <Button type="submit" disabled={busy || !answer.trim()}>{busy ? "Submitting…" : "Submit answer"}</Button>}
        </form>}
        {!closed && run && !waiting && <div aria-live="polite" className="space-y-3">
          {run.status === "succeeded" ? <><p className="font-medium">Workflow completed</p>{run.output != null && <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{typeof run.output === "string" ? run.output : JSON.stringify(run.output, null, 2)}</pre>}</>
            : terminal.has(run.status) ? <><p className="font-medium">{run.status === "timed_out" ? "Response deadline expired" : `Workflow ${run.status}`}</p><p className="text-sm text-muted-foreground">{run.stopReason}</p></>
            : <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Your workflow is {run.status === "queued" ? "queued" : "running"}. Questions will appear here when an answer is needed.</p>}
        </div>}
        {detail?.returnUrl && run && terminal.has(run.status) && <Button asChild variant="outline"><a href={detail.returnUrl} rel="noreferrer">Return to your application</a></Button>}
      </CardContent>
    </Card>
  </main>;
}
