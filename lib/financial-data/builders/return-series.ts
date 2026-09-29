import { calculateSimpleReturns } from "../../analytics/portfolio";
import type { PriceSeries, ReturnSeries } from "../../analytics/portfolio";
import { InvalidPriceSeriesError } from "../../analytics/portfolio";
import type { DataFrequency, DataEnvelope, DataSource } from "../types";
import type { DataQuality } from "../quality";
import { UnsupportedFrequencyError } from "./errors";

/**
 * This phase only supports daily prices -> daily returns. No resampling.
 */
const SUPPORTED_FREQUENCIES: readonly DataFrequency[] = ["daily"];

export interface ReturnSeriesBuildInput {
  priceSeries: PriceSeries;
  source: DataSource;
  frequency: DataFrequency;
  retrievedAt: string;
  quality: DataQuality;
}

function assertSupportedFrequency(frequency: DataFrequency): void {
  if (!SUPPORTED_FREQUENCIES.includes(frequency)) {
    throw new UnsupportedFrequencyError(
      `Only "${SUPPORTED_FREQUENCIES.join(", ")}" price data is supported for constructing return series; got "${frequency}". No resampling.`,
    );
  }
}

/**
 * Deterministic last-date lookup for canonical dates. Returns "" when there
 * are no points (never null), so observedAt stays a plain string.
 */
function lastDateKey(points: readonly { date: string }[]): string {
  let last = "";
  for (const point of points) {
    if (point.date > last) last = point.date;
  }
  return last;
}

/**
 * Pure builder: turns price data already obtained (PriceSeries) + lineage
 * metadata into a DataEnvelope<ReturnSeries> using calculateSimpleReturns().
 *
 * observedAt is derived deterministically from the series (the last return
 * date, or the last price date when there are no returns yet); retrievedAt is
 * taken from the caller and never fabricated. No network access.
 */
export function buildReturnSeriesEnvelope(
  input: ReturnSeriesBuildInput,
): DataEnvelope<ReturnSeries> {
  assertSupportedFrequency(input.frequency);
  if (input.priceSeries.points.length === 0) {
    throw new InvalidPriceSeriesError(
      "Cannot build a return series from an empty price series.",
    );
  }
  const returns = calculateSimpleReturns(input.priceSeries);
  const observedAt =
    lastDateKey(returns.points) || lastDateKey(input.priceSeries.points);
  return {
    value: returns,
    source: input.source,
    observedAt,
    retrievedAt: input.retrievedAt,
    frequency: input.frequency,
    quality: input.quality,
  };
}