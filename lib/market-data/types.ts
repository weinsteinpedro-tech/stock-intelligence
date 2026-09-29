export interface StockMatch {
  symbol: string;
  name: string;
  region: string | null;
  currency: string | null;
}

export interface HistoricalPrice {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  /**
   * Vendor-adjusted close (corporate actions, including splits and
   * dividends) when the provider supplies it. Optional and backward
   * compatible: existing providers (e.g. Alpha Vantage) may keep delivering
   * close-only rows.
   */
  adjustedClose?: number;
  volume: number | null;
}

export interface HistoricalPriceRequest {
  /** Inclusive start date, canonical YYYY-MM-DD. */
  startDate: string;
  /** Inclusive end date, canonical YYYY-MM-DD. */
  endDate: string;
}

export interface MarketDataProvider {
  searchSymbols(query: string): Promise<StockMatch[]>;
  getDailySeries(symbol: string): Promise<HistoricalPrice[]>;
}

/**
 * Provider that additionally supports an explicit, inclusive date range.
 * The caller decides the dates; no hardcoded windows (1Y/3Y/5Y) live here.
 */
export interface HistoryMarketDataProvider extends MarketDataProvider {
  getHistoricalPrices(
    symbol: string,
    request: HistoricalPriceRequest,
  ): Promise<HistoricalPrice[]>;
}
