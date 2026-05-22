import { parseSse } from "@/lib/sse";
import type { LlmMessage, LlmProvider, StreamCompletionRequest, TokenUsage } from "./types";
import { ProviderRequestError } from "./types";

type OpenAiChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
};

export function createOpenAiProvider(apiKey: string, models: string[]): LlmProvider {
  return {
    id: "openai",
    label: "OpenAI",
    models,
    streamCompletion: (request) => streamOpenAi(apiKey, request)
  };
}

async function streamOpenAi(apiKey: string, request: StreamCompletionRequest) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: request.signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: request.model,
      messages: toOpenAiMessages(request.messages),
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.4
    })
  });

  if (!response.ok) {
    throw await providerError("openai", response);
  }

  let text = "";
  let finishReason: string | undefined;
  let usage: TokenUsage | undefined;

  for await (const event of parseSse(response)) {
    if (event.data === "[DONE]") {
      break;
    }

    const chunk = JSON.parse(event.data) as OpenAiChunk;
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      text += delta;
      request.onToken(delta);
    }

    finishReason = chunk.choices?.[0]?.finish_reason ?? finishReason;
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens
      };
    }
  }

  return { text, usage, finishReason };
}

function toOpenAiMessages(messages: LlmMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content
  }));
}

async function providerError(provider: "openai", response: Response) {
  const body = await response.text();
  return new ProviderRequestError(provider, `OpenAI request failed with HTTP ${response.status}`, response.status, body);
}
