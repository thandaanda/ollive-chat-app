import { InferenceStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(prismaMock)),
  inferenceEvent: {
    findUnique: vi.fn(),
    create: vi.fn()
  },
  inferenceLog: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  }
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock
}));

describe("processInferenceEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes raw events and aggregate logs inside a transaction", async () => {
    const { processInferenceEvent } = await import("@/lib/ingestion/processor");
    prismaMock.inferenceEvent.findUnique.mockResolvedValue(null);
    prismaMock.inferenceLog.findUnique.mockResolvedValue(null);
    prismaMock.inferenceLog.create.mockResolvedValue({
      requestId: "request-transaction-1",
      status: InferenceStatus.STARTED
    });

    const result = await processInferenceEvent({
      eventId: "event-transaction-1",
      requestId: "request-transaction-1",
      eventType: "started",
      provider: "openai",
      model: "gpt-test",
      occurredAt: "2026-05-22T09:00:00.000Z"
    });

    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    expect(prismaMock.inferenceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: "event-transaction-1",
          requestId: "request-transaction-1"
        })
      })
    );
    expect(prismaMock.inferenceLog.create).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      deduped: false,
      log: {
        requestId: "request-transaction-1",
        status: InferenceStatus.STARTED
      }
    });
  });

  it("deduplicates repeated event IDs without inserting or reapplying the transition", async () => {
    const { processInferenceEvent } = await import("@/lib/ingestion/processor");
    prismaMock.inferenceEvent.findUnique.mockResolvedValue({
      eventId: "event-duplicate-1",
      requestId: "request-duplicate-1"
    });
    prismaMock.inferenceLog.findUnique.mockResolvedValue({
      requestId: "request-duplicate-1",
      status: InferenceStatus.COMPLETED
    });

    const result = await processInferenceEvent({
      eventId: "event-duplicate-1",
      requestId: "request-duplicate-1",
      eventType: "completed",
      provider: "openai",
      model: "gpt-test",
      occurredAt: "2026-05-22T09:00:01.000Z"
    });

    expect(result.deduped).toBe(true);
    expect(prismaMock.inferenceEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.inferenceLog.update).not.toHaveBeenCalled();
    expect(prismaMock.inferenceLog.create).not.toHaveBeenCalled();
  });
});
