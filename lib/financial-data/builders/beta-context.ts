import {
  BENCHMARK_RETURNS_DATA_KEY,
  PORTFOLIO_RETURNS_DATA_KEY,
} from "../../analytics/indicators/beta";
import type { ReturnSeries } from "../../analytics/portfolio";
import type { IndicatorContext } from "../../analytics/types";
import type { DataEnvelope } from "../types";

export interface BetaDataContextInput {
  portfolioReturns: DataEnvelope<ReturnSeries>;
  benchmarkReturns: DataEnvelope<ReturnSeries>;
  asOf: string;
}

/**
 * Pure composition boundary: turns already-built return envelopes into the
 * exact data context the "beta" indicator consumes. Beta is NOT computed
 * here. Data keys match lib/analytics' PORTFOLIO_RETURNS_DATA_KEY /
 * BENCHMARK_RETURNS_DATA_KEY so the caller can do:
 *
 *   const context = buildBetaDataContext({ ... });
 *   engine.calculate({ indicators: ["beta"], context });
 */
export function buildBetaDataContext(
  input: BetaDataContextInput,
): IndicatorContext {
  return {
    data: {
      [PORTFOLIO_RETURNS_DATA_KEY]: input.portfolioReturns,
      [BENCHMARK_RETURNS_DATA_KEY]: input.benchmarkReturns,
    },
    indicators: new Map(),
    asOf: input.asOf,
  };
}