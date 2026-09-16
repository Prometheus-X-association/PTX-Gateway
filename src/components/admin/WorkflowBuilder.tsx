import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import {
  ReactFlow, Background, Controls, MiniMap,
  addEdge, applyNodeChanges, applyEdgeChanges, reconnectEdge,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection, type ReactFlowInstance,
  Handle, Position, MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  Play, Plus, Trash2, X, Code2, GitBranch,
  Bot, Square, ChevronRight, BookOpen, RotateCcw, GripVertical, Workflow, Settings2, Link2, Maximize2, Minimize2,
  FlaskConical, Loader2, CircleStop, CheckCircle2, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type {
  AgentWorkflow, WorkflowNode, WorkflowEdge,
  TriggerNodeData, AgentNodeData, PluginNodeData, ConditionNodeData, OutputNodeData, WorkflowStepResult,
} from "@/types/workflow";
import { executeWorkflow } from "@/lib/workflowExecutor";
import { supabase } from "@/integrations/supabase/client";

// ─── Agent stub (only what WorkflowBuilder needs from LlmAgent) ──────────────

export interface AgentStub {
  id: string;
  name: string;
  description: string;
  expectedOutput: string;
}

export interface SkillStub {
  id: string;
  name: string;
  description: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

const NODE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  trigger:   ({ className }) => <Play className={className} />,
  agent:     ({ className }) => <Bot className={className} />,
  plugin:    ({ className }) => <Code2 className={className} />,
  condition: ({ className }) => <GitBranch className={className} />,
  output:    ({ className }) => <Square className={className} />,
};

const NODE_LIBRARY = [
  { type: "trigger", icon: Play, label: "Trigger", description: "Starts the workflow", color: "text-violet-600", iconBg: "bg-violet-500/10" },
  { type: "agent", icon: Bot, label: "AI Agent", description: "Runs an agent or skill", color: "text-sky-600", iconBg: "bg-sky-500/10" },
  { type: "plugin", icon: Code2, label: "JavaScript", description: "Transforms data safely", color: "text-amber-600", iconBg: "bg-amber-500/10" },
  { type: "condition", icon: GitBranch, label: "Condition", description: "Branches the workflow", color: "text-rose-500", iconBg: "bg-rose-500/10" },
  { type: "output", icon: Square, label: "Output", description: "Renders the final result", color: "text-emerald-600", iconBg: "bg-emerald-500/10" },
] as const;

const NODE_ACCENTS: Record<string, string> = {
  trigger: "border-l-violet-500",
  agent: "border-l-sky-500",
  plugin: "border-l-amber-500",
  condition: "border-l-rose-500",
  output: "border-l-emerald-500",
};

const EDGE_STYLE = { stroke: "hsl(var(--muted-foreground))", strokeWidth: 1.6 };
const EDGE_MARKER = { type: MarkerType.ArrowClosed, color: "hsl(var(--muted-foreground))" };

type TestNodeStatus = "running" | "success" | "error";
interface TestNodeRun {
  status: TestNodeStatus;
  input: unknown;
  output?: unknown;
  error?: string;
  durationMs?: number;
  visits: number;
}

const debugJson = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === undefined) return "No data";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
};

const pickDataPath = (value: unknown, path: string): unknown => {
  const normalized = path.trim().replace(/^\$\.?/, "");
  if (!normalized) return value;
  let current = value;
  for (const part of normalized.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

// ─── Custom Node renderer ─────────────────────────────────────────────────────

interface FlowNodeProps {
  id: string;
  data: Record<string, unknown>;
  type: string;
  selected: boolean;
}

const FlowNode = ({ data, type, selected }: FlowNodeProps) => {
  const Icon = NODE_ICONS[type] ?? NODE_ICONS.agent;
  const label = (data.label as string) || type;
  const isCondition = type === "condition";
  const isTrigger = type === "trigger";
  const isOutput = type === "output";
  const testStatus = data.__testStatus as TestNodeStatus | undefined;

  return (
    <div
      className={`rounded-lg border border-l-4 bg-background shadow-sm min-w-[180px] max-w-[220px] cursor-pointer transition-all
        ${NODE_ACCENTS[type] ?? NODE_ACCENTS.agent} ${selected ? "ring-2 ring-primary/60 shadow-md" : "hover:shadow-md"}`}
    >
      {/* Input handle — all except trigger */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-2.5 !h-2.5 !bg-background !border-2 !border-muted-foreground"
        />
      )}

      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <span className={`flex h-6 w-6 items-center justify-center rounded-md ${NODE_LIBRARY.find((item) => item.type === type)?.iconBg ?? "bg-muted"}`}>
          <Icon className={`h-3.5 w-3.5 shrink-0 ${NODE_LIBRARY.find((item) => item.type === type)?.color ?? "text-foreground"}`} />
        </span>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{type}</p>
          <p className="truncate text-xs font-semibold text-foreground">{label}</p>
        </div>
        {testStatus && (
          <span className={`ml-auto h-2.5 w-2.5 shrink-0 rounded-full ${testStatus === "running" ? "animate-pulse bg-sky-500" : testStatus === "success" ? "bg-emerald-500" : "bg-destructive"}`} title={`Test: ${testStatus}`} />
        )}
      </div>

      <div className="px-3 py-2 text-foreground">

      {type === "agent" && (
        <p className="text-[10px] text-muted-foreground truncate">
          {(data as AgentNodeData).mode === "inline"
            ? ((data as AgentNodeData).inlineName || "inline agent")
            : ((data as AgentNodeData).agentId || "no agent selected")}
        </p>
      )}
      {type === "plugin" && (
        <p className="text-[10px] text-muted-foreground truncate">{(data as PluginNodeData).description || "Sandboxed JS transform"}</p>
      )}
      {type === "condition" && (
        <p className="text-[10px] text-muted-foreground font-mono truncate">{(data as ConditionNodeData).expression}</p>
      )}
      {type === "trigger" && (
        <Badge variant="outline" className="text-[9px] px-1.5 py-0">
          {(data as TriggerNodeData).triggerType === "on_load" ? "auto" : "manual"}
        </Badge>
      )}
      {isOutput && <p className="text-[10px] text-muted-foreground">Final workflow response</p>}
      </div>

      {/* Output handle(s) */}
      {!isOutput && !isCondition && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-2.5 !h-2.5 !bg-background !border-2 !border-muted-foreground"
        />
      )}
      {isCondition && (
        <>
          <Handle id="true"  type="source" position={Position.Bottom} style={{ left: "30%" }}
            className="!w-3 !h-3 !bg-emerald-400 !border-2 !border-emerald-600" />
          <div className="text-[9px] flex justify-between mt-1 px-0.5 opacity-60">
            <span>✓ true</span><span>✗ false</span>
          </div>
          <Handle id="false" type="source" position={Position.Bottom} style={{ left: "70%" }}
            className="!w-3 !h-3 !bg-rose-400 !border-2 !border-rose-600" />
        </>
      )}
    </div>
  );
};

const nodeTypes = {
  trigger:   (p: FlowNodeProps) => <FlowNode {...p} type="trigger" />,
  agent:     (p: FlowNodeProps) => <FlowNode {...p} type="agent" />,
  plugin:    (p: FlowNodeProps) => <FlowNode {...p} type="plugin" />,
  condition: (p: FlowNodeProps) => <FlowNode {...p} type="condition" />,
  output:    (p: FlowNodeProps) => <FlowNode {...p} type="output" />,
};

// ─── Shared schema row ────────────────────────────────────────────────────────

