import { useCallback, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap,
  addEdge, applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection,
  Handle, Position, MarkerType, Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  Play, Plus, Trash2, X, Code2, GitBranch,
  Bot, Zap, Square, ChevronRight, BookOpen, RotateCcw,
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
  TriggerNodeData, AgentNodeData, PluginNodeData, ConditionNodeData, OutputNodeData,
} from "@/types/workflow";

// ─── Agent stub (only what WorkflowBuilder needs from LlmAgent) ──────────────

export interface AgentStub {
  id: string;
  name: string;
  description: string;
  expectedOutput: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

const NODE_COLORS: Record<string, string> = {
  trigger:   "bg-violet-500/15 border-violet-500/40 text-violet-700 dark:text-violet-300",
  agent:     "bg-sky-500/15 border-sky-500/40 text-sky-700 dark:text-sky-300",
  plugin:    "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300",
  condition: "bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-300",
  output:    "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
};

const NODE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  trigger:   ({ className }) => <Play className={className} />,
  agent:     ({ className }) => <Bot className={className} />,
  plugin:    ({ className }) => <Code2 className={className} />,
  condition: ({ className }) => <GitBranch className={className} />,
  output:    ({ className }) => <Square className={className} />,
};

const EDGE_STYLE = { stroke: "hsl(var(--border))", strokeWidth: 1.5 };
const EDGE_MARKER = { type: MarkerType.ArrowClosed, color: "hsl(var(--border))" };

// ─── Custom Node renderer ─────────────────────────────────────────────────────

interface FlowNodeProps {
  id: string;
  data: Record<string, unknown>;
  type: string;
  selected: boolean;
}

const FlowNode = ({ id, data, type, selected }: FlowNodeProps) => {
  const color = NODE_COLORS[type] ?? NODE_COLORS.agent;
  const Icon = NODE_ICONS[type] ?? NODE_ICONS.agent;
  const label = (data.label as string) || type;
  const isCondition = type === "condition";
  const isTrigger = type === "trigger";
  const isOutput = type === "output";

  return (
    <div
      className={`rounded-xl border-2 shadow-sm px-3 py-2 min-w-[148px] max-w-[200px] cursor-pointer transition-all
        ${color} ${selected ? "ring-2 ring-primary ring-offset-1" : ""}`}
    >
      {/* Input handle — all except trigger */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-background !border-2 !border-border"
        />
      )}

      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-semibold truncate">{label}</span>
      </div>

      {type === "agent" && (
        <p className="text-[10px] opacity-70 mt-0.5 truncate">
          {(data as AgentNodeData).mode === "inline"
            ? ((data as AgentNodeData).inlineName || "inline agent")
            : ((data as AgentNodeData).agentId || "no agent selected")}
        </p>
      )}
      {type === "plugin" && (
        <p className="text-[10px] opacity-70 mt-0.5 truncate">{(data as PluginNodeData).description || "JS transform"}</p>
      )}
      {type === "condition" && (
        <p className="text-[10px] opacity-70 mt-0.5 font-mono truncate">{(data as ConditionNodeData).expression}</p>
      )}
      {type === "trigger" && (
        <Badge variant="outline" className="text-[9px] mt-0.5 px-1 py-0">
          {(data as TriggerNodeData).triggerType === "on_load" ? "auto" : "manual"}
        </Badge>
      )}

      {/* Output handle(s) */}
      {!isOutput && !isCondition && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-background !border-2 !border-border"
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
      {/* Loop range — optional; if set, n-init should slice items accordingly */}
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
        outputSchema={d.outputSchema}
        onInputChange={() => {}}
        onOutputChange={(v) => onChange({ ...d, outputSchema: v || undefined })}
      />
    </div>
  );
};

const OUTPUT_TYPE_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "json", label: "JSON" },
  { value: "html", label: "HTML" },
  { value: "mixed", label: "Mixed" },
] as const;

