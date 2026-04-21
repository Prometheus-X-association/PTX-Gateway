import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Loader2, Plus, Save, Send, Trash2, Eye, EyeOff, Upload, Palette, Pencil, Table as TableIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CustomVisualizationConfig, CustomVisualizationLibraryFile, ExportApiConfig } from "@/types/dataspace";

interface TemplateTagHelp {
  tag: string;
  title: string;
  description: string;
  example: string;
}

interface VisualizationTargetOption {
  id: string;
  label: string;
  type: "software" | "serviceChain";
}

const TEMPLATE_TAG_HELP: TemplateTagHelp[] = [
  {
    tag: "##result",
    title: "Full Result Object",
    description: "Inject the entire result JSON as a value.",
    example: '{\n  "raw_result": ##result\n}',
  },
  {
    tag: "##resultArray",
    title: "Single Path Value",
    description: "Get one specific value by JSON path and optional array index.",
    example: '{\n  "skill": ##resultArray.data.content.data.nodes[0].label,\n  "weight": ##resultArray.data.content.data.nodes[0].weight\n}',
  },
  {
    tag: "##resultArrayEach",
    title: "Map All Items In Array",
    description: "Generate one array item from each element in a source array.",
    example:
      '[\n  {\n    "name": ##resultArrayEach.data.content.data.nodes.label,\n    "weight": ##resultArrayEach.data.content.data.nodes.weight\n  }\n]',
  },
  {
    tag: "##forEach",
    title: "Send Multiple POST Requests",
    description: "Prefix template to send one POST request per item in the resolved body array.",
    example:
      '##forEach(1:)\n[\n  {\n    "name": ##resultArrayEach.data.content.data.nodes.label,\n    "weight": ##resultArrayEach.data.content.data.nodes.weight\n  }\n]',
  },
];

const DDV_RENDER_CODE_EXAMPLE = `return (async () => {
  const loadScriptOnce = (src, globalCheck) =>
    new Promise((resolve, reject) => {
      if (globalCheck?.()) return resolve();
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(\`Failed to load \${src}\`));
      document.head.appendChild(script);
    });

  await loadScriptOnce("https://d3js.org/d3.v6.min.js", () => Boolean(window.d3));
  await loadScriptOnce("https://d3js.org/d3-hexbin.v0.2.min.js", () => Boolean(window.d3?.hexbin));

  const ddvLib = window.ddv;
  if (!ddvLib?.visualizers?.VisualizationSeries) {
    throw new Error("DDV library is not available. Upload ptx-ddv.js as a JS library file.");
  }

  const graphSource =
    resultData?.data?.content?.data ||
    resultData?.content?.data ||
    resultData?.data ||
    resultData;

  if (!Array.isArray(graphSource?.nodes) || !Array.isArray(graphSource?.edges)) {
    throw new Error("Expected knowledge graph data at resultData.data.content.data.nodes and edges.");
  }

  const nodes = graphSource.nodes.map((node, index) => ({
    ...node,
    id: Number.isFinite(Number(node.id)) ? Number(node.id) : index,
    label: String(node.label || node.name || \`Node \${index + 1}\`),
    value: Number(node.value ?? node.weight ?? 1) || 1,
    weight: Number(node.weight ?? node.value ?? 1) || 1,
    group: String(node.group ?? "1"),
    search_center: String(node.search_center ?? "false"),
    sources: Array.isArray(node.sources) ? node.sources : [],
    relations: Array.isArray(node.relations) ? node.relations : []
  }));

  const validNodeIds = new Set(nodes.map((node) => node.id));
  const edges = graphSource.edges
    .map((edge) => ({
      ...edge,
      from: Number(edge.from),
      to: Number(edge.to),
      value: Number(edge.value ?? edge.weight ?? 1) || 1,
      title: edge.title || \`\${edge.from} - \${edge.to}\`
    }))
    .filter((edge) => validNodeIds.has(edge.from) && validNodeIds.has(edge.to));

  const graphData = {
    unique_identifier: graphSource.unique_identifier || resultData?.sessionID || \`ptx-graph-\${Date.now()}\`,
    legends: graphSource.legends || { "1": "Skills" },
    nodes,
    edges
  };

  container.innerHTML = "";
  const ddvContainer = document.createElement("div");
  ddvContainer.style.width = "100%";
  ddvContainer.style.minHeight = "660px";
  container.appendChild(ddvContainer);

  const width = Math.max(720, container.clientWidth || 960);
  const rules = {
    visuals: [
      {
        type: "HexagonMap",
        data: graphData,
        title: "Knowledge Graph",
        subtitle: \`\${nodes.length} concepts and \${edges.length} relations\`,
        buttonTitle: "Knowledge Graph",
        properties: {
          width,
          height: 660,
          valueField: "value",
          nameField: "label",
          categoryField: "group",
          showTooltip: true,
          showLegend: true
        }
      }
    ],
    properties: {
      showButtons: false,
      showTitle: true,
      width,
      height: 660
    }
  };

  const visualization = new ddvLib.visualizers.VisualizationSeries(rules);
  if (typeof visualization.attachOnSelection === "function" && window.d3) {
    visualization.attachOnSelection(window.d3.select(ddvContainer));
  } else {
    ddvContainer.id = \`ddv-\${Date.now()}\`;
    visualization.attachOn(\`div#\${ddvContainer.id}\`);
  }

  ddvLib.visualizers.responsive?.enableResponsivenessToSeries?.(visualization);
  visualization.refresh();
})();`;

