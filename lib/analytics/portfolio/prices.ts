import { isCanonicalDate } from "./dates";
import type { PricePoint, PriceSeries } from "./types";
import { DuplicateDateError, InvalidPriceSeriesError } from "./types";

function assertValidSeries(series: PriceSeries): void {
  if (
    typeof series !== "object" ||
    series === null ||
    typeof series.assetId !== "string" ||
    series.assetId.length === 0
  ) {
    throw new InvalidPriceSeriesError(
      "Price series must have a non-empty assetId.",
    );
  }
  if (!Array.isArray(series.points)) {
    throw new InvalidPriceSeriesError(
      `Price series for asset "${series.assetId}" must have a points array.`,
    );
  }
}

/**
 * Normalizes a price series copy and validates it.
 *
 * A price series may be close, adjustedClose, or any price the caller chose.
 * For return analytics, callers should provide a price series adjusted
 * appropriately for splits/corporate actions when methodology requires it.
 * Analytics does not decide which field to use; that belongs to the data layer.
 */
export function normalizePriceSeries(series: PriceSeries): PriceSeries {
  assertValidSeries(series);
  const seen = new Set<string>();
  const points: PricePoint[] = [];
  for (const point of series.points) {
    if (!isCanonicalDate(point.date)) {
      throw new InvalidPriceSeriesError(
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
      throw new InvalidPriceSeriesError(
        `Price must be finite for asset "${series.assetId}" at "${point.date}".`,
      );
    }
    if (point.value <= 0) {
      throw new InvalidPriceSeriesError(
        `Price must be > 0 for asset "${series.assetId}" at "${point.date}".`,
      );
    }
    points.push({ date: point.date, value: point.value });
  }
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { assetId: series.assetId, points };
}