import { NextResponse } from "next/server";
import { getMarketDataProvider } from "@/lib/market-data";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json({ matches: [] });
  }

  try {
    const provider = getMarketDataProvider();
    const matches = await provider.searchSymbols(query);
    return NextResponse.json({ matches });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isRateLimit = message.toLowerCase().includes("rate limit");
    const isNetwork = message.toLowerCase().includes("reach");
    const status = isRateLimit ? 429 : isNetwork ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
