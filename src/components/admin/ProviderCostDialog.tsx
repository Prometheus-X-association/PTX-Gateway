import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { costControl } from "@/lib/costControl";
import { Loader2, Save, Trash2 } from "lucide-react";

type Target = { type: "llm_provider" | "mcp_server"; id: string; name: string; model?: string };
type Row = Record<string, unknown> & {
  id: string; policy_id?: string; target_type?: string; target_id?: string; retired_at?: string; effective_until?: string;
  version_number?: number; status?: string; definition?: { rates?: Record<string, string>; chargeOn?: "attempt" | "success" };
};

const n = (value: string) => ({ type: "number", value });
const v = (name: string) => ({ type: "variable", name });
const b = (operator: "+" | "-" | "*" | "/", left: unknown, right: unknown) => ({ type: "binary", operator, left, right });
const sum = (...items: unknown[]): unknown => items.reduce((left, right) => b("+", left, right));
const perMillion = (quantity: unknown, rate: string) => b("*", b("/", quantity, n("1000000")), v(rate));

const llmFormula = () => {
  const regularInput = { type: "function", name: "max", arguments: [n("0"), b("-", b("-", v("input_tokens"), v("cached_input_tokens")), v("cache_write_tokens"))] };
  return sum(
    perMillion(regularInput, "input_rate"),
    perMillion(v("cached_input_tokens"), "cached_input_rate"),
    perMillion(v("cache_write_tokens"), "cache_write_rate"),
    perMillion(v("output_tokens"), "output_rate"),
    b("*", v("request_count"), v("request_fee")),
  );
};
const mcpFormula = () => b("*", v("tool_call_count"), v("call_rate"));
const validAmount = (value: string) => /^\d+(?:\.\d+)?$/.test(value.trim());
const DUMMY_LLM_PRICING = {
  openai: { label: "OpenAI GPT-style demo", input: "1.25", cached: "0.25", cacheWrite: "0", output: "5", request: "0" },
  anthropic: { label: "Anthropic Claude-style demo", input: "3", cached: "0.3", cacheWrite: "3.75", output: "15", request: "0" },
  gemini: { label: "Google Gemini-style demo", input: "0.35", cached: "0.035", cacheWrite: "0", output: "1.05", request: "0" },
} as const;

