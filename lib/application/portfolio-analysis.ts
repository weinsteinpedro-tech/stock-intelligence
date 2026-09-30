import {
  AnalyticsEngine,
  IndicatorRegistry,
  EXPECTED_MARKET_RETURN_DATA_KEY,
  PORTFOLIO_ANNUAL_RETURN_DATA_KEY,
  PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY,
  RISK_DECOMPOSITION_DATA_KEY,
  RISK_FREE_RATE_DATA_KEY,
  betaIndicator,
  capmIndicator,
  createSharpePortfolioInputMethodology,
  idiosyncraticRiskIndicator,
  isCanonicalDate,
  marketRiskIndicator,
  portfolioRiskIndicator,
  resolveSharpePortfolioInputDateRange,
  sharpeIndicator,
  systematicRiskIndicator,
  treynorIndicator,
} from "../analytics";
import type {
  AnnualDecimalRate,
  IndicatorContext,
  IndicatorDataWindow,
  IndicatorDefinition,
  IndicatorResult,
  IndicatorStatus,
  ReturnSeries,
} from "../analytics";
import {
  buildBetaDataContext,
  buildRiskDecompositionEnvelope,
  buildSharpePortfolioInputEnvelopes,
} from "../financial-data/builders";
import type {
  DataEnvelope,
  DataSourceReference,
} from "../financial-data/types";

export class PortfolioAnalysisInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortfolioAnalysisInputError";
  }
}

export class PortfolioAnalysisExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortfolioAnalysisExecutionError";
  }
}

export interface AnalysisMetricSnapshot {
  indicatorId: string;
  value: number | null;
  status: IndicatorStatus;
  units: string | null;
  warnings: string[];
  sources: DataSourceReference[];
  dataWindow?: IndicatorDataWindow;
}

export interface PortfolioAnalysisSnapshot {
  schemaVersion: "1.0.0";
  asOf: string;

  metrics: {
    beta: AnalysisMetricSnapshot;
    capm: AnalysisMetricSnapshot;
    sharpe: AnalysisMetricSnapshot;
    treynor: AnalysisMetricSnapshot;
    portfolioRisk: AnalysisMetricSnapshot;
    marketRisk: AnalysisMetricSnapshot;
    systematicRisk: AnalysisMetricSnapshot;
    idiosyncraticRisk: AnalysisMetricSnapshot;
  };

  diagnostics: {
    riskVarianceDecompositionError: number;
  };
}

export interface RunPortfolioAnalysisInput {
  asOf: string;

  portfolioReturns: DataEnvelope<ReturnSeries>;
  benchmarkReturns: DataEnvelope<ReturnSeries>;

  riskFreeRate: DataEnvelope<AnnualDecimalRate>;
  expectedMarketReturn: DataEnvelope<AnnualDecimalRate>;
}

export interface RunPortfolioAnalysisOptions {
  registry?: IndicatorRegistry;
}

export function createPortfolioAnalysisRegistry(): IndicatorRegistry {
  const registry = new IndicatorRegistry();
  registry.register(betaIndicator);
  registry.register(capmIndicator);
  registry.register(sharpeIndicator);
  registry.register(treynorIndicator);
  registry.register(portfolioRiskIndicator);
  registry.register(marketRiskIndicator);
  registry.register(systematicRiskIndicator);
  registry.register(idiosyncraticRiskIndicator);
  return registry;
}

function toMetricSnapshot(
  indicatorId: string,
  result: IndicatorResult | undefined,
  definition: IndicatorDefinition | undefined,
): AnalysisMetricSnapshot {
  const warnings = Array.isArray(result?.warnings) ? [...result.warnings] : [];
  const sources = Array.isArray(result?.sources) ? [...result.sources] : [];
  const snapshot: AnalysisMetricSnapshot = {
    indicatorId,
    value:
      typeof result?.value === "number" && Number.isFinite(result.value)
        ? result.value
        : null,
    status: result?.status ?? "error",
    units: definition?.metadata?.units ?? null,
    warnings,
    sources,
  };

  if (result?.dataWindow) {
    snapshot.dataWindow = {
      startDate: result.dataWindow.startDate,
      endDate: result.dataWindow.endDate,
      observations: result.dataWindow.observations,
    };
  }

  return snapshot;
}

