import type { DataEnvelope, DataSource } from "../types";
import type { DataQuality } from "../quality";
import { isValidDataSource } from "../provenance";
import type { AnnualDecimalRate } from "../rates/risk-free-rate";

/**
 * Expected market return V1 — methodology + pure estimator (provider-agnostic,
 * no network).
 *
 * Prepares the CAPM input `expected_market_return` as a DataEnvelope<AnnualDecimalRate>
 * already normalized to { rate, period: "annual", representation: "decimal" }.
 *
 * V1 estimates it from a caller-provided benchmark price series (adjusted-close
 * total-return prices) using ten consecutive anniversary-to-anniversary
 * annual simple returns, aggregated by ARITHMETIC MEAN. It explicitly does NOT
 * use CAGR, mean-daily*252 annualization, geometric mean or anything else.
 *
 * The benchmark is a caller decision and is NEVER hardcoded here; no provider,
 * symbol or index policy belongs to this module. CAPM keeps knowing only
 * DataEnvelope<AnnualDecimalRate> and performs no conversion.
 */

export const EXPECTED_MARKET_RETURN_LOOKBACK_YEARS = 10 as const;
export const EXPECTED_MARKET_RETURN_MAX_ANCHOR_STALENESS_DAYS = 7 as const;

export interface ExpectedMarketReturnBenchmark {
  id: string;
  symbol: string;
  name?: string;
}

export interface ExpectedMarketReturnMethodology {
  benchmark: ExpectedMarketReturnBenchmark;
  lookbackYears: 10;
  priceBasis: "adjusted_close";
  annualReturnMethod: "anniversary_to_anniversary";
  aggregation: "arithmetic_mean";
  maxAnchorStalenessDays: 7;
}

export interface ExpectedMarketReturnPricePoint {
  date: string;
  value: number;
}

/** Structural PriceSeries: adjusted-close {date, value} points + asset id. */
export interface ExpectedMarketReturnPriceSeries {
  assetId: string;
  points: ExpectedMarketReturnPricePoint[];
}

export interface AnnualAnchorPoint {
  targetDate: string;
  selectedDate: string;
  value: number;
}

export interface AnnualSimpleReturn {
  startDate: string;
  endDate: string;
  value: number;
}

export interface ExpectedMarketReturnSnapshot {
  benchmarkId: string;
  benchmarkSymbol: string;
  lookbackYears: 10;
  priceBasis: "adjusted_close";
  annualReturnMethod: "anniversary_to_anniversary";
  aggregation: "arithmetic_mean";
  maxAnchorStalenessDays: 7;
}

export interface ExpectedMarketReturnTrace {
  methodologySnapshot: ExpectedMarketReturnSnapshot;
  requestedRange: { startDate: string; endDate: string };
  dataRequestRange: { startDate: string; endDate: string };
  anchorCount: number;
  annualReturnCount: number;
  firstSelectedDate: string;
  lastSelectedDate: string;
  anchors: { targetDate: string; selectedDate: string }[];
}

export class InvalidExpectedMarketReturnMethodologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidExpectedMarketReturnMethodologyError";
  }
}

export class InvalidExpectedMarketReturnDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidExpectedMarketReturnDateError";
  }
}

export class InvalidExpectedMarketReturnPriceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidExpectedMarketReturnPriceError";
  }
}

export class DuplicateExpectedMarketReturnPriceError extends Error {
  constructor(date: string) {
    super(`Duplicate price point for date "${date}".`);
    this.name = "DuplicateExpectedMarketReturnPriceError";
  }
}

export class NoEligibleAnchorError extends Error {
  constructor(targetDate: string) {
    super(
      `No price point on or before anchor target "${targetDate}". Never use a future price.`,
    );
    this.name = "NoEligibleAnchorError";
  }
}

export class AnchorTooStaleError extends Error {
  constructor(targetDate: string, selectedDate: string, maxDays: number) {
    super(
      `Anchor for target "${targetDate}" selected "${selectedDate}", which is more than ${maxDays} calendar days stale. Add or narrow the requested range.`,
    );
    this.name = "AnchorTooStaleError";
  }
}

export class InvalidExpectedMarketReturnInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidExpectedMarketReturnInputError";
  }
}

export class InvalidExpectedMarketReturnResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidExpectedMarketReturnResultError";
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCanonicalCalendarDate(date: string): boolean {
  if (typeof date !== "string" || !DATE_PATTERN.test(date)) return false;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function assertCanonicalDate(value: unknown, field: string): void {
  if (typeof value !== "string" || !isCanonicalCalendarDate(value)) {
    throw new InvalidExpectedMarketReturnDateError(
      `Invalid ${field} "${String(value)}". Expected a real canonical YYYY-MM-DD date.`,
    );
  }
}

function parseDate(iso: string): [number, number, number] {
  return [
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)),
    Number(iso.slice(8, 10)),
  ];
}

function toUtcEpoch(iso: string): number {
  const [year, month, day] = parseDate(iso);
  return Date.UTC(year, month - 1, day);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toUtcEpoch(toIso) - toUtcEpoch(fromIso)) / 86400000);
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Builds a calendar date clamped to the month's last valid day (Feb 29 -> 28). */
function clampedDate(year: number, month: number, day: number): string {
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return formatDate(year, month, Math.min(day, maxDay));
}

export function createExpectedMarketReturnMethodology(input: {
  benchmark: ExpectedMarketReturnBenchmark;
}): ExpectedMarketReturnMethodology {
  const methodology: ExpectedMarketReturnMethodology = {
    benchmark: {
      id: input.benchmark.id,
      symbol: input.benchmark.symbol,
      name: input.benchmark.name,
    },
    lookbackYears: EXPECTED_MARKET_RETURN_LOOKBACK_YEARS,
    priceBasis: "adjusted_close",
    annualReturnMethod: "anniversary_to_anniversary",
    aggregation: "arithmetic_mean",
    maxAnchorStalenessDays: EXPECTED_MARKET_RETURN_MAX_ANCHOR_STALENESS_DAYS,
  };
  validateExpectedMarketReturnMethodology(methodology);
  return methodology;
}

export function validateExpectedMarketReturnMethodology(
  methodology: ExpectedMarketReturnMethodology,
): void {
  if (typeof methodology.benchmark?.id !== "string" || methodology.benchmark.id.length === 0) {
    throw new InvalidExpectedMarketReturnMethodologyError(
      "Expected-market-return methodology requires a non-empty benchmark id.",
    );
  }
  if (
    typeof methodology.benchmark.symbol !== "string" ||
    methodology.benchmark.symbol.length === 0
  ) {
    throw new InvalidExpectedMarketReturnMethodologyError(
      "Expected-market-return methodology requires a non-empty benchmark symbol.",
    );
  }
  if (
    methodology.benchmark.name !== undefined &&
    (typeof methodology.benchmark.name !== "string" ||
      methodology.benchmark.name.length === 0)
  ) {
    throw new InvalidExpectedMarketReturnMethodologyError(
      "Expected-market-return methodology benchmark name, when present, must be a non-empty string.",
    );
  }
  if (methodology.lookbackYears !== EXPECTED_MARKET_RETURN_LOOKBACK_YEARS) {
    throw new InvalidExpectedMarketReturnMethodologyError(
      `Expected-market-return methodology only supports lookbackYears ${EXPECTED_MARKET_RETURN_LOOKBACK_YEARS}; got "${String(methodology.lookbackYears)}".`,
    );
  }
  if (methodology.priceBasis !== "adjusted_close") {
    throw new InvalidExpectedMarketReturnMethodologyError(
      `Expected-market-return methodology priceBasis must be "adjusted_close"; got "${String(methodology.priceBasis)}".`,
    );
  }
  if (methodology.annualReturnMethod !== "anniversary_to_anniversary") {
    throw new InvalidExpectedMarketReturnMethodologyError(
      `Expected-market-return methodology annualReturnMethod must be "anniversary_to_anniversary"; got "${String(methodology.annualReturnMethod)}".`,
    );
  }
  if (methodology.aggregation !== "arithmetic_mean") {
    throw new InvalidExpectedMarketReturnMethodologyError(
      `Expected-market-return methodology aggregation must be "arithmetic_mean"; got "${String(methodology.aggregation)}".`,
    );
  }
  if (
    methodology.maxAnchorStalenessDays !==
    EXPECTED_MARKET_RETURN_MAX_ANCHOR_STALENESS_DAYS
  ) {
    throw new InvalidExpectedMarketReturnMethodologyError(
      `Expected-market-return methodology maxAnchorStalenessDays must be ${EXPECTED_MARKET_RETURN_MAX_ANCHOR_STALENESS_DAYS}; got "${String(methodology.maxAnchorStalenessDays)}".`,
    );
  }
}