const AgentPanel = ({ node, agents, onChange }: { node: WorkflowNode; agents: AgentStub[]; onChange: (d: AgentNodeData) => void }) => {
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
            <div className="flex gap-1 flex-wrap">
              {OUTPUT_TYPE_OPTIONS.map(({ value, label }) => (
                <button key={value} onClick={() => onChange({ ...d, inlineOutputType: value })}
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
          Receives <code className="bg-muted px-0.5 rounded">input</code> = <code className="bg-muted px-0.5 rounded">{"{ result, docText, prevOutput }"}</code>. Return the transformed value.
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
          JS expression on <code className="bg-muted px-0.5 rounded">prevOutput</code>. Truthy → <span className="text-emerald-600">true</span> edge, falsy → <span className="text-rose-500">false</span> edge.
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
          <Label className="text-xs">Transform code <span className="text-muted-foreground">(optional JS to reshape prevOutput before replacing result data)</span></Label>
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
            outputSchema: "{ items: Array<{id,skill}>, index: 0, accumulated: [], _loopRange: 'start:total' }",
            code: `${READ_ITEMS_CODE}
const allItems = readItems(input.result);
if (allItems.length === 0) throw new Error('No nodes found in result data. Check that result.nodes or result.data.nodes exists.');
// Apply optional loop range from trigger config (passed via prevOutput from trigger node)
const trigger = input.prevOutput ?? {};
const start = typeof trigger.loopStart === 'number' ? trigger.loopStart : 0;
const end   = typeof trigger.loopEnd   === 'number' ? trigger.loopEnd + 1 : allItems.length;
const items = allItems.slice(start, end);
if (items.length === 0) throw new Error('Loop range [' + start + ', ' + (end-1) + '] produced no items (total: ' + allItems.length + ').');
// Encode range as "start:total" — single string that agents can copy unchanged
return { items, index: 0, accumulated: [], _loopRange: start + ':' + items.length };`,
          } satisfies PluginNodeData,
        },

        // ── 3. LOOP CONDITION ────────────────────────────────────────────────
        {
          id: "n-condition",
          type: "condition",
          position: { x: 240, y: 290 },
          data: {
            label: "More skills?",
            // Condition node outputs prevOutput pass-through (executor behaviour),
            // so loop state flows to both true and false branches.
            expression: `Array.isArray(prevOutput?.items) && typeof prevOutput.index === 'number' && prevOutput.index < prevOutput.items.length`,
            inputSchema: "{ items, index, accumulated }",
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
            outputSchema: "{ skill, skillId, _idx, _acc, _loopRange }",
            code: `const state = input.prevOutput;
const cur = state.items[state.index];
// Pass only what agents need — NOT the full items array.
// _loopRange is a "start:total" string agents copy unchanged so n-accumulate can re-slice.
return {
  skill:      cur.skill,
  skillId:    cur.id,
  _idx:       state.index,
  _acc:       state.accumulated,
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
            inlineSystemPrompt: `You are a precise document analyst. You receive a JSON object describing ONE skill to assess.
The uploaded reference document is available in your context.

Fields in the input JSON:
- "skill": the name of the skill to find evidence for
- "_idx": integer loop counter — copy unchanged
- "_acc": array of previous results — copy unchanged
- "_loopRange": loop range string — copy unchanged exactly as-is

Your task: search the uploaded document for ALL sentences that directly mention or strongly imply the skill.

Return ONLY valid JSON — no prose, no markdown fences — exactly this shape:
{
  "skill": "<value of skill field>",
  "sentence_sources": ["<verbatim or near-verbatim sentence>", "..."],
  "_idx": <copy _idx unchanged>,
  "_acc": <copy _acc unchanged>,
  "_loopRange": "<copy _loopRange string unchanged>"
}

If no sentences found, return an empty sentence_sources array. Do not invent sentences.`,
            passPrevOutput: true,
            promptOverride: `Assess this skill: {{prevOutput}}`,
            inputSchema: "{ skill, skillId, _idx, _acc } + docText in context",
            outputSchema: "{ skill, sentence_sources: string[], _idx, _acc }",
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
- "sentence_sources": sentences found in the document
- "_idx": loop counter — copy unchanged
- "_acc": previous results — copy unchanged
- "_loopRange": loop range string — copy unchanged exactly as-is

Write a single concise sentence describing how this skill is demonstrated, based ONLY on the sentence_sources.
If sentence_sources is empty, write "No evidence found in the uploaded document."

Return ONLY valid JSON — no prose, no markdown fences:
{
  "skill": "<value>",
  "description": "<one sentence>",
  "sentence_sources": <copy unchanged>,
  "_idx": <copy unchanged>,
  "_acc": <copy unchanged>,
  "_loopRange": "<copy _loopRange string unchanged>"
}`,
            passPrevOutput: true,
            promptOverride: `Write description for: {{prevOutput}}`,
            inputSchema: "{ skill, sentence_sources, _idx, _acc }",
            outputSchema: "{ skill, description, sentence_sources, _idx, _acc }",
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
- "_acc": previous results — copy unchanged
- "_loopRange": loop range string — copy unchanged exactly as-is

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
  "_acc": <copy unchanged>,
  "_loopRange": "<copy _loopRange string unchanged>"
}`,
            passPrevOutput: true,
            promptOverride: `Assign Bloom's level for: {{prevOutput}}`,
            inputSchema: "{ skill, description, sentence_sources, _idx, _acc }",
            outputSchema: "{ skill, description, expected_level: {level,reason}, sentence_sources, _idx, _acc }",
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
            inputSchema: "{ skill, description, expected_level, sentence_sources, _idx, _acc }",
            outputSchema: "{ items, index: _idx+1, accumulated: [..._acc, newEntry] }",
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

// Build this iteration's result entry (guard against missing fields)
const entry = {
  skill:          r.skill || '',
  description:    r.description || '',
  expected_level: r.expected_level || { level: 'unknown', reason: '' },
  sentence_sources: Array.isArray(r.sentence_sources) ? r.sentence_sources : [],
};

const prevAcc = Array.isArray(r._acc) ? r._acc : [];

return {
  items,
  index:      (typeof r._idx === 'number' ? r._idx : 0) + 1,
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

export const WorkflowBuilder = ({ workflow, agents, onChange }: WorkflowBuilderProps) => {
  const wf = workflow.nodes.length === 0 ? defaultWorkflow() : workflow;

  const [nodes, setNodes] = useState<Node[]>(wf.nodes as Node[]);
  const [edges, setEdges] = useState<Edge[]>(wf.edges as Edge[]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) as WorkflowNode | undefined;

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

  const addNode = (type: string) => {
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
      position: { x: 100 + Math.random() * 200, y: 100 + nodes.length * 120 },
      data: defaults[type] ?? { label: type },
    };
    const next = [...nodes, newNode];
    setNodes(next);
    commit(next, edges);
    setSelectedNodeId(newNode.id);
  };

  const deleteSelected = () => {
    if (!selectedNodeId) return;
    const nextNodes = nodes.filter((n) => n.id !== selectedNodeId);
    const nextEdges = edges.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId);
    setNodes(nextNodes);
    setEdges(nextEdges);
    commit(nextNodes, nextEdges);
    setSelectedNodeId(null);
  };

  const loadExample = (ex: ExampleWorkflow) => {
    setNodes(ex.workflow.nodes as Node[]);
    setEdges(ex.workflow.edges as Edge[]);
    commit(ex.workflow.nodes as Node[], ex.workflow.edges as Edge[]);
    setSelectedNodeId(null);
    setShowExamples(false);
  };

  const updateSelectedNodeData = (data: Record<string, unknown>) => {
    const next = nodes.map((n) => n.id === selectedNodeId ? { ...n, data: { ...n.data, ...data } } : n);
    setNodes(next);
    commit(next, edges);
  };

  return (
    <div className="flex gap-0 border rounded-xl overflow-hidden h-[560px]">
      {/* Canvas */}
      <div ref={reactFlowWrapper} className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes as never}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          defaultEdgeOptions={{ markerEnd: EDGE_MARKER, style: EDGE_STYLE }}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
          className="bg-muted/20"
        >
          <Background gap={18} size={1} color="hsl(var(--border))" />
          <Controls showInteractive={false} className="!shadow-none" />
          <MiniMap
            nodeColor={(n) => {
              const cls = NODE_COLORS[n.type ?? "agent"] ?? "";
              if (cls.includes("violet")) return "#7c3aed";
              if (cls.includes("sky"))    return "#0ea5e9";
              if (cls.includes("amber"))  return "#f59e0b";
              if (cls.includes("rose"))   return "#f43f5e";
              return "#10b981";
            }}
            className="!bottom-14 !right-2 !bg-background/80 !border !border-border rounded-lg"
          />

          {/* Toolbar palette */}
          <Panel position="top-left">
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-1 bg-background/90 backdrop-blur border border-border rounded-lg p-1 shadow-sm">
                {[
                  { type: "trigger",   icon: Play,       label: "Trigger",   color: "text-violet-600" },
                  { type: "agent",     icon: Bot,        label: "Agent",     color: "text-sky-600" },
                  { type: "plugin",    icon: Code2,      label: "Plugin",    color: "text-amber-600" },
                  { type: "condition", icon: GitBranch,  label: "Condition", color: "text-rose-500" },
                  { type: "output",    icon: Square,     label: "Output",    color: "text-emerald-600" },
                ].map(({ type, icon: Icon, label, color }) => (
                  <button
                    key={type}
                    onClick={() => addNode(type)}
                    title={`Add ${label}`}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-muted transition-colors text-xs font-medium ${color}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Examples picker */}
              <div className="relative">
                <button
                  onClick={() => setShowExamples((v) => !v)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-background/90 backdrop-blur border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-sm w-full"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Load example workflow
                </button>

                {showExamples && (
                  <div className="absolute top-full left-0 mt-1 z-50 w-72 rounded-xl border border-border bg-background shadow-xl overflow-hidden">
                    <div className="px-3 py-2 border-b bg-muted/40 flex items-center justify-between">
                      <span className="text-xs font-semibold">Example Workflows</span>
                      <button onClick={() => setShowExamples(false)}><X className="h-3.5 w-3.5 opacity-60 hover:opacity-100" /></button>
                    </div>
                    {EXAMPLE_WORKFLOWS.map((ex) => (
                      <div key={ex.id} className="p-3 border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className="text-xs font-semibold">{ex.name}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{ex.description}</p>
                          </div>
                          <button
                            onClick={() => loadExample(ex)}
                            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/90 transition-colors"
                          >
                            <RotateCcw className="h-2.5 w-2.5" /> Load
                          </button>
                        </div>
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {ex.workflow.nodes.map((n) => (
                            <span key={n.id} className={`text-[9px] px-1.5 py-0.5 rounded-full border ${NODE_COLORS[n.type] ?? ""}`}>
                              {(n.data as { label?: string }).label ?? n.type}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Panel>

          {/* Delete selected */}
          {selectedNodeId && (
            <Panel position="top-right">
              <button
                onClick={deleteSelected}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-background/90 border border-border text-xs text-destructive hover:bg-destructive/10 transition-colors shadow-sm"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete node
              </button>
            </Panel>
          )}
        </ReactFlow>
      </div>

      {/* Properties panel */}
      {selectedNode ? (
        <div className="w-72 border-l bg-background flex flex-col">
          <div className={`flex items-center justify-between px-3 py-2 border-b ${NODE_COLORS[selectedNode.type] ?? ""}`}>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
              {(() => { const Icon = NODE_ICONS[selectedNode.type]; return Icon ? <Icon className="h-3.5 w-3.5" /> : null; })()}
              {selectedNode.type} node
            </div>
            <button onClick={() => setSelectedNodeId(null)}>
              <X className="h-4 w-4 opacity-60 hover:opacity-100" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {selectedNode.type === "trigger" && (
              <TriggerPanel node={selectedNode} onChange={(d) => updateSelectedNodeData(d as never)} />
            )}
            {selectedNode.type === "agent" && (
              <AgentPanel node={selectedNode} agents={agents} onChange={(d) => updateSelectedNodeData(d as never)} />
            )}
            {selectedNode.type === "plugin" && (
              <PluginPanel node={selectedNode} onChange={(d) => updateSelectedNodeData(d as never)} />
            )}
            {selectedNode.type === "condition" && (
              <ConditionPanel node={selectedNode} onChange={(d) => updateSelectedNodeData(d as never)} />
            )}
            {selectedNode.type === "output" && (
              <OutputPanel node={selectedNode} onChange={(d) => updateSelectedNodeData(d as never)} />
            )}
          </div>

          {/* Node ID footer */}
          <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground font-mono truncate">
            id: {selectedNode.id}
          </div>
        </div>
      ) : (
        <div className="w-72 border-l bg-muted/20 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Zap className="h-6 w-6 opacity-30" />
          <p className="text-xs text-center px-4">Click a node to edit its properties</p>
          <p className="text-[10px] text-center px-4 opacity-70">
            Drag from a node's handle to connect. Condition nodes have two outputs (true / false).
          </p>
        </div>
      )}
    </div>
  );
};

export default WorkflowBuilder;
