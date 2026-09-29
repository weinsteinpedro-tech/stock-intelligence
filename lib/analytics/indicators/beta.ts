import { sampleCovariance, sampleVariance } from "../math";
import { alignReturnSeries } from "../portfolio/align-series";
import type { ReturnSeries } from "../portfolio/types";
import type {
  IndicatorCalculation,
  IndicatorContext,
  IndicatorDefinition,
  IndicatorDataWindow,
} from "../types";
import {
  dataEnvelopeToDataSourceReferences,
  dedupeDataSourceReferences,
} from "../../financial-data/provenance";

export const PORTFOLIO_RETURNS_DATA_KEY = "portfolio_returns";
export const BENCHMARK_RETURNS_DATA_KEY = "benchmark_returns";

const MIN_BETA_OBSERVATIONS = 2;

export interface BetaCalculation {
  value: number | null;
  status: "ok" | "insufficient_data";
  observations: number;
  startDate: string | null;
  endDate: string | null;
  reason?: string;
}

function isReturnSeries(value: unknown): value is ReturnSeries {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { assetId?: unknown; points?: unknown };
  return (
    typeof record.assetId === "string" &&
    record.assetId.length > 0 &&
    Array.isArray(record.points)
  );
}

/**
 * Pure beta calculator. Betas are computed exclusively from aligned return
 * series:
 *
 *   β = Cov(Rp, Rm) / Var(Rm)
 *
 * using sampleCovariance and sampleVariance over the SAME aligned
 * observations, so the ratio is consistent. Only common dates participate;
 * no interpolation, forward-fill, nearest-date or calendar assumptions.
 *
 * This function knows nothing about the engine, envelopes, sources or
 * providers. Malformed series surface as deterministic errors from the
 * underlying normalization/alignment (never NaN/Infinity).
 */
export function calculateBetaFromReturns(
  portfolioReturns: ReturnSeries,
  benchmarkReturns: ReturnSeries,
): BetaCalculation {
  const aligned = alignReturnSeries(portfolioReturns, benchmarkReturns);
  const observations = aligned.dates.length;
  const startDate =
    aligned.dates.length > 0 ? aligned.dates[0] : null;
  const endDate =
    aligned.dates.length > 0
      ? aligned.dates[aligned.dates.length - 1]
      : null;

  if (observations < MIN_BETA_OBSERVATIONS) {
    return {
      value: null,
      status: "insufficient_data",
      observations,
      startDate,
      endDate,
      reason: `Not enough aligned observations: need at least ${MIN_BETA_OBSERVATIONS}, got ${observations}.`,
    };
  }

  const variance = sampleVariance(aligned.right);
  if (variance === null || variance === 0) {
    return {
      value: null,
      status: "insufficient_data",
      observations,
      startDate,
      endDate,
      reason: "Benchmark variance is zero or unavailable.",
    };
  }

  const covariance = sampleCovariance(aligned.left, aligned.right);
  if (covariance === null) {
    return {
      value: null,
      status: "insufficient_data",
      observations,
      startDate,
      endDate,
      reason: "Covariance could not be computed from the aligned observations.",
    };
  }

  const value = covariance / variance;
  if (!Number.isFinite(value)) {
    return {
      value: null,
      status: "insufficient_data",
      observations,
      startDate,
      endDate,
      reason: "Beta calculation produced a non-finite result.",
    };
  }

  return { value, status: "ok", observations, startDate, endDate };
}

function windowOf(calculation: BetaCalculation): IndicatorDataWindow | undefined {
  if (calculation.startDate === null || calculation.endDate === null) {
    return undefined;
  }
  return {
    startDate: calculation.startDate,
    endDate: calculation.endDate,
    observations: calculation.observations,
  };
}

export const betaIndicator: IndicatorDefinition = {
  id: "beta",
  name: "Beta",
  version: "1.0.0",
  category: "risk",
  dependencies: {
    data: [PORTFOLIO_RETURNS_DATA_KEY, BENCHMARK_RETURNS_DATA_KEY],
  },
  calculate(context: IndicatorContext): IndicatorCalculation {
    const portfolioEnvelope = context.data[PORTFOLIO_RETURNS_DATA_KEY];
    const benchmarkEnvelope = context.data[BENCHMARK_RETURNS_DATA_KEY];
    if (!portfolioEnvelope || !benchmarkEnvelope) {
      return {
        value: null,
        status: "error",
        warnings: [
          `Both "${PORTFOLIO_RETURNS_DATA_KEY}" and "${BENCHMARK_RETURNS_DATA_KEY}" envelopes are required.`,
        ],
      };
    }

    const portfolioSeries = portfolioEnvelope.value;
    const benchmarkSeries = benchmarkEnvelope.value;
    if (!isReturnSeries(portfolioSeries) || !isReturnSeries(benchmarkSeries)) {
      return {
        value: null,
        status: "error",
        warnings: [
          `"${PORTFOLIO_RETURNS_DATA_KEY}" and "${BENCHMARK_RETURNS_DATA_KEY}" values must be ReturnSeries.`,
        ],
      };
    }

    if (portfolioEnvelope.frequency !== benchmarkEnvelope.frequency) {
      return {
        value: null,
        status: "insufficient_data",
        warnings: [
          `Frequencies do not match: portfolio is "${portfolioEnvelope.frequency}", benchmark is "${benchmarkEnvelope.frequency}".`,
        ],
      };
    }

    let calculation: BetaCalculation;
    try {
      calculation = calculateBetaFromReturns(
        portfolioSeries,
        benchmarkSeries,
      );
    } catch (error) {
      return {
        value: null,
        status: "error",
        warnings: [
          `Invalid return series: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }

    const sources = dedupeDataSourceReferences([
      ...dataEnvelopeToDataSourceReferences(portfolioEnvelope),
      ...dataEnvelopeToDataSourceReferences(benchmarkEnvelope),
    ]);

    const result: IndicatorCalculation = {
      value: calculation.value,
      status: calculation.status,
      sources,
      warnings: calculation.reason ? [calculation.reason] : [],
    };
    const window = windowOf(calculation);
    if (window) result.dataWindow = window;
    return result;
  },
  metadata: {
    description: "Sensitivity of portfolio returns to benchmark returns.",
    methodology:
      "Sample covariance of aligned portfolio and benchmark returns divided by sample variance of benchmark returns.",
    formula: "β = Cov(Rp, Rm) / Var(Rm)",
    units: null,
  },
};