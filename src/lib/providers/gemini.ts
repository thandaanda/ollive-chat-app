import { parseSse } from "@/lib/sse";
import type { LlmProvider, StreamCompletionRequest, TokenUsage } from "./types";
import { ProviderRequestError } from "./types";

type GeminiChunk = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

export function createGeminiProvider(apiKey: string, models: string[]): LlmProvider {
  return {
    id: "gemini",
    label: "Gemini",
    models,
    streamCompletion: (request) => streamGemini(apiKey, request)
  };
}

async function streamGemini(apiKey: string, request: StreamCompletionRequest) {
  const systemText = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  const contents = request.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    }));

  const model = request.model.replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    signal: request.signal,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents,
      systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
      generationConfig: {
        temperature: 0.4
      }
    })
  });

  if (!response.ok) {
    throw await providerError(response);
  }

  let text = "";
  let finishReason: string | undefined;
  let usage: TokenUsage | undefined;

  for await (const event of parseSse(response)) {
    const chunk = JSON.parse(event.data) as GeminiChunk;
    const delta = chunk.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (delta) {
      text += delta;
      request.onToken(delta);
    }

    finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
    if (chunk.usageMetadata) {
      usage = {
        promptTokens: chunk.usageMetadata.promptTokenCount,
        completionTokens: chunk.usageMetadata.candidatesTokenCount,
        totalTokens: chunk.usageMetadata.totalTokenCount
      };
    }
  }

  return { text, usage, finishReason };
}

async function providerError(response: Response) {
  const body = await response.text();
  return new ProviderRequestError("gemini", `Gemini request failed with HTTP ${response.status}`, response.status, body);
}
