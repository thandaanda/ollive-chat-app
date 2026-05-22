import { MessageRole, MessageStatus } from "@prisma/client";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  smoothStream,
  streamText,
  type FinishReason
} from "ai";
import { getAppUrl } from "@/lib/env";
import { prisma } from "@/lib/db";
import { isDatabaseUnavailableError } from "@/lib/db-errors";
import { chatRequestSchema, type ChatRequestBody } from "@/lib/chat-request-schema";
import {
  languageModelUsageToTokenUsage,
  prismaMessageToUiMessage,
  uiMessageText,
  uiMessagesToLlmMessages,
  type OlliveUIMessage
} from "@/lib/chat-ui-messages";
import { createInferenceRequestId, createInferenceRun } from "@/lib/inference-sdk";
import { resolveAiSdkLanguageModel } from "@/lib/providers";
import { ProviderConfigurationError } from "@/lib/providers/types";
import type { LlmMessage, TokenUsage } from "@/lib/providers/types";

export const runtime = "nodejs";

const SYSTEM_PROMPT =
  "You are a concise assistant inside an LLM inference logging demo. Answer directly and avoid collecting sensitive personal data.";

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  let body: ChatRequestBody;

  try {
    const parsed = chatRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid chat request", issues: parsed.error.flatten() }, { status: 400 });
    }
    body = parsed.data;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let model;
  try {
    model = resolveAiSdkLanguageModel(body.provider, body.model, body.apiKey);
  } catch (error) {
    if (error instanceof ProviderConfigurationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const requestOrigin = new URL(request.url).origin;
  const baseUrl = getAppUrl(request.headers.get("origin") ?? requestOrigin);
  const requestId = createInferenceRequestId();

  let preparedConversation: Awaited<ReturnType<typeof prepareConversation>>;
  try {
    preparedConversation = await prepareConversation(body, requestId);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return Response.json(
        {
          error: "Database is not reachable. Start Postgres and run `pnpm db:push` before chatting."
        },
        { status: 503 }
      );
    }

    throw error;
  }

  const { conversation, history, userMessage, assistantMessage } = preparedConversation;
  const originalMessages: OlliveUIMessage[] = [
    ...history.map(prismaMessageToUiMessage),
    prismaMessageToUiMessage(userMessage)
  ];
  const previewMessages: LlmMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...uiMessagesToLlmMessages(originalMessages)
  ];
  const inferenceRun = createInferenceRun({
    requestId,
    provider: body.provider,
    model: body.model,
    conversationId: conversation.id,
    messageId: assistantMessage.id,
    inputMessages: previewMessages,
    baseUrl,
    requestMetadata: {
      contextMessageCount: previewMessages.length,
      userAgent: request.headers.get("user-agent") ?? undefined
    }
  });
  const startedAt = inferenceRun.startedAt;

  let capturedError: unknown;
  let capturedAbort = false;
  let finishReason: FinishReason | undefined;
  let tokenUsage: TokenUsage | undefined;
  let terminalEventEmitted = false;

  async function finalizeTerminalEvent({
    status,
    output,
    error
  }: {
    status: "completed" | "failed" | "cancelled";
    output: string;
    error?: unknown;
  }) {
    if (terminalEventEmitted) {
      return;
    }
    terminalEventEmitted = true;

    const messageStatus =
      status === "completed"
        ? MessageStatus.COMPLETE
        : status === "cancelled"
          ? MessageStatus.CANCELLED
          : MessageStatus.FAILED;

    const errorMessage = status === "failed" ? sanitizeStreamError(error) : undefined;
    await prisma.chatMessage.update({
      where: { id: assistantMessage.id },
      data: {
        content: status === "failed" && !output ? errorMessage ?? "Provider request failed" : output,
        status: messageStatus,
        metadata: {
          finishReason: finishReason ?? null,
          errorMessage: errorMessage ?? null
        }
      }
    });

    if (status === "cancelled") {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: "CANCELLED" }
      });
    }

    const metadata = {
      finishReason: finishReason ?? null
    };

    if (status === "completed") {
      await inferenceRun.completed({ output, usage: tokenUsage, metadata });
      return;
    }

    if (status === "cancelled") {
      await inferenceRun.cancelled({ output, metadata });
      return;
    }

    await inferenceRun.failed({ output, error, metadata });
  }

  const stream = createUIMessageStream<OlliveUIMessage>({
    execute: async ({ writer }) => {
      writer.write({
        type: "data-chat-meta",
        data: {
          requestId,
          conversationId: conversation.id,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id
        },
        transient: true
      });

      await inferenceRun.started();

      try {
        const result = streamText({
          model,
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(originalMessages),
          abortSignal: request.signal,
          temperature: 0.4,
          experimental_transform: smoothStream({ delayInMs: 20, chunking: "word" }),
          providerOptions: body.provider === "openai" ? { openai: { store: false } } : undefined,
          onFinish: (event) => {
            finishReason = event.finishReason;
            tokenUsage = languageModelUsageToTokenUsage(event.totalUsage);
          },
          onError: ({ error }) => {
            capturedError = error;
          },
          onAbort: () => {
            capturedAbort = true;
          }
        });

        writer.merge(
          result.toUIMessageStream<OlliveUIMessage>({
            originalMessages,
            generateMessageId: () => assistantMessage.id,
            sendReasoning: false,
            messageMetadata: ({ part }) => {
              if (part.type === "start") {
                return {
                  provider: body.provider,
                  model: body.model,
                  status: "streaming",
                  requestId,
                  createdAt: startedAt.toISOString()
                };
              }

              if (part.type === "finish") {
                return {
                  provider: body.provider,
                  model: body.model,
                  status: capturedError ? "failed" : "complete",
                  requestId
                };
              }

              return undefined;
            },
            onFinish: async ({ responseMessage, isAborted, finishReason: uiFinishReason }) => {
              finishReason = finishReason ?? uiFinishReason;
              const output = uiMessageText(responseMessage);
              const cancelled = isAborted || capturedAbort || request.signal.aborted;

              if (cancelled) {
                await finalizeTerminalEvent({ status: "cancelled", output });
                return;
              }

              if (capturedError) {
                await finalizeTerminalEvent({ status: "failed", output, error: capturedError });
                return;
              }

              await finalizeTerminalEvent({ status: "completed", output });
            },
            onError: (error) => {
              capturedError = error;
              return sanitizeStreamError(error);
            }
          })
        );
      } catch (error) {
        capturedError = error;
        await finalizeTerminalEvent({ status: "failed", output: "", error });
        throw error;
      }
    },
    onError: (error) => {
      capturedError = error;
      return sanitizeStreamError(error);
    }
  });

  return createUIMessageStreamResponse({ stream });
}