const TABULATOR_RENDER_CODE_EXAMPLE = `return (async () => {
  const loadScriptOnce = (src, globalCheck) =>
    new Promise((resolve, reject) => {
      if (globalCheck?.()) return resolve();
      const existing = Array.from(document.scripts).find((script) => script.src === src);
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error(\`Failed to load \${src}\`)), { once: true });
        return resolve();
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(\`Failed to load \${src}\`));
      document.head.appendChild(script);
    });

  const loadShadowCssOnce = (href) =>
    new Promise((resolve, reject) => {
      if (shadowRoot.querySelector(\`link[href="\${href}"]\`)) return resolve();
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = () => resolve();
      link.onerror = () => reject(new Error(\`Failed to load \${href}\`));
      shadowRoot.appendChild(link);
    });

  await loadShadowCssOnce("https://unpkg.com/tabulator-tables@6.4.0/dist/css/tabulator.min.css");
  await loadScriptOnce("https://unpkg.com/tabulator-tables@6.4.0/dist/js/tabulator.min.js", () => Boolean(window.Tabulator));

  const resultRoot =
    resultData?.data?.content?.data?.result ||
    resultData?.content?.data?.result ||
    resultData?.data?.result ||
    resultData?.result;

  if (!resultRoot || typeof resultRoot !== "object" || Array.isArray(resultRoot)) {
    throw new Error("Expected result object at resultData.data.content.data.result.");
  }

  const toDisplayName = (key) => String(key || "").replaceAll("_", " ");
  const toJsonKey = (name) =>
    String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\\s+/g, "_")
      .replace(/_+/g, "_");

  const cloneResultData = () => JSON.parse(JSON.stringify(resultData));
  const getMutableResultRoot = (draft) => {
    if (draft?.data?.content?.data?.result) return draft.data.content.data.result;
    if (draft?.content?.data?.result) return draft.content.data.result;
    if (draft?.data?.result) return draft.data.result;
    if (draft?.result) return draft.result;
    return null;
  };

  const rows = Object.entries(resultRoot).map(([skillKey, value]) => {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const skills = Array.isArray(record.skills) ? record.skills : [];
    const firstSkill = skills[0] && typeof skills[0] === "object" ? skills[0] : {};
    const description = firstSkill?.description?.literal || "";
    const alternativeLabels = Array.isArray(firstSkill?.alternative_labels)
      ? firstSkill.alternative_labels.join(", ")
      : "";

    return {
      id: skillKey,
      original_key: skillKey,
      skill_name: toDisplayName(skillKey),
      skill_description: description,
      count: Number(record.count || 0),
      alternative_labels: alternativeLabels,
    };
  });

  container.innerHTML = "";

  const style = document.createElement("style");
  style.textContent = \`
    .tabulator-custom-shell {
      display: grid;
      gap: 12px;
      width: 100%;
      min-height: 640px;
    }
    .tabulator-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      border: 1px solid rgba(148, 163, 184, 0.35);
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.04);
    }
    .tabulator-toolbar input {
      min-width: min(100%, 320px);
      border: 1px solid rgba(148, 163, 184, 0.55);
      border-radius: 10px;
      padding: 9px 12px;
      background: white;
      color: #0f172a;
      outline: none;
    }
    .tabulator-toolbar-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    .tabulator-save-button {
      display: none;
      border: 0;
      border-radius: 10px;
      padding: 9px 14px;
      background: #059669;
      color: white;
      font-weight: 600;
      cursor: pointer;
    }
    .tabulator-save-button.is-visible {
      display: inline-flex;
    }
    .tabulator-save-button:hover {
      background: #047857;
    }
    .tabulator-reset-button {
      display: none;
      border: 1px solid rgba(148, 163, 184, 0.55);
      border-radius: 10px;
      padding: 9px 14px;
      background: white;
      color: #334155;
      font-weight: 600;
      cursor: pointer;
    }
    .tabulator-reset-button.is-visible {
      display: inline-flex;
    }
    .tabulator-toolbar .hint {
      font-size: 12px;
      color: #64748b;
    }
    .tabulator-table-host {
      min-height: 560px;
      width: 100%;
    }
    .tabulator {
      border-radius: 14px;
      overflow: hidden;
      border-color: rgba(148, 163, 184, 0.35);
      font-size: 13px;
    }
    .tabulator .tabulator-header {
      background: #0f172a;
      color: white;
    }
    .tabulator-row .tabulator-cell {
      white-space: normal;
    }
  \`;
  shadowRoot.appendChild(style);

  const shell = document.createElement("div");
  shell.className = "tabulator-custom-shell";

  const toolbar = document.createElement("div");
  toolbar.className = "tabulator-toolbar";

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search skills, descriptions, or alternative labels...";

  const toolbarActions = document.createElement("div");
  toolbarActions.className = "tabulator-toolbar-actions";

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "tabulator-save-button";
  saveButton.textContent = "Save changes to JSON";

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "tabulator-reset-button";
  resetButton.textContent = "Discard table edits";

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Edit cells directly, then click Save changes to synchronize with the JSON view.";

  toolbarActions.append(saveButton, resetButton);
  toolbar.append(searchInput, toolbarActions, hint);

  const tableHost = document.createElement("div");
  tableHost.className = "tabulator-table-host";

  shell.append(toolbar, tableHost);
  container.appendChild(shell);

  const setDirty = (dirty) => {
    saveButton.classList.toggle("is-visible", dirty);
    resetButton.classList.toggle("is-visible", dirty);
    hint.textContent = dirty
      ? "You have unsaved table edits. Click Save changes to update the JSON view."
      : "Edit cells directly, then click Save changes to synchronize with the JSON view.";
  };

  const applyRowsToJson = (tableRows) => {
    const draft = cloneResultData();
    const mutableRoot = getMutableResultRoot(draft);
    if (!mutableRoot) {
      throw new Error("Could not locate result object in JSON.");
    }

    const usedKeys = new Set();
    const nextRoot = {};

    tableRows.forEach((rowData) => {
      const previousKey = rowData.original_key;
      const nextKey = toJsonKey(rowData.skill_name);
      if (!nextKey) {
        throw new Error("Skill name cannot be empty.");
      }
      if (usedKeys.has(nextKey)) {
        throw new Error(\`Duplicate skill name: "\${rowData.skill_name}".\`);
      }
      usedKeys.add(nextKey);

      const originalRecord = mutableRoot[previousKey] || {
        count: rowData.count || 0,
        skills: [{ description: { literal: "", mimetype: "plain/text" }, alternative_labels: [] }],
      };

      const record = JSON.parse(JSON.stringify(originalRecord));
      record.count = Number(rowData.count || 0);

      if (!Array.isArray(record.skills)) {
        record.skills = [{ description: { literal: "", mimetype: "plain/text" }, alternative_labels: [] }];
      }
      if (!record.skills[0] || typeof record.skills[0] !== "object") {
        record.skills[0] = { description: { literal: "", mimetype: "plain/text" }, alternative_labels: [] };
      }
      if (!record.skills[0].description || typeof record.skills[0].description !== "object") {
        record.skills[0].description = { mimetype: "plain/text" };
      }

      record.skills[0].description.literal = rowData.skill_description || "";
      record.skills[0].description.mimetype = record.skills[0].description.mimetype || "plain/text";
      record.skills[0].alternative_labels = String(rowData.alternative_labels || "")
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean);

      nextRoot[nextKey] = record;
      rowData.id = nextKey;
      rowData.original_key = nextKey;
      rowData.skill_name = toDisplayName(nextKey);
    });

    Object.keys(mutableRoot).forEach((key) => delete mutableRoot[key]);
    Object.assign(mutableRoot, nextRoot);

    updateResultData(draft);
  };

  const table = new window.Tabulator(tableHost, {
    data: rows,
    layout: "fitColumns",
    reactiveData: false,
    height: "560px",
    movableColumns: true,
    pagination: true,
    paginationSize: 12,
    paginationSizeSelector: [12, 25, 50, true],
    placeholder: "No skills found in the result JSON.",
    columns: [
      {
        title: "Skills Name",
        field: "skill_name",
        editor: "input",
        sorter: "string",
        width: 240,
      },
      {
        title: "Skills Description",
        field: "skill_description",
        editor: "textarea",
        sorter: "string",
        formatter: "textarea",
        minWidth: 420,
      },
      {
        title: "Count",
        field: "count",
        editor: "number",
        sorter: "number",
        width: 110,
      },
      {
        title: "Alternative Labels",
        field: "alternative_labels",
        editor: "textarea",
        sorter: "string",
        formatter: "textarea",
        minWidth: 260,
      },
    ],
    cellEdited: () => setDirty(true),
  });

  saveButton.addEventListener("click", () => {
    try {
      applyRowsToJson(table.getData());
      setDirty(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not update JSON.");
    }
  });

  resetButton.addEventListener("click", () => {
    table.replaceData(rows);
    setDirty(false);
  });

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      table.clearFilter();
      return;
    }

    table.setFilter((row) =>
      ["skill_name", "skill_description", "alternative_labels"].some((field) =>
        String(row[field] || "").toLowerCase().includes(query)
      )
    );
  });
})();`;

