import {
  InferenceEventType,
  InferenceStatus,
  Prisma,
  type InferenceLog
} from "@prisma/client";
import { prisma } from "@/lib/db";
import type { InferenceEventPayload } from "./schema";

type InferenceLogSnapshot = Omit<
  Pick<
  InferenceLog,
  | "requestId"
  | "provider"
  | "model"
  | "status"
  | "conversationId"
  | "messageId"
  | "startedAt"
  | "completedAt"
  | "latencyMs"
  | "promptTokens"
  | "completionTokens"
  | "totalTokens"
  | "inputPreview"
  | "outputPreview"
  | "errorType"
  | "errorMessage"
  | "metadata"
  >,
  "metadata"
> & {
  metadata: unknown;
};

const EVENT_TYPE_MAP = {
  started: InferenceEventType.STARTED,
  completed: InferenceEventType.COMPLETED,
  failed: InferenceEventType.FAILED,
  cancelled: InferenceEventType.CANCELLED
} as const;

const STATUS_MAP = {
  started: InferenceStatus.STARTED,
  completed: InferenceStatus.COMPLETED,
  failed: InferenceStatus.FAILED,
  cancelled: InferenceStatus.CANCELLED
} as const;

const TERMINAL_STATUSES = new Set<InferenceStatus>([
  InferenceStatus.COMPLETED,
  InferenceStatus.FAILED,
  InferenceStatus.CANCELLED
]);

export async function processInferenceEvent(payload: InferenceEventPayload) {
  const occurredAt = payload.occurredAt ? new Date(payload.occurredAt) : new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const existingEvent = await tx.inferenceEvent.findUnique({
        where: { eventId: payload.eventId }
      });

      if (existingEvent) {
        return {
          log: await findLogForDuplicateEvent(tx, existingEvent.requestId),
          deduped: true
        };
      }

      await tx.inferenceEvent.create({
        data: {
          eventId: payload.eventId,
          requestId: payload.requestId,
          eventType: EVENT_TYPE_MAP[payload.eventType],
          provider: payload.provider,
          model: payload.model,
          conversationId: payload.conversationId,
          messageId: payload.messageId,
          latencyMs: payload.latencyMs,
          promptTokens: payload.tokenUsage?.promptTokens,
          completionTokens: payload.tokenUsage?.completionTokens,
          totalTokens: payload.tokenUsage?.totalTokens,
          inputPreview: payload.inputPreview,
          outputPreview: payload.outputPreview,
          errorType: payload.error?.type,
          errorMessage: payload.error?.message,
          occurredAt,
          raw: payload as unknown as Prisma.InputJsonValue
        }
      });

      const current = await tx.inferenceLog.findUnique({
        where: { requestId: payload.requestId }
      });

      if (current && TERMINAL_STATUSES.has(current.status) && payload.eventType === "started") {
        return {
          log: current,
          deduped: false
        };
      }

      const next = applyEventToLogSnapshot(current, payload, occurredAt);
      const data = toPrismaLogData(next);

      if (current) {
        return {
          log: await tx.inferenceLog.update({
            where: { requestId: payload.requestId },
            data: toPrismaLogUpdateData(data)
          }),
          deduped: false
        };
      }

      return {
        log: await tx.inferenceLog.create({
          data
        }),
        deduped: false
      };
    });
  } catch (error) {
    if (isUniqueConstraintError(error, "eventId")) {
      return {
        log: await findLogForDuplicateEvent(prisma, payload.requestId, payload.eventId),
        deduped: true
      };
    }

    throw error;
  }
}

export function applyEventToLogSnapshot(
  current: InferenceLogSnapshot | null,
  payload: InferenceEventPayload,
  occurredAt = payload.occurredAt ? new Date(payload.occurredAt) : new Date()
): InferenceLogSnapshot {
  const base: InferenceLogSnapshot = current ?? {
    requestId: payload.requestId,
    provider: payload.provider,
    model: payload.model,
    status: InferenceStatus.STARTED,
    conversationId: null,
    messageId: null,
    startedAt: null,
    completedAt: null,
    latencyMs: null,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    inputPreview: null,
    outputPreview: null,
    errorType: null,
    errorMessage: null,
    metadata: null
  };

  if (current && TERMINAL_STATUSES.has(current.status) && payload.eventType === "started") {
    return base;
  }

  return {
    ...base,
    provider: payload.provider,
    model: payload.model,
    status: STATUS_MAP[payload.eventType],
    conversationId: payload.conversationId ?? base.conversationId,
    messageId: payload.messageId ?? base.messageId,
    startedAt: payload.eventType === "started" ? occurredAt : base.startedAt,
    completedAt: payload.eventType !== "started" ? occurredAt : base.completedAt,
    latencyMs: payload.latencyMs ?? base.latencyMs,
    promptTokens: payload.tokenUsage?.promptTokens ?? base.promptTokens,
    completionTokens: payload.tokenUsage?.completionTokens ?? base.completionTokens,
    totalTokens: payload.tokenUsage?.totalTokens ?? base.totalTokens,
    inputPreview: payload.inputPreview ?? base.inputPreview,
    outputPreview: payload.outputPreview ?? base.outputPreview,
    errorType: payload.error?.type ?? (payload.eventType === "failed" ? "UnknownError" : base.errorType),
    errorMessage: payload.error?.message ?? base.errorMessage,
    metadata: (payload.metadata as Prisma.InputJsonValue | undefined) ?? base.metadata
  };
}

function toPrismaLogData(snapshot: InferenceLogSnapshot): Prisma.InferenceLogUncheckedCreateInput {
  return {
    requestId: snapshot.requestId,
    provider: snapshot.provider,
    model: snapshot.model,
    status: snapshot.status,
    conversationId: snapshot.conversationId,
    messageId: snapshot.messageId,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    latencyMs: snapshot.latencyMs,
    promptTokens: snapshot.promptTokens,
    completionTokens: snapshot.completionTokens,
    totalTokens: snapshot.totalTokens,
    inputPreview: snapshot.inputPreview,
    outputPreview: snapshot.outputPreview,
    errorType: snapshot.errorType,
    errorMessage: snapshot.errorMessage,
    metadata: snapshot.metadata === null ? Prisma.JsonNull : (snapshot.metadata as Prisma.InputJsonValue)
  };
}

function toPrismaLogUpdateData(
  data: Prisma.InferenceLogUncheckedCreateInput
): Prisma.InferenceLogUncheckedUpdateInput {
  const updateData = { ...data } as Prisma.InferenceLogUncheckedUpdateInput & { requestId?: string };
  delete updateData.requestId;
  return updateData;
}

type InferenceLogReader = {
  inferenceEvent: {
    findUnique: (args: { where: { eventId: string } }) => Promise<{ requestId: string } | null>;
  };
  inferenceLog: {
    findUnique: (args: { where: { requestId: string } }) => Promise<InferenceLog | null>;
  };
};

async function findLogForDuplicateEvent(
  client: InferenceLogReader,
  requestId: string,
  eventId?: string
): Promise<InferenceLog> {
  const resolvedRequestId = eventId
    ? (await client.inferenceEvent.findUnique({ where: { eventId } }))?.requestId ?? requestId
    : requestId;
  const log = await client.inferenceLog.findUnique({
    where: { requestId: resolvedRequestId }
  });

  if (!log) {
    throw new Error(`Duplicate inference event found without aggregate log for request ${resolvedRequestId}`);
  }

  return log;
}

function isUniqueConstraintError(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes(field) : target === field;
}
