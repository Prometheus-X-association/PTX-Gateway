import { assertPublicUrl } from "./workflowHttp.ts";
import { HttpError } from "./workflowSecurity.ts";
export interface AuthoringProvider {
  id?: string;
  name?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
  providerType?: string;
  enabled?: boolean;
  deletedAt?: string;
}
export async function generateStudioProposal(
  provider: AuthoringProvider,
  system: string,
  prompt: string,
): Promise<string> {
  if (new TextEncoder().encode(system + prompt).length > 512000) {
    throw new HttpError(
      400,
      "The authoring context exceeds 500 KiB. Reduce the target page or available catalog.",
    );
  }
  const type = provider.providerType || "openai_compatible";
  const key = provider.apiKey?.trim();
  const model = provider.model?.trim();
  if (!key || !model) {
    throw new HttpError(
      400,
      "Configure an enabled provider with a model and API key.",
    );
  }
  const defaults: Record<string, string> = {
    anthropic: "https://api.anthropic.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
  };
  const base =
    (provider.apiBaseUrl || defaults[type] || "https://api.openai.com/v1")
      .replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  let body: unknown;
  let endpoint: string;
  if (type === "anthropic") {
    endpoint = base.endsWith("/messages") ? base : `${base}/messages`;
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: prompt }],
    };
  } else if (type === "gemini") {
    endpoint = `${base}/models/${encodeURIComponent(model)}:generateContent`;
    headers["x-goog-api-key"] = key;
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    };
  } else {
    endpoint = base.endsWith("/chat/completions")
      ? base
      : `${base}/chat/completions`;
    headers.Authorization = `Bearer ${key}`;
    body = {
      model,
      messages: [{ role: "system", content: system }, {
        role: "user",
        content: prompt,
      }],
      response_format: { type: "json_object" },
    };
  }
  const url = new URL(endpoint);
  if (url.protocol !== "https:") {
    throw new HttpError(
      400,
      "Authoring providers require a public HTTPS endpoint.",
    );
  }
  await assertPublicUrl(url);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new HttpError(
      502,
      "Authoring provider could not be reached or timed out.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(
      502,
      `Authoring provider returned HTTP ${response.status}. Check its model and configuration.`,
    );
  }
  const reader = response.body?.getReader();
  let raw = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 768000) {
          throw new HttpError(502, "Authoring provider response is too large.");
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      await reader.cancel();
    }
  }
  let parsed: {
    content?: Array<{ type: string; text: string }>;
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    choices?: Array<{ message?: { content?: string } }>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(
      502,
      "Authoring provider returned an invalid response.",
    );
  }
  const output = type === "anthropic"
    ? (parsed.content || []).filter((block: { type: string }) =>
      block.type === "text"
    ).map((block: { text: string }) => block.text).join("\n")
    : type === "gemini"
    ? (parsed.candidates?.[0]?.content?.parts || []).map((
      part: { text?: string },
    ) => part.text || "").join("\n")
    : parsed.choices?.[0]?.message?.content;
  if (typeof output !== "string" || !output.trim()) {
    throw new HttpError(502, "Authoring provider returned no proposal.");
  }
  return output;
}
