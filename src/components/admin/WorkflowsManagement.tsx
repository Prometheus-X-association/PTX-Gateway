import { useState } from "react";
import {
  Plus, Pencil, Trash2, Play, Square, ChevronDown, ChevronUp,
  GitBranch, Code2, Bot, X, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { WorkflowBuilder } from "@/components/admin/WorkflowBuilder";
import type { WorkflowConfig, AgentWorkflow } from "@/types/workflow";
import type { AgentStub } from "@/components/admin/WorkflowBuilder";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

const NODE_TYPE_COLORS: Record<string, string> = {
  trigger:   "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  agent:     "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  plugin:    "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  condition: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
  output:    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
};

const NODE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  trigger:   ({ className }) => <Play className={className} />,
  agent:     ({ className }) => <Bot className={className} />,
  plugin:    ({ className }) => <Code2 className={className} />,
  condition: ({ className }) => <GitBranch className={className} />,
  output:    ({ className }) => <Square className={className} />,
};

const emptyWorkflow = (): WorkflowConfig => ({
  id: uid(),
  name: "New Workflow",
  description: "",
  enabled: true,
  graph: { nodes: [], edges: [] },
  createdAt: new Date().toISOString(),
});

// ─── NodePill ─────────────────────────────────────────────────────────────────

const NodePill = ({ type, label }: { type: string; label: string }) => {
  const Icon = NODE_ICONS[type];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${NODE_TYPE_COLORS[type] ?? ""}`}>
      {Icon && <Icon className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
};

// ─── Inline edit panel ────────────────────────────────────────────────────────

interface EditPanelProps {
  config: WorkflowConfig;
  agents: AgentStub[];
  onChange: (updated: WorkflowConfig) => void;
  onClose: () => void;
}

const EditPanel = ({ config, agents, onChange, onClose }: EditPanelProps) => (
  <div className="border-t bg-muted/20 p-4 space-y-4">
    <div className="flex items-center justify-between">
      <h4 className="text-sm font-semibold">Edit: {config.name}</h4>
      <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>

    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label className="text-xs">Name</Label>
        <Input
          className="h-7 text-xs"
          value={config.name}
          onChange={(e) => onChange({ ...config, name: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Input
          className="h-7 text-xs"
          value={config.description}
          placeholder="What does this workflow do?"
          onChange={(e) => onChange({ ...config, description: e.target.value })}
        />
      </div>
    </div>

    <WorkflowBuilder
      workflow={config.graph}
      agents={agents}
      onChange={(graph: AgentWorkflow) => onChange({ ...config, graph })}
    />
  </div>
);

// ─── Table row ────────────────────────────────────────────────────────────────

interface RowProps {
  config: WorkflowConfig;
  index: number;
  total: number;
  isEditing: boolean;
  agents: AgentStub[];
  onToggleEdit: () => void;
  onChange: (updated: WorkflowConfig) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (from: number, to: number) => void;
}

const WorkflowRow = ({
  config, index, total, isEditing, agents,
  onToggleEdit, onChange, onDuplicate, onRemove, onMove,
}: RowProps) => {
  const nodeCount = config.graph.nodes.length;
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
        <div className="flex flex-wrap gap-1">
          {nodeCount === 0
            ? <span className="text-[10px] text-muted-foreground italic">empty</span>
            : config.graph.nodes.slice(0, 4).map((n) => (
                <NodePill key={n.id} type={n.type} label={(n.data as { label?: string }).label ?? n.type} />
              ))
          }
          {nodeCount > 4 && (
            <span className="text-[10px] text-muted-foreground">+{nodeCount - 4}</span>
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
          <button
            title="Delete"
            onClick={onRemove}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Inline editor */}
      {isEditing && (
        <EditPanel
          config={config}
          agents={agents}
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
  agents: AgentStub[];
  onChange: (workflows: WorkflowConfig[]) => void;
}

export const WorkflowsManagement = ({ workflows, agents, onChange }: WorkflowsManagementProps) => {
  const [editingId, setEditingId] = useState<string | null>(null);

  const update = (index: number, updated: WorkflowConfig) => {
    onChange(workflows.map((w, i) => (i === index ? updated : w)));
  };

  const remove = (index: number) => {
    const next = workflows.filter((_, i) => i !== index);
    onChange(next);
    if (editingId === workflows[index].id) setEditingId(null);
  };

  const duplicate = (index: number) => {
    const src = workflows[index];
    const copy: WorkflowConfig = {
      ...src,
      id: uid(),
      name: `${src.name} (copy)`,
      enabled: false,
      createdAt: new Date().toISOString(),
    };
    const next = [...workflows];
    next.splice(index + 1, 0, copy);
    onChange(next);
  };

  const move = (from: number, to: number) => {
    const next = [...workflows];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const addNew = () => {
    const w = emptyWorkflow();
    onChange([...workflows, w]);
    setEditingId(w.id);
  };

  const activeCount = workflows.filter((w) => w.enabled).length;

  return (
    <div className="space-y-3">
      {/* Summary badges */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{workflows.length} workflow{workflows.length !== 1 ? "s" : ""}</span>
        {activeCount > 0 && (
          <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-400/40 bg-emerald-500/10">
            {activeCount} active
          </Badge>
        )}
      </div>

      {workflows.length === 0 ? (
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
          {workflows.map((wf, i) => (
            <WorkflowRow
              key={wf.id}
              config={wf}
              index={i}
              total={workflows.length}
              isEditing={editingId === wf.id}
              agents={agents}
              onToggleEdit={() => setEditingId(editingId === wf.id ? null : wf.id)}
              onChange={(updated) => update(i, updated)}
              onDuplicate={() => duplicate(i)}
              onRemove={() => remove(i)}
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
