export { buildReturnSeriesEnvelope } from "./return-series";
export type { ReturnSeriesBuildInput } from "./return-series";

export { buildBenchmarkReturnSeries } from "./benchmark-return-series";
export type {
  BenchmarkDefinition,
  BenchmarkReturnSeriesBuildInput,
} from "./benchmark-return-series";

export { buildPortfolioReturnSeries } from "./portfolio-return-series";
export type { PortfolioReturnSeriesBuildInput } from "./portfolio-return-series";

export { buildBetaDataContext } from "./beta-context";
export type { BetaDataContextInput } from "./beta-context";

export {
  buildSharpePortfolioInputEnvelopes,
} from "./sharpe-inputs";
export type {
  SharpePortfolioInputEnvelopes,
  SharpePortfolioInputEnvelopesBuildInput,
} from "./sharpe-inputs";

export { UnsupportedFrequencyError } from "./errors";

export type { ReturnPriceBasis } from "../adapters/market-prices";
export {
  buildRiskDecompositionEnvelope,
  traceRiskDecomposition,
  InvalidRiskDecompositionBuilderInputError,
} from "./risk-decomposition";
export type {
  BuildRiskDecompositionEnvelopeInput,
  RiskDecompositionTrace,
} from "./risk-decomposition";
