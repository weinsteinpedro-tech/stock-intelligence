import type { HistoricalPrice } from "../../market-data/types";

/**
 * Adapter boundary: converts data-layer HistoricalPrice[] into a structural
 * PriceSeries (assetId + {date, value}[]).
 *
 * This module intentionally does NOT import from lib/analytics so the
 * analytics subsystem stays fully extractable as a standalone library. The
 * returned shape is structurally compatible with PriceSeries from
 * lib/analytics/portfolio.
 *
 * The price basis is explicit (close by default). If adjusted_close is
 * requested, the provider data must actually carry an adjustedClose value:
 * there is NEVER a silent fallback from adjusted_close to close.
 */

export type ReturnPriceBasis = "close" | "adjusted_close";

export class InvalidMarketCloseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMarketCloseError";
  }
}

export interface AdapterPricePoint {
  date: string;
  value: number;
}

export interface AdapterPriceSeries {
  assetId: string;
  points: AdapterPricePoint[];
}

export interface HistoricalPriceToPriceSeriesOptions {
  priceBasis?: ReturnPriceBasis;
}

export function historicalPricesToPriceSeries(
  historical: readonly HistoricalPrice[],
  assetId: string,
  options: HistoricalPriceToPriceSeriesOptions = {},
): AdapterPriceSeries {
  const priceBasis = options.priceBasis ?? "close";
  const points: AdapterPricePoint[] = [];
  for (const item of historical) {
    let price: number | null;
    if (priceBasis === "adjusted_close") {
      const adjusted = item.adjustedClose;
      if (typeof adjusted !== "number") {
        throw new InvalidMarketCloseError(
          `Price basis "adjusted_close" was requested for asset "${assetId}" at "${item.date}", but the provider did not supply adjustedClose data. No fallback to close.`,
        );
      }
      price = adjusted;
    } else {
      price = item.close;
    }
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      throw new InvalidMarketCloseError(
        `Invalid ${priceBasis} for asset "${assetId}" at "${item.date}": ${String(price)}.`,
      );
    }
    points.push({ date: item.date, value: price });
  }
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { assetId, points };
}