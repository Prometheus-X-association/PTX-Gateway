import { useEffect, useState } from "react";
import lightcastSkillDescriptionPrompt from "@/data/agentSkillTemplates/lightcast-skill-description-agent.md?raw";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Brain, Save, Plus, Trash2, ChevronUp, ChevronDown,
  Eye, EyeOff, Server, Zap, RotateCcw, Bot, MessageSquarePlus,
  Pencil, X, ChevronsUpDown, Info, Link2, FlaskConical,
  CheckCircle2, XCircle, ChevronRight, Wrench, Workflow, BookOpen, Copy,
} from "lucide-react";
import { GlobalProviderPriority } from "@/components/admin/GlobalProviderPriority";
import { WorkflowsManagement } from "@/components/admin/WorkflowsManagement";
import { EXAMPLE_WORKFLOWS } from "@/components/admin/WorkflowBuilder";
import { AgentSkillsManagement } from "@/components/admin/AgentSkillsManagement";
import { ConfirmRecycleButton, RecycleBinPanel } from "@/components/admin/RecycleBinControls";
import { RECYCLE_RETENTION_MS, recycleExpiry } from "@/components/admin/recycleBin";
import {
  ChatAvailabilitySelector,
  type ChatAvailabilityTarget,
} from "@/components/admin/ChatAvailabilitySelector";
import type { WorkflowConfig, WorkflowRevision, WorkflowRevisionActor } from "@/types/workflow";
import type { AgentSkill } from "@/types/agentSkill";
import {
  DOCUMENT_BASED_SKILL_DESCRIPTION_SKILL_ID,
  SKILLS_FRAMEWORK_DESCRIPTION_SKILL_ID,
  createDocumentBasedSkillDescriptionTemplate,
  createSkillsFrameworkDescriptionTemplate,
  createSkillsFrameworkMapperTemplate,
} from "@/types/agentSkill";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { readGlobalFeatures } from "@/utils/globalConfigFeatures";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LlmProvider {
  id: string;
  name: string;
  providerType: "openai" | "anthropic" | "gemini" | "openai_compatible";
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  deletedAt?: string;
  deletedPreviousEnabled?: boolean;
}

interface McpServer {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  enabled: boolean;
  deletedAt?: string;
  deletedPreviousEnabled?: boolean;
}

interface LlmAgent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  webSearch?: { allowedDomains: string[]; resultPolicy?: "lightcast" };
  expectedOutput: "auto" | "text" | "json" | "html" | "mixed";
  fallbackOutput: "text" | "json" | "html" | "mixed";
  outputInstructions: string;
  mcpServerIds: string[];
  mcpToolFilter: Record<string, string[]>;
  providerIds: string[];
  agentProviders: LlmProvider[];
  defaultPrompts: string[];
  skillIds: string[];
  targetResources: string[];
  inputSources: Array<"result" | "document" | "user_upload">;
  enabled: boolean;
  ragSources: "all" | "result" | "document" | "none";
  ragMode: "auto" | "chunks" | "none"; // auto = full doc if small, chunks if large
  ragTopK: number;
  resultContextMode: "full" | "chunked";
  resultChunkSize: number;
  deletedAt?: string;
  deletedPreviousEnabled?: boolean;
}

interface LlmInsightsConfig {
  enabled: boolean;
  providers: LlmProvider[];
  mcpServers: McpServer[];
  agents: LlmAgent[];
  skills: AgentSkill[];
  predefinedPrompts: string[];
  workflows: WorkflowConfig[];
}

const BUILT_IN_WORKFLOW_TEMPLATE_IDS = new Set([
  "interactive-skill-description-refinement",
  "interactive-skill-description-refinement-object-map",
]);

const SKILLS_FRAMEWORK_DESCRIPTION_AGENT_ID = "skills-framework-description-agent";
const DOCUMENT_BASED_SKILL_DESCRIPTION_AGENT_ID = "document-based-skill-description-agent";

const DOCUMENT_BASED_SKILL_DESCRIPTION_AGENT_PROMPT =
  "Act as HR expert, generate the document-based description for the selected skill. Use the assigned Document-Based Skill Description playbook with { skill, selectedSkillInput, evidenceSource: uploaded_document_only } and the uploaded document. Use only uploaded-document evidence sentences. Return only valid JSON with skillLabel, documentBasedDescription, domain, toolsOrMachines, tasksOrActivities, and evidence.";

const FRAMEWORK_DESCRIPTION_AGENT_PROMPT =
  "You generate framework-aligned skill descriptions from an accepted skill refinement context. Use the assigned Skills Framework Description playbook whenever framework description generation is requested. Return only valid JSON with framework, description, available, and note.";

const looksLikeInteractiveSkillRefinementWorkflow = (workflow: WorkflowConfig): boolean => {
  if (BUILT_IN_WORKFLOW_TEMPLATE_IDS.has(workflow.id)) return true;
  const nodeIds = new Set(workflow.graph?.nodes?.map((node) => node.id) ?? []);
  return nodeIds.has("refine-trigger") && nodeIds.has("refine-ask-skill");
};

const upgradeBuiltInWorkflowTemplate = (workflow: WorkflowConfig): WorkflowConfig => {
  if (!looksLikeInteractiveSkillRefinementWorkflow(workflow)) return workflow;
  const template = EXAMPLE_WORKFLOWS.find((example) => example.id === workflow.id)
    ?? EXAMPLE_WORKFLOWS.find((example) => example.id === "interactive-skill-description-refinement");
  if (!template) return workflow;
  const hasSavedGraph = (workflow.graph?.nodes?.length ?? 0) > 0 || (workflow.graph?.edges?.length ?? 0) > 0;
  if (hasSavedGraph) return workflow;
  const graph = template.workflow;
  const upgradedGraph = {
    ...graph,
    nodes: (graph.nodes ?? []).map((node) => {
      if (node.id !== "refine-framework-agent" || node.type !== "agent") return node;
      const data = node.data as Record<string, unknown>;
      return {
        ...node,
        data: {
          ...data,
          label: "Generate Framework Description",
          mode: "existing",
          agentId: SKILLS_FRAMEWORK_DESCRIPTION_AGENT_ID,
          contextMode: "document_only",
          useUploadedDocument: false,
          passPrevOutput: true,
          promptOverride: `Selected skill, accepted document-based description, and agreed source evidence/context:
{{prevOutput}}

Provide the requested framework description. Return direct JSON only.`,
          inputSchema: "{ skillLabel, documentBasedDescription, evidence, domain, toolsOrMachines, tasksOrActivities, frameworkName }",
          outputSchema: "{ framework, description, available, note }",
        },
      };
    }),
  };
  return {
    ...workflow,
    name: workflow.name || template.name,
    description: workflow.description || template.description,
    graph: upgradedGraph,
  };
};

