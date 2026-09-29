import { isCanonicalDate } from "./dates";
import { normalizePriceSeries } from "./prices";
import type { PriceSeries, ReturnPoint, ReturnSeries } from "./types";
import {
  DuplicateDateError,
  InvalidReturnSeriesError,
  NonFiniteReturnError,
} from "./types";

/**
 * Normalizes a return series copy and validates it. Returns may be any finite
 * number (including negative values); no value < -1 constraint is imposed so
 * ReturnSeries stays a generic, reusable contract.
 */
export function normalizeReturnSeries(series: ReturnSeries): ReturnSeries {
  if (
    typeof series !== "object" ||
    series === null ||
    typeof series.assetId !== "string" ||
    series.assetId.length === 0
  ) {
    throw new InvalidReturnSeriesError(
      "Return series must have a non-empty assetId.",
    );
  }
  if (!Array.isArray(series.points)) {
    throw new InvalidReturnSeriesError(
      `Return series for asset "${series.assetId}" must have a points array.`,
    );
  }
  const seen = new Set<string>();
  const points: ReturnPoint[] = [];
  for (const point of series.points) {
    if (!isCanonicalDate(point.date)) {
      throw new InvalidReturnSeriesError(
        `Invalid date "${point.date}" for asset "${series.assetId}". Expected YYYY-MM-DD.`,
      );
    }
    if (seen.has(point.date)) {
      throw new DuplicateDateError(
        `Duplicate date "${point.date}" for asset "${series.assetId}".`,
      );
    }
    seen.add(point.date);
    if (typeof point.value !== "number" || !Number.isFinite(point.value)) {
      throw new InvalidReturnSeriesError(
        `Return must be finite for asset "${series.assetId}" at "${point.date}".`,
      );
    }
    points.push({ date: point.date, value: point.value });
  }
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { assetId: series.assetId, points };
}

/**
 * Computes simple (arithmetic) returns: R_t = (P_t / P_(t-1)) - 1.
 *
 * The input is normalized internally, so callers never need to pre-normalize
 * and unsorted prices still yield chronological returns. Each ReturnPoint
 * carries the date of the FINAL price.
 */
export function calculateSimpleReturns(priceSeries: PriceSeries): ReturnSeries {
  const normalized = normalizePriceSeries(priceSeries);
  const points: ReturnPoint[] = [];
  for (let i = 1; i < normalized.points.length; i += 1) {
    const previous = normalized.points[i - 1].value;
    const current = normalized.points[i].value;
    const value = current / previous - 1;
    if (!Number.isFinite(value)) {
      throw new NonFiniteReturnError(
        `Non-finite return at "${normalized.points[i].date}" for asset "${normalized.assetId}".`,
      );
    }
    points.push({ date: normalized.points[i].date, value });
  }
  return { assetId: normalized.assetId, points };
}