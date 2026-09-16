export type AgentSkillInputType = "text" | "number" | "boolean" | "json" | "document";
export type AgentSkillOutputType = "text" | "json" | "html" | "mixed";

export interface AgentSkillInputField {
  id: string;
  key: string;
  label: string;
  type: AgentSkillInputType;
  description: string;
  required: boolean;
  defaultValue?: string;
}

export interface AgentSkillReference {
  id: string;
  name: string;
  description: string;
  content: string;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  objective: string;
  instructions: string;
  requiredInputs: AgentSkillInputField[];
  outputTemplate: string;
  outputType: AgentSkillOutputType;
  references: AgentSkillReference[];
  enabled: boolean;
  version: number;
}

const markdownCell = (value: string): string => value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");

export const agentSkillSlug = (skill: Pick<AgentSkill, "id" | "name">): string => {
  const fromName = skill.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return fromName || skill.id || "agent-skill";
};

export const serializeAgentSkillMarkdown = (skill: AgentSkill): string => {
  const requiredInputs = skill.requiredInputs.length > 0
    ? [
        "| Key | Label | Type | Required | Default | Description |",
        "| --- | --- | --- | --- | --- | --- |",
        ...skill.requiredInputs.map((field) =>
          `| \`${markdownCell(field.key)}\` | ${markdownCell(field.label)} | ${field.type} | ${field.required ? "yes" : "no"} | ${markdownCell(field.defaultValue ?? "")} | ${markdownCell(field.description)} |`
        ),
      ].join("\n")
    : "No structured inputs are required.";
  const references = skill.references.length > 0
    ? skill.references.map((reference) =>
        `### ${reference.name}\n\n${reference.description ? `${reference.description}\n\n` : ""}${reference.content}`
      ).join("\n\n")
    : "No supporting references are embedded.";

  return [
    "---",
    `name: ${JSON.stringify(agentSkillSlug(skill))}`,
    `description: ${JSON.stringify(skill.description)}`,
    "metadata:",
    `  version: ${skill.version}`,
    `  enabled: ${skill.enabled}`,
    `  output_type: ${skill.outputType}`,
    "---",
    "",
    `# ${skill.name}`,
    "",
    "## Objective",
    "",
    skill.objective,
    "",
    "## Required input",
    "",
    requiredInputs,
    "",
    "## Workflow",
    "",
    skill.instructions,
    "",
    "## Output",
    "",
    "~~~",
    skill.outputTemplate,
    "~~~",
    "",
    "## Supporting resources",
    "",
    references,
    "",
  ].join("\n");
};

export const createSkillsFrameworkMapperTemplate = (): AgentSkill => ({
  id: "skills-framework-mapper",
  name: "Skills Framework Mapper",
  description: "Map organisation-owned skills to external frameworks such as ESCO while preserving provenance and requiring human review for ambiguous matches.",
  objective: "Produce traceable candidate mappings between organisation-owned skills and external framework concepts without replacing the organisation-owned canonical record.",
  instructions: [
    "Preserve the organisation-owned skill as the canonical record.",
    "Search the selected external framework for candidate concepts.",
    "Compare meaning, scope, context, and proficiency assumptions.",
    "Return up to three candidates with confidence and rationale.",
    "Mark ambiguous mappings for human validation.",
    "Never overwrite a validated mapping automatically.",
    "Use exactMatch only for semantically equivalent concepts; otherwise use closeMatch, broadMatch, or narrowMatch.",
  ].map((step, index) => `${index + 1}. ${step}`).join("\n"),
  requiredInputs: [
    { id: "input-internal-id", key: "internal_skill_id", label: "Stable internal identifier", type: "text", description: "Organisation-owned canonical skill identifier.", required: true },
    { id: "input-label", key: "preferred_label", label: "Preferred label", type: "text", description: "Preferred skill label in the source language.", required: true },
    { id: "input-evidence", key: "description_or_evidence", label: "Description or source evidence", type: "text", description: "Missing evidence must result in a weak mapping rather than a confident label-only match.", required: true },
    { id: "input-language", key: "language", label: "Language", type: "text", description: "Language code or name used by the source record.", required: true },
    { id: "input-context", key: "organisational_context", label: "Organisational context", type: "text", description: "Optional role, occupation, or organisational context.", required: false },
    { id: "input-framework", key: "external_framework", label: "External framework", type: "text", description: "Target framework, for example ESCO.", required: true, defaultValue: "ESCO" },
  ],
  outputTemplate: JSON.stringify({
    internal_skill_id: "",
    external_framework: "",
    external_concept_id: "",
    mapping_relation: "exactMatch | closeMatch | broadMatch | narrowMatch",
    confidence: 0,
    evidence: "",
    validation_status: "requires_review",
  }, null, 2),
  outputType: "json",
  references: [{
    id: "reference-mapping-policy",
    name: "Mapping policy",
    description: "Rules loaded when assigning mapping relations.",
    content: "Internal skills remain canonical. Label-only matches cannot receive high confidence. Validated mappings must not be overwritten automatically. Every mapping must retain evidence and framework version.",
  }],
  enabled: true,
  version: 1,
});
