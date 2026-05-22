import { MessageRole, MessageStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const streamTextMock = vi.hoisted(() => vi.fn());
const resolveAiSdkLanguageModelMock = vi.hoisted(() => vi.fn());
const inferenceRunMock = vi.hoisted(() => ({
  requestId: "request-sdk-1",
  startedAt: new Date("2026-05-22T00:00:00.000Z"),
  started: vi.fn(),
  completed: vi.fn(),
  failed: vi.fn(),
  cancelled: vi.fn()
}));
const createInferenceRunMock = vi.hoisted(() => vi.fn(() => inferenceRunMock));
const prismaMock = vi.hoisted(() => ({
  conversation: {
    create: vi.fn(),
    update: vi.fn()
  },
  chatMessage: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  }
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamText: streamTextMock
  };
});

vi.mock("@/lib/db", () => ({
  prisma: prismaMock
}));

vi.mock("@/lib/env", () => ({
  getAppUrl: () => "http://localhost:3000"
}));

vi.mock("@/lib/providers", () => ({
  resolveAiSdkLanguageModel: resolveAiSdkLanguageModelMock
}));

vi.mock("@/lib/inference-sdk", () => ({
  createInferenceRequestId: () => "request-sdk-1",
  createInferenceRun: createInferenceRunMock
}));

describe("POST /api/chat AI SDK stream", () => {
  beforeEach(async () => {
    process.env.DATABASE_URL = "postgresql://localhost/test";
    vi.clearAllMocks();
    createInferenceRunMock.mockReturnValue(inferenceRunMock);

    const now = new Date("2026-05-22T00:00:00.000Z");
    prismaMock.conversation.create.mockResolvedValue({
      id: "conversation-1",
      title: "Hello",
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now
    });
    prismaMock.chatMessage.findMany.mockResolvedValue([]);
    prismaMock.chatMessage.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: data.role === MessageRole.USER ? "user-message-1" : "assistant-message-1",
        conversationId: data.conversationId,
        role: data.role,
        content: data.content,
        provider: data.provider,
        model: data.model,
        requestId: data.requestId ?? null,
        status: data.status ?? MessageStatus.COMPLETE,
        metadata: null,
        createdAt: now,
        updatedAt: now
      })
    );
    prismaMock.chatMessage.update.mockResolvedValue({});
    prismaMock.conversation.update.mockResolvedValue({});
    resolveAiSdkLanguageModelMock.mockReturnValue({
      provider: "openai.responses",
      modelId: "gpt-test"
    });

    const actualAi = await vi.importActual<typeof import("ai")>("ai");
    streamTextMock.mockImplementation((options) => {
      options.onFinish?.({
        text: "Hello from AI SDK",
        finishReason: "stop",
        totalUsage: {
          inputTokens: 7,
          outputTokens: 5,
          totalTokens: 12
        }
      });

      return {
        toUIMessageStream: ({ generateMessageId, onFinish }: { generateMessageId?: () => string; onFinish?: unknown }) =>
          actualAi.createUIMessageStream({
            execute: ({ writer }) => {
              writer.write({ type: "start", messageId: generateMessageId?.() });
              writer.write({ type: "text-start", id: "text-1" });
              writer.write({ type: "text-delta", id: "text-1", delta: "Hello from AI SDK" });
              writer.write({ type: "text-end", id: "text-1" });
              writer.write({ type: "finish", finishReason: "stop" });
            },
            onFinish: onFinish as Parameters<typeof actualAi.createUIMessageStream>[0]["onFinish"]
          })
      };
    });
  });

  it("streams AI SDK UI chunks with chat metadata and never leaks request API keys", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(
      new Request("http://localhost:3000/api/chat", {
        method: "POST",
        body: JSON.stringify({
          id: null,
          message: {
            id: "client-message-1",
            role: "user",
            parts: [{ type: "text", text: "Hello" }]
          },
          provider: "openai",
          model: "gpt-test",
          apiKey: "sk-secret-browser-key"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const streamText = await response.text();
    expect(streamText).toContain('"type":"data-chat-meta"');
    expect(streamText).toContain('"conversationId":"conversation-1"');
    expect(streamText).toContain('"assistantMessageId":"assistant-message-1"');
    expect(streamText).toContain("Hello from AI SDK");
    expect(streamText).not.toContain("sk-secret-browser-key");

    expect(createInferenceRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "request-sdk-1",
        provider: "openai",
        model: "gpt-test",
        conversationId: "conversation-1",
        messageId: "assistant-message-1",
        baseUrl: "http://localhost:3000"
      })
    );
    expect(JSON.stringify(createInferenceRunMock.mock.calls)).not.toContain("sk-secret-browser-key");
    expect(inferenceRunMock.started).toHaveBeenCalledOnce();
    expect(inferenceRunMock.completed).toHaveBeenCalledWith(
      expect.objectContaining({
        output: "Hello from AI SDK",
        usage: {
          promptTokens: 7,
          completionTokens: 5,
          totalTokens: 12
        }
      })
    );
    expect(inferenceRunMock.failed).not.toHaveBeenCalled();
    expect(inferenceRunMock.cancelled).not.toHaveBeenCalled();
    expect(prismaMock.chatMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "assistant-message-1" },
        data: expect.objectContaining({
          content: "Hello from AI SDK",
          status: MessageStatus.COMPLETE
        })
      })
    );
  });
});
