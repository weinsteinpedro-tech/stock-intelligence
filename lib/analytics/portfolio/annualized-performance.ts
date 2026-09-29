/**
 * Sharpe portfolio inputs V1 — annualized portfolio return and annualized
 * volatility derived from ONE single window of daily returns.
 *
 * Both outputs are born from the exact same selected range (same-sample
 * guarantee): a single `calculateAnnualizedPortfolioPerformance` call selects
 * the window once and both numbers are derived from it.
 *
 * Pure and provider-agnostic: no network, no data providers, no UI.
 * Returns arrive already computed (ReturnSeries); prices are NEVER accepted
 * here. No Date.now(), no resampling, no CAGR, no geometric returns, no log
 * returns.
 */

import { mean, sampleStandardDeviation } from "../math";
import { isCanonicalDate } from "./dates";
import { normalizeReturnSeries } from "./returns";
import type { ReturnPoint, ReturnSeries } from "./types";

export interface SharpePortfolioInputMethodology {
  /** V1 supports exactly a 1-year lookback. */
  lookbackYears: 1;
  frequency: "daily";
  annualizationFactor: 252;
  returnAnnualization: "arithmetic_mean_times_factor";
  volatilityEstimator: "sample_standard_deviation";
  volatilityAnnualization: "sqrt_factor";
}

export interface SharpePortfolioInputMethodologySnapshot {
  lookbackYears: 1;
  frequency: "daily";
  annualizationFactor: 252;
  returnAnnualization: "arithmetic_mean_times_factor";
  volatilityEstimator: "sample_standard_deviation";
  volatilityAnnualization: "sqrt_factor";
}

export interface SharpePortfolioInputDateRange {
  startDate: string;
  endDate: string;
}

export interface SharpePortfolioPriceRequestRange {
  startDate: string;
  endDate: string;
}

/**
 * Price-acquisition buffer before the Sharpe return window start. Purely a
 * data-fetch seed (7 calendar days) so the FIRST daily return dated strictly
 * after startDate can be computed from its prior trading-day price even when
 * startDate lands on a holiday/weekend. It is NOT additional metric lookback:
 * every date before startDate stays outside the selected Sharpe sample.
 */
export const SHARPE_PRICE_SEED_LOOKBACK_DAYS = 7;

export interface SharpePortfolioInputDataWindow {
  startDate: string;
  endDate: string;
  observations: number;
}

export interface AnnualizedPortfolioPerformance {
  /** The single selected window shared by both outputs (chronological). */
  selectedReturns: ReturnPoint[];
  dailyMeanReturn: number;
  dailySampleVolatility: number;
  annualizedReturn: number;
  annualizedVolatility: number;
  dataWindow: SharpePortfolioInputDataWindow;
}

export interface SharpePortfolioInputTrace {
  methodologySnapshot: SharpePortfolioInputMethodologySnapshot;
  requestedRange: SharpePortfolioInputDateRange;
  selectedObservationCount: number;
  firstSelectedDate: string;
  lastSelectedDate: string;
}

export class InvalidSharpePortfolioInputMethodologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSharpePortfolioInputMethodologyError";
  }
}

export class InvalidSharpePortfolioInputDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSharpePortfolioInputDateError";
  }
}

export class InvalidSharpePortfolioInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSharpePortfolioInputError";
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
 * Deterministic calendar arithmetic on canonical YYYY-MM-DD. A Feb-29 asOf
 * rewinds to Feb-28 in a non-leap target year; month/year boundaries are
 * handled without Date.parse.
 */
function addYears(dateStr: string, years: number): string {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  const targetYear = year + years;
  const targetDay = Math.min(day, daysInMonth(targetYear, month));
  return formatDate(targetYear, month, targetDay);
}

/**
 * Deterministic day-on-day calendar arithmetic on canonical YYYY-MM-DD.
 * Handles month/year boundaries and leap years without Date.parse and
 * without any trading-calendar assumption (weekends/holidays are simply not
 * modeled here).
 */
