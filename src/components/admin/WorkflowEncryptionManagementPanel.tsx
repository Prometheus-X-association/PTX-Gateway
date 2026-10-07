import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { workflowBackend } from "@/lib/workflowBackend";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";

interface EncryptionManagement {
  initialized: boolean;
  keyStorage: "supabase_vault";
  activeKey: { id: string; key_version: number; activated_at: string } | null;
  keys: Array<{ id: string; key_version: number; status: string; activated_at: string; retired_at?: string }>;
  delegates: Array<{ user_id: string; delegated_by: string; created_at: string }>;
  members: Array<{ userId: string; email?: string; full_name?: string }>;
  audit: Array<{ id: string; event_type: string; actor_user_id?: string; subject_user_id?: string; created_at: string }>;
  canDelegate: boolean;
}

export function WorkflowEncryptionManagementPanel({ organizationId }: { organizationId: string }) {
  const [status, setStatus] = useState<EncryptionManagement | null>(null);
  const [delegateUserId, setDelegateUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try { setStatus((await workflowBackend("encryption_status", organizationId)).encryption); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }, [organizationId]);
  useEffect(() => { void load(); }, [load]);
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await operation(); await load(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const rotate = () => {
    if (status?.initialized && !window.confirm("Rotate this organization's workflow encryption key? Existing versions will remain available for older data.")) return;
    void perform(async () => { await workflowBackend("encryption_rotate", organizationId); });
  };
  return <div className="space-y-4">
    <div className="flex items-start gap-3 rounded border border-emerald-500/30 bg-emerald-500/5 p-3">
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
      <div><p className="font-medium">Organization workflow encryption</p><p className="mt-1 text-xs text-muted-foreground">One versioned key protects all workflows in this organization. Supabase Vault generates and encrypts it; plaintext key material is never returned to the dashboard.</p></div>
    </div>
    {error && <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">{error}</p>}
    {!status && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading encryption status…</div>}
    {status && <>
      <div className="rounded border p-3 text-sm"><strong>{status.initialized ? `Active key version ${status.activeKey?.key_version}` : "Organization key not initialized"}</strong>{status.activeKey?.activated_at && <p className="mt-1 text-xs text-muted-foreground">Activated {new Date(status.activeKey.activated_at).toLocaleString()}.</p>}</div>
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy} onClick={rotate}>{busy ? "Working…" : status.initialized ? "Rotate organization key" : "Initialize organization key"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
      <p className="text-xs text-muted-foreground">Initialization is required once per organization, not once per workflow. Rotation affects new encrypted writes; retired versions remain decrypt-only for existing runs, artifacts, and webhook secrets.</p>
      {status.canDelegate && <div className="space-y-2 rounded border p-3 text-sm">
        <p className="font-medium">Delegated key managers</p>
        <p className="text-xs text-muted-foreground">Delegates may inspect status and rotate organization keys. They cannot reveal keys, delegate others, or access unrelated admin settings.</p>
        <div className="flex flex-wrap gap-2"><select className="min-w-64 rounded-md border bg-background px-2 py-1" value={delegateUserId} onChange={(event) => setDelegateUserId(event.target.value)}><option value="">Select an active non-admin member</option>{status.members.filter((member) => !status.delegates.some((delegate) => delegate.user_id === member.userId)).map((member) => <option key={member.userId} value={member.userId}>{member.full_name || member.email || member.userId}</option>)}</select><Button type="button" size="sm" disabled={busy || !delegateUserId} onClick={() => void perform(async () => { await workflowBackend("encryption_delegate", organizationId, { userId: delegateUserId }); setDelegateUserId(""); })}>Delegate key management</Button></div>
        {status.delegates.map((delegate) => { const member = status.members.find((candidate) => candidate.userId === delegate.user_id); return <div key={delegate.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"><span>{member?.full_name || member?.email || delegate.user_id}</span><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void perform(async () => { await workflowBackend("encryption_revoke_delegate", organizationId, { userId: delegate.user_id }); })}>Revoke</Button></div>; })}
      </div>}
      {status.audit.length > 0 && <details className="rounded border p-3 text-sm"><summary className="cursor-pointer font-medium">Encryption audit history</summary><div className="mt-2 max-h-56 space-y-1 overflow-auto">{status.audit.map((event) => <div key={event.id} className="rounded border p-2 text-xs">{event.event_type.replaceAll("_", " ")} · {new Date(event.created_at).toLocaleString()}</div>)}</div></details>}
    </>}
  </div>;
}