/**
 * The eleven anniversary target dates for the lookback decade, each derived
 * from asOf backwards (target[10] === asOf exactly). Impossible anniversaries
 * (Feb 29 in non-leap years) are clamped deterministically to the last valid
 * day of that month. No Date.now() anywhere.
 */
export function generateAnnualAnchorTargetDates(input: {
  asOf: string;
  methodology: ExpectedMarketReturnMethodology;
}): string[] {
  validateExpectedMarketReturnMethodology(input.methodology);
  assertCanonicalDate(input.asOf, "asOf");
  const asOfYear = Number(input.asOf.slice(0, 4));
  const month = Number(input.asOf.slice(5, 7));
  const day = Number(input.asOf.slice(8, 10));
  const targets: string[] = [];
  for (let offset = input.methodology.lookbackYears; offset >= 0; offset -= 1) {
    targets.push(clampedDate(asOfYear - offset, month, day));
  }
  return targets;
}

export function resolveExpectedMarketReturnDateRange(input: {
  asOf: string;
  methodology: ExpectedMarketReturnMethodology;
}): { startDate: string; endDate: string } {
  const targets = generateAnnualAnchorTargetDates(input);
  return { startDate: targets[0], endDate: targets[targets.length - 1] };
}

function subtractDays(iso: string, days: number): string {
  const date = new Date(toUtcEpoch(iso) - days * 86400000);
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * The MINIMUM price history a caller must download to resolve every anchor.
 *
 * The methodology range is the economic period being measured
 * (firstAnchorTarget .. asOf). The data request range extends that start date
 * BACK by maxAnchorStalenessDays calendar days, so the first anchor can still
 * resolve on a weekend/holiday or stale close. This is purely a data-fetching
 * hint: the extra days are NOT added to the returns, and no additional anchor
 * is created. Still exactly 11 anchors and 10 annual returns.
 */
export function resolveExpectedMarketReturnDataRequestRange(input: {
  asOf: string;
  methodology: ExpectedMarketReturnMethodology;
}): { startDate: string; endDate: string } {
  validateExpectedMarketReturnMethodology(input.methodology);
  assertCanonicalDate(input.asOf, "asOf");
  const targets = generateAnnualAnchorTargetDates(input);
  return {
    startDate: subtractDays(targets[0], input.methodology.maxAnchorStalenessDays),
    endDate: input.asOf,
  };
}

function normalizePriceSeries(
  priceSeries: ExpectedMarketReturnPriceSeries,
): ExpectedMarketReturnPriceSeries {
  if (typeof priceSeries !== "object" || priceSeries === null) {
    throw new InvalidExpectedMarketReturnInputError(
      "priceSeries must be an object.",
    );
  }
  if (
    typeof priceSeries.assetId !== "string" ||
    priceSeries.assetId.length === 0
  ) {
    throw new InvalidExpectedMarketReturnInputError(
      "priceSeries requires a non-empty assetId.",
    );
  }
  if (!Array.isArray(priceSeries.points) || priceSeries.points.length === 0) {
    throw new InvalidExpectedMarketReturnInputError(
      "priceSeries requires at least one price point.",
    );
  }
  const seen = new Set<string>();
  for (const point of priceSeries.points) {
    if (typeof point !== "object" || point === null) {
      throw new InvalidExpectedMarketReturnPriceError(
        "Each price point must be an object.",
      );
    }
    assertCanonicalDate(point.date, "price point date");
    if (seen.has(point.date)) {
      throw new DuplicateExpectedMarketReturnPriceError(point.date);
    }
    seen.add(point.date);
    if (typeof point.value !== "number" || !Number.isFinite(point.value)) {
      throw new InvalidExpectedMarketReturnPriceError(
        `Price value at "${point.date}" must be a finite number; got ${String(point.value)}.`,
      );
    }
    if (point.value <= 0) {
      throw new InvalidExpectedMarketReturnPriceError(
        `Price value at "${point.date}" must be positive; got ${point.value}.`,
      );
    }
  }
  const sorted = [...priceSeries.points].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  return { assetId: priceSeries.assetId, points: sorted };
}

/**
 * Picks, per target date, the LATEST price on or before that date — allowing
 * weekends and holidays. A price after the target date is NEVER used, and a
 * selected price more than maxAnchorStalenessDays old is rejected as too
 * stale with a deterministic error.
 */
export function selectAnnualAnchors(input: {
  priceSeries: ExpectedMarketReturnPriceSeries;
  methodology: ExpectedMarketReturnMethodology;
  asOf: string;
}): AnnualAnchorPoint[] {
  validateExpectedMarketReturnMethodology(input.methodology);
  const series = normalizePriceSeries(input.priceSeries);
  const targets = generateAnnualAnchorTargetDates({
    asOf: input.asOf,
    methodology: input.methodology,
  });

  return targets.map((targetDate) => {
    for (let index = series.points.length - 1; index >= 0; index -= 1) {
      const point = series.points[index];
      if (point.date > targetDate) continue;
      const staleDays = daysBetween(point.date, targetDate);
      if (staleDays > input.methodology.maxAnchorStalenessDays) {
        throw new AnchorTooStaleError(
          targetDate,
          point.date,
          input.methodology.maxAnchorStalenessDays,
        );
      }
      return { targetDate, selectedDate: point.date, value: point.value };
    }
    throw new NoEligibleAnchorError(targetDate);
  });
}

/**
 * Ten simple annual returns R_i = P_i / P_(i-1) - 1 between the eleven
 * anchor prices. NOT log returns, NOT CAGR, no further annualization — each
 * return already spans approximately one year.
 */
export function computeAnnualSimpleReturns(
  anchors: readonly AnnualAnchorPoint[],
): AnnualSimpleReturn[] {
  if (!Array.isArray(anchors) || anchors.length < 2) {
    throw new InvalidExpectedMarketReturnResultError(
      "At least two anchors are required to compute annual simple returns.",
    );
  }
  const returns: AnnualSimpleReturn[] = [];
  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1];
    const current = anchors[index];
    assertCanonicalDate(previous.selectedDate, "anchor selectedDate");
    assertCanonicalDate(current.selectedDate, "anchor selectedDate");
    if (
      typeof previous.value !== "number" ||
      typeof current.value !== "number" ||
      !Number.isFinite(previous.value) ||
      !Number.isFinite(current.value) ||
      current.value <= 0 ||
      previous.value <= 0
    ) {
      throw new InvalidExpectedMarketReturnResultError(
        "Anchor prices must be positive and finite.",
      );
    }
    const value = current.value / previous.value - 1;
    if (!Number.isFinite(value)) {
      throw new InvalidExpectedMarketReturnResultError(
        "A computed annual simple return is non-finite.",
      );
    }
    returns.push({
      startDate: previous.selectedDate,
      endDate: current.selectedDate,
      value,
    });
  }
  return returns;
}

