import { useCallback, useEffect, useState } from "react";
import { browserAccessRequest } from "@/lib/browserAccess";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
interface Credential { id: string; username: string; valid_from: string | null; expires_at: string | null; revoked: boolean }
interface AccessLog { id: string; created_at: string; event: string; username: string | null; ip_address: string | null; user_agent: string | null; url: string | null; referrer: string | null }
const localDate = (date: string | null) => {
  if (!date) return "";
  const d = new Date(date);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const formatDate = (date: string | null) => date ? new Date(date).toLocaleString() : "No limit";
export default function BrowserAccessManagement({ slug }: { slug: string }) {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([browserAccessRequest(slug, { action: "list" }), browserAccessRequest(slug, { action: "logs" })]);
      if (results[0].status === "fulfilled") setCredentials(results[0].value.items);
      if (results[1].status === "fulfilled") setLogs(results[1].value.items);
      const failure = results.find(r => r.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      setLoadError("");
    } catch (e) { setLoadError(e instanceof Error ? e.message : "Failed to load browser access"); }
    finally { setLoading(false); }
  }, [slug]);
  useEffect(() => { void refresh(); }, [refresh]);
  const reset = () => { setEditing(null); setUsername(""); setPassword(""); setStart(""); setEnd(""); };
  const mutate = async (body: Record<string, unknown>, message: string) => {
    setBusy(true);
    try { await browserAccessRequest(slug, body); toast.success(message); reset(); await refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Request failed"); }
    finally { setBusy(false); }
  };
  const status = (c: Credential) => c.revoked ? "Revoked" : c.expires_at && Date.parse(c.expires_at) <= Date.now() ? "Expired" : c.valid_from && Date.parse(c.valid_from) > Date.now() ? "Scheduled" : "Active";
  const download = () => {
    const blob = new Blob([logs.map(log => JSON.stringify(log)).join("\n") + "\n"], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${slug}-browser-access-${new Date().toISOString().slice(0, 10)}.jsonl`; a.click(); URL.revokeObjectURL(url);
  };
  return <Card><CardHeader><CardTitle>Browser access credentials</CardTitle><CardDescription>Manage access for visitors who open the gateway URL directly. These credentials are separate from administrator accounts and embed tokens. Changes invalidate existing sessions. Sessions last up to eight hours.</CardDescription></CardHeader><CardContent className="space-y-6">
    {loadError && <p role="alert" className="text-destructive">{loadError}</p>}
    <form className="space-y-4 rounded-lg border p-4" onSubmit={e => {
      e.preventDefault();
      if (start && end && new Date(start) >= new Date(end)) { toast.error("Access end must be after start"); return; }
      void mutate({ action: "save", id: editing || undefined, username, password: password || undefined, valid_from: start ? new Date(start).toISOString() : null, expires_at: end ? new Date(end).toISOString() : null }, editing ? "Credential updated" : "Credential added");
    }}>
      <p className="font-medium">{editing ? "Edit credential" : "Add credential"}</p>
      <div className="grid sm:grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="browser-access-username">Username</Label><Input id="browser-access-username" required maxLength={100} autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} /></div><div className="space-y-2"><Label htmlFor="browser-access-password">{editing ? "New password (leave empty to keep current)" : "Password"}</Label><Input id="browser-access-password" type="password" autoComplete="new-password" required={!editing} minLength={12} value={password} onChange={e => setPassword(e.target.value)} /><p className="text-xs text-muted-foreground">At least 12 characters, at most 72 bytes. Passwords cannot be viewed after saving.</p></div><div className="space-y-2"><Label htmlFor="browser-access-start">Access starts (optional)</Label><Input id="browser-access-start" type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></div><div className="space-y-2"><Label htmlFor="browser-access-end">Access ends (optional)</Label><Input id="browser-access-end" type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></div></div>
      <p className="text-xs text-muted-foreground">Dates use your browser's local time zone. Leave both dates empty for access without a date limit.</p>
      <div className="flex gap-2"><Button type="submit" disabled={busy || loading}>{busy ? "Saving…" : editing ? "Save credential" : "Add credential"}</Button>{editing && <Button type="button" variant="outline" onClick={reset} disabled={busy}>Cancel</Button>}</div>
    </form>
    <div className="space-y-3">{loading && <p className="text-muted-foreground">Loading access details…</p>}{!loading && !credentials.length && <p className="text-muted-foreground">No browser credentials yet. Add a credential before enabling private access.</p>}{credentials.map(c => <div key={c.id} className="border rounded-lg p-4 flex flex-wrap items-center justify-between gap-4"><div><p className="font-medium">{c.username} <Badge variant="outline">{status(c)}</Badge></p><p className="text-xs text-muted-foreground">Starts: {formatDate(c.valid_from)} · Ends: {formatDate(c.expires_at)}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => { setEditing(c.id); setUsername(c.username); setPassword(""); setStart(localDate(c.valid_from)); setEnd(localDate(c.expires_at)); }}>Edit</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void mutate({ action: "revoke", id: c.id, revoked: !c.revoked }, c.revoked ? "Access restored" : "Access revoked")}>{c.revoked ? "Restore" : "Revoke"}</Button><AlertDialog><AlertDialogTrigger asChild><Button size="sm" variant="destructive" disabled={busy}>Delete</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete credential for {c.username}?</AlertDialogTitle><AlertDialogDescription>This removes the credential and invalidates its sessions. Access logs are retained.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void mutate({ action: "delete", id: c.id }, "Credential deleted")}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></div>)}</div>
    <div className="space-y-3"><div className="flex flex-wrap justify-between gap-2 items-center"><h3 className="font-medium">Browser access log</h3><div className="flex gap-2"><Button variant="outline" size="sm" disabled={loading || busy} onClick={() => void refresh()}>Refresh</Button><Button variant="outline" size="sm" disabled={!logs.length || loading} onClick={download}>Download log</Button></div></div><p className="text-xs text-muted-foreground">Latest 1,000 events. Records visits, sign-ins, failed attempts, sign-outs and credential changes, with source IP, browser, URL and referrer. Query strings are excluded.</p><div className="overflow-x-auto max-h-96"><table className="w-full text-sm"><thead><tr className="text-left border-b">{["Time", "Event", "Username", "Source IP", "URL / Referrer", "Browser"].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{logs.map(log => <tr key={log.id} className="border-b align-top"><td className="p-2 whitespace-nowrap">{formatDate(log.created_at)}</td><td className="p-2">{log.event}</td><td className="p-2">{log.username || "—"}</td><td className="p-2">{log.ip_address || "—"}</td><td className="p-2 break-all">{log.url || "—"}<div className="text-muted-foreground text-xs">{log.referrer}</div></td><td className="p-2 text-xs break-all">{log.user_agent || "—"}</td></tr>)}</tbody></table>{!logs.length && !loading && <p className="py-4 text-muted-foreground">No access events recorded.</p>}</div></div>
  </CardContent></Card>;
}
