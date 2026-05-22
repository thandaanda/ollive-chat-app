import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/providers/models/route";

const originalFetch = global.fetch;

describe("POST /api/providers/models", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns filtered OpenAI chat models", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [{ id: "gpt-4.1-mini" }, { id: "text-embedding-3-small" }, { id: "gpt-4o-transcribe" }]
      })
    );
    global.fetch = fetchMock as typeof fetch;

    const response = await POST(modelRequest("openai", "sk-test"));

    await expect(response.json()).resolves.toEqual({ models: ["gpt-4.1-mini"] });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer sk-test" }
      })
    );
  });

  it("returns Anthropic model IDs", async () => {
    global.fetch = vi.fn(async () =>
      Response.json({
        data: [{ id: "claude-3-5-sonnet-latest" }, { id: "claude-3-haiku-20240307" }]
      })
    ) as typeof fetch;

    const response = await POST(modelRequest("anthropic", "anthropic-key"));

    await expect(response.json()).resolves.toEqual({
      models: ["claude-3-5-sonnet-latest", "claude-3-haiku-20240307"]
    });
  });

  it("returns Gemini generation-capable models", async () => {
    global.fetch = vi.fn(async () =>
      Response.json({
        models: [
          { name: "models/gemini-1.5-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] }
        ]
      })
    ) as typeof fetch;

    const response = await POST(modelRequest("gemini", "gemini-key"));

    await expect(response.json()).resolves.toEqual({ models: ["gemini-1.5-flash"] });
  });

  it("sanitizes provider failures", async () => {
    global.fetch = vi.fn(async () => Response.json({ error: "key sk-secret leaked" }, { status: 401 })) as typeof fetch;

    const response = await POST(modelRequest("openai", "sk-secret"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "OpenAI model lookup failed" });
  });
});

function modelRequest(provider: string, apiKey: string) {
  return new Request("http://localhost/api/providers/models", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ provider, apiKey })
  });
}
