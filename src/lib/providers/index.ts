import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { parseCsv } from "@/lib/env";
import { createAnthropicProvider } from "./anthropic";
import { createGeminiProvider } from "./gemini";
import { createOpenAiProvider } from "./openai";
import type { LlmProvider, ProviderId, ProviderOption } from "./types";
import { ProviderConfigurationError, ProviderModelListError } from "./types";

type ProviderDefinition = {
  id: ProviderId;
  label: string;
  apiKeyEnv: string;
  modelsEnv: string;
  create: (apiKey: string, models: string[]) => LlmProvider;
  createAiSdkModel: (apiKey: string, model: string) => LanguageModel;
  listModels: (apiKey: string) => Promise<string[]>;
};

const DEFINITIONS: ProviderDefinition[] = [
  {
    id: "openai",
    label: "OpenAI",
    apiKeyEnv: "OPENAI_API_KEY",
    modelsEnv: "OPENAI_MODELS",
    create: createOpenAiProvider,
    createAiSdkModel: (apiKey, model) => createOpenAI({ apiKey }).chat(model),
    listModels: listOpenAiModels
  },
  {
    id: "anthropic",
    label: "Anthropic",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    modelsEnv: "ANTHROPIC_MODELS",
    create: createAnthropicProvider,
    createAiSdkModel: (apiKey, model) => createAnthropic({ apiKey })(model),
    listModels: listAnthropicModels
  },
  {
    id: "gemini",
    label: "Gemini",
    apiKeyEnv: "GEMINI_API_KEY",
    modelsEnv: "GEMINI_MODELS",
    create: createGeminiProvider,
    createAiSdkModel: (apiKey, model) => createGoogleGenerativeAI({ apiKey })(model),
    listModels: listGeminiModels
  }
];

export function getProviderOptions(): ProviderOption[] {
  return DEFINITIONS.map((definition) => {
    const apiKey = process.env[definition.apiKeyEnv];
    const models = parseCsv(process.env[definition.modelsEnv]);

    return {
      id: definition.id,
      label: definition.label,
      configuredByServer: Boolean(apiKey && models.length > 0),
      models
    };
  });
}

export function resolveProvider(providerId: string, model: string, requestApiKey?: string): LlmProvider {
  const resolved = resolveProviderConfiguration(providerId, model, requestApiKey);
  return resolved.definition.create(resolved.apiKey, resolved.browserApiKey ? [resolved.model] : resolved.models);
}

export function resolveAiSdkLanguageModel(providerId: string, model: string, requestApiKey?: string): LanguageModel {
  const resolved = resolveProviderConfiguration(providerId, model, requestApiKey);
  return resolved.definition.createAiSdkModel(resolved.apiKey, resolved.model);
}

function resolveProviderConfiguration(providerId: string, model: string, requestApiKey?: string) {
  const definition = DEFINITIONS.find((provider) => provider.id === providerId);
  if (!definition) {
    throw new ProviderConfigurationError(`Unknown provider: ${providerId}`);
  }

  const trimmedModel = model.trim();
  if (!trimmedModel) {
    throw new ProviderConfigurationError(`${definition.label} model is required`);
  }

  const browserApiKey = requestApiKey?.trim();
  const apiKey = browserApiKey || process.env[definition.apiKeyEnv];
  const models = parseCsv(process.env[definition.modelsEnv]);
  if (!apiKey) {
    throw new ProviderConfigurationError(`${definition.label} is not configured`);
  }

  if (!browserApiKey && models.length === 0) {
    throw new ProviderConfigurationError(`${definition.label} is not configured`);
  }

  if (!browserApiKey && !models.includes(trimmedModel)) {
    throw new ProviderConfigurationError(`${definition.label} model is not allowed: ${trimmedModel}`);
  }

  return {
    definition,
    apiKey,
    browserApiKey,
    model: trimmedModel,
    models
  };
}

export async function listProviderModels(providerId: string, apiKey: string): Promise<string[]> {
  const definition = DEFINITIONS.find((provider) => provider.id === providerId);
  if (!definition) {
    throw new ProviderConfigurationError(`Unknown provider: ${providerId}`);
  }

  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new ProviderConfigurationError(`${definition.label} API key is required`);
  }

  const models = await definition.listModels(trimmedApiKey);
  return [...new Set(models)].sort((left, right) => left.localeCompare(right));
}

async function listOpenAiModels(apiKey: string): Promise<string[]> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    throw new ProviderModelListError("openai", "OpenAI model lookup failed", response.status);
  }

  const json = (await response.json()) as { data?: Array<{ id?: string }> };
  return (json.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => Boolean(id))
    .filter((id) => /^(gpt-|o\d|o[1-9]|chatgpt-)/i.test(id))
    .filter((id) => !/(embedding|audio|transcribe|tts|realtime|image|moderation)/i.test(id));
}

async function listAnthropicModels(apiKey: string): Promise<string[]> {
  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    }
  });

  if (!response.ok) {
    throw new ProviderModelListError("anthropic", "Anthropic model lookup failed", response.status);
  }

  const json = (await response.json()) as { data?: Array<{ id?: string }> };
  return (json.data ?? []).map((model) => model.id).filter((id): id is string => Boolean(id));
}

async function listGeminiModels(apiKey: string): Promise<string[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );

  if (!response.ok) {
    throw new ProviderModelListError("gemini", "Gemini model lookup failed", response.status);
  }

  const json = (await response.json()) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };

  return (json.models ?? [])
    .filter((model) => model.supportedGenerationMethods?.some((method) => method === "generateContent" || method === "streamGenerateContent"))
    .map((model) => model.name?.replace(/^models\//, ""))
    .filter((id): id is string => Boolean(id));
}
