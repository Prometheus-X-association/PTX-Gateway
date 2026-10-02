interface SearchProvider {
  name?: string;
  providerType?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
}

interface SearchMessage { role: string; content: string }
interface SearchConfig { allowedDomains: string[]; resultPolicy?: "lightcast" }
interface ResponseItem {
  type?: string;
  status?: string;
  action?: { type?: string; url?: string };
  content?: Array<{ type?: string; text?: string }>;
}

const taxonomyUrl = (value: unknown): URL | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "lightcast.io" &&
      /^\/taxonomies\/skills-taxonomy\/[^/]+\/[^/]+\/?$/.test(url.pathname)
      ? url : null;
  } catch { return null; }
};

/** Reject unsupported providers and require hosted search before accepting text. */
export async function runRequiredWebSearch(
  providers: SearchProvider[],
  messages: SearchMessage[],
  config: SearchConfig,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const errors: string[] = [];
  for (const provider of providers) {
    const base = (provider.apiBaseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
    const family = provider.providerType ?? (base.includes("api.openai.com") ? "openai" : "openai_compatible");
    if (family !== "openai" || !provider.apiKey?.trim() || !provider.model?.trim()) continue;
    try {
      const response = await fetcher(`${base.replace(/\/(chat\/completions|responses)$/, "")}/responses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${provider.apiKey.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: provider.model.trim(),
          instructions: messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n"),
          input: messages.filter((message) => message.role !== "system").map((message) => ({
            role: message.role === "assistant" ? "assistant" : "user", content: message.content,
          })),
          tools: [{ type: "web_search", filters: { allowed_domains: config.resultPolicy === "lightcast" ? ["lightcast.io"] : config.allowedDomains } }],
          tool_choice: "required",
          include: ["web_search_call.action.sources"],
          store: false,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) throw new Error(`Responses API returned HTTP ${response.status}`);
      const result = await response.json() as { status?: string; output?: ResponseItem[] };
      if (result.status !== "completed") throw new Error("Web search response did not complete");
      const output = result.output ?? [];
      if (!output.some((item) => item.type === "web_search_call" && item.status === "completed" && item.action?.type === "search")) {
        throw new Error("Provider returned an answer without completing web search");
      }
      const text = output.filter((item) => item.type === "message")
        .flatMap((item) => item.content ?? [])
        .filter((part) => part.type === "output_text")
        .map((part) => part.text ?? "").join("");
      if (!text.trim()) throw new Error("Web search returned no answer");
      if (config.resultPolicy !== "lightcast") return text;

      // The model selects and copies the description; enforce its output contract
      // and require a completed open_page action for the reported source.
      const match = JSON.parse(text) as Record<string, unknown>;
      if (typeof match.skillLabel !== "string" || !match.skillLabel.trim()) throw new Error("Lightcast response is missing skillLabel");
      const missing = {
        skillLabel: match.skillLabel, matchedSkill: null, framework: "Lightcast",
        skillId: null, description: null, source: null, status: "not_found",
      };
      const source = taxonomyUrl(match.source);
      const opened = source && output.some((item) => {
        const url = taxonomyUrl(item.action?.url);
        return item.type === "web_search_call" && item.status === "completed" &&
          item.action?.type === "open_page" && url?.href === source.href;
      });
      if (match.status !== "found" || match.framework !== "Lightcast" || !source || !opened ||
        typeof match.matchedSkill !== "string" || !match.matchedSkill.trim() ||
        typeof match.skillId !== "string" || match.skillId !== source.pathname.split("/")[3] ||
        typeof match.description !== "string" || !match.description.trim()) {
        return JSON.stringify(missing);
      }
      return JSON.stringify({
        skillLabel: match.skillLabel, matchedSkill: match.matchedSkill, framework: "Lightcast",
        skillId: match.skillId, description: match.description, source: match.source, status: "found",
      });
    } catch (error) {
      errors.push(`${provider.name || provider.model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Required OpenAI web search could not run. Configure an OpenAI provider with a web-search-capable model.${errors.length ? ` ${errors.join("; ")}` : ""}`);
}
