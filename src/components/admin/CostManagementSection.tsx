import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { costControl } from "@/lib/costControl";
import { Loader2, RefreshCw, Save, Send, ShieldCheck } from "lucide-react";

type ScalarMap = Record<string, string | number>;
type Item = Record<string, unknown> & {
  id: string; name?: string; model?: string; policy_id?: string; version_number?: number; status?: string;
  change_reason?: string; archived_at?: string; retired_at?: string; target_type?: string; target_id?: string;
  definition?: Record<string, unknown> & { rates?: Record<string, string> }; formula_ast?: unknown;
  executionCount?: number; usageEventCount?: number; totals?: ScalarMap; providers?: Record<string, Item>; executions?: Item[];
  execution?: Item; steps?: Item[]; usage?: unknown; valuations?: unknown; stepTotals?: Record<string, ScalarMap>;
  events?: number; inputTokens?: number; outputTokens?: number; costs?: ScalarMap;
  execution_mode?: string; execution_kind?: string; started_at?: string; workflow_id?: string; agent_id?: string;
  sequence?: number; node_name?: string; node_id?: string; node_type?: string; period_start?: string; period_end?: string;
  amount?: string | number; currency?: string;
};
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const TOKEN_FORMULA = {
  type: "binary", operator: "+",
  left: { type: "binary", operator: "*", left: { type: "binary", operator: "/", left: { type: "variable", name: "input_tokens" }, right: { type: "number", value: "1000000" } }, right: { type: "variable", name: "input_rate" } },
  right: { type: "binary", operator: "*", left: { type: "binary", operator: "/", left: { type: "variable", name: "output_tokens" }, right: { type: "number", value: "1000000" } }, right: { type: "variable", name: "output_rate" } },
};