/** Arithmetic mean of the annual returns. Negative returns are allowed. */
export function computeExpectedMarketReturnFromAnnualReturns(
  returns: readonly AnnualSimpleReturn[],
): number {
  if (!Array.isArray(returns) || returns.length === 0) {
    throw new InvalidExpectedMarketReturnResultError(
      "At least one annual simple return is required.",
    );
  }
  let total = 0;
  for (const entry of returns) {
    if (
      typeof entry.value !== "number" ||
      !Number.isFinite(entry.value)
    ) {
      throw new InvalidExpectedMarketReturnResultError(
        `A return value must be finite; got ${String(entry.value)}.`,
      );
    }
    total += entry.value;
  }
  const mean = total / returns.length;
  if (!Number.isFinite(mean)) {
    throw new InvalidExpectedMarketReturnResultError(
      "The arithmetic mean of the annual returns is non-finite.",
    );
  }
  return mean;
}

export function snapshotExpectedMarketReturnMethodology(
  methodology: ExpectedMarketReturnMethodology,
): ExpectedMarketReturnSnapshot {
  validateExpectedMarketReturnMethodology(methodology);
  const benchmark = methodology.benchmark;
  return {
    benchmarkId: benchmark.id,
    benchmarkSymbol: benchmark.symbol,
    lookbackYears: methodology.lookbackYears,
    priceBasis: methodology.priceBasis,
    annualReturnMethod: methodology.annualReturnMethod,
    aggregation: methodology.aggregation,
    maxAnchorStalenessDays: methodology.maxAnchorStalenessDays,
  };
}

