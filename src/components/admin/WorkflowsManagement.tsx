import { useEffect, useState } from "react";
import {
  Plus, Pencil, Play, Square, ChevronDown, ChevronUp,
  GitBranch, Code2, Bot, Globe2, Route, X, Copy, History, RotateCcw, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ConfirmRecycleButton, RecycleBinPanel } from "@/components/admin/RecycleBinControls";
import { recycleExpiry } from "@/components/admin/recycleBin";
import { WorkflowOperationsPanel } from "@/components/admin/WorkflowOperationsPanel";
import { WorkflowEncryptionManagementPanel } from "@/components/admin/WorkflowEncryptionManagementPanel";
import { WorkflowBuilder } from "@/components/admin/WorkflowBuilder";
import {
  ChatAvailabilitySelector,
  type ChatAvailabilityTarget,
} from "@/components/admin/ChatAvailabilitySelector";
import type { WorkflowConfig, AgentWorkflow } from "@/types/workflow";
import type { AgentStub, McpServerStub, ProviderStub, SkillStub } from "@/components/admin/WorkflowBuilder";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

const cloneWorkflow = (workflow: WorkflowConfig): WorkflowConfig =>
  typeof structuredClone === "function"
    ? structuredClone(workflow)
    : JSON.parse(JSON.stringify(workflow)) as WorkflowConfig;

const NODE_TYPE_COLORS: Record<string, string> = {
  trigger:   "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  agent:     "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  api:       "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",
  plugin:    "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  condition: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
  router: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
  output:    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
};

const NODE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  trigger:   ({ className }) => <Play className={className} />,
  agent:     ({ className }) => <Bot className={className} />,
  api:       ({ className }) => <Globe2 className={className} />,
  plugin:    ({ className }) => <Code2 className={className} />,
  condition: ({ className }) => <GitBranch className={className} />,
  router:    ({ className }) => <Route className={className} />,
  output:    ({ className }) => <Square className={className} />,
};

const emptyWorkflow = (): WorkflowConfig => ({
  id: uid(),
  name: "New Workflow",
  description: "",
  enabled: true,
  targetResources: [],
  graph: { nodes: [], edges: [] },
  createdAt: new Date().toISOString(),
});

// ─── NodePill ─────────────────────────────────────────────────────────────────

const NodePill = ({ type, label }: { type: string; label: string }) => {
  const Icon = NODE_ICONS[type];
  return (
    <span
      className={`inline-flex max-w-[120px] items-center gap-1 overflow-hidden rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${NODE_TYPE_COLORS[type] ?? ""}`}
      title={label}
    >
      {Icon && <Icon className="h-2.5 w-2.5 shrink-0" />}
      <span className="min-w-0 max-w-full truncate whitespace-nowrap">{label}</span>
    </span>
  );
};

// ─── Inline edit panel ────────────────────────────────────────────────────────

interface EditPanelProps {
  config: WorkflowConfig;
  availabilityTargets: ChatAvailabilityTarget[];
  agents: AgentStub[];
  skills: SkillStub[];
  globalProviders: ProviderStub[];
  mcpServers: McpServerStub[];
  organizationId?: string;
  onChange: (updated: WorkflowConfig) => void;
  onClose: () => void;
}

