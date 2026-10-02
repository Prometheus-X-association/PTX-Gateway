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

export const SKILLS_FRAMEWORK_DESCRIPTION_SKILL_ID = "skills-framework-description";

export const DOCUMENT_BASED_SKILL_DESCRIPTION_SKILL_ID = "document-based-skill-description";

export const createDocumentBasedSkillDescriptionTemplate = (): AgentSkill => ({
  id: DOCUMENT_BASED_SKILL_DESCRIPTION_SKILL_ID,
  name: "Document-Based Skill Description",
  description: "Generate an HR-ready description for one selected skill using only evidence sentences from the uploaded document.",
  objective: "Produce a concise, traceable skill description for the selected skill, grounded only in uploaded-document evidence and returned as structured JSON.",
  instructions: [
    "Act as an HR expert.",
    "Use only the selected skill passed in prevOutput and the uploaded document. Treat evidenceSource as uploaded_document_only.",
    "Identify the selected skill label from skill.label, skill.display, skill.name, selectedSkillInput, or the closest equivalent field in the provided skill object.",
    "Read the uploaded document for sentences or self-contained bullets that clearly support the selected skill.",
    "Do not use ResultData, existing skill descriptions, graph node descriptions, previous table values, generated descriptions, or general model knowledge as evidence.",
    "Generate documentBasedDescription as a direct capability or activity description, no longer than 4000 characters.",
    "Keep documentBasedDescription importable: do not include rationale, confidence wording, source-quality comments, citations, or phrases such as \"based on the document\", \"the document indicates\", \"it suggests\", or \"the evidence shows\".",
    "Extract domain, toolsOrMachines, and tasksOrActivities only when supported by uploaded-document evidence; otherwise return an empty string or empty array.",
    "Copy evidence as exact source-document sentences or self-contained bullets. Do not invent or paraphrase evidence.",
    "If evidence is weak or limited, keep documentBasedDescription direct and place any caution in evidence as a short note after the exact supporting sentence.",
    "Return only valid JSON matching the output template. Do not include markdown, code fences, or text before or after the JSON object.",
  ].map((step, index) => `${index + 1}. ${step}`).join("\n"),
  requiredInputs: [
    { id: "input-skill", key: "skill", label: "Selected skill", type: "json", description: "Selected skill object from the previous workflow step.", required: true },
    { id: "input-selected-skill-input", key: "selectedSkillInput", label: "Selected skill input", type: "text", description: "Original user-selected skill text or fallback label.", required: true },
    { id: "input-evidence-source", key: "evidenceSource", label: "Evidence source", type: "text", description: "Must be uploaded_document_only; reject or return empty evidence for any other source.", required: true, defaultValue: "uploaded_document_only" },
    { id: "input-uploaded-document", key: "uploadedDocument", label: "Uploaded document", type: "document", description: "Uploaded source document used as the only evidence source.", required: true },
  ],
  outputTemplate: JSON.stringify({
    skillLabel: "",
    documentBasedDescription: "",
    domain: "",
    toolsOrMachines: [],
    tasksOrActivities: [],
    evidence: [],
  }, null, 2),
  outputType: "json",
  references: [{
    id: "reference-document-evidence-policy",
    name: "Uploaded document evidence policy",
    description: "Rules for generating skill descriptions from uploaded-document evidence only.",
    content: `System prompt:
Act as HR expert, generate the document-based description for the selected skill.

Selected skill only:
{{prevOutput}}

Input contract:
{ skill, selectedSkillInput, evidenceSource: uploaded_document_only } + uploaded document

Output contract:
{ skillLabel, documentBasedDescription, domain, toolsOrMachines, tasksOrActivities, evidence }

Evidence must come only from the uploaded document. The selected skill input controls which skill is described, but it is not evidence by itself. If the uploaded document does not contain supporting sentences or self-contained bullets for the selected skill, return an empty documentBasedDescription and explain the absence in evidence.`,
  }],
  enabled: true,
  version: 1,
});

