interface AgentOverrides {
  agentId?: string;
  systemPrompt?: string;
  outputType?: "auto" | "text" | "json" | "html" | "mixed";
  fallbackOutputType?: "text" | "json" | "html" | "mixed";
  skillIds?: string[];
  mcpServerIds?: string[];
  mcpToolFilter?: Record<string, string[]>;
  providerIds?: string[];
  agentProviders?: unknown[];
  nodeOutputType?: "text" | "json" | "html" | "mixed";
  nodeOutputInstructions?: string;
}

/** Replace all client agent overrides with the saved node's active mode. */
export function resolveSavedWorkflowAgent(node: Record<string, unknown>): AgentOverrides {
  if (node.mode !== "inline") {
    if (typeof node.agentId !== "string" || !node.agentId.trim()) {
      throw new Error("Select an existing agent for this workflow node before running it.");
    }
    return {
      agentId: node.agentId,
      systemPrompt: undefined,
      outputType: undefined,
      fallbackOutputType: undefined,
      skillIds: Array.isArray(node.skillIds) ? node.skillIds.map(String) : [],
      mcpServerIds: Array.isArray(node.mcpServerIds) ? node.mcpServerIds.map(String) : [],
      mcpToolFilter: node.mcpToolFilter && typeof node.mcpToolFilter === "object"
        ? node.mcpToolFilter as Record<string, string[]> : {},
      providerIds: undefined,
      agentProviders: undefined,
      nodeOutputType: ["text", "json", "html", "mixed"].includes(String(node.nodeOutputType))
        ? node.nodeOutputType as AgentOverrides["nodeOutputType"] : undefined,
      nodeOutputInstructions: typeof node.nodeOutputInstructions === "string" ? node.nodeOutputInstructions
        : node.nodeOutputType && typeof node.outputSchema === "string" && node.outputSchema.trim() ? `Match this expected output schema exactly: ${node.outputSchema}` : undefined,
    };
  }
  return {
    agentId: undefined,
    systemPrompt: typeof node.inlineSystemPrompt === "string" ? node.inlineSystemPrompt : "",
    outputType: (node.inlineOutputType ?? "text") as AgentOverrides["outputType"],
    fallbackOutputType: (node.inlineFallbackOutputType ?? "text") as AgentOverrides["fallbackOutputType"],
    skillIds: Array.isArray(node.skillIds) ? node.skillIds.map(String) : [],
    mcpServerIds: Array.isArray(node.mcpServerIds) ? node.mcpServerIds.map(String) : [],
    mcpToolFilter: node.mcpToolFilter && typeof node.mcpToolFilter === "object"
      ? node.mcpToolFilter as Record<string, string[]> : {},
    providerIds: Array.isArray(node.providerIds) ? node.providerIds.map(String) : [],
    agentProviders: Array.isArray(node.agentProviders) ? node.agentProviders : [],
    nodeOutputType: ["text", "json", "html", "mixed"].includes(String(node.nodeOutputType))
      ? node.nodeOutputType as AgentOverrides["nodeOutputType"] : undefined,
    nodeOutputInstructions: typeof node.nodeOutputInstructions === "string" ? node.nodeOutputInstructions
      : node.nodeOutputType && typeof node.outputSchema === "string" && node.outputSchema.trim() ? `Match this expected output schema exactly: ${node.outputSchema}` : undefined,
  };
}

/** Saved node delivery settings override request settings in production runs. */
export function resolveWorkflowResultContext(node: Record<string, unknown>): { resultContextMode: "full" | "chunked" | undefined; resultChunkSize: number | undefined } {
  return {
    resultContextMode: node.resultContextMode === "full" || node.resultContextMode === "chunked"
      ? node.resultContextMode : undefined,
    resultChunkSize: typeof node.resultChunkSize === "number" && Number.isFinite(node.resultChunkSize)
      ? Math.min(Math.max(Math.round(node.resultChunkSize), 2000), 50000) : undefined,
  };
}