export function traceExpectedMarketReturn(input: {
  priceSeries: ExpectedMarketReturnPriceSeries;
  methodology: ExpectedMarketReturnMethodology;
  asOf: string;
}): ExpectedMarketReturnTrace {
  const anchors = selectAnnualAnchors(input);
  const requestedRange = resolveExpectedMarketReturnDateRange(input);
  const dataRequestRange = resolveExpectedMarketReturnDataRequestRange(input);
  const returns = computeAnnualSimpleReturns(anchors);
  return {
    methodologySnapshot: snapshotExpectedMarketReturnMethodology(
      input.methodology,
    ),
    requestedRange,
    dataRequestRange,
    anchorCount: anchors.length,
    annualReturnCount: returns.length,
    firstSelectedDate: anchors[0].selectedDate,
    lastSelectedDate: anchors[anchors.length - 1].selectedDate,
    anchors: anchors.map((anchor) => ({
      targetDate: anchor.targetDate,
      selectedDate: anchor.selectedDate,
    })),
  };
}

export interface BuildExpectedMarketReturnEnvelopeInput {
  priceSeries: ExpectedMarketReturnPriceSeries;
  methodology: ExpectedMarketReturnMethodology;
  asOf: string;
  source: DataSource;
  retrievedAt: string;
  quality: DataQuality;
}

/**
 * Builds the DataEnvelope<AnnualDecimalRate> that CAPM consumes. The estimate
 * is the arithmetic mean of ten anniversary annual simple returns; observedAt
 * is the real date of the LAST selected anchor (YYYY-MM-DD); retrievedAt comes
 * from the caller; frequency is fixed to "annual". No Date.now() anywhere.
 */
export function buildExpectedMarketReturnEnvelope(
  input: BuildExpectedMarketReturnEnvelopeInput,
): DataEnvelope<AnnualDecimalRate> {
  validateExpectedMarketReturnMethodology(input.methodology);
  assertCanonicalDate(input.asOf, "asOf");
  normalizePriceSeries(input.priceSeries);
  if (typeof input.retrievedAt !== "string" || input.retrievedAt.length === 0) {
    throw new InvalidExpectedMarketReturnInputError(
      "retrievedAt must be a non-empty string.",
    );
  }
  if (!isValidDataSource(input.source)) {
    throw new InvalidExpectedMarketReturnInputError(
      "source must be a valid DataSource.",
    );
  }
  if (typeof input.quality !== "object" || input.quality === null) {
    throw new InvalidExpectedMarketReturnInputError(
      "quality must be a DataQuality object.",
    );
  }

  const anchors = selectAnnualAnchors({
    priceSeries: input.priceSeries,
    methodology: input.methodology,
    asOf: input.asOf,
  });
  const returns = computeAnnualSimpleReturns(anchors);
  const rate = computeExpectedMarketReturnFromAnnualReturns(returns);
  const lastSelectedDate = anchors[anchors.length - 1].selectedDate;

  return {
    value: { rate, period: "annual", representation: "decimal" },
    source: input.source,
    observedAt: lastSelectedDate,
    retrievedAt: input.retrievedAt,
    frequency: "annual",
    quality: input.quality,
  };
}