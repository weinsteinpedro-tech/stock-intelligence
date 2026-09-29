import type {
  HistoricalPrice,
  HistoricalPriceRequest,
  HistoryMarketDataProvider,
  StockMatch,
} from "./types";

/**
 * Tiingo EOD provider (server-side). Returns vendor-adjusted historical
 * prices.
 *
 * Adjusted semantics:
 * - Tiingo's adjClose reflects corporate-action adjustments as computed by
 *   the vendor, including splits and dividends.
 * - This provider only TRANSPORTS that value; analytics never recomputes
 *   corporate-action adjustments.
 * - close and adjustedClose are never mixed: the caller opts into a single
 *   price basis via the financial-data adapter (priceBasis).
 *
 * Server-only: the token is read from process.env.TIINGO_API_KEY and sent as
 * an Authorization header. It is never part of the URL, never exposed to the
 * client, and never logged.
 *
 * This module performs network I/O (fetch) and is a legitimate place for
 * Tiingo EOD data to enter the pipeline.
 */

const DAILY_BASE_URL = "https://api.tiingo.com/tiingo/daily";
const SEARCH_URL = "https://api.tiingo.com/tiingo/utilities/search";
const REVALIDATE_SECONDS = 900;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ISO_TIME_SUFFIX_PATTERN =
  /^T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/;

export class TiingoApiKeyMissingError extends Error {
  constructor() {
    super(
      'TIINGO_API_KEY is not set. Set it in the server environment only; never expose it to the client.',
    );
    this.name = "TiingoApiKeyMissingError";
  }
}

export class TiingoHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TiingoHttpError";
  }
}

export class TiingoMalformedPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TiingoMalformedPayloadError";
  }
}

export class TiingoMissingAdjustedCloseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TiingoMissingAdjustedCloseError";
  }
}

export class TiingoInvalidNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TiingoInvalidNumberError";
  }
}

export class TiingoInvalidDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TiingoInvalidDateError";
  }
}

export class TiingoInvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TiingoInvalidRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function assertSymbol(symbol: string): void {
  if (typeof symbol !== "string" || symbol.trim() === "") {
    throw new TiingoInvalidRequestError("A non-empty symbol is required.");
  }
}

/**
 * Deterministic real-calendar check: parses Y/M/D and round-trips through
 * Date.UTC. Impossible dates (2026-02-30, 2026-02-29, month 00/13, day 00)
 * normalize to a different date and fail; real leap days (2024-02-29) pass.
 */
function isRealCalendarDate(date: string): boolean {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() + 1 === month &&
    roundTrip.getUTCDate() === day
  );
}

/**
 * Request-date validation. Accepts ONLY the exact canonical YYYY-MM-DD form
 * (verified as a real calendar date). Rejects timestamps, non-zero-padded
 * dates, slashes, and impossible calendar dates.
 */
function assertCanonicalRequestDate(value: unknown, field: string): void {
  if (
    typeof value !== "string" ||
    !DATE_PATTERN.test(value) ||
    !isRealCalendarDate(value)
  ) {
    throw new TiingoInvalidDateError(
      `Invalid ${field} "${String(value)}". Expected canonical YYYY-MM-DD.`,
    );
  }
}

/**
 * Provider-response date normalization. Tiingo returns ISO timestamps
 * (e.g. "2026-06-01T00:00:00.000Z") or plain dates; the extracted
 * YYYY-MM-DD part must be a real calendar date. Rejects impossible dates,
 * garbage, and non-string values. Never trusts the first 10 characters alone.
 */
function canonicaliseProviderDate(value: unknown): string {
  if (typeof value !== "string") {
    throw new TiingoInvalidDateError(
      `Tiingo returned a non-string date: ${String(value)}.`,
    );
  }
  if (value.length < 10) {
    throw new TiingoInvalidDateError(
      `Tiingo returned an invalid date "${value}".`,
    );
  }
  const date = value.slice(0, 10);
  if (!DATE_PATTERN.test(date) || !isRealCalendarDate(date)) {
    throw new TiingoInvalidDateError(
      `Tiingo returned an invalid date "${value}". Expected a real YYYY-MM-DD date.`,
    );
  }
  const remainder = value.slice(10);
  if (remainder !== "" && !ISO_TIME_SUFFIX_PATTERN.test(remainder)) {
    throw new TiingoInvalidDateError(
      `Tiingo returned an invalid date "${value}". Expected YYYY-MM-DD or an ISO timestamp.`,
    );
  }
  return date;
}

function parseRequiredFinite(
  value: unknown,
  field: string,
  symbol: string,
): number {
  if (!isFiniteNumber(value)) {
    throw new TiingoInvalidNumberError(
      `Tiingo returned a non-finite ${field} for "${symbol}".`,
    );
  }
  return value;
}

function parseRequiredPositive(
  value: unknown,
  field: string,
  symbol: string,
): number {
  const numberValue = parseRequiredFinite(value, field, symbol);
  if (numberValue <= 0) {
    throw new TiingoInvalidNumberError(
      `Tiingo returned ${field} <= 0 for "${symbol}".`,
    );
  }
  return numberValue;
}

