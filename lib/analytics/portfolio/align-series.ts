import { normalizeReturnSeries } from "./returns";
import type {
  AlignedReturnSeries,
  MultipleAlignedReturnSeries,
  ReturnSeries,
} from "./types";
import { DuplicateAssetError } from "./types";

function sortPoints<T extends { date: string }>(points: readonly T[]): T[] {
  return [...points].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

/**
 * Aligns two return series keeping ONLY dates present in both.
 * No interpolation, no forward-fill, no invented observations.
 *
 * Inputs are normalized internally (a copy), so duplicate dates are rejected
 * instead of being silently overwritten by Map, malformed dates and non-finite
 * values are rejected, and inputs are never mutated.
 */
export function alignReturnSeries(
  left: ReturnSeries,
  right: ReturnSeries,
): AlignedReturnSeries {
  const normalizedLeft = normalizeReturnSeries(left);
  const normalizedRight = normalizeReturnSeries(right);
  const rightDates = new Set(normalizedRight.points.map((point) => point.date));
  const rightByDate = new Map(
    normalizedRight.points.map((point) => [point.date, point.value]),
  );
  const sortedLeft = sortPoints(normalizedLeft.points);
  const dates: string[] = [];
  const leftValues: number[] = [];
  const rightValues: number[] = [];
  for (const point of sortedLeft) {
    const rightValue = rightByDate.get(point.date);
    if (rightValue === undefined || !rightDates.has(point.date)) continue;
    dates.push(point.date);
    leftValues.push(point.value);
    rightValues.push(rightValue);
  }
  return { dates, left: leftValues, right: rightValues };
}

/**
 * Aligns N return series keeping only the date intersection of ALL series.
 * Each series is normalized internally first (see alignReturnSeries).
 */
export function alignMultipleReturnSeries(
  series: readonly ReturnSeries[],
): MultipleAlignedReturnSeries {
  if (series.length === 0) return { dates: [], series: new Map() };
  const normalized = series.map((single) => normalizeReturnSeries(single));

  const seen = new Set<string>();
  for (const single of normalized) {
    if (seen.has(single.assetId)) {
      throw new DuplicateAssetError(
        `Duplicate asset "${single.assetId}" in multi-series alignment.`,
      );
    }
    seen.add(single.assetId);
  }

  const pointsByAsset = new Map<string, Map<string, number>>();
  for (const single of normalized) {
    const byDate = new Map<string, number>();
    for (const point of single.points) {
      byDate.set(point.date, point.value);
    }
    pointsByAsset.set(single.assetId, byDate);
  }

  let common: Set<string> | undefined;
  for (const byDate of pointsByAsset.values()) {
    const keys = new Set(byDate.keys());
    if (common === undefined) {
      common = keys;
    } else {
      for (const date of Array.from(common)) {
        if (!keys.has(date)) common.delete(date);
      }
    }
  }

  const dates = common === undefined ? [] : Array.from(common).sort();
  const result = new Map<string, number[]>();
  for (const [assetId, byDate] of pointsByAsset) {
    const values: number[] = [];
    for (const date of dates) {
      const value = byDate.get(date);
      if (value === undefined) continue;
      values.push(value);
    }
    result.set(assetId, values);
  }
  return { dates, series: result };
}