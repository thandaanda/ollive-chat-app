export type ProviderId = "openai" | "anthropic" | "gemini";

export type LlmRole = "system" | "user" | "assistant";

export type LlmMessage = {
  role: LlmRole;
  content: string;
};

export type TokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type StreamCompletionRequest = {
  model: string;
  messages: LlmMessage[];
  signal?: AbortSignal;
  onToken: (token: string) => void;
};

export type StreamCompletionResult = {
  text: string;
  usage?: TokenUsage;
  finishReason?: string;
};

export type LlmProvider = {
  id: ProviderId;
  label: string;
  models: string[];
  streamCompletion: (request: StreamCompletionRequest) => Promise<StreamCompletionResult>;
};

export type ProviderOption = {
  id: ProviderId;
  label: string;
  configuredByServer: boolean;
  models: string[];
};

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigurationError";
  }
}

export class ProviderRequestError extends Error {
  readonly provider: ProviderId;
  readonly status?: number;
  readonly body?: string;

  constructor(provider: ProviderId, message: string, status?: number, body?: string) {
    super(message);
    this.name = "ProviderRequestError";
    this.provider = provider;
    this.status = status;
    this.body = body;
  }
}

export class ProviderModelListError extends Error {
  readonly provider: ProviderId;
  readonly status?: number;

  constructor(provider: ProviderId, message: string, status?: number) {
    super(message);
    this.name = "ProviderModelListError";
    this.provider = provider;
    this.status = status;
  }
}
