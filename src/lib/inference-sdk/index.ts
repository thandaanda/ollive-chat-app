import { randomUUID } from "node:crypto";
import { getIngestionToken } from "@/lib/env";
import { previewText, redactPii } from "@/lib/redaction";
import type { InferenceEventPayload } from "@/lib/ingestion/schema";
import type { LlmMessage, TokenUsage } from "@/lib/providers/types";

export type InferenceRequestMetadata = Record<string, unknown>;

export type CreateInferenceRunOptions = {
  provider: string;
  model: string;
  conversationId?: string;
  messageId?: string;
  inputMessages: LlmMessage[];
  baseUrl: string;
  requestMetadata?: InferenceRequestMetadata;
  requestId?: string;
  token?: string;
  now?: () => Date;
  eventIdFactory?: (eventType: InferenceEventPayload["eventType"]) => string;
};

export type CompleteInferenceOptions = {
  output: string;
  usage?: TokenUsage;
  metadata?: InferenceRequestMetadata;
};

export type FailedInferenceOptions = {
  error: unknown;
  output?: string;
  metadata?: InferenceRequestMetadata;
};

export type CancelledInferenceOptions = {
  output?: string;
  metadata?: InferenceRequestMetadata;
};

export type EmitInferenceEventOptions = {
  baseUrl: string;
  token?: string;
};

export function createInferenceRequestId(): string {
  return randomUUID();
}

export function createInferenceRun(options: CreateInferenceRunOptions) {
  const requestId = options.requestId ?? createInferenceRequestId();
  const startedAt = options.now?.() ?? new Date();
  const eventIdFactory = options.eventIdFactory ?? (() => randomUUID());
  const inputPreview = messagesPreview(options.inputMessages);
  const basePayload = {
    requestId,
    provider: options.provider,
    model: options.model,
    conversationId: options.conversationId,
    messageId: options.messageId
  };

  function occurredAt() {
    return options.now?.() ?? new Date();
  }

  function latencyMs(finishedAt: Date) {
    return Math.max(0, finishedAt.getTime() - startedAt.getTime());
  }

  async function emit(payload: Omit<InferenceEventPayload, "eventId">) {
    await emitInferenceEvent(
      {
        eventId: eventIdFactory(payload.eventType),
        ...payload
      },
      {
        baseUrl: options.baseUrl,
        token: options.token
      }
    );
  }

  return {
    requestId,
    startedAt,
    started: () =>
      emit({
        ...basePayload,
        eventType: "started",
        occurredAt: startedAt.toISOString(),
        inputPreview,
        metadata: sanitizeMetadata(options.requestMetadata)
      }),
    completed: ({ output, usage, metadata }: CompleteInferenceOptions) => {
      const finishedAt = occurredAt();
      return emit({
        ...basePayload,
        eventType: "completed",
        occurredAt: finishedAt.toISOString(),
        latencyMs: latencyMs(finishedAt),
        tokenUsage: usage,
        inputPreview,
        outputPreview: output ? previewText(output) : undefined,
        metadata: sanitizeMetadata(metadata)
      });
    },
    failed: ({ error, output = "", metadata }: FailedInferenceOptions) => {
      const finishedAt = occurredAt();
      return emit({
        ...basePayload,
        eventType: "failed",
        occurredAt: finishedAt.toISOString(),
        latencyMs: latencyMs(finishedAt),
        inputPreview,
        outputPreview: output ? previewText(output) : undefined,
        error: errorPayload(error),
        metadata: sanitizeMetadata(metadata)
      });
    },
    cancelled: ({ output = "", metadata }: CancelledInferenceOptions = {}) => {
      const finishedAt = occurredAt();
      return emit({
        ...basePayload,
        eventType: "cancelled",
        occurredAt: finishedAt.toISOString(),
        latencyMs: latencyMs(finishedAt),
        inputPreview,
        outputPreview: output ? previewText(output) : undefined,
        error: {
          type: "AbortError",
          message: "Client cancelled the streaming response"
        },
        metadata: sanitizeMetadata(metadata)
      });
    }
  };
}

export async function emitInferenceEvent(
  payload: InferenceEventPayload,
  options: EmitInferenceEventOptions
): Promise<void> {
  const token = options.token ?? getIngestionToken();
  const url = new URL("/api/ingest/inference", options.baseUrl);
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Ingestion failed with HTTP ${response.status}: ${await response.text()}`);
      }

      return;
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
    }
  }

  console.error("Inference ingestion failed after retry", lastError);
}

export function messagesPreview(messages: LlmMessage[]): string {
  return previewText(messages.map((message) => `${message.role}: ${message.content}`).join("\n"));
}

export function errorPayload(error: unknown) {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: previewText(error.message)
    };
  }

  return {
    type: "UnknownError",
    message: previewText(String(error))
  };
}

function sanitizeMetadata(metadata: InferenceRequestMetadata | undefined): InferenceRequestMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  const sanitizedEntries = Object.entries(metadata).flatMap(([key, value]) => {
    if (isSecretMetadataKey(key) || value === undefined) {
      return [];
    }

    if (typeof value === "string") {
      return [[key, redactPii(value)]];
    }

    return [[key, value]];
  });

  return sanitizedEntries.length ? Object.fromEntries(sanitizedEntries) : undefined;
}

function isSecretMetadataKey(key: string): boolean {
  return /(api[-_]?key|authorization|bearer|secret|token|password)/i.test(key);
}