export function CostManagementSection({ organizationId, providers, mcpServers, workflows, agents }: {
  organizationId?: string;
  providers: Array<{ id: string; name: string; model?: string }>;
  mcpServers: Array<{ id: string; name: string }>;
  workflows: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
}) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [policies, setPolicies] = useState<Item[]>([]); const [versions, setVersions] = useState<Item[]>([]); const [assignments, setAssignments] = useState<Item[]>([]);
  const [summary, setSummary] = useState<Item | null>(null); const [detail, setDetail] = useState<Item | null>(null); const [audit, setAudit] = useState<Item[]>([]);
  const [budgets, setBudgets] = useState<Item[]>([]); const [subscriptions, setSubscriptions] = useState<Item[]>([]);
  const [name, setName] = useState("LLM token pricing"); const [currency, setCurrency] = useState("EUR");
  const [rates, setRates] = useState(pretty({ input_rate: "0", output_rate: "0" })); const [formula, setFormula] = useState(pretty(TOKEN_FORMULA));
  const [selectedVersion, setSelectedVersion] = useState(""); const [simulationInputs, setSimulationInputs] = useState(pretty({ input_tokens: 12400, output_tokens: 2100 })); const [simulation, setSimulation] = useState<Item | null>(null);
  const [targetType, setTargetType] = useState("llm_provider"); const [targetId, setTargetId] = useState(""); const [assignmentPolicy, setAssignmentPolicy] = useState("");
  const [budgetName, setBudgetName] = useState("Monthly AI budget"); const [budgetAmount, setBudgetAmount] = useState("1000");
  const [subscriptionPolicy, setSubscriptionPolicy] = useState(""); const [subscriptionAmount, setSubscriptionAmount] = useState("0");
  const [reconcileExecution, setReconcileExecution] = useState(""); const [reconcileAmount, setReconcileAmount] = useState("");

  const call = useCallback((action: string, body: Record<string, unknown> = {}) => costControl(action, organizationId, body), [organizationId]);
  const refresh = useCallback(async () => {
    if (!organizationId) return; setBusy(true); setError("");
    try {
      const [policyResult, summaryResult, budgetResult, subscriptionResult, auditResult] = await Promise.all([
        call("list_policies"), call("summary"), call("list_budgets"), call("list_subscriptions"), call("audit_history"),
      ]);
      setPolicies(policyResult.policies ?? []); setVersions(policyResult.versions ?? []); setAssignments(policyResult.assignments ?? []);
      setSummary(summaryResult); setBudgets(budgetResult.budgets ?? []); setSubscriptions(subscriptionResult.subscriptions ?? []); setAudit(auditResult.events ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }, [call, organizationId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const targets = useMemo(() => targetType === "llm_provider" ? providers.map((item) => ({ ...item, label: `${item.name}${item.model ? ` · ${item.model}` : ""}` }))
    : targetType === "mcp_server" ? mcpServers.map((item) => ({ ...item, label: item.name }))
    : targetType === "workflow" ? workflows.map((item) => ({ ...item, label: item.name }))
    : targetType === "agent" ? agents.map((item) => ({ ...item, label: item.name })) : [], [agents, mcpServers, providers, targetType, workflows]);
  const version = versions.find((item) => item.id === selectedVersion);
  const perform = async (fn: () => Promise<void>) => { setBusy(true); setError(""); try { await fn(); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } };

  const loadVersion = (id: string) => { setSelectedVersion(id); const item = versions.find((value) => value.id === id); if (item) { setRates(pretty(item.definition?.rates ?? {})); setFormula(pretty(item.formula_ast)); setAssignmentPolicy(item.policy_id); } };

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Costs, usage and calculation policies</h3><p className="text-xs text-muted-foreground">Usage facts are immutable. Published calculation versions remain reproducible and auditable.</p></div><Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>{busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}Refresh</Button></div>
    {error && <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{error}</p>}
    <Tabs defaultValue="dashboard">
      <TabsList className="grid h-auto grid-cols-2 lg:grid-cols-4"><TabsTrigger value="dashboard">Cost dashboard</TabsTrigger><TabsTrigger value="executions">Executions</TabsTrigger><TabsTrigger value="policies">Policies</TabsTrigger><TabsTrigger value="controls">Budgets &amp; billing</TabsTrigger></TabsList>
      <TabsContent value="dashboard" className="space-y-3 pt-3">
        <div className="grid gap-2 sm:grid-cols-3"><Metric label="Executions" value={summary?.executionCount ?? 0} /><Metric label="Usage events" value={summary?.usageEventCount ?? 0} /><Metric label="Estimated totals" value={Object.entries(summary?.totals ?? {}).map(([unit, value]) => `${Number(value).toFixed(4)} ${unit}`).join(" · ") || "0"} /></div>
        <div className="rounded border"><div className="grid grid-cols-5 gap-2 border-b bg-muted/40 p-2 text-[10px] font-semibold uppercase"><span>Provider/source</span><span>Events</span><span>Input tokens</span><span>Output tokens</span><span>Cost</span></div>{Object.entries(summary?.providers ?? {}).map(([provider, raw]) => { const value = raw as Item; return <div key={provider} className="grid grid-cols-5 gap-2 border-b p-2 text-xs last:border-0"><span>{provider}</span><span>{value.events}</span><span>{Number(value.inputTokens).toLocaleString()}</span><span>{Number(value.outputTokens).toLocaleString()}</span><span>{Object.entries(value.costs ?? {}).map(([unit, amount]) => `${amount} ${unit}`).join(" · ") || "—"}</span></div>; })}</div>
      </TabsContent>
      <TabsContent value="executions" className="space-y-2 pt-3">
        {(summary?.executions ?? []).map((execution: Item) => <button key={execution.id} className="block w-full rounded border p-2 text-left text-xs hover:bg-muted/40" onClick={() => void perform(async () => setDetail(await call("execution_detail", { executionId: execution.id })))}><span className="font-medium">{execution.status}</span> · {execution.execution_mode} · {execution.execution_kind} · {new Date(execution.started_at).toLocaleString()}<span className="block text-muted-foreground">{execution.workflow_id || execution.agent_id || execution.id}</span></button>)}
        {detail && <details open className="rounded border p-3 text-xs"><summary className="font-medium">Execution {detail.execution?.id} · {Object.entries(detail.totals ?? {}).map(([unit, amount]) => `${amount} ${unit}`).join(" · ") || "no valued cost"}</summary><div className="mt-2 space-y-1">{(detail.steps ?? []).map((step: Item) => <div key={step.id} className="grid grid-cols-[1fr_auto] gap-2 rounded border p-2"><span>{step.sequence}. {step.node_name || step.node_id || step.node_type} · {step.status}</span><span>{Object.entries(detail.stepTotals?.[step.id] ?? {}).map(([unit, amount]) => `${amount} ${unit}`).join(" · ") || "—"}</span></div>)}</div><details className="mt-2"><summary>Usage and valuation evidence</summary><pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap">{pretty({ usage: detail.usage, valuations: detail.valuations })}</pre></details></details>}
      </TabsContent>
      <TabsContent value="policies" className="space-y-4 pt-3">
        <section className="grid gap-3 rounded border p-3 md:grid-cols-2"><div className="space-y-2"><Label>Policy name</Label><Input value={name} onChange={(event) => setName(event.target.value)} /><Label>Currency</Label><Input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /><Label>Rates JSON</Label><Textarea className="min-h-28 font-mono text-xs" value={rates} onChange={(event) => setRates(event.target.value)} /></div><div className="space-y-2"><Label>Safe formula AST</Label><Textarea className="min-h-52 font-mono text-xs" value={formula} onChange={(event) => setFormula(event.target.value)} /><Button disabled={busy || !name.trim()} onClick={() => void perform(async () => { const result = await call("create_policy", { name, currency, policyKind: "composite", rates: JSON.parse(rates), formula: JSON.parse(formula), changeReason: "Created in Agent Operations" }); loadVersion(result.version.id); })}><Save className="mr-1 h-4 w-4" />Create draft policy</Button></div></section>
        <div className="grid gap-3 lg:grid-cols-2"><section className="space-y-2 rounded border p-3"><p className="text-xs font-semibold">Versions</p>{versions.map((item) => <button key={item.id} className={`block w-full rounded border p-2 text-left text-xs ${selectedVersion === item.id ? "bg-muted" : ""}`} onClick={() => loadVersion(item.id)}><span className="font-medium">{policies.find((policy) => policy.id === item.policy_id)?.name}</span> · v{item.version_number} <Badge variant="outline" className="ml-1 text-[9px]">{item.status}</Badge><span className="block text-muted-foreground">{item.change_reason || "No change reason"}</span></button>)}</section>
          <section className="space-y-2 rounded border p-3"><p className="text-xs font-semibold">Edit, simulate and publish</p>{version ? <><p className="text-xs">Selected v{version.version_number} · {version.status}</p><Textarea className="min-h-24 font-mono text-xs" value={simulationInputs} onChange={(event) => setSimulationInputs(event.target.value)} /><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void perform(async () => { const result = await call("simulate_policy", { policyId: version.policy_id, versionId: version.id, definition: { ...version.definition, rates: JSON.parse(rates) }, formula: JSON.parse(formula), inputs: JSON.parse(simulationInputs), reason: "Admin preview" }); setSimulation(result.calculation); })}>Simulate</Button>{version.status === "draft" ? <><Button size="sm" variant="outline" onClick={() => void perform(async () => { await call("update_draft", { versionId: version.id, definition: { ...version.definition, rates: JSON.parse(rates) }, formula: JSON.parse(formula), changeReason: "Updated in Agent Operations" }); })}>Save draft</Button><Button size="sm" onClick={() => void perform(async () => { await call("publish_policy", { versionId: version.id, reason: "Approved in Agent Operations" }); })}><ShieldCheck className="mr-1 h-3.5 w-3.5" />Publish</Button></> : <Button size="sm" variant="outline" onClick={() => void perform(async () => { const result = await call("create_draft", { policyId: version.policy_id, sourceVersionId: version.id, changeReason: `New version based on v${version.version_number}` }); setSelectedVersion(result.version.id); })}>New version from this</Button>}<Button size="sm" variant="destructive" disabled={Boolean(policies.find((item) => item.id === version.policy_id)?.archived_at)} onClick={() => void perform(async () => { await call("archive_policy", { policyId: version.policy_id, reason: "Archived in Agent Operations" }); })}>Archive policy</Button></div>{simulation && <pre className="rounded bg-muted p-2 text-xs">{pretty(simulation)}</pre>}</> : <p className="text-xs text-muted-foreground">Select a policy version.</p>}</section></div>
        <section className="grid gap-2 rounded border p-3 md:grid-cols-4"><select className="rounded border bg-background px-2 text-xs" value={targetType} onChange={(event) => { setTargetType(event.target.value); setTargetId(""); }}>{["llm_provider","mcp_server","workflow","agent","organization"].map((value) => <option key={value} value={value}>{value}</option>)}</select>{targetType === "organization" ? <Input value={organizationId || ""} readOnly /> : <select className="rounded border bg-background px-2 text-xs" value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Select target</option>{targets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>}<select className="rounded border bg-background px-2 text-xs" value={assignmentPolicy} onChange={(event) => setAssignmentPolicy(event.target.value)}><option value="">Select policy</option>{policies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Button size="sm" disabled={!assignmentPolicy || !(targetId || targetType === "organization")} onClick={() => void perform(async () => { await call("assign_policy", { policyId: assignmentPolicy, targetType, targetId: targetType === "organization" ? organizationId : targetId, reason: "Assigned in Agent Operations" }); })}>Assign</Button></section>
        <section className="space-y-2 rounded border p-3 text-xs"><p className="font-semibold">Assignments</p>{assignments.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"><span>{item.target_type} · {item.target_id} · {policies.find((policy) => policy.id === item.policy_id)?.name || item.policy_id}{item.retired_at ? " · retired" : ""}</span>{!item.retired_at && <Button size="sm" variant="outline" onClick={() => void perform(async () => { await call("retire_assignment", { assignmentId: item.id, reason: "Retired in Agent Operations" }); })}>Retire</Button>}</div>)}</section>
        <details className="rounded border p-3 text-xs"><summary>Calculation audit history</summary><pre className="mt-2 max-h-80 overflow-auto">{pretty(audit)}</pre></details>
      </TabsContent>
      <TabsContent value="controls" className="space-y-4 pt-3">
        <section className="space-y-2 rounded border p-3"><p className="text-xs font-semibold">Budgets</p><div className="flex flex-wrap gap-2"><Input className="max-w-xs" value={budgetName} onChange={(event) => setBudgetName(event.target.value)} /><Input className="w-32" type="number" value={budgetAmount} onChange={(event) => setBudgetAmount(event.target.value)} /><Button size="sm" onClick={() => void perform(async () => { await call("save_budget", { name: budgetName, targetType: "organization", targetId: organizationId, period: "monthly", amount: budgetAmount, currency }); })}>Save budget</Button></div><pre className="max-h-32 overflow-auto text-xs">{pretty(budgets)}</pre></section>
        <section className="space-y-2 rounded border p-3"><p className="text-xs font-semibold">Subscription period</p><div className="grid gap-2 md:grid-cols-5"><select className="rounded border bg-background px-2 text-xs" value={subscriptionPolicy} onChange={(event) => setSubscriptionPolicy(event.target.value)}><option value="">Policy</option>{policies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Input type="date" id="subscription-start" /><Input type="date" id="subscription-end" /><Input type="number" value={subscriptionAmount} onChange={(event) => setSubscriptionAmount(event.target.value)} /><Button size="sm" disabled={!subscriptionPolicy} onClick={() => void perform(async () => { const start = (document.getElementById("subscription-start") as HTMLInputElement).value; const end = (document.getElementById("subscription-end") as HTMLInputElement).value; await call("save_subscription", { policyId: subscriptionPolicy, periodStart: start, periodEnd: end, amount: subscriptionAmount, currency, allocationMethod: "equal_execution" }); })}>Add period</Button></div><div className="space-y-1">{subscriptions.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-2 rounded border p-2 text-xs"><span>{new Date(item.period_start).toLocaleDateString()}–{new Date(item.period_end).toLocaleDateString()} · {item.amount} {item.currency} · {item.status}</span>{item.status !== "closed" && <Button size="sm" variant="outline" onClick={() => void perform(async () => { await call("close_subscription", { subscriptionId: item.id }); })}>Close and allocate</Button>}</div>)}</div></section>
        <section className="space-y-2 rounded border p-3"><p className="text-xs font-semibold">Provider reconciliation</p><div className="flex flex-wrap gap-2"><Input className="max-w-sm" placeholder="Execution UUID" value={reconcileExecution} onChange={(event) => setReconcileExecution(event.target.value)} /><Input className="w-32" placeholder="Billed amount" value={reconcileAmount} onChange={(event) => setReconcileAmount(event.target.value)} /><Button size="sm" disabled={!reconcileExecution || !reconcileAmount} onClick={() => void perform(async () => { const end = new Date(); const start = new Date(end.getFullYear(), end.getMonth(), 1); await call("reconcile", { executionId: reconcileExecution, providerId: "manual", billingPeriodStart: start.toISOString(), billingPeriodEnd: end.toISOString(), billedAmount: reconcileAmount, currency, sourceReference: "Manual reconciliation" }); })}><Send className="mr-1 h-3.5 w-3.5" />Record</Button></div></section>
      </TabsContent>
    </Tabs>
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded border bg-background p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>; }
