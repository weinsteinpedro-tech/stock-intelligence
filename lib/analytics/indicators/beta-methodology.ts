import type { IndicatorDataWindow } from "../types";

/**
 * Beta V1 configuration layer.
 *
 * Separates the BETA MATH (beta.ts: calculateBetaFromReturns, betaIndicator)
 * from the METHODOLOGY the application chooses (lookback, frequency, price
 * basis, benchmark). This module is provider-agnostic: no Tiingo / Alpha
 * Vantage / DataSource names appear anywhere. The caller supplies a
 * BenchmarkDefinition; the benchmark symbol is a caller decision and is never
 * hardcoded here.
 */

export type BetaLookbackUnit = "months" | "years";

export interface BetaLookback {
  unit: BetaLookbackUnit;
  value: number;
}

/**
 * Structural mirror of the benchmark contract used by the data-layer builders.
 * Defined here so analytics never imports the data-layer builder modules; the
 * two shapes are interchangeable at the caller.
 */
export interface BenchmarkDefinition {
  /** Stable application identifier for the benchmark. */
  id: string;
  /** Exchange symbol (whatever the caller passes). */
  symbol: string;
  name?: string;
}

/** V1 only supports daily frequency. */
export type BetaFrequency = "daily";
/** V1 only supports adjusted_close as the price basis. */
export type BetaPriceBasis = "adjusted_close";

export interface BetaMethodology {
  benchmark: BenchmarkDefinition;
  lookback: BetaLookback;
  frequency: BetaFrequency;
  priceBasis: BetaPriceBasis;
}

export interface BetaMethodologySnapshot {
  benchmarkId: string;
  benchmarkSymbol: string;
  lookback: BetaLookback;
  frequency: BetaFrequency;
  priceBasis: BetaPriceBasis;
}

export interface BetaDateRange {
  startDate: string;
  endDate: string;
}

export interface BetaExecutionTrace {
  methodologySnapshot: BetaMethodologySnapshot;
  requestedRange: BetaDateRange;
  /** Actual aligned window computed by the Beta indicator. */
  actualDataWindow: IndicatorDataWindow | undefined;
}

export class InvalidBetaMethodologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBetaMethodologyError";
  }
}

export class InvalidBetaDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBetaDateError";
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

function assertCanonicalDate(value: unknown, field: string): void {
  if (typeof value !== "string" || !DATE_PATTERN.test(value) || !isRealCalendarDate(value)) {
    throw new InvalidBetaDateError(
      `Invalid ${field} "${String(value)}". Expected canonical YYYY-MM-DD.`,
    );
  }
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Deterministic calendar arithmetic on canonical YYYY-MM-DD. Handles leap
 * years (a Feb-29 asOf rewinds to Feb-28 in a non-leap year) and month/year
 * boundaries without Date.parse.
 */
function addMonths(dateStr: string, months: number): string {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  const totalMonths = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return formatDate(targetYear, targetMonth, targetDay);
}

/**
 * Single source of truth for BetaMethodology validation. Every public API that
 * consumes a BetaMethodology (createBetaMethodology, resolveBetaDateRange,
 * snapshotBetaMethodology, traceBetaExecution) calls this, so objects arriving
 * from JSON/persistence/plain JavaScript are rejected deterministically even
 * when they never passed through the factory.
 */
export function validateBetaMethodology(methodology: BetaMethodology): void {
  if (
    typeof methodology.benchmark?.id !== "string" ||
    methodology.benchmark.id.length === 0
  ) {
    throw new InvalidBetaMethodologyError(
      "Beta methodology requires a non-empty benchmark id.",
    );
  }
  if (
    typeof methodology.benchmark?.symbol !== "string" ||
    methodology.benchmark.symbol.length === 0
  ) {
    throw new InvalidBetaMethodologyError(
      "Beta methodology requires a non-empty benchmark symbol.",
    );
  }
  const { unit, value } = methodology.lookback;
  if (unit !== "months" && unit !== "years") {
    throw new InvalidBetaMethodologyError(
      `Beta methodology lookback unit must be "months" or "years"; got "${String(unit)}".`,
    );
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new InvalidBetaMethodologyError(
      `Beta methodology lookback value must be a positive integer; got ${String(value)}.`,
    );
  }
  if (methodology.frequency !== "daily") {
    throw new InvalidBetaMethodologyError(
      `Beta V1 only supports daily frequency; got "${String(methodology.frequency)}". No resampling.`,
    );
  }
  if (methodology.priceBasis !== "adjusted_close") {
    throw new InvalidBetaMethodologyError(
      `Beta V1 only supports the adjusted_close price basis; got "${String(methodology.priceBasis)}".`,
    );
  }
}

export interface CreateBetaMethodologyInput {
  benchmark: BenchmarkDefinition;
  /** V1 default lookback: 1 year. */
  lookbackYears?: number;
  frequency?: BetaFrequency;
  priceBasis?: BetaPriceBasis;
}

export function createBetaMethodology(
  input: CreateBetaMethodologyInput,
): BetaMethodology {
  const methodology: BetaMethodology = {
    benchmark: input.benchmark,
    lookback: {
      unit: "years",
      value: input.lookbackYears ?? 1,
    },
    frequency: input.frequency ?? "daily",
    priceBasis: input.priceBasis ?? "adjusted_close",
  };
  validateBetaMethodology(methodology);
  return methodology;
}

export function resolveBetaDateRange(input: {
  asOf: string;
  methodology: BetaMethodology;
}): BetaDateRange {
  validateBetaMethodology(input.methodology);
  assertCanonicalDate(input.asOf, "asOf");
  const offsetMonths =
    input.methodology.lookback.value *
    (input.methodology.lookback.unit === "years" ? 12 : 1);
  return {
    startDate: addMonths(input.asOf, -offsetMonths),
    endDate: input.asOf,
  };
}

export function snapshotBetaMethodology(
  methodology: BetaMethodology,
): BetaMethodologySnapshot {
  validateBetaMethodology(methodology);
  return {
    benchmarkId: methodology.benchmark.id,
    benchmarkSymbol: methodology.benchmark.symbol,
    lookback: {
      unit: methodology.lookback.unit,
      value: methodology.lookback.value,
    },
    frequency: methodology.frequency,
    priceBasis: methodology.priceBasis,
  };
}

export function traceBetaExecution(input: {
  methodology: BetaMethodology;
  asOf: string;
  calculation: { dataWindow?: IndicatorDataWindow };
}): BetaExecutionTrace {
  validateBetaMethodology(input.methodology);
  return {
    methodologySnapshot: snapshotBetaMethodology(input.methodology),
    requestedRange: resolveBetaDateRange({
      asOf: input.asOf,
      methodology: input.methodology,
    }),
    actualDataWindow: input.calculation.dataWindow,
  };
}