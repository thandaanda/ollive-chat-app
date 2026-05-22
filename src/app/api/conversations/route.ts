import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      conversations: [],
      warning: "DATABASE_URL is not configured"
    });
  }

  try {
    const conversations = await prisma.conversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    return NextResponse.json({
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        status: conversation.status.toLowerCase(),
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
        lastMessage: conversation.messages[0]
          ? {
              role: conversation.messages[0].role.toLowerCase(),
              content: conversation.messages[0].content,
              status: conversation.messages[0].status.toLowerCase(),
              createdAt: conversation.messages[0].createdAt.toISOString()
            }
          : null
      }))
    });
  } catch {
    return NextResponse.json({
      conversations: [],
      warning: "Database is not reachable"
    });
  }
}
