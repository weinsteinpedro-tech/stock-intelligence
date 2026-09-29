export { isCanonicalDate } from "./dates";

export { normalizePriceSeries } from "./prices";

export {
  calculateSimpleReturns,
  normalizeReturnSeries,
} from "./returns";

export {
  calculateAnnualizedPortfolioPerformance,
  createSharpePortfolioInputMethodology,
  resolveSharpePortfolioInputDateRange,
  resolveSharpePortfolioPriceRequestRange,
  SHARPE_PRICE_SEED_LOOKBACK_DAYS,
  snapshotSharpePortfolioInputMethodology,
  traceSharpePortfolioInputPerformance,
  validateSharpePortfolioInputMethodology,
} from "./annualized-performance";
export type {
  AnnualizedPortfolioPerformance,
  SharpePortfolioInputDataWindow,
  SharpePortfolioInputDateRange,
  SharpePortfolioInputMethodology,
  SharpePortfolioInputMethodologySnapshot,
  SharpePortfolioInputTrace,
  SharpePortfolioPriceRequestRange,
} from "./annualized-performance";
export {
  InvalidSharpePortfolioInputDateError,
  InvalidSharpePortfolioInputError,
  InvalidSharpePortfolioInputMethodologyError,
} from "./annualized-performance";

export {
  alignMultipleReturnSeries,
  alignReturnSeries,
} from "./align-series";

export {
  calculatePortfolioRiskDecomposition,
  InvalidRiskDecompositionInputError,
} from "./risk-decomposition";
export type {
  PortfolioRiskDecomposition,
  RiskDecompositionAnnual,
  RiskDecompositionDaily,
  RiskDecompositionInput,
} from "./risk-decomposition";

export {
  normalizePortfolioWeights,
  PORTFOLIO_WEIGHT_TOLERANCE,
  validatePortfolioWeights,
} from "./weights";
export type { PortfolioWeightValidation } from "./types";

export { calculatePortfolioReturns } from "./portfolio-returns";

export type {
  AlignedReturnSeries,
  MultipleAlignedReturnSeries,
  PortfolioDefinition,
  PortfolioPosition,
  PortfolioReturnsRequest,
  PricePoint,
  PriceSeries,
  ReturnPoint,
  ReturnSeries,
} from "./types";

export {
  AssetSeriesKeyMismatchError,
  DuplicateAssetError,
  DuplicateDateError,
  InvalidPortfolioDefinitionError,
  InvalidPortfolioWeightsError,
  InvalidPriceSeriesError,
  InvalidReturnSeriesError,
  MissingAssetReturnSeriesError,
  NonFiniteReturnError,
} from "./types";