interface AgentOverrides {
  agentId?: string;
  systemPrompt?: string;
  outputType?: "auto" | "text" | "json" | "html" | "mixed";
  fallbackOutputType?: "text" | "json" | "html" | "mixed";
  skillIds?: string[];
  providerIds?: string[];
  agentProviders?: unknown[];
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
      skillIds: undefined,
      providerIds: undefined,
      agentProviders: undefined,
    };
  }
  return {
    agentId: undefined,
    systemPrompt: typeof node.inlineSystemPrompt === "string" ? node.inlineSystemPrompt : "",
    outputType: (node.inlineOutputType ?? "text") as AgentOverrides["outputType"],
    fallbackOutputType: (node.inlineFallbackOutputType ?? "text") as AgentOverrides["fallbackOutputType"],
    skillIds: Array.isArray(node.skillIds) ? node.skillIds.map(String) : [],
    providerIds: Array.isArray(node.providerIds) ? node.providerIds.map(String) : [],
    agentProviders: Array.isArray(node.agentProviders) ? node.agentProviders : [],
  };
}
