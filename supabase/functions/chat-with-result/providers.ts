interface Provider {
  id?: string;
  name?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
  enabled?: boolean;
  deletedAt?: string;
  providerType?: "openai" | "anthropic" | "gemini" | "openai_compatible";
}

interface ProviderConfig {
  providers?: Provider[];
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
}

interface AgentProviders {
  providerIds?: string[];
  agentProviders?: Provider[];
}

// Resolve from the configuration loaded for this request; never copy defaults into agents.
export const resolveProviders = (cfg: ProviderConfig): Provider[] => {
  if (Array.isArray(cfg.providers) && cfg.providers.length > 0) {
    return cfg.providers.filter((p) => p.enabled !== false && !p.deletedAt);
  }
  if (cfg.apiKey?.trim()) {
    return [{
      apiBaseUrl: cfg.apiBaseUrl || "https://api.openai.com/v1",
      apiKey: cfg.apiKey,
      model: cfg.model || "gpt-4o-mini",
      enabled: true,
    }];
  }
  return [];
};

// Resolve providers for a specific agent:
//   1. Agent-specific providers come first (highest priority)
//   2. Then global providers filtered to agent's providerIds selection
//   3. If no providerIds set, all global providers are used as fallback
export const resolveAgentProviders = (agent: AgentProviders, cfg: ProviderConfig): Provider[] => {
  const agentSpecific = (agent.agentProviders ?? []).filter((p) => p.enabled !== false && !p.deletedAt);
  const globalAll = resolveProviders(cfg);
  const globalSelected = (agent.providerIds ?? []).length > 0
    ? (agent.providerIds ?? [])
        .map((id) => globalAll.find((p) => p.id === id))
        .filter((p): p is Provider => Boolean(p))
    : globalAll;
  return [...agentSpecific, ...globalSelected];
};
