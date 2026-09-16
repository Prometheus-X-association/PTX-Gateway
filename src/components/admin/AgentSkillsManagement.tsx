import { useState } from "react";
import { BookOpen, Copy, Download, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AgentSkill, AgentSkillInputField, AgentSkillInputType, AgentSkillOutputType, AgentSkillReference } from "@/types/agentSkill";
import { createSkillsFrameworkMapperTemplate, serializeAgentSkillMarkdown } from "@/types/agentSkill";

const uid = () => crypto.randomUUID();

const emptySkill = (): AgentSkill => ({
  id: uid(),
  name: "New Agent Skill",
  description: "",
  objective: "",
  instructions: "1. Describe the repeatable procedure the agent must follow.",
  requiredInputs: [],
  outputTemplate: "",
  outputType: "text",
  references: [],
  enabled: true,
  version: 1,
});

const emptyInput = (): AgentSkillInputField => ({
  id: uid(), key: "", label: "", type: "text", description: "", required: true,
});

const emptyReference = (): AgentSkillReference => ({
  id: uid(), name: "", description: "", content: "",
});

const downloadSkill = (skill: AgentSkill) => {
  const blob = new Blob([serializeAgentSkillMarkdown(skill)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "SKILL.md";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};

interface AgentSkillsManagementProps {
  skills: AgentSkill[];
  onChange: (skills: AgentSkill[]) => void;
}

export const AgentSkillsManagement = ({ skills, onChange }: AgentSkillsManagementProps) => {
  const [editingId, setEditingId] = useState<string | null>(skills[0]?.id ?? null);
  const editingIndex = skills.findIndex((skill) => skill.id === editingId);
  const skill = editingIndex >= 0 ? skills[editingIndex] : null;

  const update = (updated: AgentSkill) => {
    onChange(skills.map((item, index) => index === editingIndex ? updated : item));
  };
  const add = (next: AgentSkill) => {
    const unique = skills.some((item) => item.id === next.id) ? { ...next, id: uid(), name: `${next.name} (copy)` } : next;
    onChange([...skills, unique]);
    setEditingId(unique.id);
  };
  const remove = (id: string) => {
    const next = skills.filter((item) => item.id !== id);
    onChange(next);
    if (editingId === id) setEditingId(next[0]?.id ?? null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><BookOpen className="h-4 w-4" />Agent Skills</h3>
          <p className="mt-1 text-xs text-muted-foreground">Reusable operational playbooks attached to agents and workflow agent nodes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => add(createSkillsFrameworkMapperTemplate())}>
            <RotateCcw className="h-3.5 w-3.5" />Add example
          </Button>
          <Button type="button" size="sm" className="gap-1.5 text-xs" onClick={() => add(emptySkill())}>
            <Plus className="h-3.5 w-3.5" />New Skill
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-2 rounded-lg border bg-background p-2">
          {skills.length === 0 && <p className="p-4 text-center text-xs text-muted-foreground">No skills configured. Add a skill or load the example.</p>}
          {skills.map((item) => (
            <button key={item.id} type="button" onClick={() => setEditingId(item.id)}
              className={`w-full rounded-md border p-3 text-left transition-colors ${editingId === item.id ? "border-primary/50 bg-primary/5" : "border-transparent hover:bg-muted/60"}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium leading-tight">{item.name || "Unnamed skill"}</span>
                <Badge variant={item.enabled ? "secondary" : "outline"} className="text-[9px]">v{item.version}</Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{item.description || "No activation description"}</p>
              <p className="mt-2 text-[10px] text-muted-foreground">{item.requiredInputs.length} inputs · {item.references.length} references</p>
            </button>
          ))}
        </div>

        {skill ? (
          <div className="space-y-5 rounded-lg border bg-background p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Switch checked={skill.enabled} onCheckedChange={(enabled) => update({ ...skill, enabled })} />
                <span className="text-xs text-muted-foreground">{skill.enabled ? "Enabled" : "Disabled"}</span>
              </div>
              <div className="flex gap-1">
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" title="Download as SKILL.md" onClick={() => downloadSkill(skill)}><Download className="h-3.5 w-3.5" />SKILL.md</Button>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Duplicate skill" onClick={() => add({ ...skill, id: uid(), name: `${skill.name} (copy)`, version: 1 })}><Copy className="h-3.5 w-3.5" /></Button>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Delete skill" onClick={() => remove(skill.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
              <div className="space-y-1"><Label className="text-xs">Skill name</Label><Input value={skill.name} onChange={(e) => update({ ...skill, name: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Version</Label><Input type="number" min={1} value={skill.version} onChange={(e) => update({ ...skill, version: Math.max(1, Number(e.target.value) || 1) })} /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Activation description</Label><Textarea rows={3} value={skill.description} placeholder="When should an agent use this skill? Include exclusions." onChange={(e) => update({ ...skill, description: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Objective</Label><Textarea rows={3} value={skill.objective} placeholder="What reliable outcome should this skill produce?" onChange={(e) => update({ ...skill, objective: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Operational instructions</Label><Textarea className="min-h-[160px] font-mono text-xs" value={skill.instructions} placeholder="1. Validate input…\n2. Apply domain rules…\n3. Return the required output…" onChange={(e) => update({ ...skill, instructions: e.target.value })} /></div>

            <div className="space-y-3">
              <div className="flex items-center justify-between"><div><Label className="text-xs">Required information</Label><p className="text-[10px] text-muted-foreground">Extend the skill contract with typed input fields.</p></div><Button type="button" variant="outline" size="sm" className="gap-1 text-xs" onClick={() => update({ ...skill, requiredInputs: [...skill.requiredInputs, emptyInput()] })}><Plus className="h-3 w-3" />Field</Button></div>
              {skill.requiredInputs.map((field, index) => {
                const updateField = (patch: Partial<AgentSkillInputField>) => update({ ...skill, requiredInputs: skill.requiredInputs.map((item, i) => i === index ? { ...item, ...patch } : item) });
                return <div key={field.id} className="space-y-2 rounded-lg border bg-muted/20 p-3">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_130px_auto_auto]">
                    <Input className="h-8 text-xs" value={field.label} placeholder="Display label" onChange={(e) => updateField({ label: e.target.value })} />
                    <Input className="h-8 font-mono text-xs" value={field.key} placeholder="field_key" onChange={(e) => updateField({ key: e.target.value.replace(/\s+/g, "_").toLowerCase() })} />
                    <Select value={field.type} onValueChange={(type: AgentSkillInputType) => updateField({ type })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{["text", "number", "boolean", "json", "document"].map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select>
                    <label className="flex items-center gap-2 text-xs"><Switch checked={field.required} onCheckedChange={(required) => updateField({ required })} />Required</label>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => update({ ...skill, requiredInputs: skill.requiredInputs.filter((_, i) => i !== index) })}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2"><Input className="h-8 text-xs" value={field.description} placeholder="Validation and usage guidance" onChange={(e) => updateField({ description: e.target.value })} /><Input className="h-8 text-xs" value={field.defaultValue ?? ""} placeholder="Default value (optional)" onChange={(e) => updateField({ defaultValue: e.target.value || undefined })} /></div>
                </div>;
              })}
            </div>

            <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
              <div className="space-y-1"><Label className="text-xs">Skill output type</Label><Select value={skill.outputType} onValueChange={(outputType: AgentSkillOutputType) => update({ ...skill, outputType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="text">Text</SelectItem><SelectItem value="json">JSON</SelectItem><SelectItem value="html">HTML Chart</SelectItem><SelectItem value="mixed">Mixed</SelectItem></SelectContent></Select><p className="text-[10px] text-muted-foreground">Overrides the agent fallback when this skill activates.</p></div>
              <div className="space-y-1"><Label className="text-xs">Output template or schema</Label><Textarea className="min-h-[130px] font-mono text-xs" value={skill.outputTemplate} placeholder="Describe or provide JSON for the required output." onChange={(e) => update({ ...skill, outputTemplate: e.target.value })} /></div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between"><div><Label className="text-xs">Supporting references</Label><p className="text-[10px] text-muted-foreground">Policies and domain knowledge supplied with the skill.</p></div><Button type="button" variant="outline" size="sm" className="gap-1 text-xs" onClick={() => update({ ...skill, references: [...skill.references, emptyReference()] })}><Plus className="h-3 w-3" />Reference</Button></div>
              {skill.references.map((reference, index) => {
                const updateReference = (patch: Partial<AgentSkillReference>) => update({ ...skill, references: skill.references.map((item, i) => i === index ? { ...item, ...patch } : item) });
                return <div key={reference.id} className="space-y-2 rounded-lg border bg-muted/20 p-3">
                  <div className="flex gap-2"><Input className="h-8 text-xs" value={reference.name} placeholder="Reference name" onChange={(e) => updateReference({ name: e.target.value })} /><Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => update({ ...skill, references: skill.references.filter((_, i) => i !== index) })}><Trash2 className="h-3.5 w-3.5" /></Button></div>
                  <Input className="h-8 text-xs" value={reference.description} placeholder="When should this reference be used?" onChange={(e) => updateReference({ description: e.target.value })} />
                  <Textarea className="min-h-[100px] font-mono text-xs" value={reference.content} placeholder="Reference content, policy, schema, or domain rules" onChange={(e) => updateReference({ content: e.target.value })} />
                </div>;
              })}
            </div>
          </div>
        ) : (
          <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"><Pencil className="mr-2 h-4 w-4" />Select or create a skill to edit it.</div>
        )}
      </div>
    </div>
  );
};