interface GlobalConfigSnapshot {
  app_name: string;
  app_version: string;
  environment: "development" | "staging" | "production";
  logging: { enabled: boolean; level: "debug" | "info" | "warn" | "error" };
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DATA_ANALYST_PROMPT =
  "You are a data analyst assistant. The user is viewing a result dataset. Answer questions clearly and concisely with insights, trends, patterns, and actionable recommendations. Structure your response with headings and bullet points for clarity.";

const CHART_BUILDER_PROMPT =
  "You are a data visualization expert. When asked for a chart, return ONLY a self-contained HTML block: a container div with id='chart' and style='height:400px', followed by a script tag loading ECharts from 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js', then an init script using document.getElementById('chart'). Output no text outside the HTML block.";

const AI_INSIGHT_PROMPT =
  "You are a business intelligence expert. For the given data, provide: 1) A concise summary paragraph, 2) 3-5 key bullet point insights, 3) A self-contained ECharts HTML visualization at the end. The visualization must be a <div id='chart' style='height:400px'></div> followed by the ECharts CDN <script> tag and an init script that calls document.getElementById('chart').";

const SWITCHABLE_CHART_PROMPT =
  "Analyze the JSON data and return JSON only. Required keys: summary (string), insights (string[]), visualization (object). Choose the best visualization type from: 'bar'|'line'|'area'|'scatter'|'pie'|'radial'|'treemap'|'network'|'map'. Provide the matching data structure: data[] for cartesian/pie/radial types, nodes[]+links[] for network, hierarchy object for treemap, data[] with lat/lng fields for map. Keep labels concise and aggregate long-tail items as 'Other'. The user can switch to another compatible chart type in the UI after generation.";

const createSkillsFrameworkDescriptionAgent = (): LlmAgent => ({
  id: SKILLS_FRAMEWORK_DESCRIPTION_AGENT_ID,
  name: "Skills Framework Description Agent",
  description: "Generates JSON framework descriptions for the interactive skill refinement workflow",
  systemPrompt: FRAMEWORK_DESCRIPTION_AGENT_PROMPT,
  expectedOutput: "auto",
  fallbackOutput: "json",
  outputInstructions: OUTPUT_OPTIONS.find((o) => o.value === "json")!.defaultInstructions,
  mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [], skillIds: [SKILLS_FRAMEWORK_DESCRIPTION_SKILL_ID],
  targetResources: [],
  inputSources: ["result"],
  defaultPrompts: [],
  enabled: true, ragSources: "none", ragMode: "none", ragTopK: 20,
  resultContextMode: "chunked", resultChunkSize: 2000,
});

const createDocumentBasedSkillDescriptionAgent = (): LlmAgent => ({
  id: DOCUMENT_BASED_SKILL_DESCRIPTION_AGENT_ID,
  name: "Document-Based Skill Description Agent",
  description: "Generates selected-skill descriptions from uploaded-document evidence sentences",
  systemPrompt: DOCUMENT_BASED_SKILL_DESCRIPTION_AGENT_PROMPT,
  expectedOutput: "auto",
  fallbackOutput: "json",
  outputInstructions: OUTPUT_OPTIONS.find((o) => o.value === "json")!.defaultInstructions,
  mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [],
  skillIds: [DOCUMENT_BASED_SKILL_DESCRIPTION_SKILL_ID],
  targetResources: [],
  inputSources: ["document", "user_upload"],
  defaultPrompts: ["Act as HR expert, generate the document-based description for the selected skill."],
  enabled: true, ragSources: "document", ragMode: "auto", ragTopK: 20,
  resultContextMode: "full", resultChunkSize: 12000,
});

const createLightcastSkillDescriptionAgent = (): LlmAgent => ({
  id: "lightcast-skill-description-agent",
  name: "Web Search — Standard Skill Description",
  description: "Retrieve exact official descriptions from public Lightcast taxonomy pages using OpenAI web search.",
  systemPrompt: lightcastSkillDescriptionPrompt.trim(),
  webSearch: { allowedDomains: ["lightcast.io"], resultPolicy: "lightcast" },
  expectedOutput: "json", fallbackOutput: "json",
  outputInstructions: "Return only JSON with skillLabel, matchedSkill, framework, skillId, description, source, and status. Return not_found with null match fields when the official page or description cannot be reliably retrieved.",
  mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [], skillIds: [],
  targetResources: [], inputSources: ["result"],
  defaultPrompts: ['Find the official Lightcast description for {"skillLabel":"project management"}.'],
  enabled: true, ragSources: "none", ragMode: "none", ragTopK: 20,
  resultContextMode: "full", resultChunkSize: 12000,
});

// ─── Output type options (must be before DEFAULT_AGENTS) ──────────────────────

const OUTPUT_OPTIONS: Array<{
  value: LlmAgent["expectedOutput"];
  label: string;
  description: string;
  color: string;
  defaultInstructions: string;
}> = [
  {
    value: "auto",
    label: "Auto / Skill-controlled",
    description: "Activated skill controls output; otherwise the fallback applies",
    color: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
    defaultInstructions: "",
  },
  {
    value: "text",
    label: "Text",
    description: "Markdown prose — headings, bullets, bold",
    color: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
    defaultInstructions:
      "Respond in clear, well-structured markdown.\n" +
      "Use ## headings for sections, **bold** for key terms, and - bullet lists for findings.\n" +
      "Keep the response concise and actionable.",
  },
  {
    value: "json",
    label: "JSON",
    description: "Structured JSON object — parseable, schema-defined",
    color: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    defaultInstructions:
      "Return ONLY valid JSON. No markdown, no code fences, no text before or after the JSON object.\n\n" +
      "Required keys:\n" +
      '- "summary": string — one-paragraph overview\n' +
      '- "insights": string[] — 3–5 key findings as an array of strings\n' +
      '- "data": any — structured data relevant to the question',
  },
  {
    value: "html",
    label: "HTML Chart",
    description: "Self-contained ECharts HTML block rendered in an iframe",
    color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    defaultInstructions:
      "Return ONLY a self-contained HTML visualization. No text outside the HTML block.\n\n" +
      "Required structure:\n" +
      '<div id="chart" style="height:400px"></div>\n' +
      '<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>\n' +
      "<script>\n" +
      "  const chart = echarts.init(document.getElementById('chart'));\n" +
      "  chart.setOption({ /* ECharts option object */ });\n" +
      "</script>",
  },
  {
    value: "mixed",
    label: "Mixed",
    description: "Markdown analysis followed by an ECharts HTML chart",
    color: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
    defaultInstructions:
      "Structure your response in two parts:\n\n" +
      "1. **Analysis** — 2–3 paragraphs of insight plus a bullet-point summary in markdown.\n" +
      '2. **Visualization** — immediately after the text, append a self-contained ECharts HTML block starting with <div id="chart" style="height:400px">.',
  },
];

const DEFAULT_AGENTS: LlmAgent[] = [
  {
    id: "data-analyst",
    name: "Data Analyst",
    description: "General data analysis, insights, and trend identification",
    systemPrompt: DATA_ANALYST_PROMPT,
    expectedOutput: "text",
    fallbackOutput: "text",
    outputInstructions: OUTPUT_OPTIONS.find((o) => o.value === "text")!.defaultInstructions,
    mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [], skillIds: [],
    targetResources: [],
    inputSources: ["result", "document", "user_upload"],
    defaultPrompts: [
      "Summarize the key findings in 3 bullet points",
      "Which item has the highest value and why might that be?",
      "Are there any outliers or anomalies in this data?",
      "What trends do you see?",
    ],
    enabled: true, ragSources: "all", ragMode: "auto", ragTopK: 20,
    resultContextMode: "full", resultChunkSize: 12000,
  },
  {
    id: "chart-builder",
    name: "Chart Builder",
    description: "Creates interactive ECharts visualizations from data",
    systemPrompt: CHART_BUILDER_PROMPT,
    expectedOutput: "html",
    fallbackOutput: "html",
    outputInstructions: OUTPUT_OPTIONS.find((o) => o.value === "html")!.defaultInstructions,
    mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [], skillIds: [],
    targetResources: [],
    inputSources: ["result", "document", "user_upload"],
    defaultPrompts: [
      "Show me a bar chart of the top 10 results",
      "Create a pie chart of the data distribution",
      "Show a line chart of values over time",
      "Visualize the top 5 items as a horizontal bar chart",
    ],
    enabled: true, ragSources: "all", ragMode: "auto", ragTopK: 20,
    resultContextMode: "full", resultChunkSize: 12000,
  },
  {
    id: "ai-insight",
    name: "AI Insight",
    description: "Full analysis with written insights and a chart visualization",
    systemPrompt: AI_INSIGHT_PROMPT,
    expectedOutput: "mixed",
    fallbackOutput: "mixed",
    outputInstructions: OUTPUT_OPTIONS.find((o) => o.value === "mixed")!.defaultInstructions,
    mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [], skillIds: [],
    targetResources: [],
    inputSources: ["result", "document", "user_upload"],
    defaultPrompts: [
      "Generate a complete AI insight with visualization for this data",
      "Give me a business summary with a supporting chart",
      "Analyze this data and show me the most important visualization",
    ],
    enabled: true, ragSources: "all", ragMode: "auto", ragTopK: 20,
    resultContextMode: "full", resultChunkSize: 12000,
  },
  {
    id: "switchable-chart",
    name: "Switchable Chart",
    description: "Returns structured JSON with summary, insights, and a switchable chart spec",
    systemPrompt: SWITCHABLE_CHART_PROMPT,
    expectedOutput: "json",
    fallbackOutput: "json",
    outputInstructions:
      'Return ONLY valid JSON. No markdown, no code fences.\n\nRequired keys:\n- "summary": string\n- "insights": string[]\n- "visualization": { "type": "bar"|"line"|"pie"|"scatter"|"area", "data": array, "labels"?: string[] }',
    mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [], skillIds: [],
    targetResources: [],
    inputSources: ["result", "document", "user_upload"],
    defaultPrompts: [
      "Analyze this data and generate an interactive chart I can switch between types",
      "Generate a summary with insights and a switchable visualization",
      "What is the best chart type for this data? Show me the result",
    ],
    enabled: true, ragSources: "all", ragMode: "auto", ragTopK: 20,
    resultContextMode: "full", resultChunkSize: 12000,
  },
  createSkillsFrameworkDescriptionAgent(),
  createDocumentBasedSkillDescriptionAgent(),
];

const DEFAULT_CONFIG: LlmInsightsConfig = {
  enabled: false,
  providers: [],
  mcpServers: [],
  agents: DEFAULT_AGENTS,
  skills: [
    createSkillsFrameworkMapperTemplate(),
    createDocumentBasedSkillDescriptionTemplate(),
    createSkillsFrameworkDescriptionTemplate(),
  ],
  predefinedPrompts: [],
  workflows: [],
};

const DEFAULT_GLOBAL_SNAPSHOT: GlobalConfigSnapshot = {
  app_name: "Data Analytics Platform",
  app_version: "1.0.0",
  environment: "production",
  logging: { enabled: true, level: "info" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => crypto.randomUUID();
const keepWithinRecycleRetention = (item: { deletedAt?: string }) => {
  if (!item.deletedAt) return true;
  const deletedAt = Date.parse(item.deletedAt);
  return !Number.isFinite(deletedAt) || deletedAt + RECYCLE_RETENTION_MS > Date.now();
};

const workflowContent = (workflow: WorkflowConfig) => {
  const { revision: _revision, revisionHistory: _history, lastSavedAt: _savedAt, lastSavedBy: _savedBy, ...content } = workflow;
  return content;
};

const workflowSnapshot = (workflow: WorkflowConfig): WorkflowRevision["snapshot"] => {
  const { revisionHistory: _history, ...snapshot } = structuredClone(workflow);
  return snapshot;
};

const summarizeWorkflowChanges = (previous: WorkflowConfig | undefined, next: WorkflowConfig): string[] => {
  if (!previous) return ["Workflow created"];
  const changes: string[] = [];
  if (previous.name !== next.name) changes.push(`Renamed from “${previous.name}” to “${next.name}”`);
  if (previous.description !== next.description) changes.push("Description changed");
  if (previous.enabled !== next.enabled) changes.push(next.enabled ? "Workflow enabled" : "Workflow disabled");
  if (previous.deletedAt !== next.deletedAt) changes.push(next.deletedAt ? "Moved to recycle bin" : "Restored from recycle bin");
  if (JSON.stringify(previous.targetResources ?? []) !== JSON.stringify(next.targetResources ?? [])) changes.push("Availability assignments changed");
  if (JSON.stringify(previous.execution ?? {}) !== JSON.stringify(next.execution ?? {})) changes.push("Execution and integration settings changed");
  if (JSON.stringify(previous.state ?? {}) !== JSON.stringify(next.state ?? {})) changes.push("Execution state schema changed");
  if (JSON.stringify(previous.graph) !== JSON.stringify(next.graph)) {
    const nodeDelta = next.graph.nodes.length - previous.graph.nodes.length;
    const edgeDelta = next.graph.edges.length - previous.graph.edges.length;
    const details = [nodeDelta ? `${nodeDelta > 0 ? "+" : ""}${nodeDelta} nodes` : "", edgeDelta ? `${edgeDelta > 0 ? "+" : ""}${edgeDelta} connections` : ""].filter(Boolean);
    changes.push(details.length ? `Workflow graph changed (${details.join(", ")})` : "Workflow nodes or connections changed");
  }
  return changes.length > 0 ? changes : ["Workflow configuration changed"];
};

const addWorkflowRevisions = (nextWorkflows: WorkflowConfig[], savedWorkflows: WorkflowConfig[], actor: WorkflowRevisionActor, savedAt: string): WorkflowConfig[] => nextWorkflows.map((nextWorkflow) => {
  const previous = savedWorkflows.find((workflow) => workflow.id === nextWorkflow.id);
  if (previous && JSON.stringify(workflowContent(previous)) === JSON.stringify(workflowContent(nextWorkflow))) {
    return { ...nextWorkflow, revision: previous.revision, revisionHistory: previous.revisionHistory, lastSavedAt: previous.lastSavedAt, lastSavedBy: previous.lastSavedBy };
  }
  const history = [...(previous?.revisionHistory ?? [])];
  let previousVersion = previous?.revision ?? 0;
  if (previous && history.length === 0) {
    previousVersion = 1;
    const baselineActor = previous.lastSavedBy ?? { name: "Saved before version tracking" };
    const baseline: WorkflowConfig = { ...previous, revision: 1, lastSavedAt: previous.lastSavedAt ?? previous.createdAt ?? savedAt, lastSavedBy: baselineActor };
    history.push({ id: crypto.randomUUID(), version: 1, savedAt: baseline.lastSavedAt!, savedBy: baselineActor, changes: ["Initial saved version"], snapshot: workflowSnapshot(baseline) });
  }
  const revision = previousVersion + 1 || 1;
  const audited: WorkflowConfig = { ...nextWorkflow, revision, lastSavedAt: savedAt, lastSavedBy: actor };
  history.push({ id: crypto.randomUUID(), version: revision, savedAt, savedBy: actor, changes: summarizeWorkflowChanges(previous, nextWorkflow), snapshot: workflowSnapshot(audited) });
  return { ...audited, revisionHistory: history };
});

type AgentInputSource = LlmAgent["inputSources"][number];

const normalizeAgentInputSources = (value: unknown, ragSources?: unknown): LlmAgent["inputSources"] => {
  if (Array.isArray(value)) {
    return [...new Set(value
      .map(String)
      .filter((source): source is AgentInputSource =>
        source === "result" || source === "document" || source === "user_upload"
      ))];
  }

  switch (String(ragSources ?? "all")) {
    case "result":
      return ["result"];
    case "document":
      return ["document", "user_upload"];
    case "none":
      return [];
    case "all":
    default:
      return ["result", "document", "user_upload"];
  }
};

const moveItem = <T,>(arr: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

const ensureBuiltInSkills = (skills: AgentSkill[]): AgentSkill[] => {
  const next = [...skills];
  if (!next.some((skill) => skill.id === "skills-framework-mapper")) {
    next.push(createSkillsFrameworkMapperTemplate());
  }
  if (!next.some((skill) => skill.id === "document-based-skill-description")) {
    next.push(createDocumentBasedSkillDescriptionTemplate());
  }
  if (!next.some((skill) => skill.id === SKILLS_FRAMEWORK_DESCRIPTION_SKILL_ID)) {
    next.push(createSkillsFrameworkDescriptionTemplate());
  }
  return next;
};

const ensureBuiltInAgents = (agents: LlmAgent[]): LlmAgent[] => {
  const next = [...agents];
  if (!next.some((agent) => agent.id === SKILLS_FRAMEWORK_DESCRIPTION_AGENT_ID)) {
    next.push(createSkillsFrameworkDescriptionAgent());
  }
  if (!next.some((agent) => agent.id === DOCUMENT_BASED_SKILL_DESCRIPTION_AGENT_ID)) {
    next.push(createDocumentBasedSkillDescriptionAgent());
  }
  return next;
};

const emptyProvider = (): LlmProvider => ({
  id: uid(), name: "", providerType: "openai", apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "", model: "gpt-4o-mini", enabled: true,
});

const emptyMcpServer = (): McpServer => ({
  id: uid(), name: "", url: "", apiKey: "", enabled: true,
});

const emptyAgent = (): LlmAgent => ({
  id: uid(), name: "New Agent", description: "",
  systemPrompt: "You are a helpful data assistant. Answer questions about the result data clearly and concisely.",
  expectedOutput: "text",
  fallbackOutput: "text",
  outputInstructions: OUTPUT_OPTIONS.find((o) => o.value === "text")!.defaultInstructions,
  mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [], defaultPrompts: [], enabled: true,
  skillIds: [],
  targetResources: [],
  inputSources: ["result"],
  ragSources: "result", ragMode: "auto", ragTopK: 20,
  resultContextMode: "full", resultChunkSize: 12000,
});

const migrateFromLegacy = (raw: Record<string, unknown>): LlmInsightsConfig => {
  const inferProviderType = (provider: Partial<LlmProvider>): LlmProvider["providerType"] => {
    if (["openai", "anthropic", "gemini", "openai_compatible"].includes(String(provider.providerType))) return provider.providerType as LlmProvider["providerType"];
    const url = String(provider.apiBaseUrl || "").toLowerCase();
    if (url.includes("anthropic.com")) return "anthropic";
    if (url.includes("generativelanguage.googleapis.com")) return "gemini";
    if (url.includes("api.openai.com")) return "openai";
    return "openai_compatible";
  };
  const hasProviders = Array.isArray(raw.providers) && (raw.providers as unknown[]).length > 0;
  const providers: LlmProvider[] = hasProviders
    ? (raw.providers as LlmProvider[]).map((p) => ({
        id: String(p.id || uid()), name: String(p.name || ""),
        providerType: inferProviderType(p),
        apiBaseUrl: String(p.apiBaseUrl || "https://api.openai.com/v1"),
        apiKey: String(p.apiKey || ""), model: String(p.model || "gpt-4o-mini"),
        enabled: p.enabled !== false,
        deletedAt: typeof p.deletedAt === "string" && p.deletedAt ? p.deletedAt : undefined,
        deletedPreviousEnabled: typeof p.deletedPreviousEnabled === "boolean" ? p.deletedPreviousEnabled : undefined,
      })).filter(keepWithinRecycleRetention)
    : typeof raw.apiKey === "string" && raw.apiKey
    ? [{ id: uid(), name: "Default", providerType: "openai" as const, apiBaseUrl: String(raw.apiBaseUrl || "https://api.openai.com/v1"),
        apiKey: String(raw.apiKey), model: String(raw.model || "gpt-4o-mini"), enabled: true }]
    : [];

  const mcpServers: McpServer[] = Array.isArray(raw.mcpServers)
    ? (raw.mcpServers as McpServer[]).map((s) => ({
        id: String(s.id || uid()), name: String(s.name || ""),
        url: String(s.url || ""), apiKey: String(s.apiKey || ""),
        enabled: s.enabled !== false,
        deletedAt: typeof s.deletedAt === "string" && s.deletedAt ? s.deletedAt : undefined,
        deletedPreviousEnabled: typeof s.deletedPreviousEnabled === "boolean" ? s.deletedPreviousEnabled : undefined,
      })).filter(keepWithinRecycleRetention)
    : [];

  // Migrate agents or use defaults
  let agents: LlmAgent[];
  if (Array.isArray(raw.agents) && (raw.agents as unknown[]).length > 0) {
    agents = (raw.agents as LlmAgent[]).map((a) => ({
      id: String(a.id || uid()),
      name: String(a.name || "Agent"),
      description: String(a.description || ""),
      systemPrompt: String(a.systemPrompt || ""),
      webSearch: a.webSearch && Array.isArray(a.webSearch.allowedDomains)
        ? { allowedDomains: a.webSearch.allowedDomains.map(String), ...(a.webSearch.resultPolicy === "lightcast" ? { resultPolicy: "lightcast" as const } : {}) }
        : undefined,
      expectedOutput: (() => {
        const raw = String(a.expectedOutput ?? "text");
        if (raw === "echarts") return "html";
        if (raw === "table") return "text";
        return (["auto", "text", "json", "html", "mixed"].includes(raw) ? raw : "text") as LlmAgent["expectedOutput"];
      })(),
      fallbackOutput: (["text", "json", "html", "mixed"].includes(String(a.fallbackOutput))
        ? a.fallbackOutput
        : (["text", "json", "html", "mixed"].includes(String(a.expectedOutput)) ? a.expectedOutput : "text")) as LlmAgent["fallbackOutput"],
      outputInstructions: typeof a.outputInstructions === "string" && a.outputInstructions
        ? a.outputInstructions
        : (() => {
            const raw = String(a.expectedOutput ?? "text");
            const mapped = raw === "echarts" ? "html" : raw === "table" ? "text" : raw;
            return OUTPUT_OPTIONS.find((o) => o.value === mapped)?.defaultInstructions ?? OUTPUT_OPTIONS.find((o) => o.value === "text")!.defaultInstructions;
          })(),
      mcpServerIds: Array.isArray(a.mcpServerIds) ? (a.mcpServerIds as unknown[]).map(String) : [],
      mcpToolFilter: (a.mcpToolFilter && typeof a.mcpToolFilter === "object" && !Array.isArray(a.mcpToolFilter))
        ? Object.fromEntries(
            Object.entries(a.mcpToolFilter as Record<string, unknown>).map(([k, v]) => [
              k, Array.isArray(v) ? (v as unknown[]).map(String) : [],
            ])
          )
        : {},
      providerIds: Array.isArray(a.providerIds) ? (a.providerIds as unknown[]).map(String) : [],
      agentProviders: Array.isArray(a.agentProviders)
        ? (a.agentProviders as LlmProvider[]).map((p) => ({
            id: String(p.id || uid()), name: String(p.name || ""),
            providerType: inferProviderType(p),
            apiBaseUrl: String(p.apiBaseUrl || "https://api.openai.com/v1"),
            apiKey: String(p.apiKey || ""), model: String(p.model || "gpt-4o-mini"),
            enabled: p.enabled !== false,
          }))
        : [],
      defaultPrompts: Array.isArray(a.defaultPrompts) ? (a.defaultPrompts as unknown[]).map(String).filter(Boolean) : [],
      skillIds: Array.isArray(a.skillIds) ? (a.skillIds as unknown[]).map(String) : [],
      targetResources: Array.isArray(a.targetResources) ? (a.targetResources as unknown[]).map(String) : [],
      inputSources: normalizeAgentInputSources((a as LlmAgent & { inputSources?: unknown }).inputSources, a.ragSources),
      enabled: a.enabled !== false,
      ragSources: (["all", "result", "document", "none"].includes(String(a.ragSources ?? "")) ? a.ragSources : "all") as LlmAgent["ragSources"],
      ragMode: (["auto", "chunks", "none"].includes(String(a.ragMode ?? "")) ? a.ragMode : "auto") as LlmAgent["ragMode"],
      ragTopK: typeof a.ragTopK === "number" && a.ragTopK > 0 ? a.ragTopK : 20,
      resultContextMode: (["full", "chunked"].includes(String((a as LlmAgent & { resultContextMode?: unknown }).resultContextMode ?? ""))
        ? (a as LlmAgent & { resultContextMode?: "full" | "chunked" }).resultContextMode
        : "full") as LlmAgent["resultContextMode"],
      resultChunkSize: typeof (a as LlmAgent & { resultChunkSize?: unknown }).resultChunkSize === "number" &&
        Number.isFinite((a as LlmAgent & { resultChunkSize?: number }).resultChunkSize) &&
        ((a as LlmAgent & { resultChunkSize?: number }).resultChunkSize ?? 0) > 0
          ? Math.min(Math.max(Math.round((a as LlmAgent & { resultChunkSize?: number }).resultChunkSize ?? 12000), 2000), 50000)
          : 12000,
      deletedAt: typeof a.deletedAt === "string" && a.deletedAt ? a.deletedAt : undefined,
      deletedPreviousEnabled: typeof a.deletedPreviousEnabled === "boolean" ? a.deletedPreviousEnabled : undefined,
    })).filter(keepWithinRecycleRetention).map((agent) => agent.skillIds.length > 0 && agent.expectedOutput !== "auto"
      ? { ...agent, fallbackOutput: agent.expectedOutput, expectedOutput: "auto" as const }
      : agent);
  } else {
    // Legacy: if there's a chatSystemPrompt, create a single agent from it
    const legacyPrompt = typeof raw.chatSystemPrompt === "string" ? raw.chatSystemPrompt.trim() : "";
    const legacyPredefined = Array.isArray(raw.predefinedPrompts)
      ? (raw.predefinedPrompts as unknown[]).map(String).filter(Boolean)
      : [];
    if (legacyPrompt) {
      agents = [{
        ...DEFAULT_AGENTS[0],
        id: uid(),
        systemPrompt: legacyPrompt,
        outputInstructions: OUTPUT_OPTIONS.find((o) => o.value === "text")!.defaultInstructions,
        fallbackOutput: "text",
        mcpToolFilter: {},
        providerIds: [],
        agentProviders: [],
        skillIds: [],
        defaultPrompts: legacyPredefined.length > 0 ? legacyPredefined : DEFAULT_AGENTS[0].defaultPrompts,
      }, DEFAULT_AGENTS[1], DEFAULT_AGENTS[2]];
    } else {
      agents = DEFAULT_AGENTS;
    }
  }

  // Global predefined prompts (not agent-tied) — if the DB had a predefinedPrompts array
  // and agents were already migrated separately, keep it; otherwise start empty.
  const predefinedPrompts: string[] = Array.isArray(raw.predefinedPrompts) && Array.isArray(raw.agents)
    ? (raw.predefinedPrompts as unknown[]).map(String).filter(Boolean)
    : [];

  const skills: AgentSkill[] = Array.isArray(raw.skills)
    ? (raw.skills as AgentSkill[]).map((skill) => ({
        id: String(skill.id || uid()),
        name: String(skill.name || "Agent Skill"),
        description: String(skill.description || ""),
        objective: String(skill.objective || ""),
        instructions: String(skill.instructions || ""),
        requiredInputs: Array.isArray(skill.requiredInputs) ? skill.requiredInputs.map((field) => ({
          id: String(field.id || uid()),
          key: String(field.key || ""),
          label: String(field.label || ""),
          type: (["text", "number", "boolean", "json", "document"].includes(String(field.type)) ? field.type : "text") as AgentSkill["requiredInputs"][number]["type"],
          description: String(field.description || ""),
          required: field.required !== false,
          defaultValue: typeof field.defaultValue === "string" ? field.defaultValue : undefined,
        })) : [],
        outputTemplate: String(skill.outputTemplate || ""),
        outputType: (["text", "json", "html", "mixed"].includes(String(skill.outputType)) ? skill.outputType : "text") as AgentSkill["outputType"],
        references: Array.isArray(skill.references) ? skill.references.map((reference) => ({
          id: String(reference.id || uid()),
          name: String(reference.name || ""),
          description: String(reference.description || ""),
          content: String(reference.content || ""),
        })) : [],
        enabled: skill.enabled !== false,
        version: typeof skill.version === "number" && skill.version > 0 ? skill.version : 1,
        deletedAt: typeof skill.deletedAt === "string" && skill.deletedAt ? skill.deletedAt : undefined,
        deletedPreviousEnabled: typeof skill.deletedPreviousEnabled === "boolean" ? skill.deletedPreviousEnabled : undefined,
      })).filter(keepWithinRecycleRetention)
    : [
        createSkillsFrameworkMapperTemplate(),
        createDocumentBasedSkillDescriptionTemplate(),
        createSkillsFrameworkDescriptionTemplate(),
      ];

  // Workflows — migrate from old single `workflow` field if present, then use array
  let workflows: WorkflowConfig[] = [];
  if (Array.isArray(raw.workflows)) {
    workflows = (raw.workflows as WorkflowConfig[]).map((w) => upgradeBuiltInWorkflowTemplate({
      id: String(w.id || uid()),
      name: String(w.name || "Workflow"),
      description: String(w.description || ""),
      enabled: w.enabled !== false,
      execution: w.execution && typeof w.execution === "object" ? w.execution : undefined,
      targetResources: Array.isArray(w.targetResources) ? w.targetResources.map(String) : [],
      graph: (w.graph && typeof w.graph === "object") ? w.graph : { nodes: [], edges: [] },
      createdAt: String(w.createdAt || new Date().toISOString()),
      deletedAt: typeof w.deletedAt === "string" && w.deletedAt ? w.deletedAt : undefined,
      deletedPreviousEnabled: typeof w.deletedPreviousEnabled === "boolean" ? w.deletedPreviousEnabled : undefined,
      revision: typeof w.revision === "number" && w.revision > 0 ? w.revision : undefined,
      revisionHistory: Array.isArray(w.revisionHistory) ? w.revisionHistory : [],
      lastSavedAt: typeof w.lastSavedAt === "string" ? w.lastSavedAt : undefined,
      lastSavedBy: w.lastSavedBy && typeof w.lastSavedBy === "object" ? w.lastSavedBy : undefined,
    })).filter((workflow) => {
      if (!workflow.deletedAt) return true;
      const deletedAt = Date.parse(workflow.deletedAt);
      return !Number.isFinite(deletedAt) || deletedAt + RECYCLE_RETENTION_MS > Date.now();
    });
  } else if (raw.workflow && typeof raw.workflow === "object") {
    // Migrate legacy single workflow
    const legacyGraph = raw.workflow as { nodes?: unknown[]; edges?: unknown[] };
    if (Array.isArray(legacyGraph.nodes) && legacyGraph.nodes.length > 0) {
      workflows = [{
        id: uid(),
        name: "Workflow",
        description: "",
        enabled: true,
        targetResources: [],
        graph: legacyGraph as WorkflowConfig["graph"],
        createdAt: new Date().toISOString(),
      }];
    }
  }

  return {
    enabled: Boolean(raw.enabled ?? false),
    providers,
    mcpServers,
    agents: ensureBuiltInAgents(agents),
    skills: ensureBuiltInSkills(skills),
    predefinedPrompts,
    workflows,
  };
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ProviderCardProps {
  provider: LlmProvider; index: number; total: number;
  onChange: (updated: LlmProvider) => void;
  onMove: (from: number, to: number) => void;
  showListControls?: boolean;
  onRemove: () => void;
}

const ProviderCard = ({ provider, index, total, onChange, onMove, onRemove, showListControls = true }: ProviderCardProps) => {
  const [showKey, setShowKey] = useState(false);
  const label = index === 0 ? "Primary" : `Fallback ${index}`;

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card">
      <div className="flex items-center gap-2">
        {showListControls && <Badge variant={index === 0 ? "default" : "secondary"} className="shrink-0">{label}</Badge>}
        <Input className="h-8 text-sm font-medium" placeholder="Provider name (e.g. OpenAI, Groq)"
          value={provider.name} onChange={(e) => onChange({ ...provider, name: e.target.value })} />
        <div className="flex items-center gap-1 ml-auto shrink-0">
          {showListControls && <>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={index === 0}
            onClick={() => onMove(index, index - 1)}><ChevronUp className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={index === total - 1}
            onClick={() => onMove(index, index + 1)}><ChevronDown className="h-4 w-4" /></Button>
          </>}
          <Switch checked={provider.enabled} onCheckedChange={(v) => onChange({ ...provider, enabled: v })} />
          {showListControls && <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Provider family</Label>
          <Select value={provider.providerType} onValueChange={(providerType: LlmProvider["providerType"]) => {
            const defaults = providerType === "openai" ? { apiBaseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" }
              : providerType === "anthropic" ? { apiBaseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" }
              : providerType === "gemini" ? { apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash" }
              : { apiBaseUrl: provider.apiBaseUrl, model: provider.model };
            onChange({ ...provider, providerType, ...defaults });
          }}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="openai">OpenAI</SelectItem><SelectItem value="anthropic">Anthropic</SelectItem><SelectItem value="gemini">Google Gemini</SelectItem><SelectItem value="openai_compatible">Local / OpenAI-compatible</SelectItem></SelectContent></Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">API Base URL</Label>
          <Input className="h-8 text-xs" placeholder="https://api.openai.com/v1" value={provider.apiBaseUrl}
            onChange={(e) => onChange({ ...provider, apiBaseUrl: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Model</Label>
          <Input className="h-8 text-xs" placeholder="gpt-4o-mini" value={provider.model}
            onChange={(e) => onChange({ ...provider, model: e.target.value })} />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">API Key</Label>
          <div className="relative">
            <Input className="h-8 text-xs pr-9" type={showKey ? "text" : "password"} placeholder="sk-..."
              value={provider.apiKey} onChange={(e) => onChange({ ...provider, apiKey: e.target.value })} />
            <button type="button" className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
              onClick={() => setShowKey((v) => !v)}>
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
      <p className="rounded-md border bg-muted/30 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
        {provider.providerType === "openai" && "Native attachments use the Responses API input_file format."}
        {provider.providerType === "anthropic" && "Native document blocks support PDF and plain-text formats. DOC/DOCX/XLS/XLSX require another configured provider or conversion."}
        {provider.providerType === "gemini" && "Attachments use Gemini inline file data. Actual format support depends on the selected Gemini model."}
        {provider.providerType === "openai_compatible" && "Local models receive OpenAI Responses-compatible input_file data. The local server must implement /responses and file input; an API key is optional."}
      </p>
    </div>
  );
};

// ─── MCP test result types ────────────────────────────────────────────────────

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpTestResult {
  ok: boolean;
  latencyMs?: number;
  tools?: McpTool[];
  serverInfo?: { name?: string; version?: string };
  error?: string;
  hint?: string;
}

// Proxy the MCP test through the Edge Function to avoid CORS restrictions.
// The Deno runtime on the server side can reach any HTTP endpoint freely.
async function testMcpServer(
  url: string,
  apiKey: string,
  supabaseClient: typeof import("@/integrations/supabase/client").supabase,
  organizationId?: string,
): Promise<McpTestResult> {
  if (!url.trim()) return { ok: false, error: "No URL configured." };

  const { data, error } = await supabaseClient.functions.invoke("mcp-test", {
    body: { url: url.trim(), apiKey: apiKey.trim() || undefined },
    headers: organizationId ? { "x-organization-id": organizationId } : undefined,
  });

  if (error) {
    // FunctionsHttpError surfaces the function's JSON body in error.context
    const ctx = (error as { context?: { error?: string; hint?: string } }).context;
    return {
      ok: false,
      error: ctx?.error ?? error.message ?? String(error),
      hint: ctx?.hint,
    };
  }

  return data as McpTestResult;
}

// ─── MCP card ─────────────────────────────────────────────────────────────────

interface McpCardProps {
  server: McpServer; index: number;
  supabaseClient: typeof supabase;
  organizationId?: string;
  onChange: (updated: McpServer) => void;
  onRemove: () => void;
  showRemove?: boolean;
}

const McpCard = ({ server, supabaseClient, organizationId, onChange, onRemove, showRemove = true }: McpCardProps) => {
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<McpTestResult | null>(null);
  const [showTools, setShowTools] = useState(false);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    setShowTools(false);
    const result = await testMcpServer(server.url, server.apiKey, supabaseClient, organizationId);
    setTestResult(result);
    setTesting(false);
    if (result.ok && result.tools && result.tools.length > 0) setShowTools(true);
  };

  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      {/* Header row */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <Input className="h-8 text-sm font-medium" placeholder="Server name (e.g. Analytics MCP)"
          value={server.name} onChange={(e) => onChange({ ...server, name: e.target.value })} />
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <Switch checked={server.enabled} onCheckedChange={(v) => onChange({ ...server, enabled: v })} />
          {showRemove && <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>}
        </div>
      </div>

      {/* Fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-4 pb-3">
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">MCP Endpoint URL</Label>
          <Input className="h-8 text-xs" placeholder="https://your-mcp-server.com/mcp"
            value={server.url} onChange={(e) => onChange({ ...server, url: e.target.value })} />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">API Key (optional)</Label>
          <div className="relative">
            <Input className="h-8 text-xs pr-9" type={showKey ? "text" : "password"} placeholder="Bearer token or API key"
              value={server.apiKey} onChange={(e) => onChange({ ...server, apiKey: e.target.value })} />
            <button type="button" className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
              onClick={() => setShowKey((v) => !v)}>
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Test bar */}
      <div className="border-t border-border/60 bg-muted/30 px-4 py-2.5 flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs h-7"
          disabled={testing || !server.url.trim()} onClick={runTest}>
          {testing
            ? <><Loader2 className="h-3 w-3 animate-spin" />Testing…</>
            : <><FlaskConical className="h-3 w-3" />Test Connection</>}
        </Button>

        {testResult && !testing && (
          <div className="flex items-center gap-2 text-xs min-w-0">
            {testResult.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
            )}
            {testResult.ok ? (
              <span className="text-green-600 dark:text-green-400 font-medium">
                Connected
                {testResult.serverInfo?.name && ` · ${testResult.serverInfo.name}${testResult.serverInfo.version ? ` v${testResult.serverInfo.version}` : ""}`}
                {testResult.latencyMs !== undefined && ` · ${testResult.latencyMs}ms`}
                {testResult.tools !== undefined && ` · ${testResult.tools.length} tool${testResult.tools.length === 1 ? "" : "s"}`}
              </span>
            ) : (
              <span className="text-destructive truncate">{testResult.error}</span>
            )}

            {testResult.ok && testResult.tools && testResult.tools.length > 0 && (
              <button type="button"
                className="ml-auto shrink-0 flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowTools((v) => !v)}>
                <Wrench className="h-3 w-3" />
                <span>{showTools ? "Hide" : "Show"} tools</span>
                <ChevronRight className={`h-3 w-3 transition-transform ${showTools ? "rotate-90" : ""}`} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Error hint */}
      {testResult && !testResult.ok && testResult.hint && (
        <div className="border-t border-border/60 bg-amber-50 dark:bg-amber-950/20 px-4 py-2 text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{testResult.hint}</span>
        </div>
      )}

      {/* Error detail (for partial success) */}
      {testResult?.ok && testResult.error && (
        <div className="border-t border-border/60 bg-amber-50 dark:bg-amber-950/20 px-4 py-2 text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{testResult.error}</span>
        </div>
      )}

      {/* Tools list */}
      {showTools && testResult?.tools && testResult.tools.length > 0 && (
        <div className="border-t border-border/60 px-4 py-3 space-y-2 bg-muted/20">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Discovered tools ({testResult.tools.length})
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {testResult.tools.map((tool, i) => (
              <div key={i} className="border border-border/60 rounded-md px-3 py-2 bg-background space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <Wrench className="h-3 w-3 text-primary shrink-0" />
                  <span className="text-xs font-mono font-semibold text-foreground">{tool.name}</span>
                </div>
                {tool.description && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed pl-4">{tool.description}</p>
                )}
                {tool.inputSchema && (
                  <details className="pl-4">
                    <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground select-none">
                      Input schema
                    </summary>
                    <pre className="mt-1 text-[10px] font-mono bg-muted/60 rounded p-2 overflow-x-auto text-muted-foreground">
                      {JSON.stringify(tool.inputSchema, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty tools notice */}
      {testResult?.ok && testResult.tools && testResult.tools.length === 0 && (
        <div className="border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground flex items-center gap-2">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span>Server connected but returned no tools via <code className="font-mono bg-muted px-1 rounded">tools/list</code>. It may not expose any tools yet.</span>
        </div>
      )}
    </div>
  );
};

// ─── MCP guide ────────────────────────────────────────────────────────────────

const McpGuide = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/60 rounded-lg overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
      >
        <span className="font-medium flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5 text-primary" />
          How to set up and integrate MCP servers
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-4 py-4 space-y-4 bg-background border-t border-border/60">

          {/* What is MCP */}
          <div className="space-y-1">
            <p className="font-semibold text-foreground">What is MCP?</p>
            <p className="text-muted-foreground leading-relaxed">
              Model Context Protocol (MCP) is an open standard for exposing tools and data sources to LLMs.
              Each MCP server publishes a list of callable functions — the LLM discovers them at request time
              and calls them autonomously when relevant to the user's question.
            </p>
          </div>

          {/* Connection protocol */}
          <div className="space-y-2">
            <p className="font-semibold text-foreground">Connection protocol</p>
            <div className="space-y-1 text-muted-foreground">
              <p>• Protocol: <span className="font-mono bg-muted px-1 rounded">HTTP POST</span> with <span className="font-mono bg-muted px-1 rounded">JSON-RPC 2.0</span> (Streamable HTTP)</p>
              <p>• Response: JSON or <span className="font-mono bg-muted px-1 rounded">text/event-stream</span> (SSE) — both supported automatically</p>
              <p>• Authentication: API Key is sent as <span className="font-mono bg-muted px-1 rounded">Authorization: Bearer &lt;key&gt;</span></p>
            </div>
            <div className="bg-muted/60 rounded-md p-3 font-mono leading-relaxed text-muted-foreground">
              <p className="text-foreground font-semibold mb-1 font-sans text-[10px] uppercase tracking-wide">Example server URL</p>
              <p>https://your-mcp-server.com/mcp</p>
              <p>https://analytics.internal/api/mcp</p>
              <p>http://localhost:8080/mcp  <span className="text-muted-foreground/60">(local dev)</span></p>
            </div>
          </div>

          {/* How the flow works */}
          <div className="space-y-2">
            <p className="font-semibold text-foreground">How it works during chat</p>
            <ol className="space-y-1 text-muted-foreground list-none">
              {[
                "Chat request arrives → gateway calls initialize then tools/list on each enabled server",
                "Discovered tools are passed to the LLM as callable functions",
                "LLM decides when to invoke a tool based on the conversation",
                "Gateway executes the tool call and feeds the result back to the LLM",
                "LLM uses the result to produce the final answer, which streams to the user",
                "The chat UI shows which tools were called as inline badges",
              ].map((step, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center font-bold">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Example tool */}
          <div className="space-y-2">
            <p className="font-semibold text-foreground">Example tool response from MCP server</p>
            <pre className="bg-muted/60 rounded-md p-3 font-mono text-[11px] leading-relaxed text-muted-foreground overflow-x-auto">{`{
  "tools": [
    {
      "name": "query_database",
      "description": "Run a SQL query on the analytics DB",
      "inputSchema": {
        "type": "object",
        "properties": {
          "sql": { "type": "string", "description": "SQL query to execute" }
        },
        "required": ["sql"]
      }
    }
  ]
}`}</pre>
          </div>

          {/* Compatible use cases */}
          <div className="space-y-2">
            <p className="font-semibold text-foreground">Compatible server types</p>
            <div className="grid grid-cols-2 gap-1.5 text-muted-foreground">
              {[
                ["Database / SQL", "Run queries against analytics DBs or data warehouses"],
                ["Vector / RAG", "Search knowledge bases, documentation, or embeddings"],
                ["Analytics APIs", "Fetch KPIs, reports, or aggregated metrics"],
                ["Business logic", "ERP data, product catalogs, CRM records"],
                ["File / document", "Read or search documents, PDFs, spreadsheets"],
                ["Custom tools", "Any internal API wrapped in a JSON-RPC 2.0 endpoint"],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-1.5">
                  <Link2 className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-foreground">{title}</span>
                    <p className="text-muted-foreground/80">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Per-agent assignment tip */}
          <div className="bg-primary/5 border border-primary/20 rounded-md px-3 py-2.5 space-y-1">
            <p className="font-semibold text-primary flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5" /> Per-agent tool assignment
            </p>
            <p className="text-muted-foreground leading-relaxed">
              By default every agent can use <em>all</em> enabled servers. Open an agent's Edit panel
              and select specific servers to restrict which tools that agent can call — useful when
              a narrow agent (e.g. Chart Builder) shouldn't be distracted by unrelated tools like
              "send email" or "write to database".
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Agent table row ──────────────────────────────────────────────────────────

interface AgentTableRowProps {
  agent: LlmAgent;
  index: number;
  total: number;
  isEditing: boolean;
  mcpServers: McpServer[];
  onToggleEdit: () => void;
  onChange: (updated: LlmAgent) => void;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

const AgentTableRow = ({ agent, index, total, isEditing, mcpServers, onToggleEdit, onChange, onMove, onRemove, onDuplicate }: AgentTableRowProps) => {
  const outputOption = OUTPUT_OPTIONS.find((o) => o.value === agent.expectedOutput);
  const mcpLabel = agent.mcpServerIds.length === 0
    ? (mcpServers.length > 0 ? "All" : "—")
    : `${agent.mcpServerIds.length}`;

  return (
    <div className={`grid grid-cols-[28px_1fr_80px_60px_48px_52px_auto] items-center gap-2 px-3 py-2.5 border-b border-border/50 last:border-0 text-sm transition-colors ${isEditing ? "bg-primary/5" : "hover:bg-muted/40"}`}>
      {/* Order index */}
      <span className="text-xs text-muted-foreground text-center tabular-nums">{index + 1}</span>

      {/* Name + description */}
      <div className="min-w-0">
        <p className="font-medium truncate leading-tight">{agent.name || "Unnamed Agent"}</p>
        {agent.description && (
          <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5">{agent.description}</p>
        )}
      </div>

      {/* Output type */}
      {outputOption ? (
        <Badge variant="outline" className="text-[10px] justify-center">{outputOption.label}</Badge>
      ) : <span />}

      {/* Prompts count */}
      <span className="text-xs text-muted-foreground text-center">{agent.defaultPrompts.length} prompts</span>

      {/* MCP */}
      <span className="text-xs text-muted-foreground text-center">{mcpLabel}</span>

      {/* Enabled */}
      <Switch checked={agent.enabled} onCheckedChange={(v) => onChange({ ...agent, enabled: v })} className="mx-auto" />

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Move up"
          disabled={index === 0} onClick={() => onMove(index, index - 1)}>
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Move down"
          disabled={index === total - 1} onClick={() => onMove(index, index + 1)}>
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant={isEditing ? "secondary" : "ghost"} size="icon" className="h-7 w-7" title={isEditing ? "Collapse detail" : "Edit agent"}
          onClick={onToggleEdit}>
          {isEditing ? <ChevronsUpDown className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Duplicate agent" onClick={onDuplicate}><Copy className="h-3.5 w-3.5" /></Button>
        <ConfirmRecycleButton name={agent.name || "Unnamed agent"} itemLabel="agent" onConfirm={onRemove} />
      </div>
    </div>
  );
};

// ─── Agent edit panel ─────────────────────────────────────────────────────────

interface AgentEditPanelProps {
  agent: LlmAgent;
  availabilityTargets: ChatAvailabilityTarget[];
  skills: AgentSkill[];
  mcpServers: McpServer[];
  globalProviders: LlmProvider[];
  supabaseClient: typeof supabase;
  organizationId?: string;
  onChange: (updated: LlmAgent) => void;
  onClose: () => void;
}

const AgentEditPanel = ({ agent, availabilityTargets, skills, mcpServers, globalProviders, supabaseClient, organizationId, onChange, onClose }: AgentEditPanelProps) => {
  const [showAgentProviderKey, setShowAgentProviderKey] = useState<string | null>(null);
  // per-server tool discovery state
  const [serverTools, setServerTools] = useState<Record<string, { loading: boolean; tools: McpTool[]; error?: string }>>({});

  const updatePrompt = (i: number, val: string) =>
    onChange({ ...agent, defaultPrompts: agent.defaultPrompts.map((p, j) => (j === i ? val : p)) });
  const removePrompt = (i: number) =>
    onChange({ ...agent, defaultPrompts: agent.defaultPrompts.filter((_, j) => j !== i) });

  const toggleMcp = (serverId: string) => {
    const ids = agent.mcpServerIds.includes(serverId)
      ? agent.mcpServerIds.filter((id) => id !== serverId)
      : [...agent.mcpServerIds, serverId];
    // clear tool filter for deselected server
    const newFilter = { ...agent.mcpToolFilter };
    if (ids.includes(serverId) === false) delete newFilter[serverId];
    onChange({ ...agent, mcpServerIds: ids, mcpToolFilter: newFilter });
  };

  const loadServerTools = async (server: McpServer) => {
    setServerTools((prev) => ({ ...prev, [server.id]: { loading: true, tools: [] } }));
    const result = await testMcpServer(server.url, server.apiKey, supabaseClient, organizationId);
    setServerTools((prev) => ({
      ...prev,
      [server.id]: {
        loading: false,
        tools: result.tools ?? [],
        error: result.error ?? (result.ok ? undefined : "Failed to load tools"),
      },
    }));
  };

  const toggleTool = (serverId: string, toolName: string) => {
    const current = agent.mcpToolFilter[serverId] ?? [];
    const next = current.includes(toolName)
      ? current.filter((n) => n !== toolName)
      : [...current, toolName];
    onChange({ ...agent, mcpToolFilter: { ...agent.mcpToolFilter, [serverId]: next } });
  };

  const clearToolFilter = (serverId: string) => {
    const newFilter = { ...agent.mcpToolFilter };
    delete newFilter[serverId];
    onChange({ ...agent, mcpToolFilter: newFilter });
  };

  const toggleProvider = (providerId: string) => {
    const ids = agent.providerIds.includes(providerId)
      ? agent.providerIds.filter((id) => id !== providerId)
      : [...agent.providerIds, providerId];
    onChange({ ...agent, providerIds: ids });
  };
  const moveProviderId = (from: number, to: number) =>
    onChange({ ...agent, providerIds: moveItem(agent.providerIds, from, to) });

  const updateAgentProvider = (i: number, updated: LlmProvider) =>
    onChange({ ...agent, agentProviders: agent.agentProviders.map((p, j) => (j === i ? updated : p)) });
  const moveAgentProvider = (from: number, to: number) =>
    onChange({ ...agent, agentProviders: moveItem(agent.agentProviders, from, to) });
  const removeAgentProvider = (i: number) => {
    const removed = agent.agentProviders[i];
    onChange({
      ...agent,
      agentProviders: agent.agentProviders.filter((_, j) => j !== i),
      providerIds: agent.providerIds.filter((id) => id !== removed?.id),
    });
    if (showAgentProviderKey === removed?.id) setShowAgentProviderKey(null);
  };

  const toggleSkill = (skillId: string) => {
    const selected = agent.skillIds.includes(skillId);
    const skillIds = selected
      ? agent.skillIds.filter((id) => id !== skillId)
      : [...agent.skillIds, skillId];
    if (skillIds.length > 0) {
      const fallbackOutput = agent.expectedOutput === "auto" ? agent.fallbackOutput : agent.expectedOutput;
      onChange({ ...agent, skillIds, expectedOutput: "auto", fallbackOutput });
    } else {
      onChange({ ...agent, skillIds, expectedOutput: agent.fallbackOutput });
    }
  };

  const syncRagSources = (sources: LlmAgent["inputSources"]): LlmAgent["ragSources"] => {
    const hasResult = sources.includes("result");
    const hasDocument = sources.includes("document") || sources.includes("user_upload");
    if (hasResult && hasDocument) return "all";
    if (hasResult) return "result";
    if (hasDocument) return "document";
    return "none";
  };

  const toggleInputSource = (source: AgentInputSource, checked: boolean) => {
    const next = checked
      ? [...new Set([...agent.inputSources, source])]
      : agent.inputSources.filter((item) => item !== source);
    onChange({ ...agent, inputSources: next, ragSources: syncRagSources(next) });
  };

  return (
    <div className="border-t border-primary/20 bg-muted/20 px-4 pt-4 pb-5 space-y-4">
      {/* Panel header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary">Editing: {agent.name || "Unnamed Agent"}</span>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={onClose}>
          <X className="h-3.5 w-3.5" /> Collapse
        </Button>
      </div>

      {/* Name + Description */}
      {agent.webSearch && (
        <div className="rounded-md border bg-background p-3 text-xs">
          <p className="font-semibold">OpenAI web search required</p>
          <p className="mt-1 text-muted-foreground">Search domains: {agent.webSearch.allowedDomains.join(", ")}. Assign an OpenAI provider with a model that supports web search and opening pages. Every run searches before answering.</p>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Agent Name</Label>
          <Input className="h-8 text-sm" placeholder="e.g. Data Analyst"
            value={agent.name} onChange={(e) => onChange({ ...agent, name: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Short Description (shown in chat)</Label>
          <Input className="h-8 text-xs" placeholder="e.g. General data analysis and insights"
            value={agent.description} onChange={(e) => onChange({ ...agent, description: e.target.value })} />
        </div>
      </div>

      <ChatAvailabilitySelector
        targetIds={agent.targetResources}
        targets={availabilityTargets}
        onChange={(targetResources) => onChange({ ...agent, targetResources })}
      />

      {/* System Prompt */}
      <div className="space-y-1.5">
        <Label className="text-xs">System Prompt</Label>
        <Textarea className="text-xs font-mono" rows={5} value={agent.systemPrompt}
          onChange={(e) => onChange({ ...agent, systemPrompt: e.target.value })} />
        <p className="text-[10px] text-muted-foreground">
          Defines the agent's persona and expertise. The result dataset JSON and output instructions are appended automatically.
        </p>
      </div>

      {/* Agent Skills */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Agent Skills</Label>
          <span className="text-[10px] text-muted-foreground">Reusable playbooks injected into this agent</span>
        </div>
        {skills.filter((skill) => skill.enabled).length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No enabled skills. Create one in the Agent Skills tab.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {skills.filter((skill) => skill.enabled).map((skill) => {
              const selected = agent.skillIds.includes(skill.id);
              return (
                <button key={skill.id} type="button"
                  onClick={() => toggleSkill(skill.id)}
                  className={`rounded-lg border p-3 text-left transition-colors ${selected ? "border-primary/50 bg-primary/10" : "bg-background hover:border-primary/40"}`}>
                  <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{skill.name}</span><Badge variant="outline" className="text-[9px]">v{skill.version}</Badge></div>
                  <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">{skill.description}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Output Format */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Output Format</Label>
          <span className="text-[10px] text-muted-foreground">Controls how the chat renders the response</span>
        </div>

        {agent.skillIds.length > 0 && (
          <div className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
            Output is skill-controlled. The most recently activated skill sets the response type; if no skill activates, <strong>{agent.fallbackOutput}</strong> is used.
          </div>
        )}

        {/* Type pills */}
        <div className={`flex flex-wrap gap-2 ${agent.skillIds.length > 0 ? "opacity-55" : ""}`}>
          {OUTPUT_OPTIONS.map((opt) => (
            <button key={opt.value} type="button"
              disabled={agent.skillIds.length > 0 || opt.value === "auto"}
              onClick={() => onChange({
                ...agent,
                expectedOutput: opt.value,
                fallbackOutput: opt.value === "auto" ? agent.fallbackOutput : opt.value,
                outputInstructions: agent.outputInstructions || opt.defaultInstructions,
              })}
              className={`inline-flex flex-col items-start px-3 py-2 rounded-lg border text-xs transition-all ${
                agent.expectedOutput === opt.value
                  ? `${opt.color} border-current ring-1 ring-current/30 font-medium`
                  : "bg-background border-border text-muted-foreground hover:border-primary"
              }`}>
              <span className="font-semibold">{opt.label}</span>
              <span className="text-[10px] opacity-75 leading-tight mt-0.5">{opt.description}</span>
            </button>
          ))}
        </div>

        {/* Instructions textarea */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Output Instructions</Label>
            <button type="button"
              disabled={agent.skillIds.length > 0}
              className="text-[10px] text-primary hover:underline"
              onClick={() => {
                const preset = OUTPUT_OPTIONS.find((o) => o.value === (agent.expectedOutput === "auto" ? agent.fallbackOutput : agent.expectedOutput));
                if (preset) onChange({ ...agent, outputInstructions: preset.defaultInstructions });
              }}>
              Reset to preset
            </button>
          </div>
          <Textarea
            disabled={agent.skillIds.length > 0}
            className={`text-xs font-mono min-h-[100px] ${agent.skillIds.length > 0 ? "bg-muted text-muted-foreground" : ""}`}
            rows={6}
            placeholder="Describe exactly what format the LLM should return…"
            value={agent.outputInstructions}
            onChange={(e) => onChange({ ...agent, outputInstructions: e.target.value })}
          />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            This is injected into the system prompt as <code className="bg-muted px-1 rounded">## Output Format</code>.
            You can reference MCP tool names here (e.g. <em>"call the generate_report tool with the findings"</em>).
          </p>
        </div>

        {/* Compiled system prompt preview */}
        {agent.outputInstructions && (
          <details className="text-[10px]">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
              Preview compiled system prompt →
            </summary>
            <pre className="mt-2 bg-muted/60 rounded-md p-3 font-mono text-[10px] whitespace-pre-wrap overflow-x-auto text-muted-foreground max-h-48 overflow-y-auto">
              {[
                agent.systemPrompt || "(system prompt)",
                "",
                "---",
                "Result dataset (JSON):",
                "{ … }",
                "",
                "## Output Format",
                agent.outputInstructions,
                ...(agent.mcpServerIds.length > 0 || agent.agentProviders.length > 0
                  ? ["", "## Available Tools", agent.mcpServerIds.map((sid) => {
                      const filter = agent.mcpToolFilter[sid];
                      return filter?.length ? filter.map((t) => `- ${t}`).join("\n") : `- (all tools from server ${sid})`;
                    }).join("\n")]
                  : []),
              ].join("\n")}
            </pre>
          </details>
        )}
      </div>

      {/* Agent Inputs */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Input Settings</Label>
          <span className="text-[10px] text-muted-foreground">Context sources this agent may receive</span>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {([
            {
              value: "result" as const,
              label: "Result data",
              desc: "Current analytics result JSON from the result page.",
            },
            {
              value: "document" as const,
              label: "Gateway upload",
              desc: "Document uploaded earlier in the gateway process.",
            },
            {
              value: "user_upload" as const,
              label: "Chatbox upload",
              desc: "Ask the user to attach a document in the AI chat.",
            },
          ]).map((item) => (
            <label key={item.value} className="flex cursor-pointer gap-2 rounded-lg border bg-background p-3 text-left hover:border-primary/40">
              <Checkbox
                checked={agent.inputSources.includes(item.value)}
                onCheckedChange={(checked) => toggleInputSource(item.value, checked === true)}
                className="mt-0.5"
              />
              <span className="space-y-0.5">
                <span className="block text-xs font-semibold">{item.label}</span>
                <span className="block text-[10px] leading-relaxed text-muted-foreground">{item.desc}</span>
              </span>
            </label>
          ))}
        </div>
        {agent.inputSources.length === 0 && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[10px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
            This agent will receive only the user's chat message, its system prompt, assigned skills, and tool access.
          </p>
        )}
      </div>

      {/* Result Data Context */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Result Data Context</Label>
          <span className="text-[10px] text-muted-foreground">How resultData is sent to this agent</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { value: "full", label: "Full result", desc: "Current behavior; compacted by server limits if very large" },
              { value: "chunked", label: "Chunk + manifest", desc: "Send manifest first, then all ordered resultData chunks" },
            ] as Array<{ value: LlmAgent["resultContextMode"]; label: string; desc: string }>
          ).map((opt) => (
            <button key={opt.value} type="button"
              disabled={!agent.inputSources.includes("result")}
              onClick={() => onChange({ ...agent, resultContextMode: opt.value })}
              className={`inline-flex flex-col items-start px-3 py-2 rounded-lg border text-xs transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                (agent.resultContextMode ?? "full") === opt.value
                  ? "bg-primary/10 text-primary border-primary/40 ring-1 ring-primary/20 font-medium"
                  : "bg-background border-border text-muted-foreground hover:border-primary"
              }`}>
              <span className="font-semibold">{opt.label}</span>
              <span className="text-[10px] opacity-75 leading-tight mt-0.5">{opt.desc}</span>
            </button>
          ))}
        </div>
        {!agent.inputSources.includes("result") && (
          <p className="text-[10px] text-muted-foreground">
            Enable Result data above to use resultData chunking.
          </p>
        )}
        {agent.inputSources.includes("result") && (agent.resultContextMode ?? "full") === "chunked" && (
          <div className="flex flex-wrap items-center gap-3">
            <Label className="text-xs text-muted-foreground shrink-0">Chunk size</Label>
            <Input
              type="number" min={2000} max={50000} step={1000} className="h-7 w-24 text-xs"
              value={agent.resultChunkSize ?? 12000}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v > 0) {
                  onChange({ ...agent, resultChunkSize: Math.min(Math.max(v, 2000), 50000) });
                }
              }}
            />
            <span className="text-[10px] text-muted-foreground">
              Smaller chunks are easier to reference; all chunks are sent in order.
            </span>
          </div>
        )}
      </div>

      {/* Document Context */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Document Context</Label>
          <span className="text-[10px] text-muted-foreground">How enabled document inputs are included</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { value: "auto", label: "Auto", desc: "Full doc if small (< 30K chars), chunks if large" },
              { value: "chunks", label: "Chunks (RAG)", desc: "Always retrieve top-N semantically similar passages" },
              { value: "none", label: "Disabled", desc: "No document context — result data only" },
            ] as Array<{ value: LlmAgent["ragMode"]; label: string; desc: string }>
          ).map((opt) => (
            <button key={opt.value} type="button"
              onClick={() => onChange({ ...agent, ragMode: opt.value })}
              className={`inline-flex flex-col items-start px-3 py-2 rounded-lg border text-xs transition-all ${
                (agent.ragMode ?? "auto") === opt.value
                  ? "bg-primary/10 text-primary border-primary/40 ring-1 ring-primary/20 font-medium"
                  : "bg-background border-border text-muted-foreground hover:border-primary"
              }`}>
              <span className="font-semibold">{opt.label}</span>
              <span className="text-[10px] opacity-75 leading-tight mt-0.5">{opt.desc}</span>
            </button>
          ))}
        </div>
        {(agent.ragMode ?? "auto") === "chunks" && (
          <div className="flex items-center gap-3">
            <Label className="text-xs text-muted-foreground shrink-0">Max chunks per query</Label>
            <Input
              type="number" min={1} max={100} className="h-7 w-20 text-xs"
              value={agent.ragTopK ?? 20}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v > 0) onChange({ ...agent, ragTopK: v });
              }}
            />
            <span className="text-[10px] text-muted-foreground">20 covers ~5 job profiles</span>
          </div>
        )}
      </div>

      {/* LLM Providers */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">LLM Providers</Label>
          <span className="text-[10px] text-muted-foreground">
            {agent.agentProviders.length === 0 && agent.providerIds.length === 0
              ? "Using global providers"
              : `${agent.agentProviders.length + agent.providerIds.length} selected`}
          </span>
        </div>

        {/* Agent-specific providers */}
        {agent.agentProviders.length > 0 && (
          <div className="space-y-2">
            {agent.agentProviders.map((p, i) => (
              <div key={p.id} className="border border-border/60 rounded-md px-3 py-2.5 space-y-2 bg-background">
                <div className="flex items-center gap-2">
                  <Zap className="h-3 w-3 text-primary shrink-0" />
                  <Input className="h-7 text-xs font-medium flex-1" placeholder="Provider name"
                    value={p.name} onChange={(e) => updateAgentProvider(i, { ...p, name: e.target.value })} />
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" disabled={i === 0}
                    onClick={() => moveAgentProvider(i, i - 1)}><ChevronUp className="h-3 w-3" /></Button>
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" disabled={i === agent.agentProviders.length - 1}
                    onClick={() => moveAgentProvider(i, i + 1)}><ChevronDown className="h-3 w-3" /></Button>
                  <Switch className="scale-75" checked={p.enabled} onCheckedChange={(v) => updateAgentProvider(i, { ...p, enabled: v })} />
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                    onClick={() => removeAgentProvider(i)}><Trash2 className="h-3 w-3" /></Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-0.5 col-span-2">
                    <Label className="text-[10px]">Provider family</Label>
                    <Select value={p.providerType} onValueChange={(providerType: LlmProvider["providerType"]) => updateAgentProvider(i, { ...p, providerType })}>
                      <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="openai">OpenAI</SelectItem><SelectItem value="anthropic">Anthropic</SelectItem><SelectItem value="gemini">Google Gemini</SelectItem><SelectItem value="openai_compatible">Local / OpenAI-compatible</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[10px]">Base URL</Label>
                    <Input className="h-7 text-[11px]" placeholder="https://api.openai.com/v1"
                      value={p.apiBaseUrl} onChange={(e) => updateAgentProvider(i, { ...p, apiBaseUrl: e.target.value })} />
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[10px]">Model</Label>
                    <Input className="h-7 text-[11px]" placeholder="gpt-4o-mini"
                      value={p.model} onChange={(e) => updateAgentProvider(i, { ...p, model: e.target.value })} />
                  </div>
                  <div className="space-y-0.5 col-span-2">
                    <Label className="text-[10px]">API Key</Label>
                    <div className="relative">
                      <Input className="h-7 text-[11px] pr-8"
                        type={showAgentProviderKey === p.id ? "text" : "password"}
                        placeholder="sk-..."
                        value={p.apiKey} onChange={(e) => updateAgentProvider(i, { ...p, apiKey: e.target.value })} />
                      <button type="button"
                        className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                        onClick={() => setShowAgentProviderKey(showAgentProviderKey === p.id ? null : p.id)}>
                        {showAgentProviderKey === p.id ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Select from global providers */}
        {globalProviders.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {globalProviders.map((p) => (
              <button key={p.id} type="button" onClick={() => toggleProvider(p.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  agent.providerIds.includes(p.id)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border text-muted-foreground hover:border-primary"
                }`}>
                <Zap className="h-3 w-3" />
                {p.name || p.model || "Provider"}
                {p.model && <span className="opacity-70 text-[10px]">{p.model}</span>}
              </button>
            ))}
          </div>
        )}

        {agent.providerIds.length > 0 && (
          <div className="space-y-1.5 rounded-md border bg-background p-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Selected global provider priority</p>
            {agent.providerIds.map((id, i) => {
              const provider = globalProviders.find((p) => p.id === id);
              if (!provider) return null;
              return (
                <div key={id} className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs">
                  <span className="w-5 shrink-0 text-center tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{provider.name || provider.model || "Provider"}</span>
                  {provider.model && <span className="hidden text-[10px] text-muted-foreground sm:inline">{provider.model}</span>}
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={i === 0}
                    onClick={() => moveProviderId(i, i - 1)}><ChevronUp className="h-3 w-3" /></Button>
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={i === agent.providerIds.length - 1}
                    onClick={() => moveProviderId(i, i + 1)}><ChevronDown className="h-3 w-3" /></Button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs h-7"
            onClick={() => {
              const newP = emptyProvider();
              onChange({ ...agent, agentProviders: [...agent.agentProviders, newP] });
            }}>
            <Plus className="h-3 w-3" /> Add provider for this agent
          </Button>
        </div>

        <div className="bg-muted/40 rounded-md px-3 py-2 text-[11px] text-muted-foreground">
          {agent.agentProviders.length === 0 && agent.providerIds.length === 0 ? (
            <>
              <span className="font-medium text-foreground">Using global provider list</span>
              <span className="ml-1">— select providers above to restrict, or add an agent-specific one.</span>
              <GlobalProviderPriority providers={globalProviders} />
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">Provider priority: </span>
              {agent.agentProviders.length > 0 && <span>agent-specific first</span>}
              {agent.agentProviders.length > 0 && agent.providerIds.length > 0 && <span>, then </span>}
              {agent.providerIds.length > 0 && <span>{agent.providerIds.length} selected global provider(s)</span>}
              {agent.providerIds.length === 0 && agent.agentProviders.length > 0 && <span>, then global providers in their current priority order</span>}
            </>
          )}
        </div>
      </div>

      {/* MCP Servers + Tool Filter */}
      {mcpServers.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs">MCP Tool Servers</Label>
            <span className="text-[10px] text-muted-foreground">
              {agent.mcpServerIds.length === 0 ? "No servers selected" : `${agent.mcpServerIds.length} server(s) selected`}
            </span>
          </div>

          {/* Server chips */}
          <div className="flex flex-wrap gap-2">
            {mcpServers.map((s) => {
              const selected = agent.mcpServerIds.includes(s.id);
              const filterCount = (agent.mcpToolFilter[s.id] ?? []).length;
              return (
                <button key={s.id} type="button" onClick={() => toggleMcp(s.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    selected
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border text-muted-foreground hover:border-primary"
                  }`}>
                  <Server className="h-3 w-3" />
                  {s.name || s.url}
                  {selected && filterCount > 0 && (
                    <span className="bg-primary-foreground/20 text-primary-foreground text-[9px] rounded-full px-1.5 py-0.5 font-medium">
                      {filterCount} tool{filterCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Per-server tool filter — shown for each selected server */}
          {agent.mcpServerIds.length > 0 && (
            <div className="space-y-2">
              {agent.mcpServerIds.map((sid) => {
                const server = mcpServers.find((s) => s.id === sid);
                if (!server) return null;
                const state = serverTools[sid];
                const selectedTools = agent.mcpToolFilter[sid] ?? [];
                const discovered = state?.tools ?? [];

                return (
                  <div key={sid} className="border border-border/60 rounded-md overflow-hidden">
                    {/* Server header */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border/60">
                      <Server className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-xs font-medium flex-1 truncate">{server.name || server.url}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {selectedTools.length === 0
                          ? "all tools"
                          : `${selectedTools.length} of ${discovered.length || "?"} tool${selectedTools.length !== 1 ? "s" : ""}`}
                      </span>
                      {selectedTools.length > 0 && (
                        <button type="button" onClick={() => clearToolFilter(sid)}
                          className="text-[10px] text-muted-foreground hover:text-foreground shrink-0">
                          clear
                        </button>
                      )}
                      <Button type="button" variant="ghost" size="sm"
                        className="h-6 gap-1 text-[11px] shrink-0 px-2"
                        disabled={state?.loading}
                        onClick={() => loadServerTools(server)}>
                        {state?.loading
                          ? <><Loader2 className="h-2.5 w-2.5 animate-spin" />Loading…</>
                          : <><FlaskConical className="h-2.5 w-2.5" />{discovered.length > 0 ? "Reload" : "Load tools"}</>}
                      </Button>
                    </div>

                    {/* Tool list */}
                    {state?.error && (
                      <div className="px-3 py-2 text-[11px] text-destructive flex items-start gap-1.5">
                        <XCircle className="h-3 w-3 shrink-0 mt-0.5" />{state.error}
                      </div>
                    )}

                    {!state && (
                      <div className="px-3 py-2.5 text-[11px] text-muted-foreground text-center">
                        Click "Load tools" to discover available tools from this server.
                      </div>
                    )}

                    {discovered.length > 0 && (
                      <div className="px-3 py-2 space-y-1.5 max-h-48 overflow-y-auto">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
                            {discovered.length} tool{discovered.length !== 1 ? "s" : ""} available
                          </span>
                          <button type="button" onClick={() => {
                            if (selectedTools.length === discovered.length) {
                              clearToolFilter(sid);
                            } else {
                              onChange({ ...agent, mcpToolFilter: { ...agent.mcpToolFilter, [sid]: discovered.map((t) => t.name) } });
                            }
                          }} className="text-[10px] text-primary hover:underline">
                            {selectedTools.length === discovered.length ? "Deselect all" : "Select all"}
                          </button>
                        </div>
                        {discovered.map((tool) => {
                          const checked = selectedTools.length === 0 || selectedTools.includes(tool.name);
                          const explicitlySelected = selectedTools.includes(tool.name);
                          return (
                            <label key={tool.name}
                              className={`flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                                explicitlySelected ? "bg-primary/8" : "hover:bg-muted/50"
                              } ${selectedTools.length > 0 && !explicitlySelected ? "opacity-50" : ""}`}>
                              <input type="checkbox"
                                className="mt-0.5 h-3 w-3 accent-primary shrink-0"
                                checked={selectedTools.length === 0 ? true : explicitlySelected}
                                onChange={() => toggleTool(sid, tool.name)}
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-mono font-medium leading-tight truncate">{tool.name}</p>
                                {tool.description && (
                                  <p className="text-[10px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">{tool.description}</p>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {/* Status footer */}
                    {discovered.length > 0 && (
                      <div className="px-3 py-1.5 bg-muted/20 border-t border-border/60 text-[10px] text-muted-foreground">
                        {selectedTools.length === 0
                          ? "All tools passed to LLM. Select specific tools above to restrict."
                          : `LLM can only call: ${selectedTools.join(", ")}`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {agent.mcpServerIds.length === 0 && (
            <div className="bg-muted/40 rounded-md px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">No MCP access</span>
              <span className="ml-1">— select one or more enabled servers to grant this agent access to their tools.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-muted/30 border border-dashed border-border rounded-md px-3 py-2.5 text-[11px] text-muted-foreground flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <span>No MCP servers configured yet. Add servers in the <strong>MCP Servers</strong> section above, then return here to assign them to this agent.</span>
        </div>
      )}

      {/* Default Prompts */}
      <div className="space-y-2">
        <Label className="text-xs">Default Prompts (shown in chat quick-pick)</Label>
        {agent.defaultPrompts.length === 0 && (
          <p className="text-xs text-muted-foreground border border-dashed rounded-md p-3 text-center">
            No prompts yet. Add one below.
          </p>
        )}
        {agent.defaultPrompts.map((p, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className="flex flex-col gap-0 shrink-0">
              <Button type="button" variant="ghost" size="icon" className="h-5 w-6 rounded-none"
                disabled={i === 0}
                onClick={() => onChange({ ...agent, defaultPrompts: moveItem(agent.defaultPrompts, i, i - 1) })}>
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-5 w-6 rounded-none"
                disabled={i === agent.defaultPrompts.length - 1}
                onClick={() => onChange({ ...agent, defaultPrompts: moveItem(agent.defaultPrompts, i, i + 1) })}>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </div>
            {i === 0
              ? <span className="text-[9px] text-primary font-medium shrink-0 w-8 text-center leading-none">top</span>
              : <span className="w-8 shrink-0" />}
            <Input className="h-8 text-xs flex-1" value={p} placeholder="Enter a quick prompt…"
              onChange={(e) => updatePrompt(i, e.target.value)} />
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
              onClick={() => removePrompt(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs"
          onClick={() => onChange({ ...agent, defaultPrompts: [...agent.defaultPrompts, ""] })}>
          <MessageSquarePlus className="h-3.5 w-3.5" /> Add Prompt
        </Button>
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const LlmSettingsSection = () => {
  const { user } = useAuth();
  const [configId, setConfigId] = useState<string | undefined>(undefined);
  const [llm, setLlm] = useState<LlmInsightsConfig>(DEFAULT_CONFIG);
  const [featuresRest, setFeaturesRest] = useState<Record<string, unknown>>({});
  const [globalSnapshot, setGlobalSnapshot] = useState<GlobalConfigSnapshot>(DEFAULT_GLOBAL_SNAPSHOT);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [availabilityTargets, setAvailabilityTargets] = useState<ChatAvailabilityTarget[]>([]);
  const [providerEditor, setProviderEditor] = useState<{ mode: "create" | "edit"; draft: LlmProvider } | null>(null);
  const [mcpEditor, setMcpEditor] = useState<{ mode: "create" | "edit"; draft: McpServer } | null>(null);
  const [showProviderRecycle, setShowProviderRecycle] = useState(false);
  const [showMcpRecycle, setShowMcpRecycle] = useState(false);
  const [showAgentRecycle, setShowAgentRecycle] = useState(false);
  const activeProviders = llm.providers.filter((item) => !item.deletedAt);
  const recycledProviders = llm.providers.filter((item) => Boolean(item.deletedAt));
  const activeMcpServers = llm.mcpServers.filter((item) => !item.deletedAt);
  const recycledMcpServers = llm.mcpServers.filter((item) => Boolean(item.deletedAt));
  const activeAgents = llm.agents.filter((item) => !item.deletedAt);
  const recycledAgents = llm.agents.filter((item) => Boolean(item.deletedAt));
  const activeSkills = llm.skills.filter((item) => !item.deletedAt);

  useEffect(() => {
    let timer: number | undefined;
    const cleanAndSchedule = () => {
      const now = Date.now();
      const collections = [llm.providers, llm.mcpServers, llm.agents, llm.skills];
      const hasExpired = collections.some((items) => items.some((item) => item.deletedAt && recycleExpiry(item) <= now));
      if (hasExpired) {
        setLlm((current) => ({
          ...current,
          providers: current.providers.filter((item) => !item.deletedAt || recycleExpiry(item) > now),
          mcpServers: current.mcpServers.filter((item) => !item.deletedAt || recycleExpiry(item) > now),
          agents: current.agents.filter((item) => !item.deletedAt || recycleExpiry(item) > now),
          skills: current.skills.filter((item) => !item.deletedAt || recycleExpiry(item) > now),
        }));
        return;
      }
      const nextExpiry = Math.min(...collections.flatMap((items) => items.filter((item) => item.deletedAt).map(recycleExpiry)));
      if (Number.isFinite(nextExpiry)) timer = window.setTimeout(cleanAndSchedule, Math.max(1_000, Math.min(nextExpiry - now, 2_000_000_000)));
    };
    cleanAndSchedule();
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, [llm.providers, llm.mcpServers, llm.agents, llm.skills]);

  useEffect(() => {
    const fetchConfig = async () => {
      if (!user?.organization?.id) return;
      setIsLoading(true);
      try {
        const [
          { data, error },
          { data: softwareData, error: softwareError },
          { data: serviceChainData, error: serviceChainError },
        ] = await Promise.all([
          supabase
            .from("global_configs")
            .select("id, app_name, app_version, environment, logging, features")
            .eq("organization_id", user.organization.id)
            .maybeSingle(),
          supabase
            .from("dataspace_params")
            .select("id, resource_name, resource_url")
            .eq("organization_id", user.organization.id)
            .eq("resource_type", "software"),
          supabase
            .from("service_chains")
            .select("id, catalog_id, basis_information")
            .eq("organization_id", user.organization.id),
        ]);
        if (error && error.code !== "PGRST116") throw error;
        if (softwareError) throw softwareError;
        if (serviceChainError) throw serviceChainError;

        const rawFeatures = (data?.features as Record<string, unknown> | null) ?? {};
        const rawLlm = (rawFeatures.llmInsights as Record<string, unknown> | undefined) ?? {};
        const { llmInsights: _drop, ...rest } = rawFeatures;
        setFeaturesRest(rest);
        setLlm(migrateFromLegacy(rawLlm));
        setConfigId(data?.id);
        setAvailabilityTargets([
          ...(softwareData || []).map((item) => ({
            id: `software:${item.id}`,
            label: item.resource_name || item.resource_url || item.id,
            type: "software" as const,
          })),
          ...(serviceChainData || []).map((item) => {
            const basis = item.basis_information && typeof item.basis_information === "object" && !Array.isArray(item.basis_information)
              ? item.basis_information as Record<string, unknown>
              : {};
            return {
              id: `serviceChain:${item.id}`,
              label: String(basis.name || item.catalog_id || item.id),
              type: "serviceChain" as const,
            };
          }),
        ]);
        setGlobalSnapshot({
          app_name: String(data?.app_name || DEFAULT_GLOBAL_SNAPSHOT.app_name),
          app_version: String(data?.app_version || DEFAULT_GLOBAL_SNAPSHOT.app_version),
          environment: (data?.environment as GlobalConfigSnapshot["environment"]) || DEFAULT_GLOBAL_SNAPSHOT.environment,
          logging: { ...DEFAULT_GLOBAL_SNAPSHOT.logging, ...((data?.logging as Record<string, unknown> | null) ?? {}) } as GlobalConfigSnapshot["logging"],
        });
      } catch {
        toast.error("Failed to load agent operations");
      } finally {
        setIsLoading(false);
      }
    };
    void fetchConfig();
  }, [user?.organization?.id]);

  const patchLlm = (patch: Partial<LlmInsightsConfig>) => setLlm((prev) => ({ ...prev, ...patch }));
  const updateSkills = (skills: AgentSkill[]) => {
    const validIds = new Set(skills.map((skill) => skill.id));
    setLlm((prev) => ({
      ...prev,
      skills,
      agents: prev.agents.map((agent) => {
        const skillIds = agent.skillIds.filter((id) => validIds.has(id));
        return {
          ...agent,
          skillIds,
          expectedOutput: agent.skillIds.length > 0 && skillIds.length === 0
            ? agent.fallbackOutput
            : agent.expectedOutput,
        };
      }),
      workflows: prev.workflows.map((workflow) => ({
        ...workflow,
        graph: {
          ...workflow.graph,
          nodes: workflow.graph.nodes.map((node) => {
            if (node.type !== "agent") return node;
            const data = node.data as {
              skillIds?: string[];
              inlineOutputType?: "auto" | "text" | "json" | "html" | "mixed";
              inlineFallbackOutputType?: "text" | "json" | "html" | "mixed";
            };
            if (!Array.isArray(data.skillIds)) return node;
            const skillIds = data.skillIds.filter((id) => validIds.has(id));
            return {
              ...node,
              data: {
                ...node.data,
                skillIds,
                inlineOutputType: data.skillIds.length > 0 && skillIds.length === 0
                  ? (data.inlineFallbackOutputType ?? "text")
                  : data.inlineOutputType,
              },
            };
          }),
        },
      })),
    }));
  };

  const recycleProvider = (id: string) => patchLlm({ providers: llm.providers.map((item) => item.id === id ? { ...item, enabled: false, deletedAt: new Date().toISOString(), deletedPreviousEnabled: item.enabled } : item) });
  const restoreProvider = (id: string) => patchLlm({ providers: llm.providers.map((item) => item.id === id ? { ...item, enabled: item.deletedPreviousEnabled === true, deletedAt: undefined, deletedPreviousEnabled: undefined } : item) });
  const permanentlyDeleteProvider = (id: string) => patchLlm({ providers: llm.providers.filter((item) => item.id !== id) });
  const duplicateProvider = (provider: LlmProvider) => patchLlm({ providers: [...llm.providers, { ...structuredClone(provider), id: uid(), name: `${provider.name} (copy)`, enabled: false, deletedAt: undefined, deletedPreviousEnabled: undefined }] });
  const moveProvider = async (from: number, to: number) => {
    await persistLlmConfig({ ...llm, providers: [...moveItem(activeProviders, from, to), ...recycledProviders] }, "Provider priority updated and saved");
  };

  const recycleMcp = (id: string) => patchLlm({ mcpServers: llm.mcpServers.map((item) => item.id === id ? { ...item, enabled: false, deletedAt: new Date().toISOString(), deletedPreviousEnabled: item.enabled } : item) });
  const restoreMcp = (id: string) => patchLlm({ mcpServers: llm.mcpServers.map((item) => item.id === id ? { ...item, enabled: item.deletedPreviousEnabled === true, deletedAt: undefined, deletedPreviousEnabled: undefined } : item) });
  const permanentlyDeleteMcp = (id: string) => patchLlm({ mcpServers: llm.mcpServers.filter((item) => item.id !== id) });
  const duplicateMcp = (server: McpServer) => patchLlm({ mcpServers: [...llm.mcpServers, { ...structuredClone(server), id: uid(), name: `${server.name} (copy)`, enabled: false, deletedAt: undefined, deletedPreviousEnabled: undefined }] });

  const updateAgent = (id: string, updated: LlmAgent) => patchLlm({ agents: llm.agents.map((agent) => agent.id === id ? updated : agent) });
  const recycleAgent = (id: string) => patchLlm({ agents: llm.agents.map((item) => item.id === id ? { ...item, enabled: false, deletedAt: new Date().toISOString(), deletedPreviousEnabled: item.enabled } : item) });
  const restoreAgent = (id: string) => patchLlm({ agents: llm.agents.map((item) => item.id === id ? { ...item, enabled: item.deletedPreviousEnabled === true, deletedAt: undefined, deletedPreviousEnabled: undefined } : item) });
  const permanentlyDeleteAgent = (id: string) => patchLlm({ agents: llm.agents.filter((item) => item.id !== id) });
  const duplicateAgent = (agent: LlmAgent) => patchLlm({ agents: [...llm.agents, { ...structuredClone(agent), id: uid(), name: `${agent.name} (copy)`, enabled: false, deletedAt: undefined, deletedPreviousEnabled: undefined }] });
  const moveAgent = (from: number, to: number) =>
    patchLlm({ agents: [...moveItem(activeAgents, from, to), ...recycledAgents] });

  const updateGlobalPrompt = (i: number, val: string) =>
    patchLlm({ predefinedPrompts: llm.predefinedPrompts.map((p, j) => (j === i ? val : p)) });
  const removeGlobalPrompt = (i: number) =>
    patchLlm({ predefinedPrompts: llm.predefinedPrompts.filter((_, j) => j !== i) });
  const moveGlobalPrompt = (from: number, to: number) =>
    patchLlm({ predefinedPrompts: moveItem(llm.predefinedPrompts, from, to) });

  const validateLlmConfig = (config: LlmInsightsConfig): boolean => {
    const invalidSkill = config.skills.find((skill) => {
      const inputKeys = skill.requiredInputs.map((field) => field.key.trim()).filter(Boolean);
      const hasInvalidInput = skill.requiredInputs.some((field) => !field.key.trim() || !field.label.trim());
      const hasDuplicateInput = new Set(inputKeys).size !== inputKeys.length;
      const hasInvalidReference = skill.references.some((reference) => !reference.name.trim() || !reference.content.trim());
      return !skill.name.trim() || !skill.description.trim() || !skill.objective.trim() ||
        !skill.instructions.trim() || !skill.outputTemplate.trim() || hasInvalidInput ||
        hasDuplicateInput || hasInvalidReference;
    });
    if (invalidSkill) {
      toast.error(`Complete the required fields and use unique input keys for “${invalidSkill.name || "Unnamed skill"}”`);
      return false;
    }
    return true;
  };

  const persistLlmConfig = async (nextLlm: LlmInsightsConfig, successMessage = "Agent operations saved") => {
    if (!user?.organization?.id) {
      toast.error("No active organization selected");
      return false;
    }
    if (!validateLlmConfig(nextLlm)) return false;
    setIsSaving(true);
    try {
      const currentFeatures = await readGlobalFeatures(user.organization.id);
      const { llmInsights: _drop, ...currentFeaturesRest } = currentFeatures;
      const savedLlm = migrateFromLegacy((currentFeatures.llmInsights as Record<string, unknown> | undefined) ?? {});
      const savedAt = new Date().toISOString();
      const actor: WorkflowRevisionActor = {
        userId: user.id,
        email: user.email || undefined,
        name: user.profile?.full_name || undefined,
      };
      const auditedLlm: LlmInsightsConfig = {
        ...nextLlm,
        workflows: addWorkflowRevisions(nextLlm.workflows, savedLlm.workflows, actor, savedAt),
      };
      const payload = {
        ...(configId ? { id: configId } : {}),
        organization_id: user.organization.id,
        ...globalSnapshot,
        features: { ...featuresRest, ...currentFeaturesRest, llmInsights: auditedLlm },
      };
      const { data, error } = await supabase
        .from("global_configs")
        .upsert(payload, { onConflict: "organization_id" })
        .select("id")
        .single();
      if (error) throw error;
      setConfigId(data.id);
      setFeaturesRest(currentFeaturesRest);
      setLlm(auditedLlm);
      toast.success(successMessage);
      return true;
    } catch (error) {
      console.error("Failed to save agent operations:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save agent operations");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const saveProviderEditor = async () => {
    if (!providerEditor) return;
    const provider = {
      ...providerEditor.draft,
      name: providerEditor.draft.name.trim(),
      apiBaseUrl: providerEditor.draft.apiBaseUrl.trim(),
      model: providerEditor.draft.model.trim(),
    };
    if (!provider.name || !provider.apiBaseUrl || !provider.model) {
      toast.error("Provider name, API base URL, and model are required");
      return;
    }
    const nextLlm = {
      ...llm,
      providers: providerEditor.mode === "create"
        ? [...llm.providers, provider]
        : llm.providers.map((item) => item.id === provider.id ? provider : item),
    };
    setLlm(nextLlm);
    const saved = await persistLlmConfig(nextLlm, providerEditor.mode === "create" ? "Provider added and saved" : "Provider updated and saved");
    if (saved) setProviderEditor(null);
  };

  const saveMcpEditor = async () => {
    if (!mcpEditor) return;
    const server = { ...mcpEditor.draft, name: mcpEditor.draft.name.trim(), url: mcpEditor.draft.url.trim() };
    if (!server.name || !server.url) {
      toast.error("MCP server name and endpoint URL are required");
      return;
    }
    const nextLlm = {
      ...llm,
      mcpServers: mcpEditor.mode === "create"
        ? [...llm.mcpServers, server]
        : llm.mcpServers.map((item) => item.id === server.id ? server : item),
    };
    setLlm(nextLlm);
    const saved = await persistLlmConfig(nextLlm, mcpEditor.mode === "create" ? "MCP server added and saved" : "MCP server updated and saved");
    if (saved) setMcpEditor(null);
  };

  const handleSave = async () => {
    await persistLlmConfig(llm);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Agent Operations
        </CardTitle>
        <CardDescription>
          Configure LLM providers, MCP servers, agents, skills, and workflows for result-page chat and standalone API or webhook execution.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Enable toggle */}
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div>
            <p className="font-medium">Enable result-page agent chat</p>
            <p className="text-sm text-muted-foreground">Activate result-page agent chat. Standalone workflows remain available through their enabled API and webhook integrations.</p>
          </div>
          <Switch checked={llm.enabled} onCheckedChange={(v) => patchLlm({ enabled: v })} />
        </div>

        <Tabs defaultValue="providers" className="space-y-5">
          <TabsList className="grid h-auto w-full grid-cols-1 gap-1 rounded-xl bg-muted/60 p-1 sm:grid-cols-2 lg:grid-cols-4">
            <TabsTrigger value="providers" className="gap-2 rounded-lg py-2.5">
              <Server className="h-4 w-4" />
              Providers &amp; MCP
              <Badge variant="secondary" className="ml-1 px-1.5 text-[10px]">
                {activeProviders.length + activeMcpServers.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="skills" className="gap-2 rounded-lg py-2.5">
              <BookOpen className="h-4 w-4" />
              Agent Skills
              <Badge variant="secondary" className="ml-1 px-1.5 text-[10px]">{activeSkills.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="agents" className="gap-2 rounded-lg py-2.5">
              <Bot className="h-4 w-4" />
              AI Agents
              <Badge variant="secondary" className="ml-1 px-1.5 text-[10px]">{activeAgents.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="workflows" className="gap-2 rounded-lg py-2.5">
              <Workflow className="h-4 w-4" />
              Agent Workflows
              <Badge variant="secondary" className="ml-1 px-1.5 text-[10px]">{llm.workflows.filter((workflow) => !workflow.deletedAt).length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="providers" className="mt-0 space-y-6 rounded-xl border bg-muted/10 p-4 sm:p-5">
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">LLM Providers</h3>
                </div>
                <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setProviderEditor({ mode: "create", draft: emptyProvider() })}>
                  <Plus className="h-3.5 w-3.5" /> Add provider
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Providers are tried in priority order. Edits and priority changes save immediately and apply to agents and workflow nodes using global defaults on their next request.
              </p>
              <div className="overflow-x-auto rounded-md border bg-background">
                <div className="min-w-[820px]">
                  <div className="grid grid-cols-[76px_minmax(150px,1fr)_130px_150px_minmax(180px,1.2fr)_76px_132px] items-center gap-3 border-b bg-muted/50 px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    <span>Priority</span>
                    <span>Name</span>
                    <span>Family</span>
                    <span>Model</span>
                    <span>Endpoint</span>
                    <span>Status</span>
                    <span className="text-right">Actions</span>
                  </div>
                  {activeProviders.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">No providers configured.</div>
                  ) : activeProviders.map((provider, index) => (
                    <div key={provider.id} className="grid grid-cols-[76px_minmax(150px,1fr)_130px_150px_minmax(180px,1.2fr)_76px_132px] items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
                      <Badge variant={provider.enabled && activeProviders.find((item) => item.enabled)?.id === provider.id ? "default" : "secondary"} className="w-fit text-[10px]">{provider.enabled && activeProviders.find((item) => item.enabled)?.id === provider.id ? "Primary" : `#${index + 1}`}</Badge>
                      <span className="truncate text-sm font-medium" title={provider.name}>{provider.name || "Unnamed provider"}</span>
                      <span className="truncate text-xs text-muted-foreground">{provider.providerType === "openai_compatible" ? "OpenAI compatible" : provider.providerType}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground" title={provider.model}>{provider.model || "Not set"}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground" title={provider.apiBaseUrl}>{provider.apiBaseUrl || "Not set"}</span>
                      <Badge variant={provider.enabled ? "outline" : "secondary"} className="w-fit text-[10px]">{provider.enabled ? "Enabled" : "Off"}</Badge>
                      <div className="flex justify-end gap-1">
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Move provider up" disabled={isSaving || index === 0} onClick={() => moveProvider(index, index - 1)}><ChevronUp className="h-3.5 w-3.5" /></Button>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Move provider down" disabled={isSaving || index === activeProviders.length - 1} onClick={() => moveProvider(index, index + 1)}><ChevronDown className="h-3.5 w-3.5" /></Button>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Edit provider" onClick={() => setProviderEditor({ mode: "edit", draft: { ...provider } })}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Duplicate provider" onClick={() => duplicateProvider(provider)}><Copy className="h-3.5 w-3.5" /></Button>
                        <ConfirmRecycleButton name={provider.name || "Unnamed provider"} itemLabel="provider" onConfirm={() => recycleProvider(provider.id)} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <RecycleBinPanel title="Provider recycle bin" itemLabel="provider" items={recycledProviders} open={showProviderRecycle} onToggle={() => setShowProviderRecycle((value) => !value)} onRestore={restoreProvider} onDelete={permanentlyDeleteProvider} />
            </section>

            <Separator />

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">MCP Servers</h3>
                </div>
                <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setMcpEditor({ mode: "create", draft: emptyMcpServer() })}>
                  <Plus className="h-3.5 w-3.5" /> Add MCP server
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Connect remote MCP servers and assign them to agents. Connection testing remains available inside each editor.
              </p>
              <McpGuide />
              <div className="overflow-x-auto rounded-md border bg-background">
                <div className="min-w-[700px]">
                  <div className="grid grid-cols-[minmax(160px,1fr)_minmax(260px,1.8fr)_100px_80px_88px] items-center gap-3 border-b bg-muted/50 px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    <span>Name</span>
                    <span>Endpoint</span>
                    <span>Authentication</span>
                    <span>Status</span>
                    <span className="text-right">Actions</span>
                  </div>
                  {activeMcpServers.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">No MCP servers configured.</div>
                  ) : activeMcpServers.map((server) => (
                    <div key={server.id} className="grid grid-cols-[minmax(160px,1fr)_minmax(260px,1.8fr)_100px_80px_88px] items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
                      <span className="truncate text-sm font-medium" title={server.name}>{server.name || "Unnamed server"}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground" title={server.url}>{server.url || "Not set"}</span>
                      <span className="text-xs text-muted-foreground">{server.apiKey ? "API key" : "None"}</span>
                      <Badge variant={server.enabled ? "outline" : "secondary"} className="w-fit text-[10px]">{server.enabled ? "Enabled" : "Off"}</Badge>
                      <div className="flex justify-end gap-1">
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Edit MCP server" onClick={() => setMcpEditor({ mode: "edit", draft: { ...server } })}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Duplicate MCP server" onClick={() => duplicateMcp(server)}><Copy className="h-3.5 w-3.5" /></Button>
                        <ConfirmRecycleButton name={server.name || "Unnamed MCP server"} itemLabel="MCP server" onConfirm={() => recycleMcp(server.id)} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <RecycleBinPanel title="MCP recycle bin" itemLabel="MCP server" items={recycledMcpServers} open={showMcpRecycle} onToggle={() => setShowMcpRecycle((value) => !value)} onRestore={restoreMcp} onDelete={permanentlyDeleteMcp} />
            </section>
          </TabsContent>

          <TabsContent value="agents" className="mt-0 space-y-6 rounded-xl border bg-muted/10 p-4 sm:p-5">
            {/* Agents */}
            <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">Agents</h3>
            </div>
            <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-xs"
              onClick={() => {
                patchLlm({ agents: DEFAULT_AGENTS });
                toast.success("Agents reset to defaults");
              }}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Each agent has its own system prompt, expected output type, MCP server assignments, and quick prompts.
            In the chat, users can type <code className="bg-muted px-1 rounded">/</code> to switch between enabled agents.
            The first enabled agent is the default.
          </p>

          {activeAgents.length === 0 ? (
            <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">
              No agents configured. Add one below or reset to defaults.
            </p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[28px_1fr_80px_60px_48px_52px_auto] gap-2 px-3 py-2 bg-muted/50 border-b border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                <span className="text-center">#</span>
                <span>Name</span>
                <span className="text-center">Output</span>
                <span className="text-center">Prompts</span>
                <span className="text-center">MCP</span>
                <span className="text-center">On</span>
                <span>Actions</span>
              </div>

              {/* Table rows + inline edit panels */}
              {activeAgents.map((agent, i) => (
                <div key={agent.id}>
                  <AgentTableRow
                    agent={agent} index={i} total={activeAgents.length}
                    isEditing={editingAgentId === agent.id}
                    mcpServers={activeMcpServers}
                    onToggleEdit={() => setEditingAgentId(editingAgentId === agent.id ? null : agent.id)}
                    onChange={(updated) => updateAgent(agent.id, updated)}
                    onMove={moveAgent} onDuplicate={() => duplicateAgent(agent)} onRemove={() => { recycleAgent(agent.id); if (editingAgentId === agent.id) setEditingAgentId(null); }}
                  />
                  {editingAgentId === agent.id && (
                    <AgentEditPanel
                      agent={agent} availabilityTargets={availabilityTargets} skills={activeSkills} mcpServers={activeMcpServers} globalProviders={activeProviders}
                      supabaseClient={supabase} organizationId={user?.organization?.id}
                      onChange={(updated) => updateAgent(agent.id, updated)}
                      onClose={() => setEditingAgentId(null)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="gap-2">
                <Plus className="h-4 w-4" /> Add Agent <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-96 w-80 overflow-y-auto">
              <DropdownMenuItem onSelect={() => {
                const agent = emptyAgent();
                patchLlm({ agents: [...llm.agents, agent] });
                setEditingAgentId(agent.id);
              }}>
                Blank agent
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Available templates</DropdownMenuLabel>
              {[...DEFAULT_AGENTS, createLightcastSkillDescriptionAgent()].map((template) => (
                <DropdownMenuItem key={template.id} className="block cursor-pointer p-3" onSelect={() => {
                  const draft = structuredClone(template);
                  const agent = llm.agents.some((item) => item.id === draft.id)
                    ? { ...draft, id: uid(), name: `${draft.name} (copy)` }
                    : draft;
                  patchLlm({ agents: [...llm.agents, agent] });
                  setEditingAgentId(agent.id);
                }}>
                  <p className="text-xs font-semibold">{template.name}</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{template.description}</p>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <RecycleBinPanel title="Agent recycle bin" itemLabel="agent" items={recycledAgents} open={showAgentRecycle} onToggle={() => setShowAgentRecycle((value) => !value)} onRestore={restoreAgent} onDelete={permanentlyDeleteAgent} />
            </div>

            <Separator />

            {/* General Prompts — not tied to any agent */}
            <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">General Prompts</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            These prompts appear in the chat quick-pick alongside agent prompts but are not tied to any specific agent.
            The current active agent will handle them.
          </p>

          {llm.predefinedPrompts.length === 0 && (
            <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">
              No general prompts. Add one below.
            </p>
          )}
          <div className="space-y-2">
            {llm.predefinedPrompts.map((p, i) => (
              <div key={i} className="flex items-center gap-1">
                <div className="flex flex-col gap-0 shrink-0">
                  <Button type="button" variant="ghost" size="icon" className="h-5 w-6 rounded-none"
                    disabled={i === 0} onClick={() => moveGlobalPrompt(i, i - 1)}>
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-5 w-6 rounded-none"
                    disabled={i === llm.predefinedPrompts.length - 1} onClick={() => moveGlobalPrompt(i, i + 1)}>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </div>
                <Input className="h-8 text-xs flex-1" value={p} placeholder="Enter a general prompt…"
                  onChange={(e) => updateGlobalPrompt(i, e.target.value)} />
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => removeGlobalPrompt(i)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-2"
            onClick={() => patchLlm({ predefinedPrompts: [...llm.predefinedPrompts, ""] })}>
            <Plus className="h-4 w-4" /> Add General Prompt
          </Button>
            </div>
          </TabsContent>

          <TabsContent value="skills" className="mt-0 rounded-xl border bg-muted/10 p-4 sm:p-5">
            <AgentSkillsManagement skills={llm.skills} organizationId={user?.organization?.id} onChange={updateSkills} />
          </TabsContent>

          <TabsContent value="workflows" className="mt-0 rounded-xl border bg-muted/10 p-4 sm:p-5">
            {/* Agentic Workflows */}
            <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Agentic Workflows</h3>
            <Badge variant="outline" className="text-[10px]">beta</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Build node graphs that chain agents, run JavaScript transforms, and branch on conditions.
            Each workflow can be activated independently and triggered from the chat panel.
            Open the canvas editor to drag nodes, connect them, and load built-in examples.
          </p>
          <WorkflowsManagement
            workflows={llm.workflows ?? []}
            availabilityTargets={availabilityTargets}
            organizationId={user?.organization?.id}
            skills={activeSkills.filter((skill) => skill.enabled)}
            globalProviders={activeProviders.filter((provider) => provider.enabled)}
            mcpServers={activeMcpServers.filter((server) => server.enabled)}
            agents={activeAgents.filter((a) => a.enabled).map((a) => ({
              id: a.id,
              name: a.name,
              description: a.description,
              expectedOutput: a.expectedOutput,
            }))}
            onChange={(workflows) => patchLlm({ workflows })}
          />
            </div>
          </TabsContent>
        </Tabs>

        <Dialog open={providerEditor !== null} onOpenChange={(open) => { if (!open) setProviderEditor(null); }}>
          <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{providerEditor?.mode === "create" ? "Add LLM provider" : "Edit LLM provider"}</DialogTitle>
              <DialogDescription>Configure the provider connection and model used by agents and workflow nodes.</DialogDescription>
            </DialogHeader>
            {providerEditor && (
              <ProviderCard
                provider={providerEditor.draft}
                index={Math.max(0, llm.providers.findIndex((provider) => provider.id === providerEditor.draft.id))}
                total={Math.max(1, llm.providers.length)}
                showListControls={false}
                onChange={(draft) => setProviderEditor({ ...providerEditor, draft })}
                onMove={() => undefined}
                onRemove={() => undefined}
              />
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setProviderEditor(null)}>Cancel</Button>
              <Button type="button" className="gap-1.5" onClick={saveProviderEditor} disabled={isSaving}>
                <Save className="h-4 w-4" /> Save provider
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={mcpEditor !== null} onOpenChange={(open) => { if (!open) setMcpEditor(null); }}>
          <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{mcpEditor?.mode === "create" ? "Add MCP server" : "Edit MCP server"}</DialogTitle>
              <DialogDescription>Configure the server endpoint, credentials, status, and test its available tools.</DialogDescription>
            </DialogHeader>
            {mcpEditor && (
              <McpCard
                server={mcpEditor.draft}
                index={0}
                supabaseClient={supabase}
                organizationId={user?.organization?.id}
                showRemove={false}
                onChange={(draft) => setMcpEditor({ ...mcpEditor, draft })}
                onRemove={() => undefined}
              />
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMcpEditor(null)}>Cancel</Button>
              <Button type="button" className="gap-1.5" onClick={saveMcpEditor} disabled={isSaving}>
                <Save className="h-4 w-4" /> Save MCP server
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Separator />

        <p className="text-xs text-muted-foreground">
          Agent operations are stored in the organization global config and included in Admin Export/Import.
        </p>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving} className="gap-2">
            {isSaving ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Saving...</>
            ) : (
              <><Save className="h-4 w-4" />Save Agent Operations</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default LlmSettingsSection;
