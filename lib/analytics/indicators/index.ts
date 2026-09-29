export {
  BENCHMARK_RETURNS_DATA_KEY,
  betaIndicator,
  calculateBetaFromReturns,
  PORTFOLIO_RETURNS_DATA_KEY,
} from "./beta";
export type { BetaCalculation } from "./beta";

export {
  createBetaMethodology,
  resolveBetaDateRange,
  snapshotBetaMethodology,
  traceBetaExecution,
  validateBetaMethodology,
} from "./beta-methodology";
export {
  InvalidBetaDateError,
  InvalidBetaMethodologyError,
} from "./beta-methodology";
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
} from "./beta-methodology";

export {
  capmIndicator,
  calculateCapmExpectedReturn,
  EXPECTED_MARKET_RETURN_DATA_KEY,
  InvalidCapmInputError,
  isValidAnnualDecimalRate,
  RISK_FREE_RATE_DATA_KEY,
} from "./capm";
export type {
  AnnualDecimalRate,
  CalculateCapmExpectedReturnInput,
} from "./capm";

export {
  calculateSharpeRatio,
  InvalidSharpeInputError,
  isValidAnnualDecimalVolatility,
  PORTFOLIO_ANNUAL_RETURN_DATA_KEY,
  PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY,
  sharpeIndicator,
} from "./sharpe";
export type {
  AnnualDecimalVolatility,
  CalculateSharpeRatioInput,
} from "./sharpe";

export {
  calculateTreynorRatio,
  InvalidTreynorInputError,
  treynorIndicator,
} from "./treynor";
export type { CalculateTreynorRatioInput } from "./treynor";
export {
  RISK_DECOMPOSITION_DATA_KEY,
  portfolioRiskIndicator,
  marketRiskIndicator,
  systematicRiskIndicator,
  idiosyncraticRiskIndicator,
} from "./risk-metrics";
