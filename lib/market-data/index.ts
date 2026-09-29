import { AlphaVantageProvider } from "./alpha-vantage";
import { TiingoProvider, makeTiingoSource } from "./tiingo";
import type {
  HistoricalPrice,
  HistoricalPriceRequest,
  HistoryMarketDataProvider,
  MarketDataProvider,
  StockMatch,
} from "./types";

export { AlphaVantageProvider, TiingoProvider, makeTiingoSource };
export type {
  HistoricalPrice,
  HistoricalPriceRequest,
  HistoryMarketDataProvider,
  MarketDataProvider,
  StockMatch,
};

export function getMarketDataProvider(): MarketDataProvider {
  return new AlphaVantageProvider();
}