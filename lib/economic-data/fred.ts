/**
 * St. Louis Fed (FRED) series/observations provider. Generic economic data
 * accessor: it maps a series id to observations and leaves every unit,
 * instrument and analytical semantic to the caller's policy layer.
 *
 * Server-only: the API key is read from process.env.FRED_API_KEY and sent as
 * the FRED `api_key` query parameter. It is never exposed to the client, never
 * logged, and never included in error messages.
 *
 * This module performs network I/O (fetch) and is a legitimate place for FRED
 * data to enter the pipeline. All tests mock fetch.
 */

const OBSERVATIONS_URL = "https://api.stlouisfed.org/fred/series/observations";
const REVALIDATE_SECONDS = 3600;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class FredApiKeyMissingError extends Error {
  constructor() {
    super(
      'FRED_API_KEY is not set. Set it in the server environment only; never expose it to the client.',
    );
    this.name = "FredApiKeyMissingError";
  }
}

export class InvalidFredRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFredRequestError";
  }
}

export class FredHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FredHttpError";
  }
}

export class FredRateLimitError extends Error {
  constructor() {
    super("FRED rate limit reached (HTTP 429), try again shortly.");
    this.name = "FredRateLimitError";
  }
}

export class FredMalformedPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FredMalformedPayloadError";
  }
}

export class InvalidFredObservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFredObservationError";
  }
}

export interface FredObservation {
  date: string;
  value: number;
}

export interface GetSeriesObservationsRequest {
  startDate: string;
  endDate: string;
}

export interface GetSeriesObservationsResult {
  seriesId: string;
  observations: FredObservation[];
  retrievedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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

function assertCanonicalRequestDate(value: unknown, field: string): void {
  if (
    typeof value !== "string" ||
    !DATE_PATTERN.test(value) ||
    !isRealCalendarDate(value)
  ) {
    throw new InvalidFredRequestError(
      `Invalid ${field} "${String(value)}". Expected canonical YYYY-MM-DD.`,
    );
  }
}

function assertSeriesId(seriesId: string): void {
  if (typeof seriesId !== "string" || seriesId.trim() === "") {
    throw new InvalidFredRequestError("A non-empty series id is required.");
  }
}

/**
 * The only accepted missing-observation representation in the FRED V1
 * contract is "." — it is omitted from the output (never coerced to 0 or NaN,
 * never thrown for a routine missing datapoint). Anything else that is not a
 * numeric string — including null, undefined, a missing value property, or a
 * bare number — is an invalid payload, not a missing observation.
 */
function parseValue(
  value: unknown,
  seriesId: string,
  date: string,
): number | undefined {
  if (value === ".") return undefined;
  if (typeof value !== "string") {
    throw new InvalidFredObservationError(
      `FRED value for "${seriesId}" on ${date} must be a numeric string; got ${value === null ? "null" : typeof value}.`,
    );
  }
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    throw new InvalidFredObservationError(
      `FRED returned a non-finite value "${value}" for "${seriesId}" on ${date}.`,
    );
  }
  return parsed;
}

type RevalidatingRequestInit = RequestInit & {
  next?: { revalidate?: number };
};

/**
 * Generic FRED provider: maps a series id and a caller-decided date range to
 * `FredObservation[]` (date + plain number). Units (percent vs decimal) are
 * NOT assumed here — that is the caller's policy/config concern.
 */
export class FredProvider {
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.FRED_API_KEY;
    if (!key) {
      throw new FredApiKeyMissingError();
    }
    this.apiKey = key;
  }

  async getSeriesObservations(
    seriesId: string,
    request: GetSeriesObservationsRequest,
  ): Promise<GetSeriesObservationsResult> {
    assertSeriesId(seriesId);
    assertCanonicalRequestDate(request.startDate, "startDate");
    assertCanonicalRequestDate(request.endDate, "endDate");
    if (request.endDate < request.startDate) {
      throw new InvalidFredRequestError(
        `endDate (${request.endDate}) must be on or after startDate (${request.startDate}).`,
      );
    }

    const params = new URLSearchParams({
      series_id: seriesId,
      api_key: this.apiKey,
      file_type: "json",
      observation_start: request.startDate,
      observation_end: request.endDate,
      sort_order: "asc",
    });
    const url = `${OBSERVATIONS_URL}?${params.toString()}`;

    const init: RevalidatingRequestInit = {
      next: { revalidate: REVALIDATE_SECONDS },
    };

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch {
      throw new FredHttpError("Failed to reach FRED.");
    }

    if (response.status === 429) {
      throw new FredRateLimitError();
    }
    if (!response.ok) {
      throw new FredHttpError(
        `FRED returned HTTP ${response.status}. The URL and api_key are never logged.`,
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new FredMalformedPayloadError("Invalid JSON body from FRED.");
    }

    return parseObservationsPayload(json, seriesId);
  }
}

function parseObservationsPayload(
  value: unknown,
  seriesId: string,
): GetSeriesObservationsResult {
  if (!isRecord(value) || !Array.isArray(value.observations)) {
    throw new FredMalformedPayloadError(
      'FRED observations payload must be an object with an "observations" array.',
    );
  }

  const observations: FredObservation[] = [];
  for (const row of value.observations) {
    if (!isRecord(row)) {
      throw new FredMalformedPayloadError(
        `FRED observation row for "${seriesId}" is not an object.`,
      );
    }
    if (typeof row.date !== "string") {
      throw new InvalidFredObservationError(
        `FRED observation for "${seriesId}" has a non-string date.`,
      );
    }
    if (!DATE_PATTERN.test(row.date) || !isRealCalendarDate(row.date)) {
      throw new InvalidFredObservationError(
        `FRED observation for "${seriesId}" has an invalid date "${row.date}". Expected a real YYYY-MM-DD date.`,
      );
    }
    const parsed = parseValue(row.value, seriesId, row.date);
    if (parsed === undefined) continue;
    observations.push({ date: row.date, value: parsed });
  }

  return {
    seriesId,
    observations,
    retrievedAt: new Date().toISOString(),
  };
}