import { randomUUID } from "node:crypto";
import { InferenceStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { processInferenceEvent } from "@/lib/ingestion/processor";

const describeDb = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;

describeDb("database-backed ingestion smoke test", () => {
  it("stores raw events, upserts one aggregate log, and deduplicates event IDs", async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required when RUN_DB_TESTS=1");
    }

    const requestId = `db-smoke-${randomUUID()}`;
    const startedEventId = `${requestId}-started`;
    const completedEventId = `${requestId}-completed`;

    try {
      const started = await processInferenceEvent({
        eventId: startedEventId,
        requestId,
        eventType: "started",
        provider: "openai",
        model: "gpt-smoke",
        occurredAt: "2026-05-22T09:00:00.000Z",
        inputPreview: "user: hello"
      });

      const completed = await processInferenceEvent({
        eventId: completedEventId,
        requestId,
        eventType: "completed",
        provider: "openai",
        model: "gpt-smoke",
        occurredAt: "2026-05-22T09:00:01.000Z",
        latencyMs: 1000,
        tokenUsage: {
          promptTokens: 3,
          completionTokens: 4,
          totalTokens: 7
        },
        outputPreview: "assistant: hi"
      });

      const duplicate = await processInferenceEvent({
        eventId: completedEventId,
        requestId,
        eventType: "completed",
        provider: "openai",
        model: "gpt-smoke",
        occurredAt: "2026-05-22T09:00:01.000Z"
      });

      const rawEvents = await prisma.inferenceEvent.findMany({
        where: { requestId },
        orderBy: { occurredAt: "asc" }
      });
      const aggregate = await prisma.inferenceLog.findUnique({
        where: { requestId }
      });

      expect(started.deduped).toBe(false);
      expect(completed.deduped).toBe(false);
      expect(duplicate.deduped).toBe(true);
      expect(rawEvents).toHaveLength(2);
      expect(rawEvents.map((event) => event.eventId)).toEqual([startedEventId, completedEventId]);
      expect(aggregate).toMatchObject({
        requestId,
        status: InferenceStatus.COMPLETED,
        latencyMs: 1000,
        totalTokens: 7
      });
    } finally {
      await prisma.inferenceEvent.deleteMany({ where: { requestId } });
      await prisma.inferenceLog.deleteMany({ where: { requestId } });
      await prisma.$disconnect();
    }
  });
});
