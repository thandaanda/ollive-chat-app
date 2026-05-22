import { describe, expect, it } from "vitest";
import { chatRequestSchema } from "@/lib/chat-request-schema";

describe("chatRequestSchema", () => {
  it("treats null id as a new conversation", () => {
    const parsed = chatRequestSchema.parse({
      id: null,
      message: {
        id: "client-message-1",
        role: "user",
        parts: [{ type: "text", text: "What is the reason for this?" }]
      },
      provider: "openai",
      model: "gpt-3.5-turbo",
      apiKey: "sk-test"
    });

    expect(parsed.conversationId).toBeUndefined();
    expect(parsed.messageText).toBe("What is the reason for this?");
  });

  it("keeps an existing string id as the conversation id", () => {
    const parsed = chatRequestSchema.parse({
      id: "conversation-123",
      message: {
        id: "client-message-2",
        role: "user",
        parts: [{ type: "text", text: "resume this" }]
      },
      provider: "openai",
      model: "gpt-3.5-turbo"
    });

    expect(parsed.conversationId).toBe("conversation-123");
  });

  it("rejects non-user messages", () => {
    expect(() =>
      chatRequestSchema.parse({
        id: "conversation-123",
        message: {
          id: "client-message-3",
          role: "assistant",
          parts: [{ type: "text", text: "not allowed" }]
        },
        provider: "openai",
        model: "gpt-3.5-turbo"
      })
    ).toThrow();
  });
});
