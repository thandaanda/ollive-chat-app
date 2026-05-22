import { MessageRole, MessageStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  languageModelUsageToTokenUsage,
  prismaMessageToUiMessage,
  uiMessageText
} from "@/lib/chat-ui-messages";

describe("chat UI message helpers", () => {
  it("converts stored chat messages to AI SDK UI messages", () => {
    const message = prismaMessageToUiMessage({
      id: "message-1",
      conversationId: "conversation-1",
      role: MessageRole.ASSISTANT,
      content: "Hello",
      provider: "openai",
      model: "gpt-4.1-mini",
      requestId: "request-1",
      status: MessageStatus.COMPLETE,
      metadata: null,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      updatedAt: new Date("2026-05-22T00:00:00.000Z")
    });

    expect(message).toMatchObject({
      id: "message-1",
      role: "assistant",
      metadata: {
        provider: "openai",
        model: "gpt-4.1-mini",
        status: "complete",
        requestId: "request-1"
      },
      parts: [{ type: "text", text: "Hello" }]
    });
  });

  it("extracts text from AI SDK text parts only", () => {
    expect(
      uiMessageText({
        parts: [
          { type: "text", text: "Hello" },
          { type: "data-chat-meta", data: { requestId: "r", conversationId: "c", userMessageId: "u", assistantMessageId: "a" } },
          { type: "text", text: " world" }
        ]
      })
    ).toBe("Hello world");
  });

  it("maps AI SDK usage to inference token usage", () => {
    expect(
      languageModelUsageToTokenUsage({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15
      })
    ).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15
    });
  });
});
