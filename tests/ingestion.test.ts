import { InferenceStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { applyEventToLogSnapshot } from "@/lib/ingestion/processor";
import { inferenceEventPayloadSchema } from "@/lib/ingestion/schema";

describe("ingestion schema", () => {
  it("rejects malformed events", () => {
    const parsed = inferenceEventPayloadSchema.safeParse({
      requestId: "short",
      eventType: "completed",
      provider: "",
      model: "gpt-4.1-mini"
    });

    expect(parsed.success).toBe(false);
  });
});

describe("inference log transitions", () => {
  it("moves a request from started to completed with token and latency metadata", () => {
    const started = applyEventToLogSnapshot(null, {
      eventId: "event-started-123",
      requestId: "request-123",
      eventType: "started",
      provider: "openai",
      model: "gpt-4.1-mini",
      conversationId: "conversation-1",
      messageId: "message-1",
      occurredAt: "2026-05-22T09:00:00.000Z",
      inputPreview: "user: hello"
    });

    const completed = applyEventToLogSnapshot(started, {
      eventId: "event-completed-123",
      requestId: "request-123",
      eventType: "completed",
      provider: "openai",
      model: "gpt-4.1-mini",
      occurredAt: "2026-05-22T09:00:01.250Z",
      latencyMs: 1250,
      tokenUsage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30
      },
      outputPreview: "assistant: hi"
    });

    expect(started.status).toBe(InferenceStatus.STARTED);
    expect(completed.status).toBe(InferenceStatus.COMPLETED);
    expect(completed.latencyMs).toBe(1250);
    expect(completed.totalTokens).toBe(30);
    expect(completed.conversationId).toBe("conversation-1");
  });

  it("marks cancellation without losing partial output", () => {
    const cancelled = applyEventToLogSnapshot(null, {
      eventId: "event-cancelled-456",
      requestId: "request-456",
      eventType: "cancelled",
      provider: "gemini",
      model: "gemini-1.5-flash",
      occurredAt: "2026-05-22T09:00:01.250Z",
      outputPreview: "partial response"
    });

    expect(cancelled.status).toBe(InferenceStatus.CANCELLED);
    expect(cancelled.outputPreview).toBe("partial response");
  });

  it("does not regress a terminal log when a late started event arrives", () => {
    const completed = applyEventToLogSnapshot(null, {
      eventId: "event-completed-789",
      requestId: "request-789",
      eventType: "completed",
      provider: "openai",
      model: "gpt-4.1-mini",
      occurredAt: "2026-05-22T09:00:01.250Z"
    });

    const lateStarted = applyEventToLogSnapshot(completed, {
      eventId: "event-started-789",
      requestId: "request-789",
      eventType: "started",
      provider: "openai",
      model: "gpt-4.1-mini",
      occurredAt: "2026-05-22T09:00:02.000Z"
    });

    expect(lateStarted.status).toBe(InferenceStatus.COMPLETED);
  });
});