async function prepareConversation(body: ChatRequestBody, requestId: string) {
  const conversation = body.conversationId
    ? await prisma.conversation.update({
        where: { id: body.conversationId },
        data: { status: "ACTIVE" }
      })
    : await prisma.conversation.create({
        data: {
          title: titleFromMessage(body.messageText)
        }
      });

  const history = await prisma.chatMessage.findMany({
    where: {
      conversationId: conversation.id,
      status: { in: [MessageStatus.COMPLETE, MessageStatus.CANCELLED] }
    },
    orderBy: { createdAt: "desc" },
    take: 9
  });

  const userMessage = await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: MessageRole.USER,
      content: body.messageText,
      status: MessageStatus.COMPLETE,
      provider: body.provider,
      model: body.model
    }
  });

  const assistantMessage = await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: MessageRole.ASSISTANT,
      content: "",
      status: MessageStatus.STREAMING,
      provider: body.provider,
      model: body.model,
      requestId
    }
  });

  return {
    conversation,
    history: history.reverse(),
    userMessage,
    assistantMessage
  };
}

function titleFromMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  if (compact.length <= 48) {
    return compact;
  }

  return `${compact.slice(0, 47).trimEnd()}...`;
}

function sanitizeStreamError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || "Provider request failed";
  }

  if (isRecord(error)) {
    const message = firstStringValue(error, ["message", "statusText"]);
    if (message) {
      return message;
    }

    const cause = error.cause;
    if (cause) {
      return sanitizeStreamError(cause);
    }
  }

  return "Provider request failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function firstStringValue(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return undefined;
}
