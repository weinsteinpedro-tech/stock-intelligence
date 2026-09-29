import type {
  HistoricalPrice,
  MarketDataProvider,
  StockMatch,
} from "./types";

const API_BASE = "https://www.alphavantage.co/query";
const REVALIDATE_SECONDS = 900;

interface AlphaVantageSearchResult {
  "1. symbol": string;
  "2. name": string;
  "4. region": string;
  "8. currency": string;
}

interface AlphaVantageDailyResult {
  "1. open": string;
  "2. high": string;
  "3. low": string;
  "4. close": string;
  "5. volume": string;
}

function parseNumber(value: string | undefined): number | null {
  if (!value || value === "None") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Temporary diagnostic helper. Returns "" unless the value is really a
// string, trimmed, capped at 500 characters. Never prints keys, URLs,
// params, headers, environment variables or the full response.
function safeString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 500);
}

function logAlphaVantageDiagnostics(record: Record<string, unknown>): void {
  const note = safeString(record["Note"]);
  const information = safeString(record["Information"]);
  const errorMessage = safeString(record["Error Message"]);
  if (!note && !information && !errorMessage) return;
  console.error("[alpha-vantage-provider]", {
    note,
    information,
    errorMessage,
  });
}

export class AlphaVantageProvider implements MarketDataProvider {
  private readonly apiKey: string;

  constructor() {
    const key = process.env.ALPHA_VANTAGE_API_KEY;
    if (!key) {
      throw new Error("ALPHA_VANTAGE_API_KEY is not set");
    }
    this.apiKey = key;
  }

  async searchSymbols(query: string): Promise<StockMatch[]> {
    const params = new URLSearchParams({
      function: "SYMBOL_SEARCH",
      keywords: query,
      apikey: this.apiKey,
    });

    const data = await this.fetchJson(params);
    const bestMatches = data.bestMatches as
      | AlphaVantageSearchResult[]
      | undefined;

    if (!Array.isArray(bestMatches)) {
      return [];
    }

    return bestMatches
      .slice(0, 8)
      .map((result) => ({
        symbol: result["1. symbol"] ?? "",
        name: result["2. name"] ?? "",
        region: result["4. region"] || null,
        currency: result["8. currency"] || null,
      }))
      .filter((result) => result.symbol !== "");
  }

  async getDailySeries(symbol: string): Promise<HistoricalPrice[]> {
    const params = new URLSearchParams({
      function: "TIME_SERIES_DAILY",
      symbol,
      outputsize: "compact",
      apikey: this.apiKey,
    });

    const data = await this.fetchJson(params);
    const timeSeries = data["Time Series (Daily)"] as
      | Record<string, AlphaVantageDailyResult>
      | undefined;

    if (!timeSeries || typeof timeSeries !== "object") {
      console.error("[alpha-vantage-provider]", {
        context: "missing-time-series",
        keys: Object.keys(data).slice(0, 20),
        note: safeString(data["Note"]),
        information: safeString(data["Information"]),
        errorMessage: safeString(data["Error Message"]),
      });
      return [];
    }

    const parsed: HistoricalPrice[] = [];
    for (const date of Object.keys(timeSeries)) {
      const day = timeSeries[date];
      if (!day) continue;
      parsed.push({
        date,
        open: parseNumber(day["1. open"]),
        high: parseNumber(day["2. high"]),
        low: parseNumber(day["3. low"]),
        close: parseNumber(day["4. close"]),
        volume: parseNumber(day["5. volume"]),
      });
    }

    if (parsed.length === 0) {
      console.error("[alpha-vantage-provider]", {
        context: "empty-parsed-series",
        timeSeriesEntries: Object.keys(timeSeries).length,
      });
    }

    parsed.sort((a, b) => a.date.localeCompare(b.date));

    return parsed;
  }

  private async fetchJson(
    params: URLSearchParams,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}?${params.toString()}`, {
        next: { revalidate: REVALIDATE_SECONDS },
      });
    } catch {
      throw new Error("Failed to reach Alpha Vantage");
    }

    if (response.status === 429) {
      throw new Error("Alpha Vantage rate limit reached");
    }

    if (!response.ok) {
      throw new Error(`Alpha Vantage returned ${response.status}`);
    }

    let json: Record<string, unknown>;
    try {
      json = await response.json();
    } catch {
      throw new Error("Invalid response from Alpha Vantage");
    }

    if (!json || typeof json !== "object") {
      throw new Error("Invalid response from Alpha Vantage");
    }

    const record = json as Record<string, unknown>;
    const note = record["Note"];
    const information = record["Information"];
    const errorMessage = record["Error Message"];

    if (typeof note === "string" && note.toLowerCase().includes("rate")) {
      logAlphaVantageDiagnostics(record);
      throw new Error("Alpha Vantage rate limit reached, try again shortly");
    }

    if (
      typeof information === "string" &&
      (information.toLowerCase().includes("limit") ||
        information.toLowerCase().includes("premium") ||
        information.toLowerCase().includes("apikey") ||
        information.toLowerCase().includes("invalid"))
    ) {
      logAlphaVantageDiagnostics(record);
      throw new Error("Alpha Vantage rate limit or API key error");
    }

    if (typeof errorMessage === "string" && errorMessage) {
      logAlphaVantageDiagnostics(record);
      throw new Error("Alpha Vantage returned an error for this request");
    }

    return record;
  }
}
