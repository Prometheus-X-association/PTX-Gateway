import type { WorkflowConfig } from "@/types/workflow";

/** Every new end-user run must await a fresh saved workflow, with no local fallback. */
export async function loadWorkflowForNewRun(
  workflowId: string,
  loadLatestWorkflow: (workflowId: string) => Promise<WorkflowConfig>,
): Promise<WorkflowConfig> {
  if (typeof loadLatestWorkflow !== "function") {
    throw new Error("Could not load the latest saved workflow. Please refresh and try again.");
  }
  const latest = await loadLatestWorkflow(workflowId);
  if (!latest || latest.id !== workflowId || !latest.enabled) {
    throw new Error("This workflow is no longer available for this result.");
  }
  if (!Array.isArray(latest.graph?.nodes) || !Array.isArray(latest.graph?.edges)
    || !latest.graph.nodes.some((node) => node.type === "trigger")) {
    throw new Error("The saved workflow has no valid graph. Please update it in the admin dashboard.");
  }
  return latest;
}
