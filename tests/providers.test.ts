import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getProviderOptions, resolveAiSdkLanguageModel, resolveProvider } from "@/lib/providers";
import { ProviderConfigurationError } from "@/lib/providers/types";

const originalEnv = process.env;

describe("provider registry", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODELS;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODELS;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODELS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns the full provider catalog and marks server-configured providers", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_MODELS = "gpt-4.1-mini,gpt-4.1";
    process.env.ANTHROPIC_API_KEY = "anthropic-test";

    expect(getProviderOptions()).toEqual([
      {
        id: "openai",
        label: "OpenAI",
        configuredByServer: true,
        models: ["gpt-4.1-mini", "gpt-4.1"]
      },
      {
        id: "anthropic",
        label: "Anthropic",
        configuredByServer: false,
        models: []
      },
      {
        id: "gemini",
        label: "Gemini",
        configuredByServer: false,
        models: []
      }
    ]);
  });

  it("uses a browser-provided request key without requiring env allowlists", () => {
    const provider = resolveProvider("openai", "gpt-4.1-mini", "sk-browser");

    expect(provider.id).toBe("openai");
    expect(provider.models).toEqual(["gpt-4.1-mini"]);
  });

  it("resolves an AI SDK language model from a browser-provided key", () => {
    const model = resolveAiSdkLanguageModel("openai", "gpt-4.1-mini", "sk-browser");

    expect(model.modelId).toBe("gpt-4.1-mini");
    expect(model.provider).toBe("openai.chat");
  });

  it("rejects env fallback models outside the configured allowlist", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_MODELS = "gpt-4.1-mini";

    expect(() => resolveProvider("openai", "gpt-4.1")).toThrow(ProviderConfigurationError);
  });

  it("rejects missing request and env keys", () => {
    expect(() => resolveProvider("openai", "gpt-4.1-mini")).toThrow(ProviderConfigurationError);
  });
});
