import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { studioApi, emptyStudioDefinition, studioItemUrl, type StudioItem, type StudioKind } from "@/services/studioApi";
import { validateStudioDefinition } from "../../../supabase/functions/_shared/studioSchema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export default function StudioManagement({ chats = false }: { chats?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization?.id;
  const orgSlug = user?.organization?.slug || "";
  const client = useQueryClient();
  const [kind, setKind] = useState<StudioKind>(chats ? "chat" : "application");
  const [selected, setSelected] = useState<StudioItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [archive, setArchive] = useState<StudioItem | null>(null);
  const [history, setHistory] = useState<StudioItem | null>(null);
  const queryKey = ["studio-items", user?.id, orgId];
  const itemsQuery = useQuery({ queryKey, enabled: Boolean(orgId), queryFn: () => studioApi("list", orgId) });
  const items = itemsQuery.data?.items || [];
  const releases = useQuery({ queryKey: ["studio-releases", user?.id, orgId, history?.id], enabled: Boolean(history), queryFn: () => studioApi("releases", orgId, { id: history!.id }) });
  const visible = items.filter((item) => item.kind === kind);
  const applications = items.filter((item) => item.kind === "application");
  const close = () => { setCreating(false); setSelected(null); setError(""); };
  const edit = (item: StudioItem) => { setSelected(item); setCreating(false); setSlug(item.slug); setParentId(item.parent_id || ""); setSource(JSON.stringify(item.draft, null, 2)); setError(""); };
  const create = () => {
    const definition = emptyStudioDefinition(kind === "chat" ? "AI Assistant" : "Untitled " + kind);
    if (kind === "page") definition.elements = [{ id: "heading", type: "heading", label: "Welcome", content: "My application page" }, { id: "input", type: "json-input", label: "Request data", content: "{}" }, { id: "output", type: "result", label: "Results" }];
    setSelected(null); setCreating(true); setSlug(""); setParentId(applications[0]?.id || ""); setSource(JSON.stringify(definition, null, 2)); setError("");
  };
  const perform = async (action: string, item?: StudioItem | null, extra: Record<string, unknown> = {}) => {
    setBusy(true); setError("");
    try {
      const result = await studioApi(action, orgId, { ...(item ? { id: item.id, expectedRevision: item.revision } : {}), ...extra });
      await client.invalidateQueries({ queryKey });
      if (result.item && (action === "save" || action === "create" || selected?.id === item?.id)) edit(result.item);
      if (action === "delete") { if (selected?.id === item?.id) close(); setArchive(null); }
      if (action === "rollback") setHistory(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const save = () => {
    try {
      const definition = validateStudioDefinition(kind, JSON.parse(source));
      void perform(creating ? "create" : "save", selected, { kind, slug, parentId, definition });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const updateField = (key: string, value: unknown) => {
    try { setSource(JSON.stringify({ ...JSON.parse(source), [key]: value }, null, 2)); setError(""); }
    catch { setError("Correct the JSON definition before using the form fields."); }
  };
  let definition = emptyStudioDefinition("");
  try {
    const parsed = JSON.parse(source || "{}");
    definition = { ...definition, ...parsed,
      title: typeof parsed.title === "string" ? parsed.title : "",
      targetResourceId: typeof parsed.targetResourceId === "string" ? parsed.targetResourceId : "",
      agentIds: Array.isArray(parsed.agentIds) ? parsed.agentIds.filter((entry: unknown) => typeof entry === "string") : [],
      workflowIds: Array.isArray(parsed.workflowIds) ? parsed.workflowIds.filter((entry: unknown) => typeof entry === "string") : [],
      allowedOrigins: Array.isArray(parsed.allowedOrigins) ? parsed.allowedOrigins.filter((entry: unknown) => typeof entry === "string") : [],
      pageIds: Array.isArray(parsed.pageIds) ? parsed.pageIds.filter((entry: unknown) => typeof entry === "string") : [],
    };
  } catch { /* editable invalid JSON is reported on save */ }
  const dirty = selected ? source !== JSON.stringify(selected.draft, null, 2) : creating;
  const url = selected && studioItemUrl(selected, items, orgSlug);
  const embedUrl = selected ? `${window.location.origin}/chat/embed/${orgSlug}/${selected.id}#token=YOUR_EMBED_TOKEN` : "";
  const snippets = `<iframe src="${embedUrl}" title="AI assistant" style="width:100%;height:640px;border:0" referrerpolicy="strict-origin-when-cross-origin"></iframe>\n\n<script src="${window.location.origin}/ptx-chat.js" defer></script>\n<ptx-chat src="${window.location.origin}" org="${orgSlug}" drawer-id="${selected?.id || ""}" token="YOUR_EMBED_TOKEN" style="display:block;height:640px"></ptx-chat>`;
  return <div className="space-y-5">
    <Card><CardHeader><CardTitle>{chats ? "Chat Drawers" : "Applications & Pages"}</CardTitle><CardDescription>{chats ? "Manage reusable result-chat components for Studio, standalone pages and external applications." : "Create organization applications, pages and canvases. Save drafts, publish page releases, then publish the application or canvas to include them. Rollback restores its pinned page versions."}</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-3">
      {!chats && <select aria-label="Item type" className="rounded border bg-background p-2" value={kind} onChange={(event) => { close(); setKind(event.target.value as StudioKind); }}>{["application", "page", "canvas"].map((value) => <option key={value} value={value}>{value === "canvas" ? "Organization canvases" : value === "page" ? "Pages" : "Applications"}</option>)}</select>}
      <Button onClick={create} disabled={busy}>New {kind}</Button><Button variant="outline" disabled={busy} onClick={() => void itemsQuery.refetch()}>Refresh</Button>
      {!chats && <Button asChild variant="outline"><Link to={`/admin/application-preview/${orgId}`}>Workflow prototype</Link></Button>}
    </CardContent></Card>
    {(error || itemsQuery.error) && <p role="alert" className="rounded border p-3 text-destructive">{error || itemsQuery.error?.message}</p>}
    {itemsQuery.isPending && <p role="status">Loading Studio…</p>}
    {!itemsQuery.isPending && !itemsQuery.error && !visible.length && <p className="rounded border border-dashed p-6 text-muted-foreground">No {kind}s yet. Create one to begin.</p>}
    <div className="space-y-2">{visible.map((item) => <Card key={item.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="font-medium">{item.draft.title} <Badge variant={item.active ? "default" : "secondary"}>{item.active ? "Active" : "Inactive"}</Badge></div><p className="text-xs text-muted-foreground">{item.slug} · Draft revision {item.revision} · {item.published_release_id ? "Published" : "Unpublished"}{item.parent_id ? ` · ${applications.find((app) => app.id === item.parent_id)?.draft.title || "Archived application"}` : ""}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => edit(item)}>Edit</Button><Button size="sm" variant="outline" disabled={busy || !item.published_release_id} onClick={() => void perform("activate", item, { active: !item.active })}>{item.active ? "Deactivate" : "Activate"}</Button><Button size="sm" variant="outline" onClick={() => setHistory(item)}>Releases</Button>{item.active && studioItemUrl(item, items, orgSlug) && <Button size="sm" variant="outline" asChild><Link to={studioItemUrl(item, items, orgSlug)!} target="_blank" rel="noopener noreferrer">Open</Link></Button>}<Button size="sm" variant="outline" disabled={busy} onClick={() => setArchive(item)}>Delete</Button></div></CardContent></Card>)}</div>
    {(creating || selected) && <Card><CardHeader><CardTitle>{creating ? `Create ${kind}` : `Edit ${selected?.draft.title}`}</CardTitle><CardDescription>Draft changes are private to administrators. Publishing activates a new immutable release. Slugs stay stable after creation.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="studio-title">Title</Label><Input id="studio-title" value={definition.title} onChange={(event) => updateField("title", event.target.value)} /></div><div><Label htmlFor="studio-slug">URL slug</Label><Input id="studio-slug" value={slug} disabled={!creating} onChange={(event) => setSlug(event.target.value)} placeholder="skills-management" /></div></div>
      {kind === "page" && <div><Label htmlFor="studio-parent">Application</Label><select id="studio-parent" className="ml-3 rounded border bg-background p-2" value={parentId} disabled={!creating} onChange={(event) => setParentId(event.target.value)}><option value="">Select application</option>{applications.map((app) => <option key={app.id} value={app.id}>{app.draft.title}</option>)}</select><p className="mt-2 text-xs text-muted-foreground">Element types: heading, text, json-input, workflow-button (workflowId), result, html (content), chat (chatId). The visual builder follows in batch three.</p></div>}
      {kind === "canvas" && <div className="space-y-2"><Label>Included pages</Label>{items.filter((item) => item.kind === "page").map((page) => <label className="flex items-center gap-2 text-sm" key={page.id}><input type="checkbox" checked={Array.isArray(definition.pageIds) && definition.pageIds.includes(page.id)} onChange={(event) => updateField("pageIds", event.target.checked ? [...(definition.pageIds || []), page.id] : (definition.pageIds || []).filter((id) => id !== page.id))} />{page.draft.title} ({page.active ? "active" : "inactive"})</label>)}<Label htmlFor="canvas-layout">Layout</Label><select id="canvas-layout" className="ml-3 rounded border bg-background p-2" value={definition.layout} onChange={(event) => updateField("layout", event.target.value)}><option value="tabs">Tabs</option><option value="grid">Responsive panels</option></select></div>}
      {kind === "chat" && <div className="space-y-3"><div><Label htmlFor="chat-target">Target resource or service-chain ID</Label><Input id="chat-target" value={definition.targetResourceId} onChange={(event) => updateField("targetResourceId", event.target.value)} /><p className="text-xs text-muted-foreground">Optional fallback for existing resource assignments. Direct assignments below work without a resource.</p></div><div><Label htmlFor="chat-agent-ids">Agent IDs (one per line)</Label><Textarea id="chat-agent-ids" value={definition.agentIds.join("\n")} onChange={(event) => updateField("agentIds", event.target.value.split("\n").filter(Boolean))} /></div><div><Label htmlFor="chat-workflow-ids">Workflow IDs (one per line)</Label><Textarea id="chat-workflow-ids" value={definition.workflowIds.join("\n")} onChange={(event) => updateField("workflowIds", event.target.value.split("\n").filter(Boolean))} /></div><label className="flex items-center gap-2"><input type="checkbox" checked={definition.allowEmbedding} onChange={(event) => updateField("allowEmbedding", event.target.checked)} />Allow external embedding</label><div><Label htmlFor="chat-origins">Allowed parent origins (one per line)</Label><Textarea id="chat-origins" value={(definition.allowedOrigins || []).join("\n")} onChange={(event) => updateField("allowedOrigins", event.target.value.split("\n").filter(Boolean))} placeholder="https://portal.example.com" /></div><p className="text-sm text-muted-foreground">Issue or revoke organization embed tokens in Global Settings → Embed. Drawer origins must match the token origin. Shared chat configuration must also be enabled in Agent Orchestration.</p></div>}
      <div><Label htmlFor="studio-definition">Definition (JSON)</Label><Textarea id="studio-definition" className="min-h-80 font-mono text-xs" value={source} onChange={(event) => setSource(event.target.value)} /></div>
      <div className="flex flex-wrap gap-2"><Button onClick={save} disabled={busy}>{busy ? "Working…" : "Save draft"}</Button>{selected && <Button onClick={() => void perform("publish", selected)} disabled={busy || dirty}>Publish saved draft</Button>}<Button variant="outline" onClick={close} disabled={busy}>Close editor</Button></div>
      {dirty && selected && <p className="text-sm text-muted-foreground">Save draft changes before publishing.</p>}
      {url && <p className="break-all text-sm">Access URL: <a className="underline" href={url}>{window.location.origin}{url}</a></p>}
      {kind === "chat" && selected && <div className="space-y-2"><Label>External iframe and web component</Label><Textarea readOnly className="min-h-48 font-mono text-xs" value={snippets} /><p className="text-xs text-muted-foreground">Replace YOUR_EMBED_TOKEN with an issued token. Tokens are organization-scoped, as in the existing gateway embeds. Target assignments configure the UI; they are not additional token permission scopes.</p></div>}
    </CardContent></Card>}
    <Dialog open={Boolean(archive)} onOpenChange={(open) => { if (!open) setArchive(null); }}><DialogContent><DialogHeader><DialogTitle>Delete {archive?.draft.title}?</DialogTitle><DialogDescription>This archives the item and disables its published URL. Deleting an application also makes its pages unavailable. Release history is retained.</DialogDescription></DialogHeader><Button variant="destructive" disabled={busy} onClick={() => void perform("delete", archive)}>Delete item</Button>{error && <p role="alert">{error}</p>}</DialogContent></Dialog>
    <Dialog open={Boolean(history)} onOpenChange={(open) => { if (!open) setHistory(null); }}><DialogContent><DialogHeader><DialogTitle>Published releases</DialogTitle><DialogDescription>Rollback changes the published release and preserves the current draft and activation state.</DialogDescription></DialogHeader><div className="max-h-80 space-y-2 overflow-auto">{releases.isPending && <p>Loading…</p>}{releases.error && <p role="alert">{releases.error.message}</p>}{releases.data?.releases?.length === 0 && <p>No published releases.</p>}{releases.data?.releases?.map((release) => <div key={release.id} className="flex items-center justify-between gap-2 rounded border p-2"><span className="text-sm">Revision {release.revision} · {new Date(release.created_at).toLocaleString()}</span><Button size="sm" disabled={busy || history?.published_release_id === release.id} onClick={() => void perform("rollback", history, { releaseId: release.id })}>{history?.published_release_id === release.id ? "Current" : "Restore"}</Button></div>)}</div>{error && <p role="alert">{error}</p>}</DialogContent></Dialog>
  </div>;
}
