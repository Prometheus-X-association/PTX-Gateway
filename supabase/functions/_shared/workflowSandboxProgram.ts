export const WORKFLOW_SANDBOX_PROGRAM = `  "use strict";
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
  });`;
