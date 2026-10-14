import { WORKFLOW_SANDBOX_PROGRAM } from "../../supabase/functions/_shared/workflowSandboxProgram.ts";
import type { SandboxRequest } from "../../supabase/functions/_shared/workflowExecutor.ts";

// The parent has database/network credentials. This worker receives only node data
// and has no environment, filesystem, network, subprocess, or FFI permissions.
export function executeJavascript(request: SandboxRequest, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const source = `const window = self; window.parent = { postMessage: (value) => self.postMessage(value) };\n${WORKFLOW_SANDBOX_PROGRAM}`;
    const worker = new Worker(`data:application/javascript,${encodeURIComponent(source)}`, { type: "module", deno: { permissions: "none" } });
    let settled = false;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Sandbox execution deadline exceeded.")), Math.min(request.timeoutMs ?? 2500, 5000));
    signal?.addEventListener("abort", abort, { once: true });
    const id = crypto.randomUUID();
    worker.onmessage = (event) => {
      const response = event.data;
      if (response?.type !== "ptx-workflow-sandbox-result" || response.id !== id) return;
      finish(response.ok ? undefined : new Error(String(response.error || "Sandbox execution failed.")), response.value);
    };
    worker.onerror = (event) => { event.preventDefault(); finish(new Error(event.message || "Sandbox worker failed.")); };
    worker.postMessage({ ...request, id, type: "ptx-workflow-sandbox-run" });
  });
}