const emptyExportApi = (): ExportApiConfig => ({
  name: "",
  url: "",
  authorization: "",
  params: [],
  body_template: '{\n  "data": ##result\n}',
});

const emptyCustomVisualization = (): CustomVisualizationConfig => ({
  id: crypto.randomUUID(),
  name: "",
  description: "",
  is_active: false,
  library_source: "url",
  library_url: "",
  library_file_name: "",
  library_code: "",
  library_files: [],
  json_schema: "",
  render_code:
    "// Available variables: container, resultData, jsonSchema, config\n" +
    "// The visualization library is loaded before this code runs.\n" +
    "container.innerHTML = `<pre style=\"white-space:pre-wrap;font:12px monospace;\">${JSON.stringify(resultData, null, 2)}</pre>`;",
  target_resources: [],
});

const inferJsonSchema = (value: unknown): Record<string, unknown> => {
  if (value === null) {
    return { type: "null" };
  }

  if (Array.isArray(value)) {
    const itemSchemas = value.slice(0, 25).map(inferJsonSchema);
    const firstSchema = itemSchemas[0] || {};
    return {
      type: "array",
      items: itemSchemas.length > 1 ? mergeJsonSchemas(itemSchemas) : firstSchema,
    };
  }

  const valueType = typeof value;
  if (valueType === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.entries(record);
    return {
      type: "object",
      properties: Object.fromEntries(
        entries.map(([key, item]) => [key, inferJsonSchema(item)])
      ),
      required: entries.map(([key]) => key),
      additionalProperties: true,
    };
  }

  if (valueType === "number") {
    return { type: Number.isInteger(value) ? "integer" : "number" };
  }

  if (valueType === "string" || valueType === "boolean") {
    return { type: valueType };
  }

  return { type: "string" };
};

