import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown, ChevronRight, Eye, FileText, Loader2, Pencil, Plus, Save, ShieldCheck, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AnalyticsPagePluginType, CredentialEntry, CredentialPluginConfig } from "@/types/dataspace";
import { buildCredentialSrcdoc, createCredentialPngObjectUrl } from "@/utils/credentialPreview";

const PLUGIN_TYPES: { value: AnalyticsPagePluginType; label: string; description: string }[] = [
  {
    value: "carisma",
    label: "T-AI CARiSMA",
    description: "Compliance certificate viewer. Supports an admin HTML template, an optional gateway HTML template, and per-target JSON + PNG data pairs.",
  },
];

const pluginTypeLabel = (t?: AnalyticsPagePluginType) =>
  PLUGIN_TYPES.find((p) => p.value === t)?.label ?? "T-AI CARiSMA";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const readAsText = (file: File): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("Failed to read file"));
    r.readAsText(file);
  });

const readAsBase64 = (file: File): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(",")[1] ?? "");
    r.onerror = () => rej(new Error("Failed to read file"));
    r.readAsDataURL(file);
  });

interface ResourceOption {
  id: string;
  name: string;
  type: "software" | "serviceChain";
}

interface EntryForm {
  label: string;
  jsonFile: File | null;
  pngFile: File | null;
  targetIds: string[];
}

interface PluginForm {
  plugin_type: AnalyticsPagePluginType;
  name: string;
  description: string;
  htmlFile: File | null;
  gatewayHtmlFile: File | null;
}

const emptyEntryForm = (): EntryForm => ({ label: "", jsonFile: null, pngFile: null, targetIds: [] });
const emptyPluginForm = (): PluginForm => ({
  plugin_type: "carisma",
  name: "",
  description: "",
  htmlFile: null,
  gatewayHtmlFile: null,
});