const SchemaRow = ({
  inputSchema, outputSchema,
  onInputChange, onOutputChange,
}: {
  inputSchema?: string; outputSchema?: string;
  onInputChange: (v: string) => void; onOutputChange: (v: string) => void;
}) => (
  <div className="rounded-lg border bg-muted/30 p-2.5 space-y-2">
    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Data contract</p>
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">Expects (input)</Label>
      <Input className="h-6 text-[10px] font-mono" value={inputSchema ?? ""} placeholder="e.g. Array<{id, skill}>"
        onChange={(e) => onInputChange(e.target.value)} />
    </div>
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">Produces (output)</Label>
      <Input className="h-6 text-[10px] font-mono" value={outputSchema ?? ""} placeholder="e.g. Array<{skill, level, sources}>"
        onChange={(e) => onOutputChange(e.target.value)} />
    </div>
  </div>
);

// ─── Property panels ──────────────────────────────────────────────────────────

const TriggerPanel = ({ node, onChange }: { node: WorkflowNode; onChange: (d: TriggerNodeData) => void }) => {
  const d = node.data as TriggerNodeData;
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Label</Label>
        <Input className="h-7 text-xs" value={d.label} onChange={(e) => onChange({ ...d, label: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Trigger type</Label>
        <Select value={d.triggerType} onValueChange={(v) => onChange({ ...d, triggerType: v as TriggerNodeData["triggerType"] })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">Manual — user clicks Run</SelectItem>
            <SelectItem value="on_load">Auto — fires when chat opens</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Default prompt <span className="text-muted-foreground">(pre-fills chat input)</span></Label>
        <Textarea className="text-xs min-h-[56px]" rows={3} value={d.defaultPrompt ?? ""}
          placeholder="e.g. Analyse the skill levels based on the uploaded document"
          onChange={(e) => onChange({ ...d, defaultPrompt: e.target.value || undefined })} />
      </div>
      <SchemaRow
        outputSchema={d.outputSchema}
        onInputChange={() => {}}
        onOutputChange={(v) => onChange({ ...d, outputSchema: v || undefined })}
      />
    </div>
  );
};

const OUTPUT_TYPE_OPTIONS = [
  { value: "auto", label: "Auto / Skill-controlled" },
  { value: "text", label: "Text" },
  { value: "json", label: "JSON" },
  { value: "html", label: "HTML" },
  { value: "mixed", label: "Mixed" },
] as const;

const AgentPanel = ({ node, agents, skills, onChange }: { node: WorkflowNode; agents: AgentStub[]; skills: SkillStub[]; onChange: (d: AgentNodeData) => void }) => {
  const d = node.data as AgentNodeData;
  const mode = d.mode ?? "existing";
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Label</Label>
        <Input className="h-7 text-xs" value={d.label} onChange={(e) => onChange({ ...d, label: e.target.value })} />
      </div>

      {/* Mode toggle */}
      <div className="flex rounded-lg border overflow-hidden text-[11px] font-medium">
        {(["existing", "inline"] as const).map((m) => (
          <button key={m} onClick={() => onChange({ ...d, mode: m })}
            className={`flex-1 py-1.5 transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>
            {m === "existing" ? "Use existing agent" : "Create inline agent"}
          </button>
        ))}
      </div>

      {mode === "existing" ? (
        <>
          <div className="space-y-1">
            <Label className="text-xs">Agent</Label>
            {agents.length === 0 ? (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 border border-amber-400/30 bg-amber-500/10 rounded-lg p-2">
                No enabled agents found. Create one in the Agents section above, or switch to "Create inline agent".
              </p>
            ) : (
              <Select value={d.agentId ?? ""} onValueChange={(v) => onChange({ ...d, agentId: v })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select agent…" /></SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="font-medium">{a.name}</span>
                      {a.description && <span className="text-muted-foreground ml-1 text-[10px]">— {a.description}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1">
            <Label className="text-xs">Agent name <span className="text-muted-foreground">(display only)</span></Label>
            <Input className="h-7 text-xs" value={d.inlineName ?? ""} placeholder="e.g. Skill Level Assessor"
              onChange={(e) => onChange({ ...d, inlineName: e.target.value || undefined })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Output type</Label>
            {(d.skillIds ?? []).length > 0 && (
              <p className="rounded-md border bg-muted px-2 py-1.5 text-[10px] text-muted-foreground">
                Skill-controlled; the most recently activated skill overrides the <strong>{d.inlineFallbackOutputType ?? "text"}</strong> fallback.
              </p>
            )}
            <div className={`flex gap-1 flex-wrap ${(d.skillIds ?? []).length > 0 ? "opacity-55" : ""}`}>
              {OUTPUT_TYPE_OPTIONS.map(({ value, label }) => (
                <button key={value} disabled={(d.skillIds ?? []).length > 0 || value === "auto"}
                  onClick={() => onChange({ ...d, inlineOutputType: value, inlineFallbackOutputType: value === "auto" ? d.inlineFallbackOutputType : value })}
                  className={`px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors
                    ${(d.inlineOutputType ?? "text") === value
                      ? "bg-sky-500/20 border-sky-500/40 text-sky-700 dark:text-sky-300"
                      : "hover:bg-muted text-muted-foreground border-border"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">System prompt</Label>
            <Textarea className="text-xs font-mono min-h-[100px]" rows={6} spellCheck={false}
              value={d.inlineSystemPrompt ?? ""}
              placeholder="You are an expert at… Respond with a JSON array of…"
              onChange={(e) => onChange({ ...d, inlineSystemPrompt: e.target.value || undefined })} />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Agent skills</Label>
            {skills.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">No enabled skills are available.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {skills.map((skill) => {
                  const selected = (d.skillIds ?? []).includes(skill.id);
                  return <button key={skill.id} type="button" title={skill.description}
                    onClick={() => {
                      const skillIds = selected ? (d.skillIds ?? []).filter((id) => id !== skill.id) : [...(d.skillIds ?? []), skill.id];
                      if (skillIds.length > 0) {
                        const fallback = d.inlineOutputType === "auto" ? (d.inlineFallbackOutputType ?? "text") : (d.inlineOutputType ?? "text");
                        onChange({ ...d, skillIds, inlineOutputType: "auto", inlineFallbackOutputType: fallback });
                      } else {
                        onChange({ ...d, skillIds, inlineOutputType: d.inlineFallbackOutputType ?? "text" });
                      }
                    }}
                    className={`rounded-full border px-2.5 py-1 text-[10px] transition-colors ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary"}`}>
                    {skill.name}
                  </button>;
                })}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">Selected playbooks are injected into this inline agent when the node runs.</p>
          </div>
        </>
      )}

      <div className="space-y-1">
        <Label className="text-xs">Prompt override <span className="text-muted-foreground">(leave empty to use the chat message)</span></Label>
        <Textarea className="text-xs min-h-[52px]" rows={3} value={d.promptOverride ?? ""}
          placeholder="e.g. Based on prevOutput, summarise each skill in one sentence"
          onChange={(e) => onChange({ ...d, promptOverride: e.target.value || undefined })} />
      </div>
      <div className="flex items-center justify-between">
        <Label className="text-xs">Inject previous node output into context</Label>
        <Switch checked={d.passPrevOutput} onCheckedChange={(v) => onChange({ ...d, passPrevOutput: v })} />
      </div>
      <SchemaRow
        inputSchema={d.inputSchema} outputSchema={d.outputSchema}
        onInputChange={(v) => onChange({ ...d, inputSchema: v || undefined })}
        onOutputChange={(v) => onChange({ ...d, outputSchema: v || undefined })}
      />
    </div>
  );
};

const PluginPanel = ({ node, onChange }: { node: WorkflowNode; onChange: (d: PluginNodeData) => void }) => {
  const d = node.data as PluginNodeData;
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Label</Label>
        <Input className="h-7 text-xs" value={d.label} onChange={(e) => onChange({ ...d, label: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Input className="h-7 text-xs" value={d.description ?? ""} placeholder="What does this plugin do?"
          onChange={(e) => onChange({ ...d, description: e.target.value || undefined })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">JavaScript code</Label>
        <p className="text-[10px] text-muted-foreground">
          Receives <code className="bg-muted px-0.5 rounded">input</code> = <code className="bg-muted px-0.5 rounded">{"{ result, docText, prevOutput, getNodeOutput }"}</code>. Return the transformed value.
          Runs in an isolated sandbox without DOM, storage, or network access and has a 2-second execution limit.
        </p>
        <Textarea className="text-xs font-mono min-h-[120px]" rows={7} spellCheck={false}
          value={d.code}
          placeholder={"// extract skill labels from result nodes\nconst nodes = Array.isArray(input.result?.nodes) ? input.result.nodes : [];\nreturn nodes.map(n => ({ id: n.id, skill: (n.label || n.id).replace(/_/g,' ') }));"}
          onChange={(e) => onChange({ ...d, code: e.target.value })} />
      </div>
      <SchemaRow
        inputSchema={d.inputSchema} outputSchema={d.outputSchema}
        onInputChange={(v) => onChange({ ...d, inputSchema: v || undefined })}
        onOutputChange={(v) => onChange({ ...d, outputSchema: v || undefined })}
      />
    </div>
  );
};

const ConditionPanel = ({ node, onChange }: { node: WorkflowNode; onChange: (d: ConditionNodeData) => void }) => {
  const d = node.data as ConditionNodeData;
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Label</Label>
        <Input className="h-7 text-xs" value={d.label} onChange={(e) => onChange({ ...d, label: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Condition expression</Label>
        <p className="text-[10px] text-muted-foreground">
          Sandboxed JS expression on <code className="bg-muted px-0.5 rounded">prevOutput</code>. Truthy → <span className="text-emerald-600">true</span> edge, falsy → <span className="text-rose-500">false</span> edge.
        </p>
        <Input className="h-7 text-xs font-mono" value={d.expression}
          placeholder="Array.isArray(prevOutput) && prevOutput.length > 0"
          onChange={(e) => onChange({ ...d, expression: e.target.value })} />
      </div>
      <div className="rounded-lg border bg-muted/40 p-2 space-y-0.5">
        <div className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
          <ChevronRight className="h-3 w-3" /> <strong>True</strong> — left (green) handle
        </div>
        <div className="flex items-center gap-1 text-[10px] text-rose-500 dark:text-rose-400">
          <ChevronRight className="h-3 w-3" /> <strong>False</strong> — right (red) handle
        </div>
      </div>
      {/* Loop range — enforced by executor on every condition visit, no agent cooperation needed */}
      <div className="space-y-1">
        <Label className="text-xs">
          Loop range <span className="text-muted-foreground">(0-based indices, optional)</span>
        </Label>
        <div className="flex items-center gap-2">
          <div className="flex-1 space-y-0.5">
            <span className="text-[10px] text-muted-foreground">Start (inclusive)</span>
            <Input
              type="number" min={0} className="h-6 text-[10px]"
              placeholder="0"
              value={d.loopStart ?? ""}
              onChange={(e) => onChange({ ...d, loopStart: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          </div>
          <span className="text-muted-foreground text-xs mt-4">–</span>
          <div className="flex-1 space-y-0.5">
            <span className="text-[10px] text-muted-foreground">End (inclusive, empty = all)</span>
            <Input
              type="number" min={0} className="h-6 text-[10px]"
              placeholder="all"
              value={d.loopEnd ?? ""}
              onChange={(e) => onChange({ ...d, loopEnd: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          e.g. 0–2 = first 3 items · 3–8 = items 3 to 8 · 5–5 = item 5 only
        </p>
      </div>
      <SchemaRow
        inputSchema={d.inputSchema}
        onInputChange={(v) => onChange({ ...d, inputSchema: v || undefined })}
        onOutputChange={() => {}}
      />
    </div>
  );
};

const RENDER_OPTIONS: Array<{ value: OutputNodeData["renderAs"]; label: string; desc: string }> = [
  { value: "auto",          label: "Auto",          desc: "Detect HTML/JSON/text automatically" },
  { value: "html",          label: "HTML",          desc: "Force render as iframe visualization" },
  { value: "json",          label: "JSON",          desc: "Render as formatted JSON viewer" },
  { value: "text",          label: "Text",          desc: "Render as markdown prose" },
  { value: "update_result", label: "Update result", desc: "Replace the result data panel with this output" },
];

const OutputPanel = ({ node, onChange }: { node: WorkflowNode; onChange: (d: OutputNodeData) => void }) => {
  const d = node.data as OutputNodeData;
  const renderAs = d.renderAs ?? "auto";
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Label</Label>
        <Input className="h-7 text-xs" value={d.label} onChange={(e) => onChange({ ...d, label: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Render output as</Label>
        <div className="space-y-1">
          {RENDER_OPTIONS.map(({ value, label, desc }) => (
            <button key={value} onClick={() => onChange({ ...d, renderAs: value })}
              className={`w-full flex items-start gap-2 px-2.5 py-2 rounded-lg border text-left transition-colors
                ${renderAs === value ? "bg-emerald-500/10 border-emerald-500/40" : "hover:bg-muted border-transparent"}`}>
              <span className={`mt-0.5 w-3 h-3 rounded-full border-2 shrink-0 flex items-center justify-center
                ${renderAs === value ? "border-emerald-500 bg-emerald-500" : "border-muted-foreground"}`}>
                {renderAs === value && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </span>
              <div>
                <p className="text-xs font-medium">{label}</p>
                <p className="text-[10px] text-muted-foreground">{desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
      {renderAs === "update_result" && (
        <div className="space-y-1">
          <Label className="text-xs">Transform code <span className="text-muted-foreground">(optional sandboxed JS to reshape prevOutput before replacing result data)</span></Label>
          <Textarea className="text-xs font-mono min-h-[72px]" rows={4} spellCheck={false}
            value={d.transformCode ?? ""}
            placeholder={"// e.g. parse JSON string → object\nreturn typeof prevOutput === 'string' ? JSON.parse(prevOutput) : prevOutput;"}
            onChange={(e) => onChange({ ...d, transformCode: e.target.value || undefined })} />
        </div>
      )}
      <SchemaRow
        inputSchema={d.inputSchema}
        onInputChange={(v) => onChange({ ...d, inputSchema: v || undefined })}
        onOutputChange={() => {}}
      />
    </div>
  );
};

// ─── Example workflows ────────────────────────────────────────────────────────

interface ExampleWorkflow {
  id: string;
  name: string;
  description: string;
  workflow: AgentWorkflow;
}

// Shared helper used by n-init and n-accumulate to read skill list from result data.
// Handles both flat (result.nodes) and nested (result.data.nodes) structures.
const READ_ITEMS_CODE = `
function readItems(result) {
  const raw = result;
  const rawNodes = Array.isArray(raw?.nodes) ? raw.nodes
    : Array.isArray(raw?.data?.nodes) ? raw.data.nodes
    : Array.isArray(raw) ? raw : [];
  return rawNodes
    .map(n => ({ id: String(n.id ?? ''), skill: String(n.label ?? n.id ?? '').replace(/[_-]+/g,' ').trim() }))
    .filter(s => s.skill.length > 0);
}`.trim();

// Helper to parse potentially string-encoded agent JSON output
const PARSE_AGENT_JSON = `
function parseAgentJSON(val) {
  if (typeof val !== 'string') return val;
  // strip markdown fences if present
  const s = val.replace(/^\`\`\`(?:json)?\\n?/,'').replace(/\\n?\`\`\`$/,'').trim();
  try { return JSON.parse(s); } catch(e) { return {}; }
}`.trim();

const EXAMPLE_WORKFLOWS: ExampleWorkflow[] = [
  {
    id: "skill-expertise-analysis",
    name: "Skill Expertise Analysis",
    description: "Loops over every skill node from result data. Per skill: finds evidence sentences from the uploaded document, writes a description, assigns a Bloom's level. Renders results as an HTML table.",
    workflow: {
      nodes: [
        // ── 1. TRIGGER ──────────────────────────────────────────────────────
        {
          id: "n-trigger",
          type: "trigger",
          position: { x: 240, y: 30 },
          data: {
            label: "Start Skill Analysis",
            triggerType: "manual",
            defaultPrompt: "Identify the expertise level of each skill in the result data based on the uploaded document.",
            outputSchema: "{ triggerType, userMessage }",
          } satisfies TriggerNodeData,
        },

        // ── 2. INIT LOOP STATE ───────────────────────────────────────────────
        // BUG FIX: handle both result.nodes and result.data.nodes (actual API wraps in data:{})
        {
          id: "n-init",
          type: "plugin",
          position: { x: 240, y: 150 },
          data: {
            label: "Init Loop",
            description: "Read result nodes (handles data.nodes nesting), set index=0",
            inputSchema: "result: { nodes? } | { data: { nodes? } }",
            outputSchema: "{ items: Array<{id,skill}>, index: 0, accumulated: [] }",
            code: `${READ_ITEMS_CODE}
const items = readItems(input.result);
if (items.length === 0) throw new Error('No nodes found in result data. Check that result.nodes or result.data.nodes exists.');
// Loop range is NOT applied here — the condition node enforces it on every visit.
return { items, index: 0, accumulated: [] };`,
          } satisfies PluginNodeData,
        },

        // ── 3. LOOP CONDITION ────────────────────────────────────────────────
        {
          id: "n-condition",
          type: "condition",
          position: { x: 240, y: 290 },
          data: {
            label: "More skills?",
            expression: `Array.isArray(prevOutput?.items) && typeof prevOutput.index === 'number' && prevOutput.index < prevOutput.items.length`,
            inputSchema: "{ items, index, accumulated }",
            // loopStart / loopEnd: set these to limit the loop range.
            // The executor re-slices items on every condition visit — no agent cooperation needed.
            // loopStart: 0,
            // loopEnd: 2,   ← example: process items 0, 1, 2 only
          } satisfies ConditionNodeData,
        },

        // ── 4. GET CURRENT SKILL (true branch) ──────────────────────────────
        // BUG FIX: do NOT pass items[] to agents — it's 100+ nodes and bloats every LLM call.
        // Only pass: skill name, loop index, and accumulated so far.
        // n-accumulate will re-read items from input.result directly.
        {
          id: "n-get-item",
          type: "plugin",
          position: { x: 560, y: 290 },
          data: {
            label: "Get Current Skill",
            description: "Extract current skill for agents — strips items[] to keep prompts lean",
            inputSchema: "{ items, index, accumulated }",
            outputSchema: "{ skill, skillId, _idx, _loopRange }",
            code: `const state = input.prevOutput;
const cur = state.items[state.index];
// _acc is NOT sent to agents — n-accumulate reads it directly via input.getNodeOutput.
// _loopRange is a "start:total" string agents copy unchanged so n-accumulate can re-slice.
return {
  skill:      cur.skill,
  skillId:    cur.id,
  _idx:       state.index,
  _loopRange: state._loopRange,
};`,
          } satisfies PluginNodeData,
        },

        // ── 5. AGENT: find sentences for ONE skill ───────────────────────────
        {
          id: "n-agent-sentences",
          type: "agent",
          position: { x: 560, y: 420 },
          data: {
            label: "Find Sentences",
            mode: "inline",
            inlineName: "Sentence Finder",
            inlineOutputType: "json",
            inlineSystemPrompt: `You are a document analyst. The uploaded document is in your context under "Uploaded document:".

Task: read the uploaded document and collect every sentence that mentions, demonstrates, or relates to the skill given by the user. Include sentences that use synonyms or closely related concepts — do not require exact keyword matches. Copy each sentence exactly as it appears in the document (no paraphrasing).

If no relevant sentence is found, return an empty array for sentence_sources.
Copy _idx and _loopRange from the input JSON unchanged.

Return ONLY valid JSON — no prose, no markdown fences:
{
  "skill": "<skill name>",
  "sentence_sources": ["<sentence from document>", "..."],
  "_idx": <copy unchanged>,
  "_loopRange": "<copy unchanged>"
}`,
            passPrevOutput: true,
            promptOverride: `Find sentences related to skill: "{{prevOutput.skill}}"`,
            inputSchema: "{ skill, skillId, _idx, _loopRange } + docText in context",
            outputSchema: "{ skill, sentence_sources: string[], _idx, _loopRange }",
          } satisfies AgentNodeData,
        },

        // ── 6. AGENT: generate description from sentences ────────────────────
        {
          id: "n-agent-desc",
          type: "agent",
          position: { x: 560, y: 550 },
          data: {
            label: "Write Description",
            mode: "inline",
            inlineName: "Description Writer",
            inlineOutputType: "json",
            inlineSystemPrompt: `You receive a JSON object with:
- "skill": the skill name
- "sentence_sources": sentences from the uploaded document
- "_idx": loop counter — copy unchanged
- "_loopRange": loop range string — copy unchanged

Write a single concise sentence describing how this skill is demonstrated, based ONLY on sentence_sources.
If sentence_sources is empty, write "No evidence found in the uploaded document."

Return ONLY valid JSON — no prose, no markdown fences:
{
  "skill": "<value>",
  "description": "<one sentence>",
  "sentence_sources": <copy unchanged>,
  "_idx": <copy unchanged>,
  "_loopRange": "<copy _loopRange unchanged>"
}`,
            passPrevOutput: true,
            promptOverride: `Write description for skill "{{prevOutput.skill}}": {{prevOutput}}`,
            inputSchema: "{ skill, sentence_sources, _idx, _loopRange }",
            outputSchema: "{ skill, description, sentence_sources, _idx, _loopRange }",
          } satisfies AgentNodeData,
        },

        // ── 7. AGENT: identify expected level ────────────────────────────────
        {
          id: "n-agent-level",
          type: "agent",
          position: { x: 560, y: 680 },
          data: {
            label: "Assess Level",
            mode: "inline",
            inlineName: "Level Assessor",
            inlineOutputType: "json",
            inlineSystemPrompt: `You are a Bloom's Taxonomy expert. You receive a JSON object with:
- "skill": skill name
- "description": one-sentence description
- "sentence_sources": evidence sentences from the document
- "_idx": loop counter — copy unchanged
- "_loopRange": loop range string — copy unchanged

Assign ONE expertise level based on the evidence:
- beginner: recall/understand concepts (no hands-on evidence)
- intermediate: apply/analyse in practice
- advanced: evaluate, optimise, critique
- expert: create, design, synthesise novel approaches

Return ONLY valid JSON — no prose, no markdown fences:
{
  "skill": "<value>",
  "description": "<value>",
  "expected_level": {
    "level": "beginner|intermediate|advanced|expert",
    "reason": "<one sentence citing specific words from sentence_sources>"
  },
  "sentence_sources": <copy unchanged>,
  "_idx": <copy unchanged>,
  "_loopRange": "<copy _loopRange unchanged>"
}`,
            passPrevOutput: true,
            promptOverride: `Assign Bloom's level for skill "{{prevOutput.skill}}": {{prevOutput}}`,
            inputSchema: "{ skill, description, sentence_sources, _idx, _loopRange }",
            outputSchema: "{ skill, description, expected_level: {level,reason}, sentence_sources, _idx, _loopRange }",
          } satisfies AgentNodeData,
        },

        // ── 8. ACCUMULATE & ADVANCE (back-edge → condition) ──────────────────
        // BUG FIX: re-reads items from input.result so items[] never travels through agents.
        // BUG FIX: parses agent output robustly in case it returns a JSON string.
        {
          id: "n-accumulate",
          type: "plugin",
          position: { x: 560, y: 810 },
          data: {
            label: "Accumulate & Advance",
            description: "Push result, increment index, rebuild items from source data (no token bloat)",
            inputSchema: "{ skill, description, expected_level, sentence_sources, _idx, _loopRange }",
            outputSchema: "{ items, index: _idx+1, accumulated: [...prevAcc, newEntry] }",
            code: `${PARSE_AGENT_JSON}
${READ_ITEMS_CODE}

// Agent may return a JSON string — parse it
const r = parseAgentJSON(input.prevOutput);

// Re-read all items and re-apply the loop range encoded as "start:total"
const allItems = readItems(input.result);
const rangeParts = typeof r._loopRange === 'string' ? r._loopRange.split(':').map(Number) : [];
const loopStart = rangeParts[0] >= 0 ? rangeParts[0] : 0;
const loopTotal = rangeParts[1] > 0  ? rangeParts[1] : allItems.length;
const items = allItems.slice(loopStart, loopStart + loopTotal);

// Read accumulated from the condition node's previous output — _acc no longer travels
// through agents (it grows with every iteration, bloating every LLM call).
const conditionState = input.getNodeOutput('n-condition');
const prevAcc = Array.isArray(conditionState?.accumulated) ? conditionState.accumulated : [];

// Build this iteration's result entry (guard against missing fields)
const entry = {
  skill:          r.skill || '',
  description:    r.description || '',
  expected_level: r.expected_level || { level: 'unknown', reason: '' },
  sentence_sources: Array.isArray(r.sentence_sources) ? r.sentence_sources : [],
};

return {
  items,
  index:       (typeof r._idx === 'number' ? r._idx : 0) + 1,
  accumulated: [...prevAcc, entry],
  _loopRange:  r._loopRange || (loopStart + ':' + loopTotal),
};`,
          } satisfies PluginNodeData,
        },

        // ── 9. EXTRACT RESULTS (false branch — loop finished) ────────────────
        {
          id: "n-extract",
          type: "plugin",
          position: { x: 240, y: 440 },
          data: {
            label: "Extract Results",
            description: "Pull accumulated[] out of loop state when loop ends",
            inputSchema: "{ items, index, accumulated }",
            outputSchema: "Array<{ skill, description, expected_level, sentence_sources }>",
            code: `const state = input.prevOutput;
if (Array.isArray(state?.accumulated)) return state.accumulated;
// Guard: if agent returned a JSON string at some point
if (typeof state === 'string') { try { const p = JSON.parse(state); return Array.isArray(p?.accumulated) ? p.accumulated : []; } catch(e) {} }
return [];`,
          } satisfies PluginNodeData,
        },

        // ── 10. FORMAT AS HTML TABLE ─────────────────────────────────────────
        {
          id: "n-agent-format",
          type: "agent",
          position: { x: 240, y: 580 },
          data: {
            label: "Format HTML Table",
            mode: "inline",
            inlineName: "HTML Formatter",
            inlineOutputType: "html",
            inlineSystemPrompt: `You receive a JSON array of skill assessment objects, each with:
  skill, description, expected_level: {level, reason}, sentence_sources[]

Convert it into a self-contained HTML table (no DOCTYPE, no <html>/<body> wrapper).
Table columns: Skill | Level | Description | Reason | Source Sentences

Styling rules (inline only):
- table: border-collapse:collapse; width:100%; font-family:sans-serif; font-size:13px
- th: background:#1e293b; color:#fff; padding:10px 14px; text-align:left
- td: padding:8px 12px; border-bottom:1px solid #e2e8f0; vertical-align:top
- tr:hover td: background:#f8fafc
- Level badge: display:inline-block; padding:2px 8px; border-radius:999px; font-weight:600; font-size:11px
  - beginner → background:#dbeafe; color:#1d4ed8
  - intermediate → background:#fef9c3; color:#92400e
  - advanced → background:#ffedd5; color:#c2410c
  - expert → background:#dcfce7; color:#15803d
- sentence_sources: render as <ul style="margin:0;padding-left:16px"> with each sentence as <li>

Return ONLY the HTML. No prose, no markdown fences, no DOCTYPE.`,
            passPrevOutput: true,
            promptOverride: `Format this skill assessment data as an HTML table:\n{{prevOutput}}`,
            inputSchema: "Array<{ skill, description, expected_level, sentence_sources }>",
            outputSchema: "HTML table string",
          } satisfies AgentNodeData,
        },

        // ── 11. OUTPUT ───────────────────────────────────────────────────────
        {
          id: "n-output",
          type: "output",
          position: { x: 240, y: 720 },
          data: {
            label: "Show Results",
            renderAs: "html",
            inputSchema: "HTML string from formatter agent",
          } satisfies OutputNodeData,
        },
      ],
      edges: [
        // linear lead-in
        { id: "e1",  source: "n-trigger",         target: "n-init"           },
        { id: "e2",  source: "n-init",            target: "n-condition"       },
        // true branch (loop body)
        { id: "e3",  source: "n-condition",        target: "n-get-item",       sourceHandle: "true"  },
        { id: "e4",  source: "n-get-item",         target: "n-agent-sentences" },
        { id: "e5",  source: "n-agent-sentences",  target: "n-agent-desc"      },
        { id: "e6",  source: "n-agent-desc",       target: "n-agent-level"     },
        { id: "e7",  source: "n-agent-level",      target: "n-accumulate"      },
        // back-edge — advances loop state and re-enters condition
        { id: "e8",  source: "n-accumulate",       target: "n-condition"       },
        // false branch (loop exit)
        { id: "e9",  source: "n-condition",        target: "n-extract",        sourceHandle: "false" },
        { id: "e10", source: "n-extract",          target: "n-agent-format"    },
        { id: "e11", source: "n-agent-format",     target: "n-output"          },
      ],
    },
  },
];

// ─── Main component ───────────────────────────────────────────────────────────

interface WorkflowBuilderProps {
  workflow: AgentWorkflow;
  agents: AgentStub[];
  skills: SkillStub[];
  organizationId?: string;
  onChange: (w: AgentWorkflow) => void;
}

const defaultWorkflow = (): AgentWorkflow => ({
  nodes: [
    {
      id: "trigger-1",
      type: "trigger",
      position: { x: 200, y: 60 },
      data: { label: "Start", triggerType: "manual" } satisfies TriggerNodeData,
    },
  ],
  edges: [],
});

export const WorkflowBuilder = ({ workflow, agents, skills, organizationId, onChange }: WorkflowBuilderProps) => {
  const wf = workflow.nodes.length === 0 ? defaultWorkflow() : workflow;

  const [nodes, setNodes] = useState<Node[]>(wf.nodes as Node[]);
  const [edges, setEdges] = useState<Edge[]>(wf.edges as Edge[]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [propertiesWidth, setPropertiesWidth] = useState(320);
  const [isResizingProperties, setIsResizingProperties] = useState(false);
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [testInputMode, setTestInputMode] = useState<"json" | "text">("json");
  const [testInput, setTestInput] = useState('{\n  "example": "value"\n}');
  const [testPrompt, setTestPrompt] = useState("Process this test data through the workflow.");
  const [isTesting, setIsTesting] = useState(false);
  const [testRuns, setTestRuns] = useState<Record<string, TestNodeRun>>({});
  const [testExecutionOrder, setTestExecutionOrder] = useState<string[]>([]);
  const [testStopReason, setTestStopReason] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const propertiesResizeOrigin = useRef({ pointerX: 0, width: 320 });
  const testAbortRef = useRef<AbortController | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) as WorkflowNode | undefined;
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);
  const canvasNodes = nodes.map((node) => ({
    ...node,
    data: { ...node.data, __testStatus: testRuns[node.id]?.status },
  }));
  const canvasEdges = edges.map((edge) => {
    const sourceRun = testRuns[edge.source];
    const targetRun = testRuns[edge.target];
    const active = sourceRun?.status === "success" && Boolean(targetRun);
    return active
      ? { ...edge, animated: targetRun.status === "running", style: { ...EDGE_STYLE, stroke: targetRun.status === "error" ? "#ef4444" : "#10b981", strokeWidth: 2.2 } }
      : edge;
  });

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!isResizingProperties) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const resize = (event: PointerEvent) => {
      const delta = propertiesResizeOrigin.current.pointerX - event.clientX;
      const viewportMaximum = Math.max(240, window.innerWidth - 614);
      setPropertiesWidth(Math.min(Math.min(640, viewportMaximum), Math.max(240, propertiesResizeOrigin.current.width + delta)));
    };
    const stop = () => setIsResizingProperties(false);
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop, { once: true });
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
    };
  }, [isResizingProperties]);

  // Keep parent in sync
  const commit = useCallback((ns: Node[], es: Edge[]) => {
    onChange({ nodes: ns as WorkflowNode[], edges: es as WorkflowEdge[] });
  }, [onChange]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => {
      const next = applyNodeChanges(changes, nds);
      commit(next, edges);
      return next;
    });
  }, [edges, commit]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => {
      const next = applyEdgeChanges(changes, eds);
      commit(nodes, next);
      return next;
    });
  }, [nodes, commit]);

  const onConnect = useCallback((params: Connection) => {
    setEdges((eds) => {
      const next = addEdge(
        { ...params, id: uid(), markerEnd: EDGE_MARKER, style: EDGE_STYLE, label: params.sourceHandle ?? undefined },
        eds,
      );
      commit(nodes, next);
      return next;
    });
  }, [nodes, commit]);

  const onReconnect = useCallback((oldEdge: Edge, connection: Connection) => {
    setEdges((currentEdges) => {
      const wasBranch = oldEdge.sourceHandle === "true" || oldEdge.sourceHandle === "false";
      const next = reconnectEdge(oldEdge, connection, currentEdges, { shouldReplaceId: false }).map((edge) => {
        if (edge.id !== oldEdge.id) return edge;
        const isBranch = connection.sourceHandle === "true" || connection.sourceHandle === "false";
        return { ...edge, label: isBranch ? connection.sourceHandle : (wasBranch ? undefined : edge.label) };
      });
      commit(nodes, next);
      return next;
    });
  }, [nodes, commit]);

  const addNode = (type: string, position?: { x: number; y: number }) => {
    const defaults: Record<string, unknown> = {
      trigger:   { label: "Trigger", triggerType: "manual" } satisfies TriggerNodeData,
      agent:     { label: "Agent", mode: "existing", agentId: agents[0]?.id ?? "", passPrevOutput: true } satisfies AgentNodeData,
      plugin:    { label: "Plugin", code: "return input.prevOutput;", description: "" } satisfies PluginNodeData,
      condition: { label: "Condition", expression: "prevOutput?.length > 0" } satisfies ConditionNodeData,
      output:    { label: "Output", renderAs: "auto" } satisfies OutputNodeData,
    };
    const newNode: Node = {
      id: `${type}-${uid()}`,
      type,
      position: position ?? { x: 100 + Math.random() * 200, y: 100 + nodes.length * 120 },
      data: defaults[type] ?? { label: type },
    };
    const next = [...nodes, newNode];
    setNodes(next);
    commit(next, edges);
    setSelectedNodeId(newNode.id);
    setSelectedEdgeId(null);
  };

  const onPaletteDragStart = (event: DragEvent, type: string) => {
    event.dataTransfer.setData("application/workflow-node", type);
    event.dataTransfer.effectAllowed = "move";
  };

  const onCanvasDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const onCanvasDrop = (event: DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData("application/workflow-node");
    if (!type || !NODE_LIBRARY.some((item) => item.type === type) || !reactFlowInstance) return;
    addNode(type, reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  const deleteSelected = () => {
    if (selectedNodeId) {
      const nextNodes = nodes.filter((n) => n.id !== selectedNodeId);
      const nextEdges = edges.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId);
      setNodes(nextNodes);
      setEdges(nextEdges);
      commit(nextNodes, nextEdges);
      setSelectedNodeId(null);
      return;
    }
    if (selectedEdgeId) {
      const nextEdges = edges.filter((edge) => edge.id !== selectedEdgeId);
      setEdges(nextEdges);
      commit(nodes, nextEdges);
      setSelectedEdgeId(null);
    }
  };

  const loadExample = (ex: ExampleWorkflow) => {
    setNodes(ex.workflow.nodes as Node[]);
    setEdges(ex.workflow.edges as Edge[]);
    commit(ex.workflow.nodes as Node[], ex.workflow.edges as Edge[]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setShowExamples(false);
  };

  const updateSelectedNodeData = (data: Record<string, unknown>) => {
    const next = nodes.map((n) => n.id === selectedNodeId ? { ...n, data: { ...n.data, ...data } } : n);
    setNodes(next);
    commit(next, edges);
  };

  const updateSelectedEdge = (patch: Partial<Edge>) => {
    const next = edges.map((edge) => edge.id === selectedEdgeId ? { ...edge, ...patch } : edge);
    setEdges(next);
    commit(nodes, next);
  };

  const runWorkflowTest = async () => {
    if (isTesting) return;
    let resultData: unknown = testInput;
    if (testInputMode === "json") {
      try {
        resultData = JSON.parse(testInput);
      } catch (error) {
        setTestError(`Invalid test JSON: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    }

    setTestRuns({});
    setTestExecutionOrder([]);
    setTestStopReason(null);
    setTestError(null);
    setIsTesting(true);
    const controller = new AbortController();
    testAbortRef.current = controller;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const run = await executeWorkflow({ nodes: nodes as WorkflowNode[], edges: edges as WorkflowEdge[] }, {
        resultData,
        docText: testInputMode === "text" ? testInput : null,
        userMessage: testPrompt,
        organizationId: organizationId ?? null,
        orgExecutionToken: null,
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string,
        signal: controller.signal,
        stopOnError: true,
        onStepStart: (nodeId, input) => {
          setTestExecutionOrder((current) => current.includes(nodeId) ? current : [...current, nodeId]);
          setTestRuns((current) => ({
            ...current,
            [nodeId]: { status: "running", input, visits: (current[nodeId]?.visits ?? 0) + 1 },
          }));
        },
        onStepDone: (step: WorkflowStepResult) => {
          setTestRuns((current) => ({
            ...current,
            [step.nodeId]: {
              status: step.error ? "error" : "success",
              input: step.input,
              output: step.output,
              error: step.error,
              durationMs: step.durationMs,
              visits: current[step.nodeId]?.visits ?? 1,
            },
          }));
        },
        onAgentStep: async (_nodeId, agentConfig, prompt, prevOutput) => {
          const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-with-result`, {
            method: "POST",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(organizationId ? { "x-organization-id": organizationId } : {}),
            },
            body: JSON.stringify({
              messages: [{ role: "user", content: prompt }],
              result: { __doc_context: true, result: { testData: resultData, previousNodeOutput: prevOutput } },
              organizationId,
              agentId: agentConfig.agentId,
              systemPrompt: agentConfig.inline?.systemPrompt,
              outputType: agentConfig.inline?.outputType,
              fallbackOutputType: agentConfig.inline?.fallbackOutputType,
              skillIds: agentConfig.inline?.skillIds,
            }),
          });
          if (!response.ok || !response.body) throw new Error(`Agent request failed (${response.status}): ${await response.text()}`);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let output = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              try {
                const event = JSON.parse(line.slice(5).trim()) as { type?: string; content?: string; message?: string };
                if (event.type === "token" && event.content) output += event.content;
                if (event.type === "error") throw new Error(event.message || "Agent execution failed");
              } catch (error) {
                if (error instanceof SyntaxError) continue;
                throw error;
              }
            }
          }
          return output;
        },
      });
      setTestStopReason(run.stopReason ?? (run.aborted ? "Test run stopped." : "Workflow run finished."));
      if (run.error) setTestError(run.error);
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      setTestStopReason(aborted ? "Test run was stopped by the user." : "Execution stopped because of an error.");
      if (!aborted) setTestError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsTesting(false);
      testAbortRef.current = null;
    }
  };

  return (
    <div className={isFullscreen
      ? "fixed inset-0 z-[100] overflow-hidden bg-background"
      : "relative overflow-hidden rounded-xl border bg-background shadow-sm"}>
      <div className="relative flex h-12 items-center justify-between border-b bg-background px-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary"><Workflow className="h-4 w-4" /></span>
          <div>
            <p className="text-xs font-semibold">Workflow canvas</p>
            <p className="text-[10px] text-muted-foreground">{nodes.length} nodes · {edges.length} connections</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={showTestPanel ? "secondary" : "outline"}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setShowTestPanel((value) => !value)}
          >
            <FlaskConical className="h-3.5 w-3.5" /> Test workflow
          </Button>
          {(selectedNodeId || selectedEdgeId) && (
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive" onClick={deleteSelected}>
              <Trash2 className="h-3.5 w-3.5" /> Delete {selectedEdgeId ? "connection" : "selected"}
            </Button>
          )}
          <div className="relative">
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setShowExamples((value) => !value)}>
              <BookOpen className="h-3.5 w-3.5" /> Templates
            </Button>
            {showExamples && (
              <div className="absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-xl border bg-background shadow-xl">
                <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
                  <span className="text-xs font-semibold">Workflow templates</span>
                  <button type="button" onClick={() => setShowExamples(false)}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
                </div>
                {EXAMPLE_WORKFLOWS.map((example) => (
                  <div key={example.id} className="border-b p-3 last:border-0 hover:bg-muted/30">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="text-xs font-semibold">{example.name}</p><p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{example.description}</p></div>
                      <Button type="button" size="sm" className="h-7 shrink-0 gap-1 text-[10px]" onClick={() => loadExample(example)}><RotateCcw className="h-3 w-3" /> Load</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Button
            type="button"
            variant={isFullscreen ? "secondary" : "outline"}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setIsFullscreen((value) => !value)}
            title={isFullscreen ? "Close full-screen view (Esc)" : "Open full-screen workflow canvas"}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {isFullscreen ? "Close full screen" : "Full screen"}
          </Button>
        </div>
      </div>

      {showTestPanel && (
        <div className="absolute left-[202px] top-[60px] z-40 flex max-h-[calc(100%_-_72px)] w-[470px] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
          <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-primary" /><div><p className="text-xs font-semibold">Test workflow</p><p className="text-[9px] text-muted-foreground">Current canvas · configured agents make real provider calls</p></div></div>
            <button type="button" disabled={isTesting} onClick={() => setShowTestPanel(false)}><X className="h-4 w-4 text-muted-foreground hover:text-foreground" /></button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            <div className="grid grid-cols-[110px_1fr] gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">Input type</Label>
                <Select value={testInputMode} onValueChange={(value: "json" | "text") => setTestInputMode(value)} disabled={isTesting}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="json">JSON</SelectItem><SelectItem value="text">Text</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-[10px]">Test prompt</Label><Input className="h-8 text-xs" disabled={isTesting} value={testPrompt} onChange={(event) => setTestPrompt(event.target.value)} /></div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Input data</Label>
              <Textarea className="min-h-[110px] font-mono text-[10px]" disabled={isTesting} value={testInput} onChange={(event) => setTestInput(event.target.value)} placeholder={testInputMode === "json" ? '{ "items": [] }' : "Paste the text to process"} />
            </div>
            <div className="flex items-center gap-2">
              {isTesting ? (
                <Button type="button" variant="destructive" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => testAbortRef.current?.abort()}><CircleStop className="h-3.5 w-3.5" /> Stop test</Button>
              ) : (
                <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void runWorkflowTest()}><Play className="h-3.5 w-3.5" /> Run test</Button>
              )}
              {Object.keys(testRuns).length > 0 && <span className="text-[10px] text-muted-foreground">{Object.values(testRuns).filter((run) => run.status === "success").length}/{nodes.length} nodes completed</span>}
            </div>
            {(testStopReason || testError) && (
              <div className={`rounded-lg border p-2.5 text-[10px] leading-relaxed ${testError ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"}`}>
                <p className="font-semibold">{testError ? "Execution stopped" : "Run result"}</p>
                <p>{testError || testStopReason}</p>
              </div>
            )}
            {Object.keys(testRuns).length > 0 && (
              <div className="space-y-1">
                <Label className="text-[10px]">Execution path</Label>
                {testExecutionOrder.map((nodeId) => nodes.find((node) => node.id === nodeId)).filter((node): node is Node => Boolean(node)).map((node) => {
                  const run = testRuns[node.id];
                  return <button type="button" key={node.id} onClick={() => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }} className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left hover:bg-muted">
                    {run.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" /> : run.status === "error" ? <XCircle className="h-3.5 w-3.5 text-destructive" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                    <span className="min-w-0 flex-1 truncate text-[10px] font-medium">{String(node.data.label || node.id)}</span>
                    {run.visits > 1 && <Badge variant="outline" className="px-1 text-[8px]">×{run.visits}</Badge>}
                    {run.durationMs !== undefined && <span className="text-[9px] text-muted-foreground">{run.durationMs} ms</span>}
                  </button>;
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div
        className={`grid min-w-[900px] ${isFullscreen ? "h-[calc(100vh-3rem)]" : "h-[680px]"}`}
        style={{ gridTemplateColumns: isFullscreen
          ? `190px minmax(420px, 1fr) 5px ${propertiesWidth}px`
          : "190px minmax(420px, 1fr) 300px" }}
      >
        <aside className="border-r bg-muted/15 p-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Node library</p>
          <p className="mb-3 text-[10px] leading-relaxed text-muted-foreground">Drag a block onto the canvas or click to add it.</p>
          <div className="space-y-2">
            {NODE_LIBRARY.map(({ type, icon: Icon, label, description, color, iconBg }) => (
              <button
                key={type}
                type="button"
                draggable
                onDragStart={(event) => onPaletteDragStart(event, type)}
                onClick={() => addNode(type)}
                className="group flex w-full cursor-grab items-center gap-2 rounded-lg border bg-background p-2 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow active:cursor-grabbing"
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${iconBg}`}><Icon className={`h-4 w-4 ${color}`} /></span>
                <span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{label}</span><span className="block truncate text-[9px] text-muted-foreground">{description}</span></span>
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground" />
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-dashed bg-background/50 p-2.5 text-[10px] leading-relaxed text-muted-foreground">
            Connect nodes by dragging between their circular ports. Select any node to configure it.
          </div>
        </aside>

        <div ref={reactFlowWrapper} className="relative" onDragOver={onCanvasDragOver} onDrop={onCanvasDrop}>
          <ReactFlow
            nodes={canvasNodes}
            edges={canvasEdges}
            nodeTypes={nodeTypes as never}
            onInit={setReactFlowInstance}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onEdgesDelete={(deletedEdges) => {
              if (deletedEdges.some((edge) => edge.id === selectedEdgeId)) setSelectedEdgeId(null);
            }}
            onConnect={onConnect}
            onReconnect={onReconnect}
            edgesReconnectable
            reconnectRadius={24}
            onNodeClick={(_, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }}
            onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
            onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }}
            defaultEdgeOptions={{ type: "smoothstep", markerEnd: EDGE_MARKER, style: EDGE_STYLE }}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            proOptions={{ hideAttribution: true }}
            className="bg-muted/10"
          >
            <Background gap={20} size={1} color="hsl(var(--border))" />
            <Controls showInteractive={false} className="!m-3 !overflow-hidden !rounded-lg !border !border-border !bg-background !shadow-sm" />
            <MiniMap
              nodeColor={(node) => ({ trigger: "#7c3aed", agent: "#0ea5e9", plugin: "#f59e0b", condition: "#f43f5e", output: "#10b981" }[node.type ?? "agent"] ?? "#64748b")}
              maskColor="hsl(var(--background) / 0.65)"
              className="!bottom-3 !right-3 !rounded-lg !border !border-border !bg-background/90 !shadow-sm"
            />
          </ReactFlow>
        </div>

        {isFullscreen && (
          <div
            role="separator"
            aria-label="Resize properties panel"
            aria-orientation="vertical"
            title="Drag to resize properties panel"
            onPointerDown={(event) => {
              propertiesResizeOrigin.current = { pointerX: event.clientX, width: propertiesWidth };
              setIsResizingProperties(true);
            }}
            className={`group relative z-10 cursor-col-resize border-l border-r transition-colors hover:border-primary ${isResizingProperties ? "border-primary bg-primary/10" : "border-border bg-muted/30"}`}
          >
            <span className="absolute left-1/2 top-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/30 transition-colors group-hover:bg-primary" />
          </div>
        )}

        <aside className={`flex min-h-0 min-w-0 flex-col bg-background ${isFullscreen ? "" : "border-l"}`}>
          {selectedNode ? (
            <>
              <div className={`flex items-center justify-between border-b border-l-4 px-3 py-2.5 ${NODE_ACCENTS[selectedNode.type] ?? NODE_ACCENTS.agent}`}>
                <div className="flex items-center gap-2">
                  {(() => { const Icon = NODE_ICONS[selectedNode.type]; return Icon ? <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted"><Icon className="h-3.5 w-3.5" /></span> : null; })()}
                  <div><p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Properties</p><p className="text-xs font-semibold capitalize">{selectedNode.type} node</p></div>
                </div>
                <button type="button" onClick={() => setSelectedNodeId(null)}><X className="h-4 w-4 text-muted-foreground hover:text-foreground" /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                {selectedNode.type === "trigger" && <TriggerPanel node={selectedNode} onChange={(data) => updateSelectedNodeData(data as never)} />}
                {selectedNode.type === "agent" && <AgentPanel node={selectedNode} agents={agents} skills={skills} onChange={(data) => updateSelectedNodeData(data as never)} />}
                {selectedNode.type === "plugin" && <PluginPanel node={selectedNode} onChange={(data) => updateSelectedNodeData(data as never)} />}
                {selectedNode.type === "condition" && <ConditionPanel node={selectedNode} onChange={(data) => updateSelectedNodeData(data as never)} />}
                {selectedNode.type === "output" && <OutputPanel node={selectedNode} onChange={(data) => updateSelectedNodeData(data as never)} />}
                {testRuns[selectedNode.id] && (
                  <div className="mt-4 space-y-2 border-t pt-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Latest test data</Label>
                      <Badge variant="outline" className={`text-[9px] ${testRuns[selectedNode.id].status === "error" ? "border-destructive/40 text-destructive" : testRuns[selectedNode.id].status === "running" ? "border-sky-500/40 text-sky-600" : "border-emerald-500/40 text-emerald-600"}`}>
                        {testRuns[selectedNode.id].status} · visit {testRuns[selectedNode.id].visits}
                      </Badge>
                    </div>
                    <details open className="rounded-lg border bg-muted/20">
                      <summary className="cursor-pointer px-2.5 py-2 text-[10px] font-semibold">Input received</summary>
                      <pre className="max-h-48 overflow-auto border-t p-2.5 whitespace-pre-wrap break-words font-mono text-[9px] text-muted-foreground">{debugJson(testRuns[selectedNode.id].input)}</pre>
                    </details>
                    <details open className="rounded-lg border bg-muted/20">
                      <summary className="cursor-pointer px-2.5 py-2 text-[10px] font-semibold">Output produced</summary>
                      <pre className="max-h-56 overflow-auto border-t p-2.5 whitespace-pre-wrap break-words font-mono text-[9px] text-muted-foreground">{debugJson(testRuns[selectedNode.id].output)}</pre>
                    </details>
                    {testRuns[selectedNode.id].error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-[10px] text-destructive">{testRuns[selectedNode.id].error}</p>}
                  </div>
                )}
              </div>
              <div className="truncate border-t px-3 py-2 font-mono text-[10px] text-muted-foreground">id: {selectedNode.id}</div>
            </>
          ) : selectedEdge ? (
            <>
              <div className="flex items-center justify-between border-b border-l-4 border-l-primary px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary"><Link2 className="h-3.5 w-3.5" /></span>
                  <div><p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Properties</p><p className="text-xs font-semibold">Connection</p></div>
                </div>
                <button type="button" onClick={() => setSelectedEdgeId(null)}><X className="h-4 w-4 text-muted-foreground hover:text-foreground" /></button>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3">
                <div className="rounded-lg border bg-primary/5 p-2.5 text-[10px] leading-relaxed text-muted-foreground">
                  Drag either endpoint of the selected line onto another node port, or change its endpoints below.
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">From node</Label>
                  <Select value={selectedEdge.source} onValueChange={(source) => {
                    const isCondition = nodes.find((node) => node.id === source)?.type === "condition";
                    const sourceHandle = isCondition ? (selectedEdge.sourceHandle ?? "true") : undefined;
                    const wasBranch = selectedEdge.sourceHandle === "true" || selectedEdge.sourceHandle === "false";
                    updateSelectedEdge({ source, sourceHandle, label: isCondition ? sourceHandle : (wasBranch ? undefined : selectedEdge.label) });
                  }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{nodes.filter((node) => node.type !== "output").map((node) => <SelectItem key={node.id} value={node.id}>{String(node.data.label || node.id)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {nodes.find((node) => node.id === selectedEdge.source)?.type === "condition" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Condition branch</Label>
                    <Select value={selectedEdge.sourceHandle ?? "true"} onValueChange={(sourceHandle) => updateSelectedEdge({ sourceHandle, label: sourceHandle })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="true">True</SelectItem><SelectItem value="false">False</SelectItem></SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">To node</Label>
                  <Select value={selectedEdge.target} onValueChange={(target) => updateSelectedEdge({ target, targetHandle: undefined })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{nodes.filter((node) => node.type !== "trigger").map((node) => <SelectItem key={node.id} value={node.id}>{String(node.data.label || node.id)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Line style</Label>
                  <Select value={selectedEdge.type ?? "smoothstep"} onValueChange={(type) => updateSelectedEdge({ type })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="smoothstep">Smooth step</SelectItem><SelectItem value="default">Curved</SelectItem><SelectItem value="straight">Straight</SelectItem><SelectItem value="step">Step</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Connection label</Label>
                  <Input className="h-8 text-xs" value={typeof selectedEdge.label === "string" ? selectedEdge.label : ""} placeholder="Optional label" onChange={(event) => updateSelectedEdge({ label: event.target.value || undefined })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Data to pass to next node</Label>
                  <Input
                    className="h-8 font-mono text-xs"
                    value={typeof selectedEdge.dataPath === "string" ? selectedEdge.dataPath : ""}
                    placeholder="Entire output, or e.g. data.items[0]"
                    onChange={(event) => updateSelectedEdge({ dataPath: event.target.value || undefined })}
                  />
                  <p className="text-[10px] leading-relaxed text-muted-foreground">Leave empty to pass the complete output. Use dot or array notation to pass only one field.</p>
                </div>
                {testRuns[selectedEdge.source] && (
                  <details open className="rounded-lg border bg-muted/20">
                    <summary className="cursor-pointer px-2.5 py-2 text-[10px] font-semibold">Data exchanged on this connection</summary>
                    <pre className="max-h-56 overflow-auto border-t p-2.5 whitespace-pre-wrap break-words font-mono text-[9px] text-muted-foreground">{debugJson(pickDataPath(testRuns[selectedEdge.source].output, selectedEdge.dataPath ?? ""))}</pre>
                  </details>
                )}
                <Button type="button" variant="outline" size="sm" className="w-full gap-1.5 text-destructive hover:text-destructive" onClick={deleteSelected}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete connection
                </Button>
              </div>
              <div className="truncate border-t px-3 py-2 font-mono text-[10px] text-muted-foreground">id: {selectedEdge.id}</div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-7 text-center text-muted-foreground">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border bg-muted/30"><Settings2 className="h-5 w-5 opacity-50" /></span>
              <p className="text-xs font-medium text-foreground">Nothing selected</p>
              <p className="text-[10px] leading-relaxed">Select a node or connection to edit it. Connection endpoints can also be dragged to another port.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default WorkflowBuilder;
