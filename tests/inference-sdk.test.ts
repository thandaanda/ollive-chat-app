import { afterEach, describe, expect, it, vi } from "vitest";
import { createInferenceRun } from "@/lib/inference-sdk";

vi.mock("@/lib/env", () => ({
  getIngestionToken: () => "test-ingestion-token"
}));

describe("inference SDK", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits started and completed events with redacted previews, event IDs, and no secret metadata", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    global.fetch = fetchMock as typeof fetch;
    const now = [
      new Date("2026-05-22T09:00:00.000Z"),
      new Date("2026-05-22T09:00:01.250Z")
    ];

    const run = createInferenceRun({
      requestId: "request-sdk-test",
      provider: "openai",
      model: "gpt-test",
      conversationId: "conversation-1",
      messageId: "message-1",
      baseUrl: "http://localhost:3000",
      inputMessages: [
        {
          role: "user",
          content: "Email me at person@example.com and use sk1234567890abcdefghijkl"
        }
      ],
      requestMetadata: {
        userAgent: "Mozilla",
        apiKey: "sk-secret-browser-key"
      },
      now: () => now.shift() ?? new Date("2026-05-22T09:00:01.250Z"),
      eventIdFactory: (eventType) => `event-${eventType}`
    });

    await run.started();
    await run.completed({
      output: "Call +1 415 555 0130",
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30
      },
      metadata: {
        finishReason: "stop",
        authorization: "Bearer secret-token-value"
      }
    });

    const payloads = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(payloads.map((payload) => payload.eventId)).toEqual(["event-started", "event-completed"]);
    expect(payloads.map((payload) => payload.requestId)).toEqual(["request-sdk-test", "request-sdk-test"]);
    expect(payloads[0].inputPreview).toContain("[redacted-email]");
    expect(payloads[0].inputPreview).toContain("[redacted-secret]");
    expect(payloads[1].outputPreview).toContain("[redacted-phone]");
    expect(payloads[1].tokenUsage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30
    });
    expect(JSON.stringify(payloads)).not.toContain("sk-secret-browser-key");
    expect(JSON.stringify(payloads)).not.toContain("secret-token-value");
  });

  it("retries ingestion once before giving up", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    global.fetch = fetchMock as typeof fetch;

    const run = createInferenceRun({
      requestId: "request-sdk-retry",
      provider: "gemini",
      model: "gemini-test",
      baseUrl: "http://localhost:3000",
      inputMessages: [{ role: "user", content: "hello" }],
      eventIdFactory: () => "event-retry"
    });

    await run.started();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
