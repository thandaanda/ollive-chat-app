import { NextResponse } from "next/server";
import { z } from "zod";
import { listProviderModels } from "@/lib/providers";
import { ProviderConfigurationError, ProviderModelListError } from "@/lib/providers/types";

export const runtime = "nodejs";

const providerModelsRequestSchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().trim().min(1)
});

export async function POST(request: Request) {
  let body: z.infer<typeof providerModelsRequestSchema>;

  try {
    const parsed = providerModelsRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid provider model request" }, { status: 400 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const models = await listProviderModels(body.provider, body.apiKey);
    return NextResponse.json({ models });
  } catch (error) {
    if (error instanceof ProviderConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof ProviderModelListError) {
      return NextResponse.json({ error: error.message }, { status: error.status === 401 ? 401 : 502 });
    }

    return NextResponse.json({ error: "Provider model lookup failed" }, { status: 502 });
  }
}