const ChooseAnalyticsPageSettingsSection = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);
  const [plugins, setPlugins] = useState<CredentialPluginConfig[]>([]);
  const [resources, setResources] = useState<ResourceOption[]>([]);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Add-entry form
  const [addingEntryTo, setAddingEntryTo] = useState<string | null>(null);
  const [entryForm, setEntryForm] = useState<EntryForm>(emptyEntryForm());
  const [entryError, setEntryError] = useState<string | null>(null);

  // Edit-entry form
  const [editingEntryKey, setEditingEntryKey] = useState<{ pluginId: string; entryId: string } | null>(null);
  const [editEntryForm, setEditEntryForm] = useState<EntryForm>(emptyEntryForm());
  const [editEntryError, setEditEntryError] = useState<string | null>(null);

  // Inline plugin-name editing
  const [editingPluginNameId, setEditingPluginNameId] = useState<string | null>(null);
  const [editingPluginNameVal, setEditingPluginNameVal] = useState("");
  const pluginNameInputRef = useRef<HTMLInputElement>(null);

  // Replace admin/default and optional gateway HTML templates
  const [replacingHtmlFor, setReplacingHtmlFor] = useState<string | null>(null);
  const [replacingGatewayHtmlFor, setReplacingGatewayHtmlFor] = useState<string | null>(null);
  const replaceHtmlRef = useRef<HTMLInputElement>(null);

  // Add-plugin form
  const [showAddPlugin, setShowAddPlugin] = useState(false);
  const [pluginForm, setPluginForm] = useState<PluginForm>(emptyPluginForm());
  const [pluginError, setPluginError] = useState<string | null>(null);
  const htmlFileRef = useRef<HTMLInputElement>(null);
  const gatewayHtmlFileRef = useRef<HTMLInputElement>(null);

  // Rendered preview of one saved HTML + JSON + PNG entry
  const [preview, setPreview] = useState<{
    pluginId: string;
    entryId: string;
    pluginName: string;
    pluginDescription?: string;
    entryLabel: string;
    templateLabel: string;
    srcdoc: string;
  } | null>(null);
  const previewPngUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (previewPngUrlRef.current) URL.revokeObjectURL(previewPngUrlRef.current);
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!user?.organization?.id) return;
      setIsLoading(true);
      try {
        const [{ data: globalData, error: gErr }, { data: sw }, { data: chains }] = await Promise.all([
          supabase.from("global_configs").select("id, features").eq("organization_id", user.organization.id).maybeSingle(),
          supabase.from("dataspace_params").select("id, resource_name, resource_url").eq("organization_id", user.organization.id).eq("resource_type", "software"),
          supabase.from("service_chains").select("id, catalog_id, basis_information").eq("organization_id", user.organization.id),
        ]);
        if (gErr) throw gErr;
        setConfigId(globalData?.id ?? null);
        const features = isRecord(globalData?.features) ? globalData.features : {};
        const ap = isRecord(features.analyticsPage) ? features.analyticsPage : {};
        const rawPlugins: unknown = ap.credentialPlugins;
        setPlugins(Array.isArray(rawPlugins) ? (rawPlugins as CredentialPluginConfig[]) : []);
        setResources([
          ...(sw || []).map((r) => ({ id: r.id, name: r.resource_name || r.resource_url, type: "software" as const })),
          ...(chains || []).map((c) => {
            const b = isRecord(c.basis_information) ? c.basis_information : {};
            return { id: c.id, name: (typeof b.name === "string" && b.name) || c.catalog_id, type: "serviceChain" as const };
          }),
        ]);
      } catch {
        toast.error("Failed to load analytics page plugins");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [user?.organization?.id]);

  const persist = async (next: CredentialPluginConfig[]) => {
    if (!configId) { toast.error("No global config found"); return; }
    setIsSaving(true);
    try {
      const { data: existing } = await supabase.from("global_configs").select("features").eq("id", configId).maybeSingle();
      const ef = isRecord(existing?.features) ? existing.features : {};
      const ap = isRecord(ef.analyticsPage) ? ef.analyticsPage : {};
      const nextFeatures: unknown = { ...ef, analyticsPage: { ...ap, credentialPlugins: next } };
      const { error } = await supabase.from("global_configs").update({ features: nextFeatures as never }).eq("id", configId);
      if (error) throw error;
      setPlugins(next);
      toast.success("Saved");
    } catch { toast.error("Failed to save"); }
    finally { setIsSaving(false); }
  };

  // ── Plugin name editing ───────────────────────────────────────────────────

  const startEditPluginName = (plugin: CredentialPluginConfig) => {
    setEditingPluginNameId(plugin.id);
    setEditingPluginNameVal(plugin.name);
    setTimeout(() => pluginNameInputRef.current?.focus(), 0);
  };

  const savePluginName = () => {
    if (!editingPluginNameId) return;
    const trimmed = editingPluginNameVal.trim();
    if (!trimmed) return;
    void persist(plugins.map((p) => p.id === editingPluginNameId ? { ...p, name: trimmed } : p));
    setEditingPluginNameId(null);
  };

  const cancelEditPluginName = () => setEditingPluginNameId(null);

  // ── Plugin-level actions ──────────────────────────────────────────────────

  const handleAddPlugin = async () => {
    setPluginError(null);
    if (!pluginForm.name.trim()) { setPluginError("Name is required."); return; }
    if (!pluginForm.htmlFile) { setPluginError("HTML template file is required."); return; }
    setIsSaving(true);
    try {
      const [html, gatewayHtml] = await Promise.all([
        readAsText(pluginForm.htmlFile),
        pluginForm.gatewayHtmlFile ? readAsText(pluginForm.gatewayHtmlFile) : Promise.resolve(undefined),
      ]);
      const newPlugin: CredentialPluginConfig = {
        id: `plugin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        plugin_type: pluginForm.plugin_type,
        name: pluginForm.name.trim(),
        description: pluginForm.description.trim() || undefined,
        is_active: true,
        html_content: html,
        gateway_html_content: gatewayHtml,
        credentials: [],
      };
      await persist([...plugins, newPlugin]);
      setShowAddPlugin(false);
      setPluginForm(emptyPluginForm());
      if (htmlFileRef.current) htmlFileRef.current.value = "";
      if (gatewayHtmlFileRef.current) gatewayHtmlFileRef.current.value = "";
      setExpandedId(newPlugin.id);
    } catch (e) { setPluginError(e instanceof Error ? e.message : "Failed"); }
    finally { setIsSaving(false); }
  };

  const toggleActive = (id: string, val: boolean) =>
    void persist(plugins.map((p) => (p.id === id ? { ...p, is_active: val } : p)));

  const deletePlugin = (id: string) => void persist(plugins.filter((p) => p.id !== id));

  const handleReplaceHtml = async (id: string, file: File) => {
    try {
      const html = await readAsText(file);
      await persist(plugins.map((p) => (p.id === id ? { ...p, html_content: html } : p)));
      setReplacingHtmlFor(null);
    } catch { toast.error("Failed to replace HTML template"); }
  };

  const handleReplaceGatewayHtml = async (id: string, file: File) => {
    try {
      const html = await readAsText(file);
      await persist(plugins.map((p) => (p.id === id ? { ...p, gateway_html_content: html } : p)));
      setReplacingGatewayHtmlFor(null);
    } catch { toast.error("Failed to replace gateway HTML template"); }
  };

  const removeGatewayHtml = (id: string) => {
    void persist(plugins.map((p) => (p.id === id ? { ...p, gateway_html_content: undefined } : p)));
    setReplacingGatewayHtmlFor(null);
  };

  // ── Add-entry actions ─────────────────────────────────────────────────────

  const startAddEntry = (pluginId: string) => {
    setEditingEntryKey(null);
    setAddingEntryTo(pluginId);
    setEntryForm(emptyEntryForm());
    setEntryError(null);
  };

  const cancelEntryForm = () => {
    setAddingEntryTo(null);
    setEntryForm(emptyEntryForm());
    setEntryError(null);
  };

  const handleAddEntry = async (pluginId: string) => {
    setEntryError(null);
    if (!entryForm.jsonFile) { setEntryError("JSON data file is required."); return; }
    if (!entryForm.pngFile) { setEntryError("Diagram PNG is required."); return; }
    setIsSaving(true);
    try {
      const [jsonText, pngB64] = await Promise.all([readAsText(entryForm.jsonFile), readAsBase64(entryForm.pngFile)]);
      try { JSON.parse(jsonText); } catch { setEntryError("JSON file is not valid JSON."); setIsSaving(false); return; }
      const entry: CredentialEntry = {
        id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        label: entryForm.label.trim(),
        json_content: jsonText,
        png_base64: pngB64,
        target_resource_ids: entryForm.targetIds,
      };
      await persist(plugins.map((p) => p.id === pluginId ? { ...p, credentials: [...p.credentials, entry] } : p));
      cancelEntryForm();
    } catch (e) { setEntryError(e instanceof Error ? e.message : "Failed"); }
    finally { setIsSaving(false); }
  };

  // ── Edit-entry actions ────────────────────────────────────────────────────

  const startEditEntry = (pluginId: string, entry: CredentialEntry) => {
    setAddingEntryTo(null);
    setEditingEntryKey({ pluginId, entryId: entry.id });
    setEditEntryForm({ label: entry.label, jsonFile: null, pngFile: null, targetIds: [...entry.target_resource_ids] });
    setEditEntryError(null);
  };

  const cancelEditEntry = () => {
    setEditingEntryKey(null);
    setEditEntryForm(emptyEntryForm());
    setEditEntryError(null);
  };

  const saveEditEntry = async (pluginId: string, entryId: string) => {
    setEditEntryError(null);
    const plugin = plugins.find((p) => p.id === pluginId);
    const existing = plugin?.credentials.find((e) => e.id === entryId);
    if (!existing) return;
    setIsSaving(true);
    try {
      let jsonContent = existing.json_content;
      let pngContent = existing.png_base64;
      if (editEntryForm.jsonFile) {
        jsonContent = await readAsText(editEntryForm.jsonFile);
        try { JSON.parse(jsonContent); } catch { setEditEntryError("JSON file is not valid JSON."); setIsSaving(false); return; }
      }
      if (editEntryForm.pngFile) {
        pngContent = await readAsBase64(editEntryForm.pngFile);
      }
      const updated: CredentialEntry = {
        ...existing,
        label: editEntryForm.label.trim(),
        json_content: jsonContent,
        png_base64: pngContent,
        target_resource_ids: editEntryForm.targetIds,
      };
      await persist(plugins.map((p) =>
        p.id === pluginId
          ? { ...p, credentials: p.credentials.map((e) => e.id === entryId ? updated : e) }
          : p
      ));
      cancelEditEntry();
    } catch (e) { setEditEntryError(e instanceof Error ? e.message : "Failed"); }
    finally { setIsSaving(false); }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const deleteEntry = (pluginId: string, entryId: string) =>
    void persist(plugins.map((p) => p.id === pluginId ? { ...p, credentials: p.credentials.filter((e) => e.id !== entryId) } : p));

  const closePreview = () => {
    if (previewPngUrlRef.current) {
      URL.revokeObjectURL(previewPngUrlRef.current);
      previewPngUrlRef.current = null;
    }
    setPreview(null);
  };

  const openPreview = (
    plugin: CredentialPluginConfig,
    entry: CredentialEntry,
    template: "admin" | "gateway",
  ) => {
    try {
      if (previewPngUrlRef.current) URL.revokeObjectURL(previewPngUrlRef.current);
      const pngUrl = createCredentialPngObjectUrl(entry.png_base64);
      const isDedicatedGatewayTemplate = template === "gateway" && Boolean(plugin.gateway_html_content);
      const htmlContent = template === "gateway"
        ? plugin.gateway_html_content || plugin.html_content
        : plugin.html_content;
      previewPngUrlRef.current = pngUrl;
      setPreview({
        pluginId: plugin.id,
        entryId: entry.id,
        pluginName: plugin.name,
        pluginDescription: plugin.description,
        entryLabel: entry.label,
        templateLabel: template === "admin"
          ? "Admin template"
          : isDedicatedGatewayTemplate ? "Gateway template" : "Gateway preview · admin fallback",
        srcdoc: buildCredentialSrcdoc(htmlContent, entry.json_content, pngUrl),
      });
    } catch {
      toast.error("Could not open the plugin preview");
    }
  };

  const toggleEntryTarget = (id: string, checked: boolean) =>
    setEntryForm((p) => ({ ...p, targetIds: checked ? [...p.targetIds, id] : p.targetIds.filter((t) => t !== id) }));

  const toggleEditEntryTarget = (id: string, checked: boolean) =>
    setEditEntryForm((p) => ({ ...p, targetIds: checked ? [...p.targetIds, id] : p.targetIds.filter((t) => t !== id) }));

  const targetNames = (ids: string[]) =>
    ids.length === 0 ? "No targets" : resources.filter((r) => ids.includes(r.id)).map((r) => r.name).join(", ") || `${ids.length} target(s)`;

  // ── Entry form (shared layout used for both add and edit) ─────────────────

  const renderEntryForm = (opts: {
    pluginId: string;
    title: string;
    form: EntryForm;
    error: string | null;
    onChangeLabel: (v: string) => void;
    onChangeJson: (f: File | null) => void;
    onChangePng: (f: File | null) => void;
    onToggleTarget: (id: string, checked: boolean) => void;
    onSave: () => void;
    onCancel: () => void;
    isEdit?: boolean;
  }) => (
    <div className="rounded-md border px-3 py-3 space-y-3 bg-muted/10">
      <p className="text-sm font-medium">{opts.title}</p>

      <div className="space-y-1.5">
        <Label className="text-xs">
          Display name <span className="text-muted-foreground">(badge label in gateway + modal header)</span>
        </Label>
        <Input
          value={opts.form.label}
          onChange={(e) => opts.onChangeLabel(e.target.value)}
          placeholder="e.g. T-AI CARiSMA — IMC 2026"
          className="h-8 text-sm"
        />
        <p className="text-[11px] text-muted-foreground">
          Each entry can have its own name shown on the analytics card badge.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1">
            <FileText className="h-3 w-3" /> JSON data file
            {opts.isEdit
              ? <span className="text-muted-foreground font-normal">(leave empty to keep current)</span>
              : <span className="text-destructive">*</span>}
          </Label>
          <input
            type="file"
            accept=".json,application/json"
            className="w-full text-xs"
            onChange={(e) => opts.onChangeJson(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1">
            <FileText className="h-3 w-3" /> Diagram PNG
            {opts.isEdit
              ? <span className="text-muted-foreground font-normal">(leave empty to keep current)</span>
              : <span className="text-destructive">*</span>}
          </Label>
          <input
            type="file"
            accept=".png,image/png"
            className="w-full text-xs"
            onChange={(e) => opts.onChangePng(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Show on analytics options</Label>
        <div className="rounded-md border p-2 max-h-44 overflow-y-auto space-y-1.5 bg-background">
          {resources.length === 0 && (
            <p className="text-xs text-muted-foreground">No resources found.</p>
          )}
          {resources.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox
                checked={opts.form.targetIds.includes(r.id)}
                onCheckedChange={(c) => opts.onToggleTarget(r.id, c === true)}
              />
              <span className="flex-1 truncate">{r.name}</span>
              <Badge variant="outline" className="text-[10px] px-1 shrink-0">
                {r.type === "software" ? "SW" : "SC"}
              </Badge>
            </label>
          ))}
        </div>
      </div>

      {opts.error && <p className="text-xs text-destructive">{opts.error}</p>}

      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={opts.onSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
          {opts.isEdit ? "Save Changes" : "Save Entry"}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={opts.onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Choose Analytics Page — Verification Plugins
        </CardTitle>
        <CardDescription>
          Add verification plugins that appear as badge buttons on analytics option cards in the gateway.
          Each plugin has an admin HTML template, an optional gateway-specific HTML template, and multiple data entries targeted to analytics options.
          Currently supported: <strong>T-AI CARiSMA</strong> — compliance certificate viewer (HTML + JSON + PNG).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">

        {plugins.length === 0 && !showAddPlugin && (
          <p className="text-sm text-muted-foreground rounded-md border p-4 bg-muted/30">
            No verification plugins configured yet. Add a T-AI CARiSMA plugin to display compliance certificates on analytics cards.
          </p>
        )}

        {plugins.map((plugin) => {
          const isExpanded = expandedId === plugin.id;
          const typeLabel = pluginTypeLabel(plugin.plugin_type);
          const isEditingName = editingPluginNameId === plugin.id;

          return (
            <div key={plugin.id} className="rounded-lg border overflow-hidden">
              {/* Plugin header */}
              <div className="flex items-center gap-2 px-4 py-3 bg-muted/20">
                {/* Expand/collapse chevron */}
                <button
                  type="button"
                  className="shrink-0 p-0.5 rounded hover:bg-muted/50"
                  onClick={() => {
                    if (isExpanded) {
                      setExpandedId(null);
                      cancelEntryForm();
                      cancelEditEntry();
                      setReplacingHtmlFor(null);
                      setReplacingGatewayHtmlFor(null);
                    }
                    else setExpandedId(plugin.id);
                  }}
                >
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>

                {/* Plugin name — view or inline edit */}
                {isEditingName ? (
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <Input
                      ref={pluginNameInputRef}
                      value={editingPluginNameVal}
                      onChange={(e) => setEditingPluginNameVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") savePluginName();
                        if (e.key === "Escape") cancelEditPluginName();
                      }}
                      className="h-7 text-sm flex-1 min-w-0"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-primary shrink-0"
                      onClick={savePluginName}
                      disabled={isSaving}
                      title="Save name"
                    >
                      {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={cancelEditPluginName}
                      title="Cancel"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div
                    className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
                    onClick={() => {
                      if (isExpanded) {
                        setExpandedId(null);
                        cancelEntryForm();
                        cancelEditEntry();
                        setReplacingHtmlFor(null);
                        setReplacingGatewayHtmlFor(null);
                      }
                      else setExpandedId(plugin.id);
                    }}
                  >
                    <span className="font-medium text-sm truncate">{plugin.name}</span>
                    <button
                      type="button"
                      className="shrink-0 p-0.5 rounded opacity-40 hover:opacity-100 hover:bg-muted/50 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); startEditPluginName(plugin); }}
                      title="Edit plugin name"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <Badge variant="secondary" className="shrink-0 text-xs font-normal">
                      {typeLabel}
                    </Badge>
                    <Badge variant={plugin.is_active ? "default" : "outline"} className="shrink-0 text-xs">
                      {plugin.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {plugin.credentials.length} entr{plugin.credentials.length === 1 ? "y" : "ies"}
                    </Badge>
                  </div>
                )}

                {/* Right controls */}
                <Switch checked={plugin.is_active} onCheckedChange={(v) => toggleActive(plugin.id, v)} disabled={isSaving} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                  onClick={() => deletePlugin(plugin.id)}
                  disabled={isSaving}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Expanded body */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-3 space-y-4">
                  {plugin.description && (
                    <p className="text-xs text-muted-foreground">{plugin.description}</p>
                  )}

                  {/* Admin/default HTML template row */}
                  <div className="flex items-center gap-3 rounded-md border bg-muted/10 px-3 py-2">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm">Admin HTML template</span>
                      <span className="text-xs text-muted-foreground ml-2">required · gateway fallback</span>
                    </div>
                    {replacingHtmlFor === plugin.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          ref={replaceHtmlRef}
                          type="file"
                          accept=".html,text/html"
                          className="text-xs"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleReplaceHtml(plugin.id, f);
                          }}
                        />
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setReplacingHtmlFor(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setReplacingHtmlFor(plugin.id)}>
                        Replace
                      </Button>
                    )}
                  </div>

                  {/* Optional gateway-specific HTML template row */}
                  <div className="flex items-center gap-3 rounded-md border bg-muted/10 px-3 py-2">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm">Gateway HTML template</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {plugin.gateway_html_content ? "custom template active" : "optional · using admin template"}
                      </span>
                    </div>
                    {replacingGatewayHtmlFor === plugin.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="file"
                          accept=".html,text/html"
                          className="text-xs"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleReplaceGatewayHtml(plugin.id, file);
                          }}
                        />
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setReplacingGatewayHtmlFor(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setReplacingGatewayHtmlFor(plugin.id)}>
                          {plugin.gateway_html_content ? "Replace" : "Upload"}
                        </Button>
                        {plugin.gateway_html_content && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                            onClick={() => removeGatewayHtml(plugin.id)}
                            disabled={isSaving}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Data entries */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {typeLabel} data entries
                    </p>

                    {plugin.credentials.length === 0 && addingEntryTo !== plugin.id && (
                      <p className="text-xs text-muted-foreground pl-1">
                        No entries yet — each entry maps a JSON + PNG pair to specific analytics options.
                      </p>
                    )}

                    {plugin.credentials.map((entry) => {
                      const isEditingThis = editingEntryKey?.pluginId === plugin.id && editingEntryKey.entryId === entry.id;
                      if (isEditingThis) {
                        return (
                          <div key={entry.id}>
                            {renderEntryForm({
                              pluginId: plugin.id,
                              title: "Edit entry",
                              form: editEntryForm,
                              error: editEntryError,
                              onChangeLabel: (v) => setEditEntryForm((p) => ({ ...p, label: v })),
                              onChangeJson: (f) => setEditEntryForm((p) => ({ ...p, jsonFile: f })),
                              onChangePng: (f) => setEditEntryForm((p) => ({ ...p, pngFile: f })),
                              onToggleTarget: toggleEditEntryTarget,
                              onSave: () => void saveEditEntry(plugin.id, entry.id),
                              onCancel: cancelEditEntry,
                              isEdit: true,
                            })}
                          </div>
                        );
                      }
                      return (
                        <div key={entry.id} className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 rounded-md border px-3 py-2.5 bg-background">
                          <div className="space-y-0.5 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium">
                                {entry.label || <span className="text-muted-foreground italic">No display name</span>}
                              </p>
                              {entry.label && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 h-4 font-normal">badge label</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{targetNames(entry.target_resource_ids)}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-1 sm:justify-end shrink-0">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => openPreview(plugin, entry, "admin")}
                              disabled={isSaving}
                              title="Preview the admin HTML with this JSON and PNG"
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" />
                              Admin Preview
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => openPreview(plugin, entry, "gateway")}
                              disabled={isSaving}
                              title={plugin.gateway_html_content
                                ? "Preview the gateway HTML with this JSON and PNG"
                                : "Preview the gateway using the admin HTML fallback"}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" />
                              Gateway Preview
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => startEditEntry(plugin.id, entry)}
                              disabled={isSaving}
                              title="Edit entry"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => deleteEntry(plugin.id, entry.id)}
                              disabled={isSaving}
                              title="Delete entry"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}

                    {/* Add-entry form */}
                    {addingEntryTo === plugin.id ? (
                      renderEntryForm({
                        pluginId: plugin.id,
                        title: `New ${typeLabel} entry`,
                        form: entryForm,
                        error: entryError,
                        onChangeLabel: (v) => setEntryForm((p) => ({ ...p, label: v })),
                        onChangeJson: (f) => setEntryForm((p) => ({ ...p, jsonFile: f })),
                        onChangePng: (f) => setEntryForm((p) => ({ ...p, pngFile: f })),
                        onToggleTarget: toggleEntryTarget,
                        onSave: () => void handleAddEntry(plugin.id),
                        onCancel: cancelEntryForm,
                      })
                    ) : editingEntryKey?.pluginId !== plugin.id && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full h-7 text-xs border-dashed"
                        onClick={() => startAddEntry(plugin.id)}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add {typeLabel} entry
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Add-plugin form */}
        {showAddPlugin ? (
          <div className="rounded-lg border p-4 space-y-4 bg-muted/10">
            <div className="flex items-center justify-between">
              <p className="font-medium text-sm">New Verification Plugin</p>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setShowAddPlugin(false); setPluginForm(emptyPluginForm()); setPluginError(null); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Plugin Type <span className="text-destructive">*</span></Label>
              <div className="grid gap-2">
                {PLUGIN_TYPES.map((t) => (
                  <label
                    key={t.value}
                    className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                      pluginForm.plugin_type === t.value ? "border-primary bg-primary/5" : "hover:bg-muted/30"
                    }`}
                  >
                    <input
                      type="radio"
                      name="plugin_type"
                      value={t.value}
                      checked={pluginForm.plugin_type === t.value}
                      onChange={() => setPluginForm((p) => ({ ...p, plugin_type: t.value }))}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="text-sm font-medium">{t.label}</p>
                      <p className="text-xs text-muted-foreground">{t.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label>Plugin name <span className="text-destructive">*</span></Label>
                <Input
                  value={pluginForm.name}
                  onChange={(e) => setPluginForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder={pluginForm.plugin_type === "carisma" ? "e.g. T-AI CARiSMA" : "Plugin name"}
                />
                <p className="text-xs text-muted-foreground">
                  Shown as the fallback badge label on analytics cards. Individual entries can override this with their own display name.
                </p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Description</Label>
                <Textarea value={pluginForm.description} onChange={(e) => setPluginForm((p) => ({ ...p, description: e.target.value }))} rows={2} placeholder="Optional" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" /> Admin HTML template <span className="text-destructive">*</span>
                </Label>
                <input ref={htmlFileRef} type="file" accept=".html,text/html" className="w-full text-sm"
                  onChange={(e) => setPluginForm((p) => ({ ...p, htmlFile: e.target.files?.[0] ?? null }))} />
                <p className="text-xs text-muted-foreground">
                  Used for admin previews and as the gateway fallback when no gateway-specific template is uploaded.
                </p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" /> Gateway HTML template
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <input
                  ref={gatewayHtmlFileRef}
                  type="file"
                  accept=".html,text/html"
                  className="w-full text-sm"
                  onChange={(e) => setPluginForm((p) => ({ ...p, gatewayHtmlFile: e.target.files?.[0] ?? null }))}
                />
                <p className="text-xs text-muted-foreground">
                  When provided, this template is shown on gateway and embed pages. It uses the same JSON + PNG entries as the admin template.
                </p>
              </div>
            </div>

            {pluginError && <p className="text-sm text-destructive">{pluginError}</p>}

            <div className="flex gap-2">
              <Button onClick={() => void handleAddPlugin()} disabled={isSaving}>
                {isSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : <><Save className="h-4 w-4 mr-2" />Save Plugin</>}
              </Button>
              <Button variant="outline" onClick={() => { setShowAddPlugin(false); setPluginForm(emptyPluginForm()); setPluginError(null); }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="w-full" onClick={() => setShowAddPlugin(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Verification Plugin
          </Button>
        )}

      </CardContent>
    </Card>
    {preview && createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-6">
        <div className="flex flex-col bg-background w-full h-full md:rounded-lg md:border md:shadow-2xl md:w-[80vw] md:max-w-6xl md:h-[90vh]">
          <div className="flex items-center justify-between px-4 py-2 border-b bg-background shrink-0 md:rounded-t-lg">
            <div className="flex items-center gap-2 min-w-0">
              <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
              <span className="font-medium text-sm truncate">{preview.pluginName}</span>
              {preview.entryLabel && (
                <span className="text-xs text-muted-foreground hidden sm:inline truncate">
                  — {preview.entryLabel}
                </span>
              )}
              <Badge variant="outline" className="hidden sm:inline-flex shrink-0 text-[10px]">
                {preview.templateLabel}
              </Badge>
              {preview.pluginDescription && (
                <span className="text-xs text-muted-foreground hidden lg:inline truncate">
                  ({preview.pluginDescription})
                </span>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={closePreview}
              aria-label="Close plugin preview"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <iframe
            key={`${preview.pluginId}-${preview.entryId}`}
            className="flex-1 w-full border-0 md:rounded-b-lg"
            srcDoc={preview.srcdoc}
            sandbox="allow-scripts allow-same-origin allow-popups"
            title={`${preview.pluginName} — ${preview.entryLabel || "Preview"}`}
          />
        </div>
      </div>,
      document.body,
    )}
    </>
  );
};

export default ChooseAnalyticsPageSettingsSection;
