import { z } from "zod";
import { randomUUID } from "node:crypto";

export const tokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional()
});

export const inferenceEventPayloadSchema = z.object({
  eventId: z.string().min(8).optional().default(() => randomUUID()),
  requestId: z.string().min(8),
  eventType: z.enum(["started", "completed", "failed", "cancelled"]),
  provider: z.string().min(1),
  model: z.string().min(1),
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
  occurredAt: z.string().datetime().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  tokenUsage: tokenUsageSchema.optional(),
  inputPreview: z.string().max(2_000).optional(),
  outputPreview: z.string().max(2_000).optional(),
  error: z
    .object({
      type: z.string().min(1),
      message: z.string().min(1)
    })
    .optional(),
  metadata: z.record(z.unknown()).optional()
});

export type InferenceEventPayload = z.infer<typeof inferenceEventPayloadSchema>;
