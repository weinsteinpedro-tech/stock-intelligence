import {
  calculateSimpleReturns,
  createSharpePortfolioInputMethodology,
  isCanonicalDate,
  resolveSharpePortfolioInputDateRange,
  resolveSharpePortfolioPriceRequestRange,
} from "../analytics";
import type { IndicatorRegistry, ReturnSeries } from "../analytics";
import { historicalPricesToPriceSeries } from "../financial-data/adapters/market-prices";
import {
  buildExpectedMarketReturnEnvelope,
  createExpectedMarketReturnMethodology,
  resolveExpectedMarketReturnDataRequestRange,
} from "../financial-data/market-return";
import { makeDataQuality } from "../financial-data/quality";
import {
  buildUsCapmRiskFreeRateEnvelope,
  resolveUsCapmRiskFreeRequestRange,
  US_CAPM_RISK_FREE_V1,
} from "../financial-data/rates";
import type { DataEnvelope, DataSource } from "../financial-data/types";
import { fredObservationsToRateObservations } from "../economic-data/fred-adapter";
import type {
  GetSeriesObservationsRequest,
  GetSeriesObservationsResult,
} from "../economic-data/fred";
import type { HistoryMarketDataProvider } from "../market-data/types";
import {
  type PortfolioAnalysisSnapshot,
  runPortfolioAnalysis,
} from "./portfolio-analysis";

export class LiveStockAnalysisInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveStockAnalysisInputError";
  }
}

export class LiveStockAnalysisDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveStockAnalysisDependencyError";
  }
}

export interface RunLiveStockAnalysisInput {
  symbol: string;
  benchmarkSymbol: string;
  asOf: string;
}

export interface EconomicDataProvider {
  getSeriesObservations(
    seriesId: string,
    request: GetSeriesObservationsRequest,
  ): Promise<GetSeriesObservationsResult>;
}

export interface LiveStockAnalysisDependencies {
  marketProvider: HistoryMarketDataProvider;
  economicProvider: EconomicDataProvider;
}

export interface RunLiveStockAnalysisOptions {
  retrievedAt?: string;
  registry?: IndicatorRegistry;
}

function assertCanonicalDate(date: string, field: string): void {
  if (typeof date !== "string" || !isCanonicalDate(date)) {
    throw new LiveStockAnalysisInputError(
      `Invalid ${field} "${String(date)}". Expected a real canonical YYYY-MM-DD date.`,
    );
  }
}

/**
 * Orchestrates the full live stock analytics pipeline for a single stock
 * (treated as a 100% single-asset portfolio) against a caller-specified benchmark.
 *
 * Provider calls: exactly 3
 * 1. Stock price history (1Y + seed buffer, adjusted close)
 * 2. Benchmark price history (10Y + anchor buffer, adjusted close) - reused for EMR and 1Y returns
 * 3. FRED DGS1 observations (range via US CAPM policy)
 *
 * Coordinates existing domain modules only; contains zero mathematical or analytics formulas.
 */
