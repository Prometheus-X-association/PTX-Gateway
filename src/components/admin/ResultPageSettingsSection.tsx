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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, Download, Files, GraduationCap, LinkIcon, Loader2, Plus, Save, Send, Trash2, Eye, EyeOff, Upload, Palette, Pencil, Table as TableIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CustomVisualizationConfig, CustomVisualizationLibraryBundle, CustomVisualizationLibraryFile, ExportApiConfig } from "@/types/dataspace";

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
    tag: "##resultObjectEach",
    title: "Map Object Entries",
    description: "Generate one array item from each key/value pair in a source object. Use .$key for the object key and .$value for nested fields inside that value. Entries missing a selected field are skipped.",
    example:
      '[\n  {\n    "skill_name": ##resultObjectEach.data.content.data.result.$key|replace("_"," "),\n    "description": ##resultObjectEach.data.content.data.result.$value.skills[0].description.literal\n  }\n]',
  },
  {
    tag: "##forEach",
    title: "Send Multiple POST Requests",
    description: "Prefix template to send one POST request per item in the resolved body array. Use ##forEach(0:2) for the first 3 items.",
    example:
      '##forEach(0:2)\n[\n  {\n    "skill_name": ##resultObjectEach.data.content.data.result.$key|replace("_"," "),\n    "description": ##resultObjectEach.data.content.data.result.$value.skills[0].description.literal\n  }\n]',
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

const DDV_COURSE_RECOMMENDATION_RENDER_CODE_EXAMPLE = `return (async () => {
  const source =
    resultData?.data?.content?.data ||
    resultData?.content?.data ||
    resultData?.data?.data ||
    resultData?.data ||
    resultData;

  const asList = (value) => (Array.isArray(value) ? value : []);
  const matchingRecommendations = asList(source?.recommendations_based_on_matching_skills);
  const extensiveRecommendations = asList(source?.recommendations_based_on_extensive_skills);
  const selectedRecommendationSource = matchingRecommendations.length > 0 ? "matching" : "extensive";
  const recommendations = selectedRecommendationSource === "matching"
    ? matchingRecommendations
    : extensiveRecommendations;

  if (recommendations.length === 0) {
    throw new Error("Expected recommendations_based_on_matching_skills or recommendations_based_on_extensive_skills in resultData.");
  }

  container.innerHTML = "";

  const iframe = document.createElement("iframe");
  iframe.title = "Course recommendations";
  iframe.style.display = "block";
  iframe.style.width = "100%";
  iframe.style.minHeight = "760px";
  iframe.style.border = "0";
  iframe.style.background = "transparent";
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-modals");
  container.appendChild(iframe);

  const iframeReady = new Promise((resolve, reject) => {
    iframe.onload = resolve;
    iframe.onerror = () => reject(new Error("Failed to initialize DDV iframe."));
  });

  iframe.srcdoc = [
    "<!doctype html>",
    "<html>",
    "  <head>",
    "    <meta charset=\\"utf-8\\">",
    "    <meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1\\">",
    "    <style>",
    "      html, body { margin: 0; min-height: 100%; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #212529; background: transparent; }",
    "      *, *::before, *::after { box-sizing: border-box; }",
    "      body { overflow-x: hidden; }",
    "      #ddv { width: 100%; min-height: 720px; }",
    "      .visualTitle { margin: 0 0 6px; color: #0891b2; font-size: 20px; font-weight: 800; line-height: 1.2; }",
    "      .visualSubtitle { margin: 0 0 18px; color: #6c757d; font-size: 14px; }",
    "      .listElement { cursor: pointer; }",
    "      .modal { z-index: 2147483647 !important; }",
    "      .modal-backdrop { z-index: 2147483646 !important; }",
    "    </style>",
    "  </head>",
    "  <body>",
    "    <div id=\\"ddv\\"></div>",
    "  </body>",
    "</html>"
  ].join("\\n");

  await iframeReady;

  const frameWindow = iframe.contentWindow;
  const frameDocument = iframe.contentDocument;
  if (!frameWindow || !frameDocument) {
    throw new Error("Could not access DDV iframe document.");
  }

  const root = frameDocument.getElementById("ddv");
  const getFrameDdv = () => {
    const candidates = [frameWindow.ddv, frameWindow.self?.ddv, frameWindow.globalThis?.ddv];
    return candidates.find((candidate) => candidate?.visualizers) || candidates.find(Boolean);
  };
  const hasDdvVisualizers = () => Boolean(getFrameDdv()?.visualizers);

  const appendCss = (cssText, sourceName) => {
    if (!cssText?.trim()) return;
    const style = frameDocument.createElement("style");
    style.textContent = cssText;
    style.setAttribute("data-uploaded-library-file", sourceName || "uploaded.css");
    frameDocument.head.appendChild(style);
  };

  const appendCssUrl = (href) =>
    new Promise((resolve, reject) => {
      if (!href?.trim()) return resolve();
      const link = frameDocument.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = resolve;
      link.onerror = () => reject(new Error("Failed to load " + href));
      frameDocument.head.appendChild(link);
    });

  const loadFrameScript = (src, globalCheck) =>
    new Promise((resolve, reject) => {
      if (globalCheck?.()) return resolve();
      const script = frameDocument.createElement("script");
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onload = () => {
        if (!globalCheck || globalCheck()) return resolve();
        reject(new Error("Loaded " + src + " but expected global was not available."));
      };
      script.onerror = () => reject(new Error("Failed to load " + src));
      frameDocument.head.appendChild(script);
    });

  const loadFrameScriptBlob = (scriptText, sourceName, globalCheck) => {
    if (globalCheck?.()) return Promise.resolve();
    if (!scriptText?.trim() || scriptText.trim().startsWith("<")) {
      return Promise.reject(new Error("Uploaded " + sourceName + " does not look like JavaScript."));
    }

    return new Promise((resolve, reject) => {
      const blobUrl = URL.createObjectURL(new Blob([scriptText], { type: "text/javascript" }));
      const cleanup = () => window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
      const script = frameDocument.createElement("script");
      script.src = blobUrl;
      script.async = false;
      script.onload = () => {
        cleanup();
        if (!globalCheck || globalCheck()) return resolve();
        reject(new Error("Loaded " + sourceName + " but DDV visualizers were not available."));
      };
      script.onerror = () => {
        cleanup();
        reject(new Error("Failed to load " + sourceName));
      };
      frameDocument.head.appendChild(script);
    });
  };

  const loadDdvLibrary = async () => {
    if (hasDdvVisualizers()) return;

    const uploadedFiles = config?.library_source === "bundle"
      ? config?.library_bundle_files || []
      : config?.library_files || [];

    uploadedFiles
      .filter((file) => file.file_type === "css")
      .forEach((file) => appendCss(file.content, file.file_name));

    const jsFiles = uploadedFiles.filter((file) => file.file_type === "js" && file.content?.trim());
    const ddvFile =
      jsFiles.find((file) => /ddv/i.test(file.file_name || "")) ||
      jsFiles.find((file) => /visual/i.test(file.file_name || "")) ||
      jsFiles[0];

    if (ddvFile) {
      await loadFrameScriptBlob(ddvFile.content, ddvFile.file_name || "uploaded-visualization-library.js", hasDdvVisualizers);
      return;
    }

    const urls = (config?.library_url || "").split(/\\s+/).filter(Boolean);
    for (const url of urls) {
      if (/\\.css($|[?#])/.test(url)) {
        await appendCssUrl(url);
      } else {
        await loadFrameScript(url, hasDdvVisualizers);
      }
      if (hasDdvVisualizers()) return;
    }

    throw new Error("DDV library is missing. Upload ptx-ddv.js or select a bundle containing it.");
  };

  await loadDdvLibrary();
  await loadFrameScript("https://d3js.org/d3.v6.min.js", () => Boolean(frameWindow.d3));
  await loadFrameScript("https://d3js.org/d3-hexbin.v0.2.min.js", () => Boolean(frameWindow.d3?.hexbin));

  const ddv = getFrameDdv();
  const VisualizationSeries = ddv?.visualizers?.VisualizationSeries;
  if (!VisualizationSeries) {
    throw new Error("DDV VisualizationSeries is not available.");
  }

  const appendText = (parent, tagName, className, text) => {
    const element = frameDocument.createElement(tagName);
    element.className = className;
    element.textContent = text;
    parent.appendChild(element);
  };

  const ddvData = {
    recommendations_based_on_extensive_skills: selectedRecommendationSource === "extensive" ? recommendations : [],
    recommendations_based_on_matching_skills: selectedRecommendationSource === "matching" ? recommendations : [],
    recommendations_based_on_match: asList(source?.recommendations_based_on_match),
    recommendations_based_on_learning_paths: asList(source?.recommendations_based_on_learning_paths),
    recommendations_based_on_skills_demand: asList(source?.recommendations_based_on_skills_demand)
  };

  root.textContent = "";
  appendText(root, "h2", "visualTitle", "Course Recommendations");
  appendText(root, "p", "visualSubtitle", recommendations.length + " recommended course" + (recommendations.length === 1 ? "" : "s"));

  const ddvMount = frameDocument.createElement("div");
  ddvMount.id = "ddv-series";
  root.appendChild(ddvMount);

  const visualization = new VisualizationSeries({
    visuals: [
      {
        type: "Courses",
        data: ddvData,
        title: "Course Recommendations",
        buttonTitle: "Courses",
        provider: "headai"
      }
    ],
    properties: {
      showButtons: false,
      showTitle: false,
      width: Math.max(320, root.clientWidth || container.clientWidth || 1000),
      height: Math.max(520, recommendations.length * 120)
    }
  });

  visualization.attachOn("div#ddv-series");
  ddv.visualizers.responsive?.enableResponsivenessToSeries?.(visualization);
  visualization.refresh();

  const updateIframeHeight = () => {
    iframe.style.height = Math.max(
      760,
      frameDocument.documentElement?.scrollHeight || 0,
      frameDocument.body?.scrollHeight || 0
    ) + "px";
  };

  if (frameWindow.ResizeObserver) {
    new frameWindow.ResizeObserver(updateIframeHeight).observe(frameDocument.body);
  }
  updateIframeHeight();
  window.setTimeout(updateIframeHeight, 250);
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

    return {
      id: skillKey,
      original_key: skillKey,
      skill_name: toDisplayName(skillKey),
      skill_description: description,
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
    .tabulator .tabulator-header .tabulator-col {
      background: #0f172a;
      border-right-color: rgba(255, 255, 255, 0.18);
      color: white;
    }
    .tabulator .tabulator-header .tabulator-col .tabulator-col-title {
      color: white;
      font-weight: 700;
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
  searchInput.placeholder = "Search skills or descriptions...";

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
        skills: [{ description: { literal: "", mimetype: "plain/text" } }],
      };

      const record = JSON.parse(JSON.stringify(originalRecord));

      if (!Array.isArray(record.skills)) {
        record.skills = [{ description: { literal: "", mimetype: "plain/text" } }];
      }
      if (!record.skills[0] || typeof record.skills[0] !== "object") {
        record.skills[0] = { description: { literal: "", mimetype: "plain/text" } };
      }
      if (!record.skills[0].description || typeof record.skills[0].description !== "object") {
        record.skills[0].description = { mimetype: "plain/text" };
      }

      record.skills[0].description.literal = rowData.skill_description || "";
      record.skills[0].description.mimetype = record.skills[0].description.mimetype || "plain/text";

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
      ["skill_name", "skill_description"].some((field) =>
        String(row[field] || "").toLowerCase().includes(query)
      )
    );
  });
})();`;

const emptyExportApi = (): ExportApiConfig => ({
  id: crypto.randomUUID(),
  name: "",
  url: "",
  api_version: "",
  is_active: false,
  authorization: "",
  params: [],
  body_template: '{\n  "data": ##result\n}',
  target_resources: [],
});

const emptyCustomVisualization = (): CustomVisualizationConfig => ({
  id: crypto.randomUUID(),
  name: "",
  description: "",
  is_active: false,
  library_source: "url",
  library_bundle_id: "",
  library_bundle_files: [],
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

const emptyCustomVisualizationLibraryBundle = (): CustomVisualizationLibraryBundle => ({
  id: crypto.randomUUID(),
  name: "",
  description: "",
  library_files: [],
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
  const bundles = getCustomVisualizationLibraryBundlesFromFeatures(features);
  return Array.isArray(resultPage.customVisualizations)
    ? (resultPage.customVisualizations as unknown as CustomVisualizationConfig[]).map((visualization) => ({
      ...visualization,
      library_bundle_files: visualization.library_source === "bundle"
        ? bundles.find((bundle) => bundle.id === visualization.library_bundle_id)?.library_files || []
        : visualization.library_bundle_files || [],
    }))
    : [];
};

const getCustomVisualizationLibraryBundlesFromFeatures = (features: unknown): CustomVisualizationLibraryBundle[] => {
  if (!isRecord(features)) return [];
  const resultPage = isRecord(features.resultPage) ? features.resultPage : {};
  return Array.isArray(resultPage.customVisualizationLibraryBundles)
    ? (resultPage.customVisualizationLibraryBundles as unknown as CustomVisualizationLibraryBundle[])
    : [];
};

const ResultPageSettingsSection = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("export-api");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [globalFeatures, setGlobalFeatures] = useState<Record<string, unknown>>({});
  const [exportApis, setExportApis] = useState<ExportApiConfig[]>([]);
  const [customVisualizations, setCustomVisualizations] = useState<CustomVisualizationConfig[]>([]);
  const [customVisualizationLibraryBundles, setCustomVisualizationLibraryBundles] = useState<CustomVisualizationLibraryBundle[]>([]);
  const [visualizationTargets, setVisualizationTargets] = useState<VisualizationTargetOption[]>([]);
  const [schemaSampleInputs, setSchemaSampleInputs] = useState<Record<string, string>>({});
  const [isUsingLegacyExportApis, setIsUsingLegacyExportApis] = useState(false);
  const [isTagHelpOpen, setIsTagHelpOpen] = useState(false);
  const [selectedTagHelp, setSelectedTagHelp] = useState<TemplateTagHelp | null>(null);
  const [editingExportApiId, setEditingExportApiId] = useState<string | null>(null);
  const [deleteExportApiId, setDeleteExportApiId] = useState<string | null>(null);
  const [editingVisualizationId, setEditingVisualizationId] = useState<string | null>(null);
  const [deleteVisualizationId, setDeleteVisualizationId] = useState<string | null>(null);
  const [isLibraryBundlesOpen, setIsLibraryBundlesOpen] = useState(false);
  const [editingLibraryBundleId, setEditingLibraryBundleId] = useState<string | null>(null);
  const [deleteLibraryBundleId, setDeleteLibraryBundleId] = useState<string | null>(null);

  const editingExportApiIndex = exportApis.findIndex((api) => api.id === editingExportApiId);
  const editingExportApi = editingExportApiIndex >= 0 ? exportApis[editingExportApiIndex] : null;
  const deleteExportApi = exportApis.find((api) => api.id === deleteExportApiId);
  const editingVisualizationIndex = customVisualizations.findIndex(
    (visualization) => visualization.id === editingVisualizationId
  );
  const editingVisualization = editingVisualizationIndex >= 0
    ? customVisualizations[editingVisualizationIndex]
    : null;
  const deleteVisualization = customVisualizations.find(
    (visualization) => visualization.id === deleteVisualizationId
  );
  const editingLibraryBundleIndex = customVisualizationLibraryBundles.findIndex(
    (bundle) => bundle.id === editingLibraryBundleId
  );
  const editingLibraryBundle = editingLibraryBundleIndex >= 0
    ? customVisualizationLibraryBundles[editingLibraryBundleIndex]
    : null;
  const deleteLibraryBundle = customVisualizationLibraryBundles.find((bundle) => bundle.id === deleteLibraryBundleId);

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
      const normalizeExportApis = (apis: ExportApiConfig[]) => apis.map((api) => ({
        ...api,
        id: api.id || crypto.randomUUID(),
        api_version: api.api_version || "",
        is_active: api.is_active ?? true,
        target_resources: Array.isArray(api.target_resources) ? api.target_resources : [],
        params: Array.isArray(api.params) ? api.params : [],
      }));
      const storedExportApis = normalizeExportApis(getExportApisFromFeatures(features));
      const storedCustomVisualizations = getCustomVisualizationsFromFeatures(features);
      const storedLibraryBundles = getCustomVisualizationLibraryBundlesFromFeatures(features);
      const legacyExportApis = normalizeExportApis((legacyData || []).flatMap((config) =>
        Array.isArray(config.export_api_configs)
          ? (config.export_api_configs as unknown as ExportApiConfig[])
          : [],
      ));
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
      setCustomVisualizationLibraryBundles(storedLibraryBundles);
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

  const toggleExportApiTarget = (index: number, targetId: string, checked: boolean) => {
    setExportApis((current) => {
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

  const getTargetSummary = (targetIds: string[] = []) => {
    if (targetIds.length === 0) return "No analytics selected";
    const targetMap = new Map(visualizationTargets.map((target) => [target.id, target]));
    const labels = targetIds
      .map((id) => targetMap.get(id)?.label || id)
      .slice(0, 2);
    const remainder = targetIds.length - labels.length;
    return remainder > 0 ? `${labels.join(", ")} +${remainder} more` : labels.join(", ");
  };

  const updateCustomVisualization = (index: number, next: Partial<CustomVisualizationConfig>) => {
    setCustomVisualizations((current) => {
      const updated = [...current];
      updated[index] = { ...updated[index], ...next };
      return updated;
    });
  };

  const updateLibraryBundle = (index: number, next: Partial<CustomVisualizationLibraryBundle>) => {
    setCustomVisualizationLibraryBundles((current) => {
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
        library_bundle_id: "",
        library_bundle_files: [],
        library_url: "",
        library_file_name: "",
        library_code: "",
        library_files: [...(visualization.library_files || []), ...nextFiles],
      };
      return updated;
    });
    toast.success(`Loaded ${nextFiles.length} visualization file${nextFiles.length === 1 ? "" : "s"}`);
  };

  const handleLibraryBundleFileUpload = async (index: number, files: FileList | null) => {
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

    setCustomVisualizationLibraryBundles((current) => {
      const updated = [...current];
      const bundle = updated[index];
      if (!bundle) return current;

      updated[index] = {
        ...bundle,
        library_files: [...(bundle.library_files || []), ...nextFiles],
      };
      return updated;
    });
    toast.success(`Loaded ${nextFiles.length} bundle file${nextFiles.length === 1 ? "" : "s"}`);
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
    toast.success("Visualization library file removed. Click Apply Changes to save this update.");
  };

  const handleDeleteLibraryBundleFile = (index: number, fileId: string) => {
    const bundle = customVisualizationLibraryBundles[index];
    if (!bundle) return;

    updateLibraryBundle(index, {
      library_files: (bundle.library_files || []).filter((file) => file.id !== fileId),
    });
    toast.success("Bundle file removed. Click Save Library Bundles to apply this update.");
  };

  const handleApplyDdvExample = (index: number) => {
    if (!customVisualizations[index]) return;
    updateCustomVisualization(index, { render_code: DDV_RENDER_CODE_EXAMPLE });
    toast.success("DDV knowledge graph example applied to render code");
  };

  const handleApplyDdvCourseRecommendationExample = (index: number) => {
    if (!customVisualizations[index]) return;
    updateCustomVisualization(index, { render_code: DDV_COURSE_RECOMMENDATION_RENDER_CODE_EXAMPLE });
    toast.success("DDV course recommendation example applied to render code");
  };

  const handleApplyTabulatorExample = (index: number) => {
    if (!customVisualizations[index]) return;
    updateCustomVisualization(index, { render_code: TABULATOR_RENDER_CODE_EXAMPLE });
    toast.success("Tabulator interactive table example applied to render code");
  };

  const getVisualizationLibrarySummary = (visualization: CustomVisualizationConfig) => {
    if (visualization.library_source === "bundle") {
      const bundle = customVisualizationLibraryBundles.find((item) => item.id === visualization.library_bundle_id);
      const files = bundle?.library_files || visualization.library_bundle_files || [];
      if (!bundle) return "Missing library bundle";
      return `${bundle.name || "Unnamed bundle"} (${files.length} file${files.length === 1 ? "" : "s"})`;
    }

    const uploadedFiles = visualization.library_files || [];
    if (uploadedFiles.length > 0) {
      const jsCount = uploadedFiles.filter((file) => file.file_type === "js").length;
      const cssCount = uploadedFiles.filter((file) => file.file_type === "css").length;
      return `${uploadedFiles.length} uploaded file${uploadedFiles.length === 1 ? "" : "s"} (${jsCount} JS, ${cssCount} CSS)`;
    }

    if (visualization.library_source === "upload") {
      return visualization.library_file_name || "Uploaded JS";
    }

    const urls = (visualization.library_url || "").split(/\s+/).filter(Boolean);
    if (urls.length > 1) return `${urls.length} library URLs`;
    return urls[0] || "No library URL";
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

  const saveResultPageSettings = async (
    successMessage: string,
    overrides?: {
      exportApis?: ExportApiConfig[];
      customVisualizations?: CustomVisualizationConfig[];
      customVisualizationLibraryBundles?: CustomVisualizationLibraryBundle[];
    },
  ) => {
    if (!user?.organization?.id) return false;

    setIsSaving(true);
    try {
      const nextExportApis = overrides?.exportApis ?? exportApis;
      const nextCustomVisualizations = overrides?.customVisualizations ?? customVisualizations;
      const nextLibraryBundles = overrides?.customVisualizationLibraryBundles ?? customVisualizationLibraryBundles;
      const nextFeatures = {
        ...globalFeatures,
        resultPage: {
          ...(isRecord(globalFeatures.resultPage) ? globalFeatures.resultPage : {}),
          exportApiConfigs: nextExportApis,
          customVisualizations: nextCustomVisualizations,
          customVisualizationLibraryBundles: nextLibraryBundles,
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
      return true;
    } catch {
      toast.error("Failed to save result page settings");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    await saveResultPageSettings("Export API endpoints saved");
  };

  const handleAddExportApi = () => {
    const api = emptyExportApi();
    setActiveTab("export-api");
    setExportApis((current) => [...current, api]);
    setEditingExportApiId(api.id || null);
  };

  const handleToggleExportApiActive = async (index: number) => {
    const api = exportApis[index];
    if (!api) return;

    setActiveTab("export-api");
    const updated = [...exportApis];
    updated[index] = { ...api, is_active: !(api.is_active ?? true) };
    setExportApis(updated);

    await saveResultPageSettings(
      updated[index].is_active ? "Export API endpoint activated" : "Export API endpoint deactivated",
      { exportApis: updated },
    );
  };

  const handleApplyExportApiChanges = async () => {
    setActiveTab("export-api");
    const saved = await saveResultPageSettings("Export API endpoint saved");
    if (saved) {
      setEditingExportApiId(null);
    }
  };

  const handleConfirmDeleteExportApi = async () => {
    if (!deleteExportApiId) return;

    setActiveTab("export-api");
    const updated = exportApis.filter((api) => api.id !== deleteExportApiId);
    setExportApis(updated);
    if (editingExportApiId === deleteExportApiId) {
      setEditingExportApiId(null);
    }
    setDeleteExportApiId(null);
    await saveResultPageSettings("Export API endpoint deleted", { exportApis: updated });
  };

  const handleAddCustomVisualization = () => {
    const visualization = emptyCustomVisualization();
    setActiveTab("custom-visualization");
    setCustomVisualizations((current) => [...current, visualization]);
    setEditingVisualizationId(visualization.id);
  };

  const handleOpenLibraryBundles = () => {
    setIsLibraryBundlesOpen(true);
    if (!editingLibraryBundleId && customVisualizationLibraryBundles.length > 0) {
      setEditingLibraryBundleId(customVisualizationLibraryBundles[0].id);
    }
  };

  const handleAddLibraryBundle = () => {
    const bundle = emptyCustomVisualizationLibraryBundle();
    setCustomVisualizationLibraryBundles((current) => [...current, bundle]);
    setEditingLibraryBundleId(bundle.id);
  };

  const handleSaveLibraryBundles = async () => {
    const saved = await saveResultPageSettings("Visualization library bundles saved");
    if (saved) {
      setIsLibraryBundlesOpen(false);
      setEditingLibraryBundleId(null);
    }
  };

  const handleToggleCustomVisualizationActive = async (index: number) => {
    const visualization = customVisualizations[index];
    if (!visualization) return;

    setActiveTab("custom-visualization");
    const updated = [...customVisualizations];
    updated[index] = { ...visualization, is_active: !visualization.is_active };
    setCustomVisualizations(updated);

    await saveResultPageSettings(
      updated[index].is_active ? "Custom visualization activated" : "Custom visualization deactivated",
      { customVisualizations: updated },
    );
  };

  const handleApplyVisualizationChanges = async () => {
    setActiveTab("custom-visualization");
    const saved = await saveResultPageSettings("Custom visualization saved");
    if (saved) {
      setEditingVisualizationId(null);
    }
  };

  const handleConfirmDeleteVisualization = async () => {
    if (!deleteVisualizationId) return;

    setActiveTab("custom-visualization");
    const updated = customVisualizations.filter((visualization) => visualization.id !== deleteVisualizationId);
    setCustomVisualizations(updated);
    if (editingVisualizationId === deleteVisualizationId) {
      setEditingVisualizationId(null);
    }
    setDeleteVisualizationId(null);
    await saveResultPageSettings("Custom visualization deleted", { customVisualizations: updated });
  };

  const handleConfirmDeleteLibraryBundle = async () => {
    if (!deleteLibraryBundleId) return;

    const updatedBundles = customVisualizationLibraryBundles.filter((bundle) => bundle.id !== deleteLibraryBundleId);
    const updatedVisualizations = customVisualizations.map((visualization) =>
      visualization.library_bundle_id === deleteLibraryBundleId
        ? {
          ...visualization,
          library_source: "url" as const,
          library_bundle_id: "",
          library_bundle_files: [],
        }
        : visualization
    );

    setCustomVisualizationLibraryBundles(updatedBundles);
    setCustomVisualizations(updatedVisualizations);
    if (editingLibraryBundleId === deleteLibraryBundleId) {
      setEditingLibraryBundleId(updatedBundles[0]?.id || null);
    }
    setDeleteLibraryBundleId(null);
    await saveResultPageSettings("Visualization library bundle deleted", {
      customVisualizations: updatedVisualizations,
      customVisualizationLibraryBundles: updatedBundles,
    });
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
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
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
                        Manage export API endpoints
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Configure API endpoints available for users to export result data from the result page.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddExportApi}
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
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Version</TableHead>
                            <TableHead>Endpoint</TableHead>
                            <TableHead>Connected Analytics</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {exportApis.map((api, apiIndex) => (
                            <TableRow key={api.id || apiIndex}>
                              <TableCell>
                                <div className="space-y-1">
                                  <p className="font-medium">{api.name || `Export API #${apiIndex + 1}`}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {(api.params || []).length} query parameter{(api.params || []).length === 1 ? "" : "s"}
                                  </p>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant={(api.is_active ?? true) ? "default" : "secondary"}>
                                  {(api.is_active ?? true) ? "Active" : "Inactive"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {api.api_version || "Not set"}
                              </TableCell>
                              <TableCell className="max-w-[260px]">
                                <code className="text-xs text-muted-foreground break-all">{api.url || "No URL configured"}</code>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {getTargetSummary(api.target_resources || [])}
                              </TableCell>
                              <TableCell>
                                <div className="flex justify-end gap-2">
                                  <Button
                                    type="button"
                                    variant={(api.is_active ?? true) ? "secondary" : "outline"}
                                    size="sm"
                                    onClick={() => void handleToggleExportApiActive(apiIndex)}
                                  >
                                    {(api.is_active ?? true) ? (
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
                                    onClick={() => setEditingExportApiId(api.id || null)}
                                  >
                                    <Pencil className="h-4 w-4 mr-1" />
                                    Edit
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDeleteExportApiId(api.id || null)}
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

                <Dialog open={Boolean(editingExportApi)} onOpenChange={(open) => !open && setEditingExportApiId(null)}>
                  <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
                    <DialogHeader>
                      <DialogTitle>Edit Export API Endpoint</DialogTitle>
                      <DialogDescription>
                        Configure the endpoint and select which software or service-chain results can import to LMS through it.
                      </DialogDescription>
                    </DialogHeader>

                    {editingExportApi && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Name</Label>
                            <Input
                              value={editingExportApi.name}
                              onChange={(e) => updateApi(editingExportApiIndex, { name: e.target.value })}
                              placeholder="My Export API"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">URL</Label>
                            <Input
                              value={editingExportApi.url}
                              onChange={(e) => updateApi(editingExportApiIndex, { url: e.target.value })}
                              placeholder="https://api.example.com/data"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">API Version</Label>
                            <Input
                              value={editingExportApi.api_version || ""}
                              onChange={(e) => updateApi(editingExportApiIndex, { api_version: e.target.value })}
                              placeholder="v1"
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Authorization</Label>
                          <Input
                            type="password"
                            value={editingExportApi.authorization || ""}
                            onChange={(e) => updateApi(editingExportApiIndex, { authorization: e.target.value })}
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
                                updateApi(editingExportApiIndex, {
                                  params: [...(editingExportApi.params || []), { key: "", value: "" }],
                                })
                              }
                            >
                              <Plus className="h-3 w-3 mr-1" />
                              Add
                            </Button>
                          </div>
                          {(editingExportApi.params || []).map((param, paramIndex) => (
                            <div key={paramIndex} className="flex gap-2">
                              <Input
                                value={param.key}
                                onChange={(e) => {
                                  const params = [...(editingExportApi.params || [])];
                                  params[paramIndex] = { ...params[paramIndex], key: e.target.value };
                                  updateApi(editingExportApiIndex, { params });
                                }}
                                placeholder="Key"
                                className="flex-1"
                              />
                              <Input
                                value={param.value}
                                onChange={(e) => {
                                  const params = [...(editingExportApi.params || [])];
                                  params[paramIndex] = { ...params[paramIndex], value: e.target.value };
                                  updateApi(editingExportApiIndex, { params });
                                }}
                                placeholder="Value"
                                className="flex-1"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-10 px-2"
                                onClick={() => updateApi(editingExportApiIndex, { params: (editingExportApi.params || []).filter((_, index) => index !== paramIndex) })}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">
                            Body Template <span className="text-primary">(supports ##result, ##resultArray, ##resultArrayEach, ##resultObjectEach, ##forEach)</span>
                          </Label>
                          <Textarea
                            value={editingExportApi.body_template || ""}
                            onChange={(e) => updateApi(editingExportApiIndex, { body_template: e.target.value })}
                            placeholder='{"data": ##result}'
                            className="font-mono text-xs min-h-[120px]"
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
                        <div className="space-y-2">
                          <Label className="text-xs">Show / Connect For Software And Service Chains</Label>
                          {visualizationTargets.length === 0 ? (
                            <p className="text-xs text-muted-foreground border border-dashed rounded-md p-3">
                              No software resources or service chains found yet.
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-auto rounded-md border p-3 bg-background/30">
                              {visualizationTargets.map((target) => (
                                <label key={target.id} className="flex items-start gap-2 text-sm">
                                  <Checkbox
                                    checked={(editingExportApi.target_resources || []).includes(target.id)}
                                    onCheckedChange={(checked) => toggleExportApiTarget(editingExportApiIndex, target.id, checked === true)}
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
                      <Button variant="outline" onClick={() => setEditingExportApiId(null)}>
                        Close
                      </Button>
                      <Button onClick={() => void handleApplyExportApiChanges()} disabled={isSaving}>
                        {isSaving ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          "Apply Changes"
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog open={Boolean(deleteExportApi)} onOpenChange={(open) => !open && setDeleteExportApiId(null)}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Delete Export API Endpoint?</DialogTitle>
                      <DialogDescription>
                        This removes "{deleteExportApi?.name || "this export API endpoint"}" from the list and saves the change immediately.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                      Connected analytics mappings, query parameters, authorization, and body template for this endpoint will be removed.
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setDeleteExportApiId(null)}>
                        Cancel
                      </Button>
                      <Button variant="destructive" onClick={() => void handleConfirmDeleteExportApi()} disabled={isSaving}>
                        {isSaving ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Deleting...
                          </>
                        ) : (
                          "Delete Endpoint"
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
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
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleOpenLibraryBundles}
                  >
                    <Files className="h-4 w-4 mr-1" />
                    Add Visualization Libraries
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddCustomVisualization}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Visualization
                  </Button>
                </div>
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
                                onClick={() => void handleToggleCustomVisualizationActive(index)}
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

            <Dialog open={isLibraryBundlesOpen} onOpenChange={(open) => {
              setIsLibraryBundlesOpen(open);
              if (!open) setEditingLibraryBundleId(null);
            }}>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
                <DialogHeader>
                  <DialogTitle>Visualization Library Bundles</DialogTitle>
                  <DialogDescription>
                    Create reusable JS/CSS file bundles that can be selected by multiple custom visualizations.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-xs">Bundles</Label>
                      <Button type="button" variant="outline" size="sm" onClick={handleAddLibraryBundle}>
                        <Plus className="h-4 w-4 mr-1" />
                        Add Bundle
                      </Button>
                    </div>

                    {customVisualizationLibraryBundles.length === 0 ? (
                      <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
                        No visualization library bundles yet.
                      </div>
                    ) : (
                      <div className="rounded-md border overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Files</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {customVisualizationLibraryBundles.map((bundle) => (
                              <TableRow key={bundle.id} className={bundle.id === editingLibraryBundleId ? "bg-secondary/40" : undefined}>
                                <TableCell>
                                  <div className="space-y-1">
                                    <p className="font-medium">{bundle.name || "Unnamed bundle"}</p>
                                    {bundle.description && (
                                      <p className="text-xs text-muted-foreground line-clamp-2">{bundle.description}</p>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {(bundle.library_files || []).length}
                                </TableCell>
                                <TableCell>
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setEditingLibraryBundleId(bundle.id)}
                                    >
                                      <Pencil className="h-4 w-4 mr-1" />
                                      Edit
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setDeleteLibraryBundleId(bundle.id)}
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

                  {editingLibraryBundle && editingLibraryBundleIndex >= 0 ? (
                    <div className="space-y-3 rounded-md border bg-background/40 p-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Bundle Name</Label>
                          <Input
                            value={editingLibraryBundle.name}
                            onChange={(event) => updateLibraryBundle(editingLibraryBundleIndex, { name: event.target.value })}
                            placeholder="DDV visualization libraries"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Add Files</Label>
                          <Input
                            type="file"
                            multiple
                            accept=".js,.css,application/javascript,text/javascript,text/css"
                            onChange={(event) => {
                              void handleLibraryBundleFileUpload(editingLibraryBundleIndex, event.target.files);
                              event.currentTarget.value = "";
                            }}
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Description</Label>
                        <Textarea
                          value={editingLibraryBundle.description || ""}
                          onChange={(event) => updateLibraryBundle(editingLibraryBundleIndex, { description: event.target.value })}
                          placeholder="Shared library bundle for DDV visualizations."
                          className="min-h-[70px]"
                        />
                      </div>

                      {(editingLibraryBundle.library_files || []).length > 0 ? (
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
                              {(editingLibraryBundle.library_files || []).map((file) => (
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
                                        onClick={() => handleDeleteLibraryBundleFile(editingLibraryBundleIndex, file.id)}
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
                      ) : (
                        <p className="text-xs text-muted-foreground border border-dashed rounded-md p-3">
                          No files in this bundle yet.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-sm text-muted-foreground border border-dashed rounded-lg">
                      Select a bundle to edit it.
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsLibraryBundlesOpen(false)}>
                    Close
                  </Button>
                  <Button onClick={() => void handleSaveLibraryBundles()} disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save Library Bundles"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

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
                      <div className="space-y-2">
                        <Label className="text-xs">Library Source</Label>
                        <div className="grid grid-cols-3 gap-2">
                          <Button
                            type="button"
                            variant={editingVisualization.library_source === "upload" ? "default" : "outline"}
                            size="sm"
                            onClick={() => updateCustomVisualization(editingVisualizationIndex, {
                              library_source: "upload",
                              library_bundle_id: "",
                              library_bundle_files: [],
                            })}
                          >
                            <Upload className="h-4 w-4 mr-1" />
                            Upload
                          </Button>
                          <Button
                            type="button"
                            variant={editingVisualization.library_source === "bundle" ? "default" : "outline"}
                            size="sm"
                            onClick={() => updateCustomVisualization(editingVisualizationIndex, {
                              library_source: "bundle",
                              library_bundle_id: editingVisualization.library_bundle_id || customVisualizationLibraryBundles[0]?.id || "",
                              library_bundle_files: customVisualizationLibraryBundles.find((bundle) => bundle.id === (editingVisualization.library_bundle_id || customVisualizationLibraryBundles[0]?.id))?.library_files || [],
                              library_url: "",
                            })}
                          >
                            <Files className="h-4 w-4 mr-1" />
                            Bundle
                          </Button>
                          <Button
                            type="button"
                            variant={editingVisualization.library_source === "url" ? "default" : "outline"}
                            size="sm"
                            onClick={() => updateCustomVisualization(editingVisualizationIndex, {
                              library_source: "url",
                              library_bundle_id: "",
                              library_bundle_files: [],
                            })}
                          >
                            <LinkIcon className="h-4 w-4 mr-1" />
                            URLs
                          </Button>
                        </div>
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

                    {editingVisualization.library_source === "bundle" && (
                      <div className="rounded-md border bg-background/40 p-3 space-y-2">
                        <Label className="text-xs flex items-center gap-2">
                          <Files className="h-3.5 w-3.5" />
                          Reusable Visualization Library Bundle
                        </Label>
                        {customVisualizationLibraryBundles.length === 0 ? (
                          <div className="text-sm text-muted-foreground border border-dashed rounded-md p-3">
                            No library bundles are available yet.
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="ml-3"
                              onClick={handleOpenLibraryBundles}
                            >
                              Add Bundle
                            </Button>
                          </div>
                        ) : (
                          <Select
                            value={editingVisualization.library_bundle_id || ""}
                            onValueChange={(bundleId) => {
                              const bundle = customVisualizationLibraryBundles.find((item) => item.id === bundleId);
                              updateCustomVisualization(editingVisualizationIndex, {
                                library_source: "bundle",
                                library_bundle_id: bundleId,
                                library_bundle_files: bundle?.library_files || [],
                                library_url: "",
                              });
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select a library bundle" />
                            </SelectTrigger>
                            <SelectContent>
                              {customVisualizationLibraryBundles.map((bundle) => (
                                <SelectItem key={bundle.id} value={bundle.id}>
                                  {bundle.name || "Unnamed bundle"} ({(bundle.library_files || []).length} files)
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Selected bundle files are loaded before your render code. Updating the bundle updates every visualization that uses it.
                        </p>
                      </div>
                    )}

                    {editingVisualization.library_source === "url" && (
                      <div className="rounded-md border bg-background/40 p-3 space-y-2">
                        <Label className="text-xs flex items-center gap-2">
                          <LinkIcon className="h-3.5 w-3.5" />
                          Library URLs / CDN
                        </Label>
                        <Textarea
                          value={editingVisualization.library_url || ""}
                          onChange={(event) => updateCustomVisualization(editingVisualizationIndex, {
                            library_source: "url",
                            library_url: event.target.value,
                          })}
                          placeholder={"https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js\nhttps://cdn.jsdelivr.net/npm/tabulator-tables@6.3/dist/js/tabulator.min.js"}
                          className="font-mono text-xs min-h-[90px]"
                        />
                        <p className="text-xs text-muted-foreground">
                          Add one JavaScript or CSS URL per line. CSS URLs are added to the custom visualization Shadow DOM, and JS URLs are loaded in order.
                        </p>
                      </div>
                    )}

                    {editingVisualization.library_source === "upload" && (
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
                    )}

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
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <Label className="text-xs">Custom JavaScript Render Code</Label>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="outline" size="sm" className="w-fit">
                              Use example
                              <ChevronDown className="ml-2 h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-64">
                            <DropdownMenuItem onClick={() => handleApplyTabulatorExample(editingVisualizationIndex)}>
                              <TableIcon className="mr-2 h-4 w-4" />
                              Tabulator editable skills table
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleApplyDdvExample(editingVisualizationIndex)}>
                              <Palette className="mr-2 h-4 w-4" />
                              DDV knowledge graph
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleApplyDdvCourseRecommendationExample(editingVisualizationIndex)}>
                              <GraduationCap className="mr-2 h-4 w-4" />
                              DDV course recommendation
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
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
                  <Button onClick={() => void handleApplyVisualizationChanges()} disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Apply Changes"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={Boolean(deleteVisualization)} onOpenChange={(open) => !open && setDeleteVisualizationId(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete Custom Visualization?</DialogTitle>
                  <DialogDescription>
                    This removes "{deleteVisualization?.name || "this custom visualization"}" from the list and saves the change immediately.
                  </DialogDescription>
                </DialogHeader>
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  This action removes the saved JavaScript render code, uploaded library content, schema, and target mappings for this visualization.
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteVisualizationId(null)}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={() => void handleConfirmDeleteVisualization()} disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      "Delete Visualization"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={Boolean(deleteLibraryBundle)} onOpenChange={(open) => !open && setDeleteLibraryBundleId(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete Visualization Library Bundle?</DialogTitle>
                  <DialogDescription>
                    This removes "{deleteLibraryBundle?.name || "this library bundle"}" and switches visualizations using it back to URL libraries.
                  </DialogDescription>
                </DialogHeader>
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  Bundle files are removed from the shared library list. Custom render code and target mappings are kept.
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteLibraryBundleId(null)}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={() => void handleConfirmDeleteLibraryBundle()} disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      "Delete Bundle"
                    )}
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
