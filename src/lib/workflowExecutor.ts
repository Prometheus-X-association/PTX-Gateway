import { executeWorkflow as executeCore, type ExecutorContext } from "../../supabase/functions/_shared/workflowExecutor.ts";
import { executeSandboxedJavascript } from "./workflowSandbox";
import type { AgentWorkflow } from "@/types/workflow";
export { getWorkflowFinalOutput } from "../../supabase/functions/_shared/workflowExecutor.ts";
export type { InlineAgentConfig, WorkflowResult } from "../../supabase/functions/_shared/workflowExecutor.ts";
export type BrowserExecutorContext = Omit<ExecutorContext, "executeJavascript">;
export function executeWorkflow(workflow: AgentWorkflow, ctx: BrowserExecutorContext) {
  return executeCore(workflow, { ...ctx, executeJavascript: executeSandboxedJavascript });
}