const EditPanel = ({ config, availabilityTargets, agents, skills, globalProviders, mcpServers, organizationId, onChange, onClose }: EditPanelProps) => {
  const [traceNodeId, setTraceNodeId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [viewedRevisionId, setViewedRevisionId] = useState<string | null>(null);
  const viewedRevision = config.revisionHistory?.find((revision) => revision.id === viewedRevisionId);
  const displayConfig = viewedRevision ? { ...viewedRevision.snapshot, revisionHistory: config.revisionHistory } as WorkflowConfig : config;
  const isHistorical = Boolean(viewedRevision);
  const change = (updated: WorkflowConfig) => { if (!isHistorical) onChange(updated); };
  const revisions = [...(config.revisionHistory ?? [])].sort((left, right) => right.version - left.version);
  return (
  <div className="border-t bg-muted/20 p-4 space-y-4">
    <div className="flex items-center justify-between">
      <div><h4 className="text-sm font-semibold">{isHistorical ? "View" : "Edit"}: {displayConfig.name}</h4><p className="text-[10px] text-muted-foreground">{isHistorical ? `Saved version ${viewedRevision?.version}` : config.revision ? `Current editable draft · latest saved version ${config.revision}` : "Not saved with version tracking yet"}</p></div>
      <div className="flex items-center gap-1"><Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setShowHistory(true)}><History className="h-3.5 w-3.5" />Version history</Button><button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button></div>
    </div>

    {isHistorical && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2"><div><p className="text-xs font-semibold">Read-only saved version {viewedRevision?.version}</p><p className="text-[10px] text-muted-foreground">Loading history never replaces the latest saved workflow or the current draft.</p></div><div className="flex gap-1">{revisions[0] && viewedRevisionId !== revisions[0].id && <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setViewedRevisionId(revisions[0].id)}><History className="h-3.5 w-3.5" />Latest saved</Button>}<Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setViewedRevisionId(null)}><RotateCcw className="h-3.5 w-3.5" />Current draft</Button></div></div>}

    <Dialog open={showHistory} onOpenChange={setShowHistory}><DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden"><DialogHeader><DialogTitle>Workflow version history</DialogTitle><DialogDescription>Every saved workflow change records when it was saved, what changed, and who made it.</DialogDescription></DialogHeader><div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">{revisions.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No saved versions yet. Save Agent Operations to create the first tracked version.</p> : revisions.map((revision, index) => {
      const actor = revision.savedBy.name || revision.savedBy.email || revision.savedBy.userId || "Unknown user";
      return <div key={revision.id} className="rounded-lg border p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">Version {revision.version} {index === 0 && <Badge variant="secondary" className="ml-1 text-[9px]">Latest saved</Badge>}</p><p className="text-[10px] text-muted-foreground">{new Date(revision.savedAt).toLocaleString()} · {actor}</p></div><AlertDialog><AlertDialogTrigger asChild><Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={viewedRevisionId === revision.id}>Load version</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Load version {revision.version}?</AlertDialogTitle><AlertDialogDescription>This opens the saved version in read-only mode. Your latest workflow remains unchanged and you can return to it at any time.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { setViewedRevisionId(revision.id); setShowHistory(false); }}>Load read-only version</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div><ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">{revision.changes.map((item, changeIndex) => <li key={`${revision.id}-${changeIndex}`}>{item}</li>)}</ul></div>;
    })}</div></DialogContent></Dialog>

    <fieldset disabled={isHistorical} className="space-y-4 disabled:opacity-75"><div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label className="text-xs">Name</Label>
        <Input
          className="h-7 text-xs"
          value={displayConfig.name}
          onChange={(e) => change({ ...displayConfig, name: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Input
          className="h-7 text-xs"
          value={displayConfig.description}
          placeholder="What does this workflow do?"
          onChange={(e) => change({ ...displayConfig, description: e.target.value })}
        />
      </div>
    </div>

    <ChatAvailabilitySelector
      targetIds={displayConfig.targetResources || []}
      targets={availabilityTargets}
      onChange={(targetResources) => change({ ...displayConfig, targetResources })}
    />

    <WorkflowOperationsPanel config={displayConfig} organizationId={organizationId} onChange={change} onFocusNode={setTraceNodeId} />

    <WorkflowBuilder
      workflowId={displayConfig.id}
      traceNodeId={traceNodeId}
      workflow={displayConfig.graph}
      state={displayConfig.state}
      agents={agents}
      skills={skills}
      globalProviders={globalProviders}
      mcpServers={mcpServers}
      organizationId={organizationId}
      onChange={(graph: AgentWorkflow) => change({ ...displayConfig, graph })}
    />
    </fieldset>
  </div>
);
};

// ─── Table row ────────────────────────────────────────────────────────────────

interface RowProps {
  config: WorkflowConfig;
  index: number;
  total: number;
  isEditing: boolean;
  availabilityTargets: ChatAvailabilityTarget[];
  agents: AgentStub[];
  skills: SkillStub[];
  globalProviders: ProviderStub[];
  mcpServers: McpServerStub[];
  organizationId?: string;
  onToggleEdit: () => void;
  onChange: (updated: WorkflowConfig) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (from: number, to: number) => void;
}

const WorkflowRow = ({
  config, index, total, isEditing, availabilityTargets, agents, skills, globalProviders, mcpServers, organizationId,
  onToggleEdit, onChange, onDuplicate, onRemove, onMove,
}: RowProps) => {
  const nodeCount = config.graph.nodes.length;
  const visibleNodes = config.graph.nodes.slice(0, 2);
  const hiddenNodeCount = Math.max(nodeCount - visibleNodes.length, 0);
  const nodeTypes = [...new Set(config.graph.nodes.map((n) => n.type))];

  return (
    <>
      <div className="grid grid-cols-[28px_1fr_200px_80px_60px_52px_auto] gap-2 px-3 py-2.5 items-center border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors">
        {/* Order */}
        <div className="flex flex-col gap-0 items-center">
          <button
            className="h-3.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <span className="text-[10px] text-muted-foreground tabular-nums">{index + 1}</span>
          <button
            className="h-3.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            disabled={index === total - 1}
            onClick={() => onMove(index, index + 1)}
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>

        {/* Name + description */}
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{config.name}</p>
          {config.description && (
            <p className="text-[11px] text-muted-foreground truncate">{config.description}</p>
          )}
        </div>

        {/* Node pills */}
        <div
          className="flex max-h-[46px] flex-wrap content-start items-center gap-1 overflow-hidden"
          title={config.graph.nodes.map((n) => (n.data as { label?: string }).label ?? n.type).join(" → ")}
        >
          {nodeCount === 0
            ? <span className="text-[10px] text-muted-foreground italic">empty</span>
            : visibleNodes.map((n) => (
                <NodePill key={n.id} type={n.type} label={(n.data as { label?: string }).label ?? n.type} />
              ))
          }
          {hiddenNodeCount > 0 && (
            <span className="shrink-0 text-[10px] text-muted-foreground">+{hiddenNodeCount}</span>
          )}
        </div>

        {/* Node type badges */}
        <div className="flex gap-0.5 flex-wrap justify-center">
          {nodeTypes.map((t) => {
            const Icon = NODE_ICONS[t];
            return Icon ? (
              <span key={t} title={t} className={`inline-flex items-center justify-center w-5 h-5 rounded-full border ${NODE_TYPE_COLORS[t] ?? ""}`}>
                <Icon className="h-2.5 w-2.5" />
              </span>
            ) : null;
          })}
          {nodeCount === 0 && <span className="text-[10px] text-muted-foreground">—</span>}
        </div>

        {/* Active toggle */}
        <div className="flex justify-center">
          <Switch
            checked={config.enabled}
            onCheckedChange={(v) => onChange({ ...config, enabled: v })}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 justify-end">
          <button
            title="Duplicate"
            onClick={onDuplicate}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            title={isEditing ? "Close editor" : "Edit"}
            onClick={onToggleEdit}
            className={`h-7 w-7 flex items-center justify-center rounded hover:bg-muted ${isEditing ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <ConfirmRecycleButton name={config.name} itemLabel="workflow" onConfirm={onRemove} />
        </div>
      </div>

      {/* Inline editor */}
      {isEditing && (
        <EditPanel
          config={config}
          availabilityTargets={availabilityTargets}
          agents={agents}
          skills={skills}
          globalProviders={globalProviders}
          mcpServers={mcpServers}
          organizationId={organizationId}
          onChange={onChange}
          onClose={onToggleEdit}
        />
      )}
    </>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

interface WorkflowsManagementProps {
  workflows: WorkflowConfig[];
  availabilityTargets: ChatAvailabilityTarget[];
  agents: AgentStub[];
  skills: SkillStub[];
  globalProviders: ProviderStub[];
  mcpServers: McpServerStub[];
  organizationId?: string;
  onChange: (workflows: WorkflowConfig[]) => void;
}

export const WorkflowsManagement = ({ workflows, availabilityTargets, agents, skills, globalProviders, mcpServers, organizationId, onChange }: WorkflowsManagementProps) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [showWorkflowSettings, setShowWorkflowSettings] = useState(false);
  const activeWorkflows = workflows.filter((workflow) => !workflow.deletedAt);
  const recycledWorkflows = workflows.filter((workflow) => Boolean(workflow.deletedAt));

  useEffect(() => {
    let timer: number | undefined;
    const cleanAndSchedule = () => {
      const now = Date.now();
      const retained = workflows.filter((workflow) => !workflow.deletedAt || recycleExpiry(workflow) > now);
      if (retained.length !== workflows.length) {
        onChange(retained);
        return;
      }
      const nextExpiry = Math.min(...workflows.filter((workflow) => workflow.deletedAt).map(recycleExpiry));
      if (Number.isFinite(nextExpiry)) {
        // Browser timers cap near 24.8 days, so long retention windows are
        // rechecked until the exact expiry is reached.
        timer = window.setTimeout(cleanAndSchedule, Math.max(1_000, Math.min(nextExpiry - now, 2_000_000_000)));
      }
    };
    cleanAndSchedule();
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, [workflows, onChange]);

  const update = (id: string, updated: WorkflowConfig) => {
    onChange(workflows.map((workflow) => workflow.id === id ? updated : workflow));
  };

  const recycle = (id: string) => {
    const deletedAt = new Date().toISOString();
    onChange(workflows.map((workflow) => workflow.id === id ? {
      ...workflow,
      enabled: false,
      deletedAt,
      deletedPreviousEnabled: workflow.enabled,
    } : workflow));
    if (editingId === id) setEditingId(null);
  };

  const duplicate = (id: string) => {
    const sourceIndex = workflows.findIndex((workflow) => workflow.id === id);
    const src = workflows[sourceIndex];
    if (!src || src.deletedAt) return;
    const cloned = cloneWorkflow(src);
    const copy: WorkflowConfig = {
      ...cloned,
      id: uid(),
      name: `${src.name} (copy)`,
      enabled: false,
      execution: { ...src.execution, apiEnabled: false, webhookEnabled: false },
      createdAt: new Date().toISOString(),
      deletedAt: undefined,
      deletedPreviousEnabled: undefined,
      revision: undefined,
      revisionHistory: [],
      lastSavedAt: undefined,
      lastSavedBy: undefined,
    };
    const next = [...workflows];
    next.splice(sourceIndex + 1, 0, copy);
    onChange(next);
  };

  const move = (from: number, to: number) => {
    const next = [...activeWorkflows];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange([...next, ...recycledWorkflows]);
  };

  const restore = (id: string) => onChange(workflows.map((workflow) => workflow.id === id ? {
    ...workflow,
    enabled: workflow.deletedPreviousEnabled === true,
    deletedAt: undefined,
    deletedPreviousEnabled: undefined,
  } : workflow));

  const permanentlyDelete = (id: string) => onChange(workflows.filter((workflow) => workflow.id !== id));

  const addNew = () => {
    const w = emptyWorkflow();
    onChange([...workflows, w]);
    setEditingId(w.id);
  };

  const activeCount = activeWorkflows.filter((w) => w.enabled).length;

  return (
    <div className="space-y-3">
      {/* Summary badges */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{activeWorkflows.length} workflow{activeWorkflows.length !== 1 ? "s" : ""}</span>
        {activeCount > 0 && (
          <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-400/40 bg-emerald-500/10">
            {activeCount} active
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2"><Button type="button" size="sm" variant="outline" className="gap-2" disabled={!organizationId} onClick={() => setShowWorkflowSettings(true)}><ShieldCheck className="h-4 w-4" />Agent workflow settings</Button><RecycleBinPanel title="Workflow recycle bin" itemLabel="workflow" items={recycledWorkflows} open={showRecycleBin} onToggle={() => setShowRecycleBin((value) => !value)} onRestore={restore} onDelete={permanentlyDelete} /></div>
      </div>

      <Dialog open={showWorkflowSettings} onOpenChange={setShowWorkflowSettings}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Agent workflow settings</DialogTitle><DialogDescription>Organization-wide settings shared by every agent workflow. Initialize encryption once for the organization.</DialogDescription></DialogHeader>
          {organizationId && <WorkflowEncryptionManagementPanel organizationId={organizationId} />}
        </DialogContent>
      </Dialog>

      {activeWorkflows.length === 0 ? (
        <div className="border border-dashed rounded-lg p-6 text-center space-y-2">
          <p className="text-sm text-muted-foreground">No workflows yet.</p>
          <p className="text-xs text-muted-foreground">Add one below, or load a built-in example from the canvas toolbar.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[28px_1fr_200px_80px_60px_52px_auto] gap-2 px-3 py-2 bg-muted/50 border-b text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            <span className="text-center">#</span>
            <span>Name</span>
            <span>Nodes</span>
            <span className="text-center">Types</span>
            <span className="text-center">Active</span>
            <span></span>
          </div>

          {/* Rows */}
          {activeWorkflows.map((wf, i) => (
            <WorkflowRow
              key={wf.id}
              config={wf}
              index={i}
              total={activeWorkflows.length}
              isEditing={editingId === wf.id}
              availabilityTargets={availabilityTargets}
              agents={agents}
              skills={skills}
              globalProviders={globalProviders}
              mcpServers={mcpServers}
              organizationId={organizationId}
              onToggleEdit={() => setEditingId(editingId === wf.id ? null : wf.id)}
              onChange={(updated) => update(wf.id, updated)}
              onDuplicate={() => duplicate(wf.id)}
              onRemove={() => recycle(wf.id)}
              onMove={move}
            />
          ))}
        </div>
      )}

      <Button type="button" variant="outline" size="sm" className="gap-2" onClick={addNew}>
        <Plus className="h-4 w-4" /> Add Workflow
      </Button>
    </div>
  );
};

export default WorkflowsManagement;