type RevalidatingRequestInit = RequestInit & {
  next?: { revalidate?: number };
};

export interface TiingoSourceShape {
  provider: "tiingo";
  originalSource: "Tiingo EOD Composite";
  identifier: string;
}

/**
 * Provenance helper for Tiingo data. `originalSource` is kept honest
 * ("Tiingo EOD Composite") — no exchange/SIP claim is invented. `retrievedAt`
 * is supplied by the request-executing layer at call time.
 */
export function makeTiingoSource(symbol: string): TiingoSourceShape {
  return {
    provider: "tiingo",
    originalSource: "Tiingo EOD Composite",
    identifier: symbol,
  };
}

export class TiingoProvider implements HistoryMarketDataProvider {
  private readonly apiKey: string;

  constructor() {
    const key = process.env.TIINGO_API_KEY;
    if (!key) {
      throw new TiingoApiKeyMissingError();
    }
    this.apiKey = key;
  }

  async searchSymbols(query: string): Promise<StockMatch[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const params = new URLSearchParams({ query: trimmed });
    const data = await this.fetchJsonWithAuth(`${SEARCH_URL}?${params.toString()}`);
    if (!Array.isArray(data)) {
      throw new TiingoMalformedPayloadError(
        "Tiingo search response must be an array.",
      );
    }
    return data
      .filter(isRecord)
      .map((row) => ({
        symbol: String(row.ticker ?? ""),
        name: String(row.name ?? ""),
        region: null,
        currency: null,
      }))
      .filter((match) => match.symbol !== "");
  }

  async getDailySeries(symbol: string): Promise<HistoricalPrice[]> {
    assertSymbol(symbol);
    return this.requestEod(symbol, new URLSearchParams());
  }

  async getHistoricalPrices(
    symbol: string,
    request: HistoricalPriceRequest,
  ): Promise<HistoricalPrice[]> {
    assertSymbol(symbol);
    assertCanonicalRequestDate(request.startDate, "startDate");
    assertCanonicalRequestDate(request.endDate, "endDate");
    if (request.endDate < request.startDate) {
      throw new TiingoInvalidRequestError(
        `endDate (${request.endDate}) must be on or after startDate (${request.startDate}).`,
      );
    }
    const params = new URLSearchParams({
      startDate: request.startDate,
      endDate: request.endDate,
    });
    return this.requestEod(symbol, params);
  }

  private async requestEod(
    symbol: string,
    params: URLSearchParams,
  ): Promise<HistoricalPrice[]> {
    const encoded = encodeURIComponent(symbol.trim().toUpperCase());
    const query = params.toString();
    const url = `${DAILY_BASE_URL}/${encoded}/prices${query ? `?${query}` : ""}`;
    const data = await this.fetchJsonWithAuth(url);
    if (!Array.isArray(data)) {
      throw new TiingoMalformedPayloadError(
        "Tiingo EOD response must be an array.",
      );
    }
    return data.map((row) => this.parseEodRow(row, symbol));
  }

  private parseEodRow(value: unknown, symbol: string): HistoricalPrice {
    if (!isRecord(value)) {
      throw new TiingoMalformedPayloadError(
        `Tiingo EOD row for "${symbol}" is not an object.`,
      );
    }
    const date = canonicaliseProviderDate(value.date);
    const open = parseRequiredFinite(value.open, "open", symbol);
    const high = parseRequiredFinite(value.high, "high", symbol);
    const low = parseRequiredFinite(value.low, "low", symbol);
    const close = parseRequiredPositive(value.close, "close", symbol);
    const volume = parseRequiredFinite(value.volume, "volume", symbol);
    if (!("adjClose" in value)) {
      throw new TiingoMissingAdjustedCloseError(
        `Tiingo EOD row for "${symbol}" on ${date} has no adjClose. Mapping it without adjusted data would be partial.`,
      );
    }
    const adjustedClose = parseRequiredPositive(
      value.adjClose,
      "adjClose",
      symbol,
    );
    return {
      date,
      open,
      high,
      low,
      close,
      adjustedClose,
      volume,
    };
  }

  private async fetchJsonWithAuth(url: string): Promise<unknown> {
    const init: RevalidatingRequestInit = {
      headers: {
        Authorization: `Token ${this.apiKey}`,
      },
      next: { revalidate: REVALIDATE_SECONDS },
    };

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch {
      throw new TiingoHttpError("Failed to reach Tiingo");
    }

    if (response.status === 429) {
      throw new TiingoHttpError(
        "Tiingo rate limit reached, try again shortly",
      );
    }

    if (!response.ok) {
      throw new TiingoHttpError(`Tiingo returned HTTP ${response.status}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new TiingoMalformedPayloadError(
        "Invalid JSON body from Tiingo.",
      );
    }
    return json;
  }
}