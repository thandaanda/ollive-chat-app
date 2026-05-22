import { parseSse } from "@/lib/sse";
import type { LlmProvider, StreamCompletionRequest, TokenUsage } from "./types";
import { ProviderRequestError } from "./types";

type AnthropicChunk = {
  type?: string;
  delta?: {
    text?: string;
  };
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

export function createAnthropicProvider(apiKey: string, models: string[]): LlmProvider {
  return {
    id: "anthropic",
    label: "Anthropic",
    models,
    streamCompletion: (request) => streamAnthropic(apiKey, request)
  };
}

async function streamAnthropic(apiKey: string, request: StreamCompletionRequest) {
  const system = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  const messages = request.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content
    }));

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: request.signal,
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: 1024,
      system: system || undefined,
      messages,
      stream: true,
      temperature: 0.4
    })
  });

  if (!response.ok) {
    throw await providerError(response);
  }

  let text = "";
  let usage: TokenUsage | undefined;

  for await (const event of parseSse(response)) {
    const chunk = JSON.parse(event.data) as AnthropicChunk;
    if (chunk.type === "content_block_delta" && chunk.delta?.text) {
      text += chunk.delta.text;
      request.onToken(chunk.delta.text);
    }

    const inputTokens = chunk.message?.usage?.input_tokens ?? chunk.usage?.input_tokens;
    const outputTokens = chunk.message?.usage?.output_tokens ?? chunk.usage?.output_tokens;
    if (inputTokens || outputTokens) {
      usage = {
        promptTokens: inputTokens ?? usage?.promptTokens,
        completionTokens: outputTokens ?? usage?.completionTokens,
        totalTokens: (inputTokens ?? usage?.promptTokens ?? 0) + (outputTokens ?? usage?.completionTokens ?? 0)
      };
    }
  }

  return { text, usage };
}

async function providerError(response: Response) {
  const body = await response.text();
  return new ProviderRequestError("anthropic", `Anthropic request failed with HTTP ${response.status}`, response.status, body);
}
