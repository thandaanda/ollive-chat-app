import { type ChatMessage as PrismaChatMessage } from "@prisma/client";
import type { LanguageModelUsage, UIMessage } from "ai";
import type { LlmMessage, TokenUsage } from "@/lib/providers/types";

export type ChatMessageMetadata = {
  provider?: string;
  model?: string;
  status?: string;
  requestId?: string;
  createdAt?: string;
};

export type ChatMetaPayload = {
  requestId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
};

export type ChatDataParts = {
  "chat-meta": ChatMetaPayload;
};

export type OlliveUIMessage = UIMessage<ChatMessageMetadata, ChatDataParts>;

export function uiMessageText(message: Pick<OlliveUIMessage, "parts">, options: { trim?: boolean } = {}): string {
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");

  return options.trim ? text.trim() : text;
}

export function prismaMessageToUiMessage(message: PrismaChatMessage): OlliveUIMessage {
  return {
    id: message.id,
    role: message.role.toLowerCase() as OlliveUIMessage["role"],
    metadata: {
      provider: message.provider ?? undefined,
      model: message.model ?? undefined,
      status: message.status.toLowerCase(),
      requestId: message.requestId ?? undefined,
      createdAt: message.createdAt.toISOString()
    },
    parts: [
      {
        type: "text",
        text: message.content
      }
    ]
  };
}

export function uiMessageToLlmMessage(message: Pick<OlliveUIMessage, "role" | "parts">): LlmMessage | null {
  const content = uiMessageText(message, { trim: true });
  if (!content) {
    return null;
  }

  return {
    role: message.role,
    content
  };
}

export function uiMessagesToLlmMessages(messages: Array<Pick<OlliveUIMessage, "role" | "parts">>): LlmMessage[] {
  return messages.flatMap((message) => {
    const llmMessage = uiMessageToLlmMessage(message);
    return llmMessage ? [llmMessage] : [];
  });
}

export function languageModelUsageToTokenUsage(usage?: LanguageModelUsage): TokenUsage | undefined {
  if (!usage) {
    return undefined;
  }

  const promptTokens = usage.inputTokens ?? undefined;
  const completionTokens = usage.outputTokens ?? undefined;
  const totalTokens =
    usage.totalTokens ?? (promptTokens !== undefined || completionTokens !== undefined
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : undefined);

  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens
  };
}