export async function runLiveStockAnalysis(
  input: RunLiveStockAnalysisInput,
  dependencies: LiveStockAnalysisDependencies,
  options?: RunLiveStockAnalysisOptions,
): Promise<PortfolioAnalysisSnapshot> {
  if (typeof input !== "object" || input === null) {
    throw new LiveStockAnalysisInputError("Input must be an object.");
  }

  const symbol = typeof input.symbol === "string" ? input.symbol.trim() : "";
  if (symbol.length === 0) {
    throw new LiveStockAnalysisInputError("Stock symbol must be a non-empty string.");
  }

  const benchmarkSymbol =
    typeof input.benchmarkSymbol === "string"
      ? input.benchmarkSymbol.trim()
      : "";
  if (benchmarkSymbol.length === 0) {
    throw new LiveStockAnalysisInputError(
      "Benchmark symbol must be a non-empty string.",
    );
  }

  assertCanonicalDate(input.asOf, "asOf");

  if (typeof dependencies !== "object" || dependencies === null) {
    throw new LiveStockAnalysisDependencyError(
      "Dependencies object with marketProvider and economicProvider is required as the second argument.",
    );
  }

  const { marketProvider, economicProvider } = dependencies;
  if (!marketProvider || typeof marketProvider.getHistoricalPrices !== "function") {
    throw new LiveStockAnalysisDependencyError(
      "A valid HistoryMarketDataProvider with getHistoricalPrices is required in dependencies.",
    );
  }

  if (
    !economicProvider ||
    typeof economicProvider.getSeriesObservations !== "function"
  ) {
    throw new LiveStockAnalysisDependencyError(
      "A valid EconomicDataProvider with getSeriesObservations is required in dependencies.",
    );
  }

  // 1. Resolve acquisition ranges from official methodology helpers
  const sharpeMethodology = createSharpePortfolioInputMethodology();
  const stockPriceRange = resolveSharpePortfolioPriceRequestRange({
    asOf: input.asOf,
    methodology: sharpeMethodology,
  });

  const emrMethodology = createExpectedMarketReturnMethodology({
    benchmark: {
      id: benchmarkSymbol,
      symbol: benchmarkSymbol,
    },
  });
  const benchmarkPriceRange = resolveExpectedMarketReturnDataRequestRange({
    asOf: input.asOf,
    methodology: emrMethodology,
  });

  const riskFreeRange = resolveUsCapmRiskFreeRequestRange({
    asOf: input.asOf,
    policy: US_CAPM_RISK_FREE_V1,
  });

  // 2. Execute exactly 3 provider queries
  const [stockPrices, benchmarkPrices, economicResult] = await Promise.all([
    marketProvider.getHistoricalPrices(symbol, {
      startDate: stockPriceRange.startDate,
      endDate: stockPriceRange.endDate,
    }),
    marketProvider.getHistoricalPrices(benchmarkSymbol, {
      startDate: benchmarkPriceRange.startDate,
      endDate: benchmarkPriceRange.endDate,
    }),
    economicProvider.getSeriesObservations(US_CAPM_RISK_FREE_V1.seriesId, {
      startDate: riskFreeRange.startDate,
      endDate: riskFreeRange.endDate,
    }),
  ]);

  // 3. Convert to price series enforcing mandatory adjusted close (no raw close fallback)
  const stockPriceSeries = historicalPricesToPriceSeries(
    stockPrices,
    symbol,
    { priceBasis: "adjusted_close" },
  );

  const benchmarkPriceSeries = historicalPricesToPriceSeries(
    benchmarkPrices,
    benchmarkSymbol,
    { priceBasis: "adjusted_close" },
  );

  const retrievedAt =
    options?.retrievedAt ?? economicResult.retrievedAt;

  // 4. Build Risk-Free Rate envelope using policy-aware V1 builder
  const rateObservations = fredObservationsToRateObservations(
    economicResult.observations,
    US_CAPM_RISK_FREE_V1,
  );
  const riskFreeRateEnvelope = buildUsCapmRiskFreeRateEnvelope({
    observations: rateObservations,
    asOf: input.asOf,
    retrievedAt: economicResult.retrievedAt,
    quality: makeDataQuality({
      freshness: "fresh",
      sourceTier: "licensed",
      completeness: 1,
    }),
  });

  // 5. Build Expected Market Return envelope from the 10Y benchmark price series
  const benchmarkSource: DataSource = {
    provider: "tiingo",
    originalSource: "tiingo",
    identifier: benchmarkSymbol,
  };
  const benchmarkQuality = makeDataQuality({
    freshness: "fresh",
    sourceTier: "licensed",
    completeness: 1,
  });

  const expectedMarketReturnEnvelope = buildExpectedMarketReturnEnvelope({
    priceSeries: {
      assetId: benchmarkSymbol,
      points: benchmarkPriceSeries.points,
    },
    methodology: emrMethodology,
    asOf: input.asOf,
    source: benchmarkSource,
    retrievedAt,
    quality: benchmarkQuality,
  });

  // 6. Build 1Y return window boundaries (startDate, asOf]
  const windowDateRange = resolveSharpePortfolioInputDateRange({
    asOf: input.asOf,
    methodology: sharpeMethodology,
  });
  const windowStartDate = windowDateRange.startDate;

  // 7. Derive stock daily simple returns and filter to strictly in-window returns
  const stockSource: DataSource = {
    provider: "tiingo",
    originalSource: "tiingo",
    identifier: symbol,
  };
  const stockQuality = makeDataQuality({
    freshness: "fresh",
    sourceTier: "licensed",
    completeness: 1,
  });

  const allStockReturns = calculateSimpleReturns(stockPriceSeries);
  const filteredStockReturnPoints = allStockReturns.points.filter(
    (point) => point.date > windowStartDate && point.date <= input.asOf,
  );

  const portfolioReturns: DataEnvelope<ReturnSeries> = {
    value: {
      assetId: symbol,
      points: filteredStockReturnPoints,
    },
    source: stockSource,
    observedAt:
      filteredStockReturnPoints[filteredStockReturnPoints.length - 1]?.date ??
      "",
    retrievedAt,
    frequency: "daily",
    quality: stockQuality,
  };

  // 8. Derive benchmark daily simple returns from the same dataset and filter to 1Y window
  const allBenchmarkReturns = calculateSimpleReturns(benchmarkPriceSeries);
  const filteredBenchmarkReturnPoints = allBenchmarkReturns.points.filter(
    (point) => point.date > windowStartDate && point.date <= input.asOf,
  );

  const benchmarkReturns: DataEnvelope<ReturnSeries> = {
    value: {
      assetId: benchmarkSymbol,
      points: filteredBenchmarkReturnPoints,
    },
    source: benchmarkSource,
    observedAt:
      filteredBenchmarkReturnPoints[filteredBenchmarkReturnPoints.length - 1]
        ?.date ?? "",
    retrievedAt,
    frequency: "daily",
    quality: benchmarkQuality,
  };

  // 9. Coordinate final portfolio analysis execution
  return runPortfolioAnalysis(
    {
      asOf: input.asOf,
      portfolioReturns,
      benchmarkReturns,
      riskFreeRate: riskFreeRateEnvelope,
      expectedMarketReturn: expectedMarketReturnEnvelope,
    },
    options?.registry ? { registry: options.registry } : undefined,
  );
}