export function runPortfolioAnalysis(
  input: RunPortfolioAnalysisInput,
  options?: RunPortfolioAnalysisOptions,
): PortfolioAnalysisSnapshot {
  if (!input || typeof input !== "object") {
    throw new PortfolioAnalysisInputError("A RunPortfolioAnalysisInput object is required.");
  }

  if (typeof input.asOf !== "string" || !isCanonicalDate(input.asOf)) {
    throw new PortfolioAnalysisInputError(
      `Invalid asOf "${String(input.asOf)}". Expected a real canonical YYYY-MM-DD date.`,
    );
  }

  if (
    !input.portfolioReturns ||
    typeof input.portfolioReturns !== "object" ||
    !input.portfolioReturns.value
  ) {
    throw new PortfolioAnalysisInputError("portfolioReturns envelope is required.");
  }

  if (
    !input.benchmarkReturns ||
    typeof input.benchmarkReturns !== "object" ||
    !input.benchmarkReturns.value
  ) {
    throw new PortfolioAnalysisInputError("benchmarkReturns envelope is required.");
  }

  if (
    !input.riskFreeRate ||
    typeof input.riskFreeRate !== "object" ||
    !input.riskFreeRate.value
  ) {
    throw new PortfolioAnalysisInputError("riskFreeRate envelope is required.");
  }

  if (
    !input.expectedMarketReturn ||
    typeof input.expectedMarketReturn !== "object" ||
    !input.expectedMarketReturn.value
  ) {
    throw new PortfolioAnalysisInputError("expectedMarketReturn envelope is required.");
  }

  if (input.portfolioReturns.frequency !== "daily") {
    throw new PortfolioAnalysisInputError(
      `portfolioReturns frequency must be "daily"; got "${String(input.portfolioReturns.frequency)}".`,
    );
  }

  if (input.benchmarkReturns.frequency !== "daily") {
    throw new PortfolioAnalysisInputError(
      `benchmarkReturns frequency must be "daily"; got "${String(input.benchmarkReturns.frequency)}".`,
    );
  }

  const sharpeMethodology = createSharpePortfolioInputMethodology();
  const dateRange = resolveSharpePortfolioInputDateRange({
    asOf: input.asOf,
    methodology: sharpeMethodology,
  });
  const windowStartDate = dateRange.startDate;

  if (Array.isArray(input.portfolioReturns.value.points)) {
    for (const point of input.portfolioReturns.value.points) {
      if (point.date <= windowStartDate || point.date > input.asOf) {
        throw new PortfolioAnalysisInputError(
          `portfolioReturns point date "${point.date}" is outside the 1-year return window (${windowStartDate}, ${input.asOf}].`,
        );
      }
    }
  }

  if (Array.isArray(input.benchmarkReturns.value.points)) {
    for (const point of input.benchmarkReturns.value.points) {
      if (point.date <= windowStartDate || point.date > input.asOf) {
        throw new PortfolioAnalysisInputError(
          `benchmarkReturns point date "${point.date}" is outside the 1-year return window (${windowStartDate}, ${input.asOf}].`,
        );
      }
    }
  }

  const registry = options?.registry ?? createPortfolioAnalysisRegistry();

  // Stage 1: Compute Beta exactly once
  const betaContext = buildBetaDataContext({
    portfolioReturns: input.portfolioReturns,
    benchmarkReturns: input.benchmarkReturns,
    asOf: input.asOf,
  });

  const stage1Engine = new AnalyticsEngine(registry);
  const stage1Results = stage1Engine.calculate({
    indicators: ["beta"],
    context: betaContext,
  });

  const betaResult = stage1Results.get("beta");

  if (
    !betaResult ||
    betaResult.status !== "ok" ||
    typeof betaResult.value !== "number" ||
    !Number.isFinite(betaResult.value) ||
    !Array.isArray(betaResult.sources) ||
    betaResult.sources.length === 0
  ) {
    throw new PortfolioAnalysisExecutionError(
      `Beta calculation failed or is unusable: status="${betaResult?.status}", value=${betaResult?.value}.`,
    );
  }

  // Stage 2: Build Sharpe input envelopes and Risk Decomposition once
  const sharpeInputs = buildSharpePortfolioInputEnvelopes({
    returnEnvelope: input.portfolioReturns,
    methodology: sharpeMethodology,
    asOf: input.asOf,
  });

  const riskDecompositionEnvelope = buildRiskDecompositionEnvelope({
    portfolioReturns: input.portfolioReturns,
    benchmarkReturns: input.benchmarkReturns,
    beta: betaResult.value,
    betaSources: betaResult.sources,
  });

  // Stage 3: Final downstream engine run using precomputed Beta
  const finalContext: IndicatorContext = {
    data: {
      [RISK_FREE_RATE_DATA_KEY]: input.riskFreeRate,
      [EXPECTED_MARKET_RETURN_DATA_KEY]: input.expectedMarketReturn,
      [PORTFOLIO_ANNUAL_RETURN_DATA_KEY]: sharpeInputs.portfolioAnnualReturn,
      [PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY]:
        sharpeInputs.portfolioAnnualizedVolatility,
      [RISK_DECOMPOSITION_DATA_KEY]: riskDecompositionEnvelope,
    },
    indicators: new Map([["beta", betaResult]]),
    asOf: input.asOf,
  };

  const finalEngine = new AnalyticsEngine(registry);
  const finalResults = finalEngine.calculate({
    indicators: [
      "capm",
      "sharpe",
      "treynor",
      "portfolio_risk",
      "market_risk",
      "systematic_risk",
      "idiosyncratic_risk",
    ],
    context: finalContext,
  });

  return {
    schemaVersion: "1.0.0",
    asOf: input.asOf,
    metrics: {
      beta: toMetricSnapshot("beta", betaResult, registry.get("beta")),
      capm: toMetricSnapshot("capm", finalResults.get("capm"), registry.get("capm")),
      sharpe: toMetricSnapshot(
        "sharpe",
        finalResults.get("sharpe"),
        registry.get("sharpe"),
      ),
      treynor: toMetricSnapshot(
        "treynor",
        finalResults.get("treynor"),
        registry.get("treynor"),
      ),
      portfolioRisk: toMetricSnapshot(
        "portfolio_risk",
        finalResults.get("portfolio_risk"),
        registry.get("portfolio_risk"),
      ),
      marketRisk: toMetricSnapshot(
        "market_risk",
        finalResults.get("market_risk"),
        registry.get("market_risk"),
      ),
      systematicRisk: toMetricSnapshot(
        "systematic_risk",
        finalResults.get("systematic_risk"),
        registry.get("systematic_risk"),
      ),
      idiosyncraticRisk: toMetricSnapshot(
        "idiosyncratic_risk",
        finalResults.get("idiosyncratic_risk"),
        registry.get("idiosyncratic_risk"),
      ),
    },
    diagnostics: {
      riskVarianceDecompositionError:
        riskDecompositionEnvelope.value.varianceDecompositionError,
    },
  };
}
