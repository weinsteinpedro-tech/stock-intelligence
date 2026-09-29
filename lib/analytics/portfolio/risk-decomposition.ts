/**
 * Portfolio risk decomposition V1 — pure engine (no IndicatorDefinition yet).
 *
 * From a portfolio ReturnSeries, a benchmark ReturnSeries and a beta that is
 * ALREADY computed elsewhere (never recalculated here), decomposes risk into:
 *
 *   - portfolio risk       annualized std dev of portfolio daily returns
 *   - market risk          annualized std dev of benchmark daily returns
 *   - systematic risk      annualized volatility due to beta exposure
 *   - idiosyncratic risk   annualized std dev of market-model residuals
 *
 * Market model:  Rp_t = alpha + beta * Rm_t + epsilon_t
 *
 *    alpha   = mean(Rp) - beta * mean(Rm)
 *    residual = Rp - alpha - beta * Rm
 *
 * All variances are SAMPLE variances (divisor n - 1). Variances annualize with
 * factor 252; volatilities are sqrt(annual variance). Volatilities are NEVER
 * summed — the decomposition identity holds on VARIANCES:
 *
 *    portfolioVariance ≈ systematicVariance + idiosyncraticVariance
 *
 * Same-window guarantee: both series are aligned FIRST (date intersection via
 * alignReturnSeries), then EVERY quantity is computed on that exact sample.
 *
 * Pure/provider-agnostic: no network, no providers, no UI. No Value at Risk,
 * no CAPM expected return, no Sharpe/Treynor.
 */

import { mean, sampleVariance } from "../math";
import { alignReturnSeries } from "./align-series";
import type { ReturnSeries } from "./types";

export interface RiskDecompositionDaily {
  portfolioVariance: number;
  marketVariance: number;
  systematicVariance: number;
  idiosyncraticVariance: number;
}

export interface RiskDecompositionAnnual {
  portfolioVariance: number;
  marketVariance: number;
  systematicVariance: number;
  idiosyncraticVariance: number;
  portfolioVolatility: number;
  marketVolatility: number;
  systematicVolatility: number;
  idiosyncraticVolatility: number;
}

export interface PortfolioRiskDecomposition {
  beta: number;
  /** Daily intercept: mean(Rp) - beta * mean(Rm). */
  alphaDaily: number;
  observationCount: number;
  /** The single aligned sample used for every quantity. */
  dates: string[];
  daily: RiskDecompositionDaily;
  annual: RiskDecompositionAnnual;
  /** portfolioVariance - systematicVariance - idiosyncraticVariance (annual). */
  varianceDecompositionError: number;
}

const DEFAULT_ANNUALIZATION_FACTOR = 252;

export class InvalidRiskDecompositionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRiskDecompositionInputError";
  }
}

export interface RiskDecompositionInput {
  portfolioReturns: ReturnSeries;
  benchmarkReturns: ReturnSeries;
  /** Already computed elsewhere; never recalculated here. */
  beta: number;
  /** V1 default: 252. */
  annualizationFactor?: number;
}

/**
 * Pure risk decomposition. Returns are validated/normalized by
 * alignReturnSeries (malformed dates, duplicates and non-finite values are
 * rejected there). Minimum 2 aligned observations are required because the
 * sample-variance divisor is n - 1.
 *
 * MARKET VARIANCE == 0 is rejected deterministically: although every quantity
 * except a ratio to market variance is still well-defined, a systematic
 * decomposition against a benchmark with zero variation is not useful, so V1
 * refuses to fabricate a result (documented decision, no epsilon hack).
 */
export function calculatePortfolioRiskDecomposition(
  input: RiskDecompositionInput,
): PortfolioRiskDecomposition {
  if (typeof input.beta !== "number" || !Number.isFinite(input.beta)) {
    throw new InvalidRiskDecompositionInputError(
      `beta must be a finite number; got ${String(input.beta)}.`,
    );
  }
  const annualizationFactor =
    input.annualizationFactor ?? DEFAULT_ANNUALIZATION_FACTOR;
  if (
    typeof annualizationFactor !== "number" ||
    !Number.isFinite(annualizationFactor) ||
    annualizationFactor <= 0
  ) {
    throw new InvalidRiskDecompositionInputError(
      `annualizationFactor must be a finite number > 0; got ${String(annualizationFactor)}.`,
    );
  }

  const aligned = alignReturnSeries(
    input.portfolioReturns,
    input.benchmarkReturns,
  );
  if (aligned.dates.length < 2) {
    throw new InvalidRiskDecompositionInputError(
      `At least 2 aligned observations are required; got ${aligned.dates.length}.`,
    );
  }

  const portfolioVarianceDaily = sampleVariance(aligned.left);
  const marketVarianceDaily = sampleVariance(aligned.right);
  if (portfolioVarianceDaily === null || marketVarianceDaily === null) {
    throw new InvalidRiskDecompositionInputError(
      "Unable to compute daily variances from the aligned returns.",
    );
  }
  if (marketVarianceDaily === 0) {
    throw new InvalidRiskDecompositionInputError(
      "Cannot decompose risk: benchmark daily variance is 0. A systematic decomposition against a benchmark with no variation is not useful in V1.",
    );
  }

  const meanPortfolio = mean(aligned.left);
  const meanBenchmark = mean(aligned.right);
  if (meanPortfolio === null || meanBenchmark === null) {
    throw new InvalidRiskDecompositionInputError(
      "Unable to compute means from the aligned returns.",
    );
  }

  const alphaDaily = meanPortfolio - input.beta * meanBenchmark;

  const residuals: number[] = [];
  for (let i = 0; i < aligned.left.length; i += 1) {
    residuals.push(
      aligned.left[i] - alphaDaily - input.beta * aligned.right[i],
    );
  }

  const idiosyncraticVarianceDaily = sampleVariance(residuals);
  if (idiosyncraticVarianceDaily === null) {
    throw new InvalidRiskDecompositionInputError(
      "Unable to compute the residual variance.",
    );
  }

  const systematicVarianceDaily =
    input.beta * input.beta * marketVarianceDaily;

  const annualize = (variance: number) => variance * annualizationFactor;
  const volatility = (annualVariance: number) => Math.sqrt(annualVariance);

  const daily = {
    portfolioVariance: portfolioVarianceDaily,
    marketVariance: marketVarianceDaily,
    systematicVariance: systematicVarianceDaily,
    idiosyncraticVariance: idiosyncraticVarianceDaily,
  };

  const annual = {
    portfolioVariance: annualize(portfolioVarianceDaily),
    marketVariance: annualize(marketVarianceDaily),
    systematicVariance: annualize(systematicVarianceDaily),
    idiosyncraticVariance: annualize(idiosyncraticVarianceDaily),
    portfolioVolatility: volatility(annualize(portfolioVarianceDaily)),
    marketVolatility: volatility(annualize(marketVarianceDaily)),
    systematicVolatility: volatility(annualize(systematicVarianceDaily)),
    idiosyncraticVolatility: volatility(annualize(idiosyncraticVarianceDaily)),
  };

  const varianceDecompositionError =
    annual.portfolioVariance -
    annual.systematicVariance -
    annual.idiosyncraticVariance;

  return {
    beta: input.beta,
    alphaDaily,
    observationCount: aligned.dates.length,
    dates: aligned.dates.slice(),
    daily,
    annual,
    varianceDecompositionError,
  };
}