export function ProviderCostDialog({ organizationId, target, onClose }: {
  organizationId?: string; target: Target | null; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [assignment, setAssignment] = useState<Row | null>(null); const [policyId, setPolicyId] = useState(""); const [versions, setVersions] = useState<Row[]>([]);
  const [currency, setCurrency] = useState("EUR"); const [chargeOn, setChargeOn] = useState<"attempt" | "success">("attempt");
  const [inputRate, setInputRate] = useState("0"); const [cachedInputRate, setCachedInputRate] = useState("0");
  const [cacheWriteRate, setCacheWriteRate] = useState("0"); const [outputRate, setOutputRate] = useState("0");
  const [requestFee, setRequestFee] = useState("0"); const [callRate, setCallRate] = useState("0");

  const load = useCallback(async () => {
    if (!target || !organizationId) return;
    setBusy(true); setError("");
    try {
      const result = await costControl("list_policies", organizationId);
      const now = Date.now();
      const linked = (result.assignments as Row[] | undefined)?.find((item) => item.target_type === target.type && item.target_id === target.id && !item.retired_at && (!item.effective_until || Date.parse(item.effective_until) > now)) ?? null;
      const policy = (result.policies as Row[] | undefined)?.find((item) => item.id === linked?.policy_id);
      const linkedVersions = ((result.versions as Row[] | undefined) ?? []).filter((item) => item.policy_id === linked?.policy_id).sort((a, b) => Number(b.version_number) - Number(a.version_number));
      const current = linkedVersions.find((item) => item.status === "active") ?? linkedVersions[0];
      const rates = current?.definition?.rates ?? {};
      setAssignment(linked); setPolicyId(linked?.policy_id ?? ""); setVersions(linkedVersions);
      setCurrency(String((policy as Record<string, unknown> | undefined)?.currency ?? "EUR")); setChargeOn(current?.definition?.chargeOn ?? "attempt");
      setInputRate(rates.input_rate ?? "0"); setCachedInputRate(rates.cached_input_rate ?? "0"); setCacheWriteRate(rates.cache_write_rate ?? "0");
      setOutputRate(rates.output_rate ?? "0"); setRequestFee(rates.request_fee ?? "0"); setCallRate(rates.call_rate ?? "0");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }, [organizationId, target]);
  useEffect(() => { if (target) void load(); }, [load, target]);

  const save = async () => {
    if (!target || !organizationId) return;
    const rates = target.type === "llm_provider"
      ? { input_rate: inputRate, cached_input_rate: cachedInputRate, cache_write_rate: cacheWriteRate, output_rate: outputRate, request_fee: requestFee }
      : { call_rate: callRate };
    if (![...Object.values(rates)].every(validAmount) || !/^[A-Z]{3}$/.test(currency)) { setError("Enter non-negative decimal rates and a three-letter currency code."); return; }
    const formula = target.type === "llm_provider" ? llmFormula() : mcpFormula();
    setBusy(true); setError("");
    try {
      let selectedPolicyId = policyId;
      let draftId: string;
      if (!selectedPolicyId) {
        const created = await costControl("create_policy", organizationId, {
          name: `${target.type === "llm_provider" ? "LLM" : "MCP"} · ${target.name} · ${target.id.slice(0, 8)}`,
          currency, policyKind: target.type === "llm_provider" ? "token" : "execution", rates, formula, chargeOn,
          changeReason: `Initial pricing for ${target.name}`,
        });
        selectedPolicyId = created.policy.id; draftId = created.version.id;
      } else {
        const latest = versions[0];
        if (latest?.status === "draft") draftId = latest.id;
        else {
          const created = await costControl("create_draft", organizationId, { policyId: selectedPolicyId, sourceVersionId: latest?.id, changeReason: `Updated pricing for ${target.name}` });
          draftId = created.version.id;
        }
        await costControl("update_draft", organizationId, { versionId: draftId, definition: { rates, chargeOn, inclusive: false }, formula, changeReason: `Updated pricing for ${target.name}` });
      }
      await costControl("publish_policy", organizationId, { versionId: draftId, reason: `Pricing saved from ${target.type === "llm_provider" ? "LLM provider" : "MCP server"} list` });
      if (!assignment) await costControl("assign_policy", organizationId, { policyId: selectedPolicyId, targetType: target.type, targetId: target.id, reason: `Assigned from ${target.name} cost settings` });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!assignment || !organizationId) return;
    setBusy(true); setError("");
    try { await costControl("retire_assignment", organizationId, { assignmentId: assignment.id, reason: `Pricing disabled from ${target?.name} cost settings` }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const applyDummyPricing = (key: keyof typeof DUMMY_LLM_PRICING) => {
    const preset = DUMMY_LLM_PRICING[key];
    setInputRate(preset.input); setCachedInputRate(preset.cached); setCacheWriteRate(preset.cacheWrite);
    setOutputRate(preset.output); setRequestFee(preset.request); if (!policyId) setCurrency("USD");
  };

  return <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>Cost · {target?.name}</DialogTitle><DialogDescription>{target?.type === "llm_provider" ? `Pricing for ${target.model || "this provider model"}. Token rates are per one million tokens.` : "Pricing for each MCP tool call on this server."} Saving creates an immutable policy version and audit record.</DialogDescription></DialogHeader>
      {busy && !policyId && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading pricing…</div>}
      {error && <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{error}</p>}
      {target?.type === "llm_provider" && <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3"><Label className="text-xs">Import dummy pricing</Label><Select onValueChange={(value: keyof typeof DUMMY_LLM_PRICING) => applyDummyPricing(value)}><SelectTrigger className="mt-1"><SelectValue placeholder="Choose GPT, Claude or Gemini example" /></SelectTrigger><SelectContent>{Object.entries(DUMMY_LLM_PRICING).map(([key, preset]) => <SelectItem key={key} value={key}>{preset.label}</SelectItem>)}</SelectContent></Select><p className="mt-1.5 text-[10px] text-muted-foreground">Illustrative test values only—not current vendor prices. Verify the provider’s price sheet or your contract before publishing.</p></div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1"><Label>Currency</Label><Input maxLength={3} value={currency} disabled={Boolean(policyId)} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label>
        <label className="space-y-1"><Label>Charge rule</Label><Select value={chargeOn} onValueChange={(value: "attempt" | "success") => setChargeOn(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="attempt">Every attempted request</SelectItem><SelectItem value="success">Successful requests only</SelectItem></SelectContent></Select></label>
        {target?.type === "llm_provider" ? <>
          <Rate label="Regular input / 1M" value={inputRate} onChange={setInputRate} />
          <Rate label="Cached input / 1M" value={cachedInputRate} onChange={setCachedInputRate} />
          <Rate label="Cache write / 1M" value={cacheWriteRate} onChange={setCacheWriteRate} />
          <Rate label="Output / 1M" value={outputRate} onChange={setOutputRate} />
          <Rate label="Fee per request" value={requestFee} onChange={setRequestFee} />
        </> : <Rate label="Cost per tool call" value={callRate} onChange={setCallRate} />}
      </div>
      <p className="text-xs text-muted-foreground">{assignment ? `Configured · policy ${policyId.slice(0, 8)} · ${versions.length} version${versions.length === 1 ? "" : "s"}` : "No cost policy is assigned yet."}</p>
      <DialogFooter className="gap-2 sm:justify-between">{assignment ? <Button type="button" variant="outline" className="text-destructive" disabled={busy} onClick={() => void remove()}><Trash2 className="mr-1 h-4 w-4" />Disable pricing</Button> : <span />}<div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" disabled={busy} onClick={() => void save()}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}Save pricing</Button></div></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function Rate({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="space-y-1"><Label>{label}</Label><Input inputMode="decimal" min="0" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
