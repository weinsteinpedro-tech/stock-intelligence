import { NextResponse } from "next/server";
import {
  analyzeFutureFactors,
  GeminiAnalysisError,
  sanitizeMessage,
} from "@/lib/ai/gemini";
import { marketSnapshotSchema } from "@/lib/ai/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON.", code: "invalid_request" },
      { status: 400 },
    );
  }

  const parsed = marketSnapshotSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Request body is not a valid stock snapshot.", code: "invalid_request" },
      { status: 400 },
    );
  }

  let result: Awaited<ReturnType<typeof analyzeFutureFactors>>;
  try {
    result = await analyzeFutureFactors(parsed.data);
  } catch (error) {
    if (error instanceof GeminiAnalysisError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: statusForCode(error.code) },
      );
    }
    // Server-side only; the browser always receives the generic message.
    console.error("[analyze]", {
      name: error instanceof Error ? error.name : typeof error,
      message: sanitizeMessage(
        error instanceof Error ? error.message : String(error),
      ),
      stage: undefined,
      code: undefined,
    });
    return NextResponse.json(
      { error: "The AI analysis could not be completed.", code: "server_error" },
      { status: 500 },
    );
  }

  return NextResponse.json(result);
}

function statusForCode(code: string): number {
  switch (code) {
    case "invalid_request":
      return 400;
    case "rate_limit":
      return 429;
    case "network_error":
      return 502;
    case "gemini_unavailable":
      return 503;
    case "service_unavailable":
      return 503;
    case "insufficient_evidence":
      return 422;
    case "invalid_response":
      return 500;
    default:
      return 500;
  }
}