const mergeJsonSchemas = (schemas: Record<string, unknown>[]): Record<string, unknown> => {
  if (schemas.length === 0) return {};

  const uniqueTypes = Array.from(new Set(schemas.map((schema) => schema.type).filter(Boolean)));
  if (uniqueTypes.length > 1) {
    return { anyOf: schemas };
  }

  if (uniqueTypes[0] === "object") {
    const allProperties: Record<string, unknown> = {};
    const requiredSets = schemas
      .map((schema) => Array.isArray(schema.required) ? schema.required.map(String) : [])
      .filter((required) => required.length > 0);
    const commonRequired = requiredSets.length > 0
      ? requiredSets.reduce((common, required) => common.filter((key) => required.includes(key)))
      : [];

    schemas.forEach((schema) => {
      const properties = isRecord(schema.properties) ? schema.properties : {};
      Object.entries(properties).forEach(([key, propertySchema]) => {
        if (!allProperties[key]) {
          allProperties[key] = propertySchema;
          return;
        }
        if (isRecord(allProperties[key]) && isRecord(propertySchema)) {
          allProperties[key] = mergeJsonSchemas([allProperties[key] as Record<string, unknown>, propertySchema]);
        }
      });
    });

    return {
      type: "object",
      properties: allProperties,
      required: commonRequired,
      additionalProperties: true,
    };
  }

  if (uniqueTypes[0] === "array") {
    const itemSchemas = schemas
      .map((schema) => schema.items)
      .filter(isRecord);
    return {
      type: "array",
      items: mergeJsonSchemas(itemSchemas),
    };
  }

  return schemas[0];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getExportApisFromFeatures = (features: unknown): ExportApiConfig[] => {
  if (!isRecord(features)) return [];
  const resultPage = isRecord(features.resultPage) ? features.resultPage : {};
  return Array.isArray(resultPage.exportApiConfigs)
    ? (resultPage.exportApiConfigs as unknown as ExportApiConfig[])
    : [];
};

const getCustomVisualizationsFromFeatures = (features: unknown): CustomVisualizationConfig[] => {
  if (!isRecord(features)) return [];
  const resultPage = isRecord(features.resultPage) ? features.resultPage : {};
  return Array.isArray(resultPage.customVisualizations)
    ? (resultPage.customVisualizations as unknown as CustomVisualizationConfig[])
    : [];
};

const ResultPageSettingsSection = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [globalFeatures, setGlobalFeatures] = useState<Record<string, unknown>>({});
  const [exportApis, setExportApis] = useState<ExportApiConfig[]>([]);
  const [customVisualizations, setCustomVisualizations] = useState<CustomVisualizationConfig[]>([]);
  const [visualizationTargets, setVisualizationTargets] = useState<VisualizationTargetOption[]>([]);
  const [schemaSampleInputs, setSchemaSampleInputs] = useState<Record<string, string>>({});
  const [isUsingLegacyExportApis, setIsUsingLegacyExportApis] = useState(false);
  const [isTagHelpOpen, setIsTagHelpOpen] = useState(false);
  const [selectedTagHelp, setSelectedTagHelp] = useState<TemplateTagHelp | null>(null);
  const [editingVisualizationId, setEditingVisualizationId] = useState<string | null>(null);
  const [deleteVisualizationId, setDeleteVisualizationId] = useState<string | null>(null);

  const editingVisualizationIndex = customVisualizations.findIndex(
    (visualization) => visualization.id === editingVisualizationId
  );
  const editingVisualization = editingVisualizationIndex >= 0
    ? customVisualizations[editingVisualizationIndex]
    : null;
  const deleteVisualization = customVisualizations.find(
    (visualization) => visualization.id === deleteVisualizationId
  );

  const fetchSettings = async () => {
    if (!user?.organization?.id) return;

    setIsLoading(true);
    try {
      const [
        { data: globalData, error: globalError },
        { data: legacyData, error: legacyError },
        { data: softwareData, error: softwareError },
        { data: chainsData, error: chainsError },
      ] = await Promise.all([
        supabase
          .from("global_configs")
          .select("features")
          .eq("organization_id", user.organization.id)
          .maybeSingle(),
        supabase
          .from("dataspace_configs")
          .select("export_api_configs")
          .eq("organization_id", user.organization.id),
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

      if (globalError) throw globalError;
      if (legacyError) throw legacyError;
      if (softwareError) throw softwareError;
      if (chainsError) throw chainsError;

      const features = isRecord(globalData?.features) ? globalData.features : {};
      const storedExportApis = getExportApisFromFeatures(features);
      const storedCustomVisualizations = getCustomVisualizationsFromFeatures(features);
      const legacyExportApis = (legacyData || []).flatMap((config) =>
        Array.isArray(config.export_api_configs)
          ? (config.export_api_configs as unknown as ExportApiConfig[])
          : [],
      );
      const softwareTargets: VisualizationTargetOption[] = (softwareData || []).map((item) => ({
        id: `software:${item.id}`,
        label: item.resource_name || item.resource_url || item.id,
        type: "software",
      }));
      const serviceChainTargets: VisualizationTargetOption[] = (chainsData || []).map((item) => {
        const basis = isRecord(item.basis_information) ? item.basis_information : {};
        return {
          id: `serviceChain:${item.id}`,
          label: String(basis.name || item.catalog_id || item.id),
          type: "serviceChain",
        };
      });

      setGlobalFeatures(features);
      setExportApis(storedExportApis.length > 0 ? storedExportApis : legacyExportApis);
      setCustomVisualizations(storedCustomVisualizations);
      setVisualizationTargets([...softwareTargets, ...serviceChainTargets]);
      setIsUsingLegacyExportApis(storedExportApis.length === 0 && legacyExportApis.length > 0);
    } catch {
      toast.error("Failed to load result page settings");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchSettings();
  }, [user?.organization?.id]);

  const updateApi = (index: number, next: Partial<ExportApiConfig>) => {
    setExportApis((current) => {
      const updated = [...current];
      updated[index] = { ...updated[index], ...next };
      return updated;
    });
  };

  const updateCustomVisualization = (index: number, next: Partial<CustomVisualizationConfig>) => {
    setCustomVisualizations((current) => {
      const updated = [...current];
      updated[index] = { ...updated[index], ...next };
      return updated;
    });
  };

  const toggleVisualizationTarget = (index: number, targetId: string, checked: boolean) => {
    setCustomVisualizations((current) => {
      const updated = [...current];
      const currentTargets = updated[index]?.target_resources || [];
      updated[index] = {
        ...updated[index],
        target_resources: checked
          ? Array.from(new Set([...currentTargets, targetId]))
          : currentTargets.filter((id) => id !== targetId),
      };
      return updated;
    });
  };

  const handleVisualizationFileUpload = async (index: number, files: FileList | null) => {
    if (!files?.length) return;

    const nextFiles: CustomVisualizationLibraryFile[] = [];
    for (const file of Array.from(files)) {
      const lowerName = file.name.toLowerCase();
      const fileType = lowerName.endsWith(".js")
        ? "js"
        : lowerName.endsWith(".css")
          ? "css"
          : null;

      if (!fileType) {
        toast.error(`${file.name} is not supported. Upload only .js or .css files.`);
        return;
      }

      nextFiles.push({
        id: crypto.randomUUID(),
        file_name: file.name,
        file_type: fileType,
        mime_type: file.type || (fileType === "css" ? "text/css" : "text/javascript"),
        content: await file.text(),
      });
    }

    setCustomVisualizations((current) => {
      const updated = [...current];
      const visualization = updated[index];
      if (!visualization) return current;

      updated[index] = {
        ...visualization,
        library_source: "upload",
        library_url: "",
        library_file_name: "",
        library_code: "",
        library_files: [...(visualization.library_files || []), ...nextFiles],
      };
      return updated;
    });
    toast.success(`Loaded ${nextFiles.length} visualization file${nextFiles.length === 1 ? "" : "s"}`);
  };

  const handleDownloadVisualizationFile = (file: CustomVisualizationLibraryFile) => {
    const blob = new Blob([file.content], { type: file.mime_type || (file.file_type === "css" ? "text/css" : "text/javascript") });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.file_name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleDeleteVisualizationFile = (index: number, fileId: string) => {
    const visualization = customVisualizations[index];
    if (!visualization) return;

    updateCustomVisualization(index, {
      library_files: (visualization.library_files || []).filter((file) => file.id !== fileId),
    });
    toast.success("Visualization library file removed. Save the settings to persist this change.");
  };

  const handleApplyDdvExample = (index: number) => {
    if (!customVisualizations[index]) return;
    updateCustomVisualization(index, { render_code: DDV_RENDER_CODE_EXAMPLE });
    toast.success("DDV knowledge graph example applied to render code");
  };

  const handleApplyTabulatorExample = (index: number) => {
    if (!customVisualizations[index]) return;
    updateCustomVisualization(index, { render_code: TABULATOR_RENDER_CODE_EXAMPLE });
    toast.success("Tabulator interactive table example applied to render code");
  };

  const handleAddTabulatorVisualization = () => {
    const visualization: CustomVisualizationConfig = {
      ...emptyCustomVisualization(),
      name: "Interactive Skills Table",
      description: "Editable Tabulator table for resultData.data.content.data.result skill descriptions.",
      render_code: TABULATOR_RENDER_CODE_EXAMPLE,
    };
    setCustomVisualizations((current) => [...current, visualization]);
    setEditingVisualizationId(visualization.id);
  };

  const getVisualizationLibrarySummary = (visualization: CustomVisualizationConfig) => {
    const uploadedFiles = visualization.library_files || [];
    if (uploadedFiles.length > 0) {
      const jsCount = uploadedFiles.filter((file) => file.file_type === "js").length;
      const cssCount = uploadedFiles.filter((file) => file.file_type === "css").length;
      return `${uploadedFiles.length} uploaded file${uploadedFiles.length === 1 ? "" : "s"} (${jsCount} JS, ${cssCount} CSS)`;
    }

    if (visualization.library_source === "upload") {
      return visualization.library_file_name || "Uploaded JS";
    }

    return visualization.library_url || "No library URL";
  };

  const handleSchemaSampleUpload = async (visualizationId: string, file: File | undefined) => {
    if (!file) return;
    if (!file.name.endsWith(".json")) {
      toast.error("Only .json sample result files are supported");
      return;
    }

    const sample = await file.text();
    setSchemaSampleInputs((current) => ({ ...current, [visualizationId]: sample }));
    toast.success(`Loaded sample result ${file.name}`);
  };

  const handleGenerateSchemaFromSample = (index: number) => {
    const visualization = customVisualizations[index];
    if (!visualization) return;

    const sample = schemaSampleInputs[visualization.id]?.trim();
    if (!sample) {
      toast.error("Paste or upload a sample result JSON first");
      return;
    }

    try {
      const parsed = JSON.parse(sample);
      const schema = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: visualization.name || "PTX Gateway Result",
        description: "Generated from a sample result JSON returned by the configured result endpoint.",
        ...inferJsonSchema(parsed),
      };
      updateCustomVisualization(index, { json_schema: JSON.stringify(schema, null, 2) });
      toast.success("JSON Schema generated from sample result");
    } catch (error) {
      toast.error(error instanceof Error ? `Invalid sample JSON: ${error.message}` : "Invalid sample JSON");
    }
  };

  const handleOpenTagHelp = (tag: string) => {
    const help = TEMPLATE_TAG_HELP.find((item) => item.tag === tag);
    if (!help) return;
    setSelectedTagHelp(help);
    setIsTagHelpOpen(true);
  };

  const saveResultPageSettings = async (successMessage: string) => {
    if (!user?.organization?.id) return;

    setIsSaving(true);
    try {
      const nextFeatures = {
        ...globalFeatures,
        resultPage: {
          ...(isRecord(globalFeatures.resultPage) ? globalFeatures.resultPage : {}),
          exportApiConfigs: exportApis,
          customVisualizations,
        },
      };

      const { error } = await supabase
        .from("global_configs")
        .upsert({
          organization_id: user.organization.id,
          features: nextFeatures,
        }, { onConflict: "organization_id" });

      if (error) throw error;
      toast.success(successMessage);
      setIsUsingLegacyExportApis(false);
      await fetchSettings();
    } catch {
      toast.error("Failed to save result page settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    await saveResultPageSettings("Export API endpoints saved");
  };

  const handleSaveCustomVisualizations = async () => {
    await saveResultPageSettings("Custom visualizations saved");
  };

  const handleAddCustomVisualization = () => {
    const visualization = emptyCustomVisualization();
    setCustomVisualizations((current) => [...current, visualization]);
    setEditingVisualizationId(visualization.id);
  };

  const handleConfirmDeleteVisualization = () => {
    if (!deleteVisualizationId) return;

    setCustomVisualizations((current) => current.filter((visualization) => visualization.id !== deleteVisualizationId));
    if (editingVisualizationId === deleteVisualizationId) {
      setEditingVisualizationId(null);
    }
    setDeleteVisualizationId(null);
    toast.success("Custom visualization deleted. Save the settings to persist this change.");
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
        <CardTitle>Result Page Settings</CardTitle>
        <CardDescription>
          Configure settings used after PDC execution, including export endpoints and future result-page behavior.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="export-api" className="space-y-4">
          <TabsList>
            <TabsTrigger value="export-api" className="gap-2">
              <Send className="h-4 w-4" />
              Export API Endpoints
            </TabsTrigger>
            <TabsTrigger value="custom-visualization" className="gap-2">
              <Palette className="h-4 w-4" />
              Custom Visualization
            </TabsTrigger>
            <TabsTrigger value="page-settings">
              Page Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="export-api" className="space-y-4">
            <>
              {isUsingLegacyExportApis && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-200">
                  Existing export endpoints were loaded from the old PDC configuration location. Save this page once to migrate them to Result Page settings.
                </div>
              )}
                <div className="space-y-3 border rounded-lg p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Label className="flex items-center gap-2">
                        <Send className="w-4 h-4" />
                        Export API Endpoints
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Configure API endpoints available for users to export result data from the result page.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setExportApis((current) => [...current, emptyExportApi()])}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add API
                    </Button>
                  </div>

                  {exportApis.length === 0 ? (
                    <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
                      No export API endpoints configured yet.
                    </div>
                  ) : (
                    exportApis.map((api, apiIndex) => (
                      <div key={apiIndex} className="border border-border rounded-lg p-4 space-y-3 bg-secondary/20">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">API #{apiIndex + 1}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setExportApis((current) => current.filter((_, index) => index !== apiIndex))}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Name</Label>
                            <Input
                              value={api.name}
                              onChange={(e) => updateApi(apiIndex, { name: e.target.value })}
                              placeholder="My Export API"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">URL</Label>
                            <Input
                              value={api.url}
                              onChange={(e) => updateApi(apiIndex, { url: e.target.value })}
                              placeholder="https://api.example.com/data"
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Authorization</Label>
                          <Input
                            type="password"
                            value={api.authorization || ""}
                            onChange={(e) => updateApi(apiIndex, { authorization: e.target.value })}
                            placeholder="Bearer <token>"
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs">Parameters</Label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs"
                              onClick={() =>
                                updateApi(apiIndex, {
                                  params: [...(api.params || []), { key: "", value: "" }],
                                })
                              }
                            >
                              <Plus className="h-3 w-3 mr-1" />
                              Add
                            </Button>
                          </div>
                          {(api.params || []).map((param, paramIndex) => (
                            <div key={paramIndex} className="flex gap-2">
                              <Input
                                value={param.key}
                                onChange={(e) => {
                                  const params = [...(api.params || [])];
                                  params[paramIndex] = { ...params[paramIndex], key: e.target.value };
                                  updateApi(apiIndex, { params });
                                }}
                                placeholder="Key"
                                className="flex-1"
                              />
                              <Input
                                value={param.value}
                                onChange={(e) => {
                                  const params = [...(api.params || [])];
                                  params[paramIndex] = { ...params[paramIndex], value: e.target.value };
                                  updateApi(apiIndex, { params });
                                }}
                                placeholder="Value"
                                className="flex-1"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-10 px-2"
                                onClick={() => updateApi(apiIndex, { params: (api.params || []).filter((_, index) => index !== paramIndex) })}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">
                            Body Template <span className="text-primary">(supports ##result, ##resultArray, ##resultArrayEach, ##forEach)</span>
                          </Label>
                          <Textarea
                            value={api.body_template || ""}
                            onChange={(e) => updateApi(apiIndex, { body_template: e.target.value })}
                            placeholder='{"data": ##result}'
                            className="font-mono text-xs min-h-[80px]"
                          />
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">Tag examples:</span>
                            {TEMPLATE_TAG_HELP.map((item) => (
                              <button
                                key={item.tag}
                                type="button"
                                onClick={() => handleOpenTagHelp(item.tag)}
                                className="text-xs px-2 py-1 rounded border border-border bg-secondary/40 hover:bg-secondary/70 transition-colors"
                              >
                                {item.tag}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save Export APIs
                      </>
                    )}
                  </Button>
                </div>
            </>
          </TabsContent>

          <TabsContent value="custom-visualization" className="space-y-4">
            <div className="space-y-3 border rounded-lg p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Label className="flex items-center gap-2">
                    <Palette className="w-4 h-4" />
                    Custom Visualization List
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Define JavaScript visualizations that render result JSON for selected software resources or service chains.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddCustomVisualization}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Visualization
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddTabulatorVisualization}
                >
                  <TableIcon className="h-4 w-4 mr-1" />
                  Add Tabulator Table
                </Button>
              </div>

              {customVisualizations.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
                  No custom visualizations configured yet.
                </div>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Library</TableHead>
                        <TableHead>Targets</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customVisualizations.map((visualization, index) => (
                        <TableRow key={visualization.id}>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-medium">
                                {visualization.name || `Visualization #${index + 1}`}
                              </p>
                              {visualization.description && (
                                <p className="text-xs text-muted-foreground line-clamp-2">
                                  {visualization.description}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={visualization.is_active ? "default" : "secondary"}>
                              {visualization.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {getVisualizationLibrarySummary(visualization)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {(visualization.target_resources || []).length || "No"} selected
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant={visualization.is_active ? "secondary" : "outline"}
                                size="sm"
                                onClick={() => updateCustomVisualization(index, { is_active: !visualization.is_active })}
                              >
                                {visualization.is_active ? (
                                  <>
                                    <EyeOff className="h-4 w-4 mr-1" />
                                    Deactivate
                                  </>
                                ) : (
                                  <>
                                    <Eye className="h-4 w-4 mr-1" />
                                    Activate
                                  </>
                                )}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setEditingVisualizationId(visualization.id)}
                              >
                                <Pencil className="h-4 w-4 mr-1" />
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteVisualizationId(visualization.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSaveCustomVisualizations} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save Custom Visualizations
                  </>
                )}
              </Button>
            </div>

            <Dialog open={Boolean(editingVisualization)} onOpenChange={(open) => !open && setEditingVisualizationId(null)}>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
                <DialogHeader>
                  <DialogTitle>
                    {editingVisualization?.name || "Edit Custom Visualization"}
                  </DialogTitle>
                  <DialogDescription>
                    Modify the visualization library, compatibility schema, render code, and selected result targets.
                  </DialogDescription>
                </DialogHeader>

                {editingVisualization && editingVisualizationIndex >= 0 && (
                  <div className="space-y-4 py-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Name</Label>
                        <Input
                          value={editingVisualization.name}
                          onChange={(event) => updateCustomVisualization(editingVisualizationIndex, { name: event.target.value })}
                          placeholder="Skills network visualization"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Library URL / CDN</Label>
                        <Input
                          value={editingVisualization.library_url || ""}
                          onChange={(event) => updateCustomVisualization(editingVisualizationIndex, {
                            library_source: "url",
                            library_url: event.target.value,
                          })}
                          placeholder="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"
                        />
                        <p className="text-xs text-muted-foreground">
                          Optional. If uploaded files are present, uploaded JS/CSS files are loaded first and can be used instead of a CDN URL.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Short Description</Label>
                      <Textarea
                        value={editingVisualization.description || ""}
                        onChange={(event) => updateCustomVisualization(editingVisualizationIndex, { description: event.target.value })}
                        placeholder="Explain what this visualization shows on the result page."
                        className="min-h-[70px]"
                      />
                    </div>

                    <div className="rounded-md border bg-background/40 p-3 space-y-2">
                      <Label className="text-xs flex items-center gap-2">
                        <Upload className="h-3.5 w-3.5" />
                        Uploaded Visualization Library Files (.js / .css)
                      </Label>
                      <Input
                        type="file"
                        multiple
                        accept=".js,.css,application/javascript,text/javascript,text/css"
                        onChange={(event) => {
                          void handleVisualizationFileUpload(editingVisualizationIndex, event.target.files);
                          event.currentTarget.value = "";
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Upload one or more JavaScript and CSS files. CSS is injected into the custom visualization Shadow DOM. JS files are loaded in the listed order before your render code runs.
                      </p>

                      {(editingVisualization.library_files || []).length > 0 ? (
                        <div className="rounded-md border overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>File</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(editingVisualization.library_files || []).map((file) => (
                                <TableRow key={file.id}>
                                  <TableCell className="font-medium">{file.file_name}</TableCell>
                                  <TableCell>
                                    <Badge variant="secondary">{file.file_type.toUpperCase()}</Badge>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex justify-end gap-2">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleDownloadVisualizationFile(file)}
                                      >
                                        <Download className="h-4 w-4 mr-1" />
                                        Download
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDeleteVisualizationFile(editingVisualizationIndex, file.id)}
                                      >
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : editingVisualization.library_file_name ? (
                        <p className="text-xs text-muted-foreground">
                          Legacy uploaded file: <span className="font-medium">{editingVisualization.library_file_name}</span>. Upload a new JS/CSS file to use the multi-file library list.
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No uploaded library files yet.
                        </p>
                      )}
                    </div>

                    <div className="rounded-md border bg-emerald-500/5 p-3 space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <Label className="text-xs">Tabulator Editable Skills Table Example</Label>
                          <p className="text-xs text-muted-foreground mt-1">
                            Use this for a searchable, sortable, filterable, editable table powered by Tabulator 6.4. It reads <code>resultData.data.content.data.result</code>, displays skill keys with spaces, and writes edited names back to JSON with underscores.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleApplyTabulatorExample(editingVisualizationIndex)}
                        >
                          Use Tabulator Example
                        </Button>
                      </div>
                      <details className="rounded-md border bg-background/60 p-3">
                        <summary className="cursor-pointer text-xs font-medium">
                          Show Tabulator render code
                        </summary>
                        <pre className="mt-3 max-h-72 overflow-auto rounded bg-secondary/50 p-3 text-xs">
{TABULATOR_RENDER_CODE_EXAMPLE}
                        </pre>
                      </details>
                    </div>

                    <div className="rounded-md border bg-blue-500/5 p-3 space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <Label className="text-xs">DDV / Distributed Data Visualization Example</Label>
                          <p className="text-xs text-muted-foreground mt-1">
                            Use this as a starting point for <code>ptx-ddv.js</code>. It expects knowledge graph data at <code>resultData.data.content.data</code> with <code>nodes[]</code> and <code>edges[]</code>, then renders a DDV HexagonMap inside the Shadow DOM container.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleApplyDdvExample(editingVisualizationIndex)}
                        >
                          Use DDV Example
                        </Button>
                      </div>
                      <details className="rounded-md border bg-background/60 p-3">
                        <summary className="cursor-pointer text-xs font-medium">
                          Show example render code
                        </summary>
                        <pre className="mt-3 max-h-72 overflow-auto rounded bg-secondary/50 p-3 text-xs">
{DDV_RENDER_CODE_EXAMPLE}
                        </pre>
                      </details>
                    </div>

                    <div className="rounded-md border bg-background/40 p-3 space-y-3">
                      <div>
                        <Label className="text-xs">Sample Result JSON From Fetch Result</Label>
                        <p className="text-xs text-muted-foreground mt-1">
                          Paste or upload an example JSON response from the result endpoint. The app infers an input compatibility schema from this sample, so the result page can check whether fetched resultData fits this custom visualization before rendering it.
                        </p>
                      </div>
                      <Input
                        type="file"
                        accept=".json,application/json"
                        onChange={(event) => void handleSchemaSampleUpload(editingVisualization.id, event.target.files?.[0])}
                      />
                      <Textarea
                        value={schemaSampleInputs[editingVisualization.id] || ""}
                        onChange={(event) => setSchemaSampleInputs((current) => ({
                          ...current,
                          [editingVisualization.id]: event.target.value,
                        }))}
                        placeholder='{"data":{"nodes":[{"id":"skill-1","label":"Data analysis"}],"links":[]}}'
                        className="font-mono text-xs min-h-[120px]"
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleGenerateSchemaFromSample(editingVisualizationIndex)}
                        >
                          Generate Input Schema From Sample JSON
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Input JSON Schema For Compatible Result Data Optional</Label>
                      <Textarea
                        value={editingVisualization.json_schema}
                        onChange={(event) => updateCustomVisualization(editingVisualizationIndex, { json_schema: event.target.value })}
                        placeholder='{"type":"object","properties":{"nodes":{"type":"array"}}}'
                        className="font-mono text-xs min-h-[120px]"
                      />
                      <p className="text-xs text-muted-foreground">
                        Optional. If provided, this schema validates the fetched <code>resultData</code> before the visualization runs. It is not the visualization output schema. Leave it empty to skip compatibility validation and let the custom render code decide how to handle the result.
                      </p>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Custom JavaScript Render Code</Label>
                      <Textarea
                        value={editingVisualization.render_code}
                        onChange={(event) => updateCustomVisualization(editingVisualizationIndex, { render_code: event.target.value })}
                        placeholder="container.innerHTML = ''; /* render resultData here */"
                        className="font-mono text-xs min-h-[180px]"
                      />
                      <p className="text-xs text-muted-foreground">
                        Variables available: <code>container</code>, <code>resultData</code>, <code>jsonSchema</code>, <code>config</code>, <code>shadowRoot</code>, <code>updateResultData</code>. Use <code>updateResultData(nextJson)</code> to synchronize custom edits with the JSON view.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">Show For Software / Service Chain Result</Label>
                      {visualizationTargets.length === 0 ? (
                        <p className="text-xs text-muted-foreground border border-dashed rounded-md p-3">
                          No software resources or service chains found yet.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-auto rounded-md border p-3 bg-background/30">
                          {visualizationTargets.map((target) => (
                            <label key={target.id} className="flex items-start gap-2 text-sm">
                              <Checkbox
                                checked={(editingVisualization.target_resources || []).includes(target.id)}
                                onCheckedChange={(checked) => toggleVisualizationTarget(editingVisualizationIndex, target.id, checked === true)}
                              />
                              <span>
                                <span className="font-medium">{target.label}</span>
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {target.type === "software" ? "Software" : "Service Chain"}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <DialogFooter>
                  <Button variant="outline" onClick={() => setEditingVisualizationId(null)}>
                    Close
                  </Button>
                  <Button onClick={() => setEditingVisualizationId(null)}>
                    Apply Changes
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={Boolean(deleteVisualization)} onOpenChange={(open) => !open && setDeleteVisualizationId(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete Custom Visualization?</DialogTitle>
                  <DialogDescription>
                    This removes "{deleteVisualization?.name || "this custom visualization"}" from the list. The deletion is only persisted after you click Save Custom Visualizations.
                  </DialogDescription>
                </DialogHeader>
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  This action removes the saved JavaScript render code, uploaded library content, schema, and target mappings for this visualization.
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteVisualizationId(null)}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={handleConfirmDeleteVisualization}>
                    Delete Visualization
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="page-settings" className="space-y-4">
            <div className="rounded-lg border p-4 bg-secondary/20">
              <h3 className="font-medium">Result Page Settings Data</h3>
              <p className="text-sm text-muted-foreground mt-1">
                This area is reserved for result-page behavior that will be stored separately from PDC connection
                settings. Export API Endpoints are available now as the first moved result-page setting.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded border bg-background/40 p-3">
	                  <p className="text-sm font-medium">Current Settings Source</p>
	                  <p className="text-xs text-muted-foreground mt-1">
	                    Export endpoints are stored in organization Result Page settings at <code>global_configs.features.resultPage.exportApiConfigs</code>.
	                  </p>
                </div>
                <div className="rounded border bg-background/40 p-3">
                  <p className="text-sm font-medium">Planned Result Settings</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Future options can include default result view, AI insight behavior, export visibility, and result-page layout.
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>

      <Dialog open={isTagHelpOpen} onOpenChange={setIsTagHelpOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{selectedTagHelp?.title ?? "Template Tag Help"}</DialogTitle>
            <DialogDescription>
              {selectedTagHelp?.description ?? "Select a tag to see usage examples."}
            </DialogDescription>
          </DialogHeader>
          {selectedTagHelp && (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Tag</p>
                <code className="text-xs bg-secondary/50 px-2 py-1 rounded">{selectedTagHelp.tag}</code>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Example</p>
                <pre className="text-xs bg-secondary/50 p-3 rounded overflow-auto max-h-[320px]">
{selectedTagHelp.example}
                </pre>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setIsTagHelpOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default ResultPageSettingsSection;
