import { useState } from "react";
import { BookOpen, Copy, Download, Loader2, Pencil, Plus, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AgentSkill, AgentSkillInputField, AgentSkillInputType, AgentSkillOutputType, AgentSkillReference } from "@/types/agentSkill";
import { createDocumentBasedSkillDescriptionTemplate, createSkillsFrameworkDescriptionTemplate, createSkillsFrameworkMapperTemplate, serializeAgentSkillMarkdown } from "@/types/agentSkill";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

const extractJsonObject = (raw: string): Record<string, unknown> => {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Try to recover a JSON object embedded in model prose.
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  }
  throw new Error("The generated response was not valid JSON.");
};

const slugKey = (value: string, fallback: string) => {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || fallback;
};

const normalizeGeneratedSkill = (raw: Record<string, unknown>): AgentSkill => {
  const outputTypes = new Set<AgentSkillOutputType>(["text", "json", "html", "mixed"]);
  const requiredInputs = Array.isArray(raw.requiredInputs)
    ? raw.requiredInputs
    : Array.isArray(raw.required_inputs)
      ? raw.required_inputs
      : [];
  const references = Array.isArray(raw.references)
    ? raw.references
    : Array.isArray(raw.supportingReferences)
      ? raw.supportingReferences
      : Array.isArray(raw.supporting_references)
        ? raw.supporting_references
        : [];
  const name = String(raw.name || raw.skillName || "Generated Agent Skill").trim() || "Generated Agent Skill";
  const outputType = outputTypes.has(raw.outputType as AgentSkillOutputType)
    ? raw.outputType as AgentSkillOutputType
    : outputTypes.has(raw.output_type as AgentSkillOutputType)
      ? raw.output_type as AgentSkillOutputType
      : "text";

  return {
    id: uid(),
    name,
    description: String(raw.description || "").trim(),
    objective: String(raw.objective || "").trim(),
    instructions: String(raw.instructions || raw.workflow || "").trim(),
    requiredInputs: requiredInputs.slice(0, 12).map((item, index) => {
      const field = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const label = String(field.label || field.name || field.key || `Input ${index + 1}`).trim();
      const type = ["text", "number", "boolean", "json", "document"].includes(String(field.type))
        ? String(field.type) as AgentSkillInputType
        : "text";
      return {
        id: uid(),
        key: slugKey(String(field.key || label), `input_${index + 1}`),
        label,
        type,
        description: String(field.description || "").trim(),
        required: field.required !== false,
        defaultValue: field.defaultValue === undefined && field.default_value === undefined
          ? undefined
          : String(field.defaultValue ?? field.default_value),
      };
    }),
    outputTemplate: typeof raw.outputTemplate === "string"
      ? raw.outputTemplate.trim()
      : typeof raw.output_template === "string"
        ? raw.output_template.trim()
        : JSON.stringify(raw.outputTemplate || raw.output_schema || { result: "" }, null, 2),
    outputType,
    references: references.slice(0, 8).map((item, index) => {
      const reference = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        id: uid(),
        name: String(reference.name || `Reference ${index + 1}`).trim(),
        description: String(reference.description || "").trim(),
        content: String(reference.content || reference.rules || "").trim(),
      };
    }).filter((reference) => reference.name && reference.content),
    enabled: true,
    version: 1,
  };
};

const SKILL_GENERATION_SYSTEM_PROMPT = `You generate reusable agent skills for an admin configuration UI. Return JSON only.
Required shape:
{
  "name": "short skill name",
  "description": "when an agent should use this skill, including exclusions",
  "objective": "reliable outcome this skill produces",
  "instructions": "numbered operational procedure",
  "requiredInputs": [{"key":"snake_case","label":"Display label","type":"text|number|boolean|json|document","description":"validation and usage guidance","required":true,"defaultValue":"optional"}],
  "outputType": "text|json|html|mixed",
  "outputTemplate": "text template or JSON schema string",
  "references": [{"name":"Reference name","description":"when used","content":"policy, schema, or domain rules"}]
}
Make the skill practical, specific, and safe to attach to an LLM agent. Do not include secrets, API keys, or implementation claims that were not requested.`;

