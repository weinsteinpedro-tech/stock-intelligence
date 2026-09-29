/**
 * Sharpe portfolio inputs builder — produces the two DataEnvelopes consumed
 * by sharpeIndicator from ONE ReturnSeries envelope:
 *
 *   portfolio_annual_return          DataEnvelope<AnnualDecimalRate>
 *   portfolio_annualized_volatility  DataEnvelope<AnnualDecimalVolatility>
 *
 * Both envelopes are derived from the EXACT same selected daily-return
 * window (calculateAnnualizedPortfolioPerformance selects once) and carry
 * identical lineage metadata: same sources, same retrievedAt, same quality,
 * same observedAt (the last selected return date), frequency "annual".
 *
 * Pure and provider-agnostic: provenance is preserved (never invented),
 * timestamps are never lost, no network access.
 */

import { calculateAnnualizedPortfolioPerformance } from "../../analytics/portfolio/annualized-performance";
import type {
  SharpePortfolioInputMethodology,
  SharpePortfolioInputTrace,
} from "../../analytics/portfolio/annualized-performance";
import { traceSharpePortfolioInputPerformance } from "../../analytics/portfolio/annualized-performance";
import {
  InvalidSharpePortfolioInputError,
} from "../../analytics/portfolio/annualized-performance";
import { normalizeReturnSeries } from "../../analytics/portfolio/returns";
import type { ReturnSeries } from "../../analytics/portfolio";
import type { DataEnvelope } from "../types";
import {
  dataEnvelopeToDataSourceReferences,
  dedupeDataSourceReferences,
} from "../provenance";
import type { AnnualDecimalRate } from "../rates/risk-free-rate";
import type { AnnualDecimalVolatility } from "../../analytics/indicators/sharpe";
import { UnsupportedFrequencyError } from "./errors";

export interface SharpePortfolioInputEnvelopesBuildInput {
  /** Daily return envelope; its provenance/quality/retrievedAt are preserved. */
  returnEnvelope: DataEnvelope<ReturnSeries>;
  methodology: SharpePortfolioInputMethodology;
  asOf: string;
}

export interface SharpePortfolioInputEnvelopes {
  portfolioAnnualReturn: DataEnvelope<AnnualDecimalRate>;
  portfolioAnnualizedVolatility: DataEnvelope<AnnualDecimalVolatility>;
  trace: SharpePortfolioInputTrace;
}

/**
 * Pure builder. The incoming envelope must be daily (no resampling), must
 * carry lineage (source and/or sources), a non-empty retrievedAt and a
 * DataQuality object. The return values themselves are validated by
 * normalizeReturnSeries inside the shared calculation.
 */
export function buildSharpePortfolioInputEnvelopes(
  input: SharpePortfolioInputEnvelopesBuildInput,
): SharpePortfolioInputEnvelopes {
  const { returnEnvelope, methodology, asOf } = input;

  if (
    typeof returnEnvelope !== "object" ||
    returnEnvelope === null
  ) {
    throw new InvalidSharpePortfolioInputError(
      "A DataEnvelope<ReturnSeries> input is required.",
    );
  }
  if (returnEnvelope.frequency !== "daily") {
    throw new UnsupportedFrequencyError(
      `Sharpe portfolio inputs support only "daily" return envelopes; got "${String(returnEnvelope.frequency)}". No resampling.`,
    );
  }
  if (
    typeof returnEnvelope.retrievedAt !== "string" ||
    returnEnvelope.retrievedAt.length === 0
  ) {
    throw new InvalidSharpePortfolioInputError(
      "retrievedAt must be a non-empty string.",
    );
  }
  if (
    typeof returnEnvelope.quality !== "object" ||
    returnEnvelope.quality === null
  ) {
    throw new InvalidSharpePortfolioInputError(
      "quality must be a DataQuality object.",
    );
  }

  normalizeReturnSeries(returnEnvelope.value);

  const calculation = calculateAnnualizedPortfolioPerformance({
    returnSeries: returnEnvelope.value,
    methodology,
    asOf,
  });

  const sources = dedupeDataSourceReferences(
    dataEnvelopeToDataSourceReferences(returnEnvelope),
  );
  if (sources.length === 0) {
    throw new InvalidSharpePortfolioInputError(
      "return envelope must carry provenance (source and/or sources).",
    );
  }

  const observedAt = calculation.dataWindow.endDate;

  const shared = {
    sources,
    observedAt,
    retrievedAt: returnEnvelope.retrievedAt,
    frequency: "annual" as const,
    quality: returnEnvelope.quality,
  };

  return {
    portfolioAnnualReturn: {
      value: {
        rate: calculation.annualizedReturn,
        period: "annual",
        representation: "decimal",
      },
      ...shared,
    },
    portfolioAnnualizedVolatility: {
      value: {
        volatility: calculation.annualizedVolatility,
        period: "annual",
        representation: "decimal",
      },
      ...shared,
    },
    trace: traceSharpePortfolioInputPerformance({
      methodology,
      asOf,
      calculation,
    }),
  };
}