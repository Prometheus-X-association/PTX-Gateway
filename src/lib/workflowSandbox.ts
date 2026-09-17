type SandboxOperation = "plugin" | "condition" | "transform";

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
