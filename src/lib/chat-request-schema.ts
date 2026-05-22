import { z } from "zod";
import { uiMessageText, type OlliveUIMessage } from "@/lib/chat-ui-messages";

const uiMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["system", "user", "assistant"]),
  metadata: z.unknown().optional(),
  parts: z.array(z.record(z.unknown())).min(1)
});

export const chatRequestSchema = z
  .object({
    id: z.string().nullable().optional(),
    conversationId: z.string().nullable().optional(),
    message: uiMessageSchema,
    provider: z.string().min(1),
    model: z.string().min(1),
    apiKey: z.string().optional()
  })
  .transform((value) => ({
    conversationId: value.conversationId ?? value.id ?? undefined,
    message: value.message as OlliveUIMessage,
    messageText: uiMessageText(value.message as OlliveUIMessage, { trim: true }),
    provider: value.provider,
    model: value.model,
    apiKey: value.apiKey
  }))
  .superRefine((value, context) => {
    if (value.message.role !== "user") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message", "role"],
        message: "Expected the latest chat message to be a user message"
      });
    }

    if (!value.messageText) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message"],
        message: "Message text is required"
      });
    }

    if (value.messageText.length > 4_000) {
      context.addIssue({
        code: z.ZodIssueCode.too_big,
        path: ["message"],
        type: "string",
        maximum: 4_000,
        inclusive: true,
        message: "Message text must be 4,000 characters or fewer"
      });
    }
  });

export type ChatRequestBody = z.infer<typeof chatRequestSchema>;