export const createSkillsFrameworkDescriptionTemplate = (): AgentSkill => ({
  id: SKILLS_FRAMEWORK_DESCRIPTION_SKILL_ID,
  name: "Skills Framework Description",
  description: "Find the requested skill in an external skills framework and return the framework description when verified; otherwise generate a clearly labelled model-knowledge description.",
  objective: "Return the correct description for a framework skill concept by checking authoritative framework sources first, and use internal LLM knowledge only when the framework entry cannot be verified.",
  instructions: [
    "Use frameworkName to identify the intended source taxonomy or skills framework, then use skillLabel as the target concept name. Use documentBasedDescription and evidence only to resolve ambiguity between similarly named concepts; never copy, paraphrase, summarize, or derive the final description from those provided documents or sentences.",
    "Search for an official public API or authoritative public framework page for the requested framework and skill. Use source-specific searches when helpful, for example `site:lightcast.io/taxonomies/skills-taxonomy <skillLabel> skill`, `site:skills.emsidata.com <skillLabel>`, or the official ESCO API documented at https://ec.europa.eu/esco/api/doc/esco_api_doc.html#api-_ for ESCO.",
    "If an official public API is available, query it for the exact concept matching skillLabel. Return the framework's exact description text only when the API result clearly identifies the requested skill concept.",
    "If no public API is available, inspect authoritative framework pages or search-result snippets from authoritative pages. For Lightcast, prefer the public Lightcast skill page and use the skill ID from the URL when available. If opening the page fails but the search result snippet exposes the definition and identifying taxonomy details, you may use that snippet, but disclose that limitation in note.",
    "Extract framework metadata when available, such as concept ID, category, subcategory, type, related skills, source URL, or framework version. Use these only to verify and explain provenance in note; do not add them to description unless the official framework description itself contains them.",
    "When the exact framework concept and description are verified from an authoritative framework source or authoritative search-result snippet, copy only the official definition into description and set available to true. Keep description importable: no rationale, citations, labels, framework preambles, examples, category text, related-skill text, or phrases such as \"This is the ESCO description\", \"In ESCO\", \"The framework says\", or \"Based on the context\".",
    "If the framework page lists related or associated skills, mention them only in note with context that they are associations from the framework, not requirements for the selected skill.",
    "If the exact framework description cannot be verified because public API access, authoritative pages, snippets, or concept matching are unavailable or ambiguous, generate a standarized description based on requested framework, and do not use the provided documentBasedDescription, evidence, or any other uploaded document and given context.",
    "For an LLM-generated fallback, set available to true only when you can provide a useful generic skill description, and explain in note that direct public framework verification was not available, the text is not an official framework description, and it was generated from the current model's internal knowledge rather than from the provided document or evidence.",
    "In every LLM-generated fallback note, name the model family/version you are running on when known, for example Claude, GPT-5, or the exact model identifier visible to you. If the exact model is not visible, say that the exact model identifier is not available.",
    "Set available to false only when neither a verified framework description nor a useful LLM-generated fallback can be produced; leave description empty and explain the missing source, ambiguity, or insufficiency in note.",
  ].map((step, index) => `${index + 1}. ${step}`).join("\n"),
  requiredInputs: [
    { id: "input-skill-label", key: "skillLabel", label: "Selected skill label", type: "text", description: "Exact selected skill label or object-map key being refined.", required: true },
    { id: "input-framework-name", key: "frameworkName", label: "Framework name", type: "text", description: "Requested framework, for example ESCO, ROME, SFIA, O*NET, or a custom framework.", required: true },
    { id: "input-document-description", key: "documentBasedDescription", label: "Accepted document description", type: "text", description: "Human-accepted description generated from uploaded source evidence.", required: true },
    { id: "input-evidence", key: "evidence", label: "Accepted evidence", type: "json", description: "Agreed evidence sentences and any domain/task/tool context that supports framework matching.", required: false },
  ],
  outputTemplate: JSON.stringify({
    framework: "",
    description: "",
    available: false,
    note: "",
  }, null, 2),
  outputType: "json",
  references: [{
    id: "reference-framework-description-policy",
    name: "Framework description policy",
    description: "Rules for verified framework description retrieval and internal-knowledge fallback generation.",
    content: "Return only JSON. Prefer the exact public framework description when the concept and source can be verified. For verified results, the description field must contain only the exact public framework description that can be imported; do not include rationale, citations, confidence language, adapted wording, examples, category metadata, related-skill metadata, or generated text in description. Authoritative search-result snippets may be used only when the official page cannot be opened and the snippet clearly exposes the definition and identifying framework metadata; disclose that limitation in note. The uploaded document and accepted evidence are disambiguation hints only; they are never a source for the final description and must not be copied, paraphrased, summarized, or transformed into description. When no verified public framework description can be accessed, generate a best-effort description from internal LLM knowledge, keep the generated description importable, and use note to disclose that it is not official framework text, that direct public API/source verification was unavailable, and which LLM model family/version produced the fallback when known.",
  }],
  enabled: true,
  version: 1,
});
