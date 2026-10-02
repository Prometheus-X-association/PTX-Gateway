type StreamFormat = "anthropic" | "gemini" | "responses" | "chat";

// A successful HTTP status does not guarantee a successful model response.
export const assertProviderSuccess = (event: Record<string, unknown>): void => {
  const response = event.response as Record<string, unknown> | undefined;
  const error = event.error ?? response?.error;
  if (error || event.type === "error" || event.type === "response.failed" || event.type === "response.incomplete") {
    const detail = error && typeof error === "object"
      ? String((error as Record<string, unknown>).message || JSON.stringify(error))
      : String(error || event.message || event.type);
    throw new Error(detail);
  }
};

export async function* readProviderStream(
  body: ReadableStream<Uint8Array>,
  format: StreamFormat,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let hasText = false;
  const parseLine = (line: string): string[] => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return [];
    const raw = trimmed.slice(5).trim();
    if (raw === "[DONE]") {
      completed = true;
      return [];
    }
    const event = JSON.parse(raw) as Record<string, unknown>;
    assertProviderSuccess(event);
    if (format === "anthropic") {
      if (event.type === "message_stop") completed = true;
      const delta = event.delta as Record<string, unknown> | undefined;
      return event.type === "content_block_delta" && typeof delta?.text === "string" ? [delta.text] : [];
    }
    if (format === "responses") {
      if (event.type === "response.completed") completed = true;
      return event.type === "response.output_text.delta" && typeof event.delta === "string" ? [event.delta] : [];
    }
    const candidates = (format === "gemini" ? event.candidates : event.choices) as Array<Record<string, unknown>> | undefined;
    const first = candidates?.[0];
    if (first?.finishReason || first?.finish_reason) completed = true;
    if (format === "gemini") {
      const content = first?.content as Record<string, unknown> | undefined;
      const parts = content?.parts as Array<Record<string, unknown>> | undefined;
      return (parts ?? []).flatMap((part) => typeof part.text === "string" ? [part.text] : []);
    }
    const delta = first?.delta as Record<string, unknown> | undefined;
    return typeof delta?.content === "string" ? [delta.content] : [];
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      if (done && buffer.trim()) lines.push(buffer);
      for (const line of lines) {
        for (const token of parseLine(line)) {
          if (token) { hasText = true; yield token; }
        }
      }
      if (done) break;
    }
    if (!completed) throw new Error("Provider stream ended before completion");
    if (!hasText) throw new Error("Provider returned an empty response");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