const AGENT_SKILL_TEMPLATES: Array<{
  id: string;
  name: string;
  description: string;
  create: () => AgentSkill;
}> = [
  {
    id: "skills-framework-mapper",
    name: "Skills Framework Mapper",
    description: "Map internal skills to external framework concepts with provenance and review status.",
    create: createSkillsFrameworkMapperTemplate,
  },
  {
    id: "skills-framework-description",
    name: "Skills Framework Description",
    description: "Retrieve verified public framework descriptions for selected skill concepts.",
    create: createSkillsFrameworkDescriptionTemplate,
  },
  {
    id: "document-based-skill-description",
    name: "Document-Based Skill Description",
    description: "Generate selected-skill descriptions from uploaded-document evidence only.",
    create: createDocumentBasedSkillDescriptionTemplate,
  },
];

interface AgentSkillsManagementProps {
  skills: AgentSkill[];
  onChange: (skills: AgentSkill[]) => void;
  organizationId?: string;
}

export const AgentSkillsManagement = ({ skills, onChange, organizationId }: AgentSkillsManagementProps) => {
  const [editingId, setEditingId] = useState<string | null>(skills[0]?.id ?? null);
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [isGeneratingSkill, setIsGeneratingSkill] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
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

  const generateSkill = async () => {
    if (!generationPrompt.trim() || isGeneratingSkill) return;
    setIsGeneratingSkill(true);
    setGenerationError(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 90_000);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
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
          messages: [{
            role: "user",
            content: `Create one reusable agent skill from this admin prompt:

${generationPrompt.trim()}`,
          }],
          result: {
            existingSkills: skills.map(({ id, name, description }) => ({ id, name, description })),
          },
          systemPrompt: SKILL_GENERATION_SYSTEM_PROMPT,
          outputType: "json",
        }),
      });
      if (!response.ok || !response.body) {
        const responseText = await response.text();
        let detail = responseText;
        try {
          const parsed = JSON.parse(responseText) as { error?: string };
          detail = parsed.error || responseText;
        } catch {
          // Keep the original response text.
        }
        throw new Error(`Skill generation failed (${response.status})${detail ? `: ${detail}` : ""}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
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
            if (event.type === "token" && event.content) accumulated += event.content;
            if (event.type === "error") throw new Error(event.message || "Skill generation failed");
          } catch (error) {
            if (error instanceof SyntaxError) continue;
            throw error;
          }
        }
      }

      const generated = normalizeGeneratedSkill(extractJsonObject(accumulated));
      const completed: AgentSkill = {
        ...generated,
        description: generated.description || "Use this skill when the user's request matches the generated operating procedure.",
        objective: generated.objective || "Produce a reliable, reviewable result for the requested operation.",
        instructions: generated.instructions || "1. Validate the supplied inputs.\n2. Follow the requested domain rules.\n3. Return the output in the configured format.",
        outputTemplate: generated.outputTemplate || "Return a concise answer with the result, assumptions, and any required follow-up actions.",
      };
      add(completed);
      setGenerationPrompt("");
      toast.success("Agent skill generated and loaded into the form");
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "Skill generation timed out. Try a more focused prompt."
        : error instanceof Error
          ? error.message
          : String(error);
      setGenerationError(message);
      toast.error("Failed to generate agent skill");
    } finally {
      window.clearTimeout(timeoutId);
      setIsGeneratingSkill(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><BookOpen className="h-4 w-4" />Agent Skills</h3>
          <p className="mt-1 text-xs text-muted-foreground">Reusable operational playbooks attached to agents and workflow agent nodes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs">
                <RotateCcw className="h-3.5 w-3.5" />Add example
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              {AGENT_SKILL_TEMPLATES.map((template) => (
                <DropdownMenuItem key={template.id} className="block cursor-pointer p-3" onSelect={() => add(template.create())}>
                  <p className="text-xs font-semibold">{template.name}</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{template.description}</p>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" size="sm" className="gap-1.5 text-xs" onClick={() => add(emptySkill())}>
            <Plus className="h-3.5 w-3.5" />New Skill
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-background p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4" />Generate from prompt</h4>
            <p className="mt-1 text-xs text-muted-foreground">Describe the repeatable operation and the generated draft will populate the skill form.</p>
          </div>
          <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" disabled={isGeneratingSkill || !generationPrompt.trim()} onClick={() => void generateSkill()}>
            {isGeneratingSkill ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Generate skill
          </Button>
        </div>
        <Textarea
          className="mt-3 min-h-[92px] text-sm"
          value={generationPrompt}
          placeholder="Example: Create a skill that reviews a supplier contract, extracts renewal dates and termination clauses, flags risks, and returns JSON for downstream workflow nodes."
          onChange={(e) => setGenerationPrompt(e.target.value)}
        />
        {generationError && (
          <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{generationError}</p>
        )}
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
