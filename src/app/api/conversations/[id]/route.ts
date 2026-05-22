import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" }
      },
      logs: {
        orderBy: { createdAt: "desc" },
        take: 20
      }
    }
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      status: conversation.status.toLowerCase(),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role.toLowerCase(),
        content: message.content,
        provider: message.provider,
        model: message.model,
        status: message.status.toLowerCase(),
        requestId: message.requestId,
        metadata: message.metadata,
        createdAt: message.createdAt.toISOString()
      })),
      logs: conversation.logs.map((log) => ({
        id: log.id,
        requestId: log.requestId,
        provider: log.provider,
        model: log.model,
        status: log.status.toLowerCase(),
        latencyMs: log.latencyMs,
        totalTokens: log.totalTokens,
        errorType: log.errorType,
        errorMessage: log.errorMessage,
        createdAt: log.createdAt.toISOString()
      }))
    }
  });
}
