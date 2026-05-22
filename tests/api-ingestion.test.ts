import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;

const processInferenceEvent = vi.fn(async (payload: { requestId: string }) => ({
  log: {
    requestId: payload.requestId,
    status: "COMPLETED"
  },
  deduped: false
}));

vi.mock("@/lib/env", () => ({
  getIngestionToken: () => "test-ingestion-token"
}));

vi.mock("@/lib/ingestion/processor", () => ({
  processInferenceEvent
}));

describe("POST /api/ingest/inference", () => {
  beforeEach(() => {
    processInferenceEvent.mockClear();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  });

  afterEach(() => {
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("rejects requests without the ingestion bearer token", async () => {
    const { POST } = await import("@/app/api/ingest/inference/route");
    const response = await POST(
      new Request("http://localhost/api/ingest/inference", {
        method: "POST",
        body: JSON.stringify(validPayload())
      })
    );

    expect(response.status).toBe(401);
    expect(processInferenceEvent).not.toHaveBeenCalled();
  });

  it("validates and processes authorized events", async () => {
    const { POST } = await import("@/app/api/ingest/inference/route");
    const response = await POST(
      new Request("http://localhost/api/ingest/inference", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-ingestion-token",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(validPayload())
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      requestId: "request-api-123",
      status: "completed",
      deduped: false
    });
    expect(processInferenceEvent).toHaveBeenCalledOnce();
  });
});

function validPayload() {
  return {
    eventId: "event-api-123",
    requestId: "request-api-123",
    eventType: "completed",
    provider: "openai",
    model: "gpt-4.1-mini",
    occurredAt: "2026-05-22T09:00:00.000Z"
  };
}
