import { NextResponse } from "next/server";
import { getIngestionToken } from "@/lib/env";
import { processInferenceEvent } from "@/lib/ingestion/processor";
import { inferenceEventPayloadSchema } from "@/lib/ingestion/schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expectedToken = getIngestionToken();
  const authHeader = request.headers.get("authorization");
  const actualToken = authHeader?.replace(/^Bearer\s+/i, "");

  if (!actualToken || actualToken !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = inferenceEventPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid inference event",
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const result = await processInferenceEvent(parsed.data);
  return NextResponse.json({
    ok: true,
    requestId: result.log.requestId,
    status: result.log.status.toLowerCase(),
    deduped: result.deduped
  });
}