function shiftCalendarDays(dateStr: string, delta: number): string {
  let year = Number(dateStr.slice(0, 4));
  let month = Number(dateStr.slice(5, 7));
  let day = Number(dateStr.slice(8, 10));
  if (delta < 0) {
    while (day + delta < 1) {
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      day += daysInMonth(year, month);
    }
    day += delta;
  } else {
    while (day + delta > daysInMonth(year, month)) {
      delta -= daysInMonth(year, month) - day + 1;
      day = 1;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    day += delta;
  }
  return formatDate(year, month, day);
}

function assertCanonicalDate(value: unknown, field: string): void {
  if (typeof value !== "string" || !isCanonicalDate(value)) {
    throw new InvalidSharpePortfolioInputDateError(
      `Invalid ${field} "${String(value)}". Expected a real canonical YYYY-MM-DD date.`,
    );
  }
}

/**
 * Single source of truth for SharpePortfolioInputMethodology validation.
 * Every public API that consumes a methodology (create, validate, resolve,
 * calculate, snapshot, trace) calls this, so objects arriving from
 * JSON/persistence/plain JavaScript are rejected deterministically.
 */
export function validateSharpePortfolioInputMethodology(
  methodology: SharpePortfolioInputMethodology,
): void {
  if (methodology.lookbackYears !== 1) {
    throw new InvalidSharpePortfolioInputMethodologyError(
      `Sharpe portfolio inputs V1 only supports lookbackYears 1; got "${String(methodology.lookbackYears)}".`,
    );
  }
  if (methodology.frequency !== "daily") {
    throw new InvalidSharpePortfolioInputMethodologyError(
      `Sharpe portfolio inputs V1 only supports daily frequency; got "${String(methodology.frequency)}". No resampling.`,
    );
  }
  if (methodology.annualizationFactor !== 252) {
    throw new InvalidSharpePortfolioInputMethodologyError(
      `Sharpe portfolio inputs V1 only supports annualizationFactor 252; got "${String(methodology.annualizationFactor)}".`,
    );
  }
  if (methodology.returnAnnualization !== "arithmetic_mean_times_factor") {
    throw new InvalidSharpePortfolioInputMethodologyError(
      `Sharpe portfolio inputs V1 only supports returnAnnualization "arithmetic_mean_times_factor"; got "${String(methodology.returnAnnualization)}".`,
    );
  }
  if (
    methodology.volatilityEstimator !== "sample_standard_deviation"
  ) {
    throw new InvalidSharpePortfolioInputMethodologyError(
      `Sharpe portfolio inputs V1 only supports volatilityEstimator "sample_standard_deviation"; got "${String(methodology.volatilityEstimator)}".`,
    );
  }
  if (methodology.volatilityAnnualization !== "sqrt_factor") {
    throw new InvalidSharpePortfolioInputMethodologyError(
      `Sharpe portfolio inputs V1 only supports volatilityAnnualization "sqrt_factor"; got "${String(methodology.volatilityAnnualization)}".`,
    );
  }
}

export function createSharpePortfolioInputMethodology(): SharpePortfolioInputMethodology {
  const methodology: SharpePortfolioInputMethodology = {
    lookbackYears: 1,
    frequency: "daily",
    annualizationFactor: 252,
    returnAnnualization: "arithmetic_mean_times_factor",
    volatilityEstimator: "sample_standard_deviation",
    volatilityAnnualization: "sqrt_factor",
  };
  validateSharpePortfolioInputMethodology(methodology);
  return methodology;
}

export function snapshotSharpePortfolioInputMethodology(
  methodology: SharpePortfolioInputMethodology,
): SharpePortfolioInputMethodologySnapshot {
  validateSharpePortfolioInputMethodology(methodology);
  return {
    lookbackYears: methodology.lookbackYears,
    frequency: methodology.frequency,
    annualizationFactor: methodology.annualizationFactor,
    returnAnnualization: methodology.returnAnnualization,
    volatilityEstimator: methodology.volatilityEstimator,
    volatilityAnnualization: methodology.volatilityAnnualization,
  };
}

export function resolveSharpePortfolioInputDateRange(input: {
  asOf: string;
  methodology: SharpePortfolioInputMethodology;
}): SharpePortfolioInputDateRange {
  validateSharpePortfolioInputMethodology(input.methodology);
  assertCanonicalDate(input.asOf, "asOf");
  return {
    startDate: addYears(input.asOf, -input.methodology.lookbackYears),
    endDate: input.asOf,
  };
}

/**
 * Minimum price range needed to BUILD the Sharpe return window: the metric
 * window (startDate, endDate] plus SHARPE_PRICE_SEED_LOOKBACK_DAYS calendar
 * days before it, so the first in-window return (dated strictly after
 * startDate) has its seed price available even when startDate itself is a
 * non-trading day. The extended segment exists ONLY for price acquisition; it
 * never enters the Sharpe sample (selection remains startDate < date <= asOf).
 */
export function resolveSharpePortfolioPriceRequestRange(input: {
  asOf: string;
  methodology: SharpePortfolioInputMethodology;
}): SharpePortfolioPriceRequestRange {
  validateSharpePortfolioInputMethodology(input.methodology);
  const returnRange = resolveSharpePortfolioInputDateRange(input);
  return {
    startDate: shiftCalendarDays(
      returnRange.startDate,
      -SHARPE_PRICE_SEED_LOOKBACK_DAYS,
    ),
    endDate: returnRange.endDate,
  };
}

/**
 * Picks returns whose label date (the date of the FINAL price) falls into
 * (startDate, endDate] — a return whose period STARTS before startDate is
 * excluded by the strict start-side bound, so nothing outside the window
 * leaks in.
 */
function selectDailyReturns(
  series: ReturnSeries,
  range: SharpePortfolioInputDateRange,
): ReturnPoint[] {
  const selected: ReturnPoint[] = [];
  for (const point of series.points) {
    if (point.date > range.startDate && point.date <= range.endDate) {
      selected.push(point);
    }
  }
  return selected;
}

/**
 * Pure single-selection calculation shared by BOTH envelope outputs.
 *
 * - dailyMeanReturn: arithmetic mean of the selected daily returns.
 * - dailySampleVolatility: sample standard deviation (n - 1 divisor).
 * - annualizedReturn: dailyMean * annualizationFactor (arithmetic mean
 *   times factor, NOT CAGR / product / log).
 * - annualizedVolatility: dailySampleVolatility * sqrt(annualizationFactor).
 *
 * At least 2 observations are required (the sample variance divisor is
 * n - 1). Returns are already normalized (validated, deduplicated,
 * chronologically sorted) so input ordering is irrelevant and negative
 * returns are allowed. Constant series produce 0 volatility — that is NOT an
 * error here; the Sharpe indicator decides what to do with it.
 */
export function calculateAnnualizedPortfolioPerformance(input: {
  returnSeries: ReturnSeries;
  methodology: SharpePortfolioInputMethodology;
  asOf: string;
}): AnnualizedPortfolioPerformance {
  validateSharpePortfolioInputMethodology(input.methodology);
  assertCanonicalDate(input.asOf, "asOf");

  const normalized = normalizeReturnSeries(input.returnSeries);
  const range = resolveSharpePortfolioInputDateRange({
    asOf: input.asOf,
    methodology: input.methodology,
  });
  const selectedReturns = selectDailyReturns(normalized, range);

  if (selectedReturns.length < 2) {
    throw new InvalidSharpePortfolioInputError(
      `Sharpe portfolio inputs require at least 2 daily returns in the window (${range.startDate}, ${range.endDate}]; got ${selectedReturns.length}.`,
    );
  }

  const values = selectedReturns.map((point) => point.value);
  const dailyMeanReturn = mean(values);
  const dailySampleVolatility = sampleStandardDeviation(values);
  if (
    dailyMeanReturn === null ||
    dailySampleVolatility === null
  ) {
    throw new InvalidSharpePortfolioInputError(
      "Unable to compute a finite daily mean/volatility from the selected returns.",
    );
  }

  const annualizedReturn =
    dailyMeanReturn * input.methodology.annualizationFactor;
  const annualizedVolatility =
    dailySampleVolatility * Math.sqrt(input.methodology.annualizationFactor);

  if (!Number.isFinite(annualizedReturn) || !Number.isFinite(annualizedVolatility)) {
    throw new InvalidSharpePortfolioInputError(
      "Annualized return/volatility produced a non-finite value.",
    );
  }

  return {
    selectedReturns,
    dailyMeanReturn,
    dailySampleVolatility,
    annualizedReturn,
    annualizedVolatility,
    dataWindow: {
      startDate: selectedReturns[0].date,
      endDate: selectedReturns[selectedReturns.length - 1].date,
      observations: selectedReturns.length,
    },
  };
}

export function traceSharpePortfolioInputPerformance(input: {
  methodology: SharpePortfolioInputMethodology;
  asOf: string;
  calculation: AnnualizedPortfolioPerformance;
}): SharpePortfolioInputTrace {
  validateSharpePortfolioInputMethodology(input.methodology);
  return {
    methodologySnapshot: snapshotSharpePortfolioInputMethodology(input.methodology),
    requestedRange: resolveSharpePortfolioInputDateRange({
      asOf: input.asOf,
      methodology: input.methodology,
    }),
    selectedObservationCount: input.calculation.dataWindow.observations,
    firstSelectedDate: input.calculation.dataWindow.startDate,
    lastSelectedDate: input.calculation.dataWindow.endDate,
  };
}