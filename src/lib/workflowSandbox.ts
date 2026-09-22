type SandboxOperation = "plugin" | "condition" | "transform" | "retrieval";

interface SandboxRequest {
  operation: SandboxOperation;
  code: string;
  input: unknown;
  nodeOutputs?: Record<string, unknown>;
  timeoutMs?: number;
}

interface SandboxResponse {
  type: "ptx-workflow-sandbox-result";
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

const SANDBOX_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'">
</head>
<body>
<script>
  "use strict";
  window.addEventListener("message", async (event) => {
    const request = event.data;
    if (!request || request.type !== "ptx-workflow-sandbox-run") return;

    const respond = (payload) => {
      window.parent.postMessage({
        type: "ptx-workflow-sandbox-result",
        id: request.id,
        ...payload,
      }, "*");
    };

    try {
      let value;
      if (request.operation === "condition") {
        const evaluate = new Function(
          "prevOutput",
          '"use strict"; return !!(' + request.code + ');',
        );
        value = evaluate(request.input);
      } else if (request.operation === "transform") {
        const transform = new Function(
          "prevOutput",
          '"use strict";\\n' + request.code,
        );
        value = transform(request.input);
      } else if (request.operation === "retrieval") {
        const input = request.input || {};
        const normalize = (value) => String(value ?? "").replace(/_/g, " ").replace(/\\s+/g, " ").trim().toLowerCase();
        const sourceData = input.sourceData;
        const findNodeArrays = (value, path = "$", depth = 0, found = []) => {
          if (!value || typeof value !== "object" || depth > 6) return found;
          if (Array.isArray(value)) {
            if (value.some((item) => item && typeof item === "object" && ("label" in item || "id" in item))) {
              found.push({ path, items: value });
            }
            value.slice(0, 12).forEach((item, index) => findNodeArrays(item, path + "[" + index + "]", depth + 1, found));
            return found;
          }
          Object.keys(value).forEach((key) => findNodeArrays(value[key], path === "$" ? key : path + "." + key, depth + 1, found));
          return found;
        };
        const nodeArrays = findNodeArrays(sourceData);
        const primaryNodes = Array.isArray(sourceData?.data?.nodes)
          ? sourceData.data.nodes
          : Array.isArray(sourceData?.nodes)
            ? sourceData.nodes
            : (nodeArrays[0]?.items || []);
        const toRecord = (item, index) => {
          if (item && typeof item === "object") {
            return {
              index,
              id: item.id ?? index,
              label: item.label ?? item.name ?? item.id ?? String(index),
              normalizedLabel: normalize(item.label ?? item.name ?? item.id ?? String(index)),
              data: item,
            };
          }
          return { index, id: index, label: String(item), normalizedLabel: normalize(item), data: item };
        };
        const records = primaryNodes.map(toRecord);
        const clampLimit = (limit) => Math.max(1, Math.min(Number(limit) || input.maxItems || 25, 1000));
        const tools = {
          manifest: () => ({
            source: input.source,
            totalRecords: records.length,
            arrays: nodeArrays.slice(0, 8).map((entry) => ({ path: entry.path, length: entry.items.length })),
            fields: records[0]?.data && typeof records[0].data === "object" ? Object.keys(records[0].data).slice(0, 40) : [],
            examples: records.slice(0, 3).map((record) => ({ index: record.index, id: record.id, label: record.label })),
          }),
          listNodes: (options = {}) => {
            const start = Math.max(0, Number(options.start) || 0);
            const limit = clampLimit(options.limit);
            return records.slice(start, start + limit);
          },
          getNode: (identifier) => {
            const wanted = normalize(identifier);
            return records.find((record) => String(record.id) === String(identifier) || record.normalizedLabel === wanted || record.index === Number(identifier)) || null;
          },
          findNodes: (query, options = {}) => {
            const wanted = normalize(query);
            const limit = clampLimit(options.limit);
            if (!wanted) return records.slice(0, limit);
            return records.filter((record) =>
              record.normalizedLabel.includes(wanted) ||
              String(record.id).toLowerCase() === String(query ?? "").toLowerCase() ||
              JSON.stringify(record.data).toLowerCase().includes(wanted)
            ).slice(0, limit);
          },
          exactLabel: (label) => {
            const wanted = normalize(label);
            return records.find((record) => record.normalizedLabel === wanted) || null;
          },
          sliceNodes: (start, end) => records.slice(Math.max(0, Number(start) || 0), Math.max(0, Number(end) || 0)),
        };
        const run = new Function("input", "tools", '"use strict";\\n' + request.code);
        value = run(input, tools);
      } else {
        const nodeOutputs = request.nodeOutputs || {};
        const pluginInput = {
          ...request.input,
          getNodeOutput: (id) => Object.prototype.hasOwnProperty.call(nodeOutputs, id)
            ? nodeOutputs[id]
            : null,
        };
        const run = new Function("input", '"use strict";\\n' + request.code);
        value = run(pluginInput);
      }

      value = await Promise.resolve(value);
      respond({ ok: true, value });
    } catch (error) {
      respond({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
</script>
</body>
</html>`;

/**
 * Executes administrator-authored workflow JavaScript in a unique-origin iframe.
 * The iframe has no same-origin access, navigation privileges, storage access, or
 * network access. A fresh iframe is created for every node and destroyed after
 * completion (or after the execution deadline).
 */
export function executeSandboxedJavascript({
  operation,
  code,
  input,
  nodeOutputs = {},
  timeoutMs = 2_000,
}: SandboxRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.display = "none";

    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      iframe.remove();
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      cleanup();
      callback();
    };
    const onMessage = (event: MessageEvent<SandboxResponse>) => {
      if (event.source !== iframe.contentWindow) return;
      if (event.data?.type !== "ptx-workflow-sandbox-result" || event.data.id !== id) return;
      if (event.data.ok) {
        finish(() => resolve(event.data.value));
      } else {
        finish(() => reject(new Error(event.data.error || "Sandbox execution failed")));
      }
    };
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error(`Sandbox execution exceeded ${timeoutMs}ms`)));
    }, timeoutMs);

    window.addEventListener("message", onMessage);
    iframe.addEventListener("load", () => {
      iframe.contentWindow?.postMessage({
        type: "ptx-workflow-sandbox-run",
        id,
        operation,
        code,
        input,
        nodeOutputs,
      }, "*");
    }, { once: true });
    iframe.srcdoc = SANDBOX_HTML;
    document.body.appendChild(iframe);
  });
}
