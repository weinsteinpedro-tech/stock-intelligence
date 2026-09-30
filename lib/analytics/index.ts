export {
  AnalyticsEngine,
  IndicatorCycleError,
  UnknownIndicatorError,
} from "./engine";
export type { CalculateRequest } from "./engine";

export {
  DuplicateIndicatorError,
  IndicatorRegistry,
} from "./registry";

export * from "./math";

export * from "./portfolio";

export {
  BENCHMARK_RETURNS_DATA_KEY,
  betaIndicator,
  calculateBetaFromReturns,
  PORTFOLIO_RETURNS_DATA_KEY,
} from "./indicators";
export type { BetaCalculation } from "./indicators";

export type {
  IndicatorCalculation,
  IndicatorCategory,
  IndicatorContext,
  IndicatorDataWindow,
  IndicatorDefinition,
  IndicatorDependencySpec,
  IndicatorMetadata,
  IndicatorResult,
  IndicatorStatus,
} from "./types";

export {
  createBetaMethodology,
  resolveBetaDateRange,
  snapshotBetaMethodology,
  traceBetaExecution,
  validateBetaMethodology,
} from "./indicators";
export {
  InvalidBetaDateError,
  InvalidBetaMethodologyError,
} from "./indicators";
export type {
  BenchmarkDefinition,
  BetaDateRange,
  BetaExecutionTrace,
  BetaFrequency,
  BetaLookback,
  BetaLookbackUnit,
  BetaMethodology,
  BetaMethodologySnapshot,
  BetaPriceBasis,
  CreateBetaMethodologyInput,
} from "./indicators";

export {
  capmIndicator,
  calculateCapmExpectedReturn,
  EXPECTED_MARKET_RETURN_DATA_KEY,
  InvalidCapmInputError,
  isValidAnnualDecimalRate,
  RISK_FREE_RATE_DATA_KEY,
} from "./indicators";
export type {
  AnnualDecimalRate,
  CalculateCapmExpectedReturnInput,
} from "./indicators";

export {
  calculateSharpeRatio,
  InvalidSharpeInputError,
  isValidAnnualDecimalVolatility,
  PORTFOLIO_ANNUAL_RETURN_DATA_KEY,
  PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY,
  sharpeIndicator,
} from "./indicators";
export type {
  AnnualDecimalVolatility,
  CalculateSharpeRatioInput,
} from "./indicators";

export {
  calculateTreynorRatio,
  InvalidTreynorInputError,
  treynorIndicator,
} from "./indicators";
export type { CalculateTreynorRatioInput } from "./indicators";

export type {
  DataEnvelope,
  DataFrequency,
  DataSource,
  DataSourceReference,
} from "../financial-data/types";

export type {
  DataFreshness,
  DataQuality,
  DataQualityInput,
  SourceTier,
} from "../financial-data/quality";

export {
  clampCompleteness,
  isValidCompleteness,
  makeDataQuality,
} from "../financial-data/quality";

export {
  ageInMs,
  classifyFreshness,
  DEFAULT_DELAYED_WITHIN_MS,
  DEFAULT_FRESH_WITHIN_MS,
} from "../financial-data/freshness";
export type { FreshnessThresholds } from "../financial-data/freshness";

export {
  dataEnvelopeToSourceReference,
  dedupeDataSourceReferences,
  isValidDataSource,
  makeDataSource,
} from "../financial-data/provenance";
export type { DataSourceReferenceInput } from "../financial-data/provenance";
export { makeDataSourceReference } from "../financial-data/provenance";
export {
  RISK_DECOMPOSITION_DATA_KEY,
  portfolioRiskIndicator,
  marketRiskIndicator,
  systematicRiskIndicator,
  idiosyncraticRiskIndicator,
} from "./indicators";

export {
  CANONICAL_METRIC_METADATA,
  formatMetricValue,
  friendlyAnalyticsErrorMessage,
} from "./presentation";
export type {
  CanonicalMetricKey,
  MetricDisplayMetadata,
} from "./presentation";
