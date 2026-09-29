/**
 * Risk decomposition envelope builder V1 — pure and provider-agnostic.
 *
 * Takes:
 *   - portfolioReturns   DataEnvelope<ReturnSeries> (frequency "daily")
 *   - benchmarkReturns   DataEnvelope<ReturnSeries> (frequency "daily")
 *   - beta               already-computed beta scalar (never recalculated here)
 *   - betaSources        non-empty lineage metadata for the beta scalar
 *
 * Produces:
 *   DataEnvelope<PortfolioRiskDecomposition>
 *
 * Calls calculatePortfolioRiskDecomposition exactly once. No duplicate
 * variance/volatility math in the builder.
 *
 * Lineage & metadata rules:
 *   - frequency: "annual" (annualized risk metrics derived from daily returns)
 *   - observedAt: last date in decomposition.dates (the aligned sample window)
 *   - retrievedAt: latest actual retrievedAt among the two ReturnSeries inputs
 *   - quality: worstQuality over the two ReturnSeries inputs
 *   - sources: union and deduplication of portfolio, benchmark, and beta sources
 */

import { calculatePortfolioRiskDecomposition } from "../../analytics/portfolio";
import type {
  PortfolioRiskDecomposition,
  ReturnSeries,
} from "../../analytics/portfolio";
import type {
  DataEnvelope,
  DataSourceReference,
} from "../types";
import {
  dataEnvelopeToDataSourceReferences,
  dedupeDataSourceReferences,
} from "../provenance";
import { worstQuality } from "../quality";
import { UnsupportedFrequencyError } from "./errors";

export class InvalidRiskDecompositionBuilderInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRiskDecompositionBuilderInputError";
  }
}

export interface BuildRiskDecompositionEnvelopeInput {
  portfolioReturns: DataEnvelope<ReturnSeries>;
  benchmarkReturns: DataEnvelope<ReturnSeries>;
  beta: number;
  betaSources: DataSourceReference[];
  annualizationFactor?: number;
}

export interface RiskDecompositionTrace {
  alignedObservationCount: number;
  firstAlignedDate: string;
  lastAlignedDate: string;
}

/**
 * Returns a lightweight trace of the aligned sample window from a
 * decomposition or its envelope.
 */
export function traceRiskDecomposition(
  target: PortfolioRiskDecomposition | DataEnvelope<PortfolioRiskDecomposition>,
): RiskDecompositionTrace {
  const decomp =
    "value" in target &&
    typeof target.value === "object" &&
    target.value !== null &&
    "observationCount" in target.value
      ? (target.value as PortfolioRiskDecomposition)
      : (target as PortfolioRiskDecomposition);

  return {
    alignedObservationCount: decomp.observationCount,
    firstAlignedDate: decomp.dates[0] ?? "",
    lastAlignedDate: decomp.dates[decomp.dates.length - 1] ?? "",
  };
}

/**
 * Pure builder for DataEnvelope<PortfolioRiskDecomposition>.
 *
 * Validates envelope presence, frequency, non-empty retrievedAt, quality,
 * and provenance (including non-empty beta lineage). Calls
 * calculatePortfolioRiskDecomposition once.
 */
export function buildRiskDecompositionEnvelope(
  input: BuildRiskDecompositionEnvelopeInput,
): DataEnvelope<PortfolioRiskDecomposition> {
  if (typeof input !== "object" || input === null) {
    throw new InvalidRiskDecompositionBuilderInputError(
      "A BuildRiskDecompositionEnvelopeInput object is required.",
    );
  }

  const { portfolioReturns, benchmarkReturns } = input;

  if (typeof portfolioReturns !== "object" || portfolioReturns === null) {
    throw new InvalidRiskDecompositionBuilderInputError(
      "portfolioReturns DataEnvelope<ReturnSeries> is required.",
    );
  }
  if (typeof benchmarkReturns !== "object" || benchmarkReturns === null) {
    throw new InvalidRiskDecompositionBuilderInputError(
      "benchmarkReturns DataEnvelope<ReturnSeries> is required.",
    );
  }

  if (portfolioReturns.frequency !== "daily") {
    throw new UnsupportedFrequencyError(
      `Risk decomposition builder supports only "daily" portfolio return envelopes; got "${String(portfolioReturns.frequency)}". No resampling.`,
    );
  }
  if (benchmarkReturns.frequency !== "daily") {
    throw new UnsupportedFrequencyError(
      `Risk decomposition builder supports only "daily" benchmark return envelopes; got "${String(benchmarkReturns.frequency)}". No resampling.`,
    );
  }

  if (
    typeof portfolioReturns.retrievedAt !== "string" ||
    portfolioReturns.retrievedAt.length === 0
  ) {
    throw new InvalidRiskDecompositionBuilderInputError(
      "portfolioReturns.retrievedAt must be a non-empty string.",
    );
  }
  if (
    typeof benchmarkReturns.retrievedAt !== "string" ||
    benchmarkReturns.retrievedAt.length === 0
  ) {
    throw new InvalidRiskDecompositionBuilderInputError(
      "benchmarkReturns.retrievedAt must be a non-empty string.",
    );
  }

  if (
    typeof portfolioReturns.quality !== "object" ||
    portfolioReturns.quality === null
  ) {
    throw new InvalidRiskDecompositionBuilderInputError(
      "portfolioReturns.quality must be a DataQuality object.",
    );
  }
  if (
    typeof benchmarkReturns.quality !== "object" ||
    benchmarkReturns.quality === null
  ) {
    throw new InvalidRiskDecompositionBuilderInputError(
      "benchmarkReturns.quality must be a DataQuality object.",
    );
  }

  const portfolioSources =
    dataEnvelopeToDataSourceReferences(portfolioReturns);
  if (portfolioSources.length === 0) {
    throw new InvalidRiskDecompositionBuilderInputError(
      "portfolioReturns envelope must carry provenance (source and/or sources).",
    );
  }

  const benchmarkSources =
    dataEnvelopeToDataSourceReferences(benchmarkReturns);
  if (benchmarkSources.length === 0) {
    throw new InvalidRiskDecompositionBuilderInputError(
      "benchmarkReturns envelope must carry provenance (source and/or sources).",
    );
  }

  if (!Array.isArray(input.betaSources) || input.betaSources.length === 0) {
    throw new InvalidRiskDecompositionBuilderInputError(
      "betaSources must be a non-empty array of DataSourceReference.",
    );
  }

  // Pure engine call — exactly once.
  // Performs series validation, date alignment, variance and decomposition math.
  const decomposition = calculatePortfolioRiskDecomposition({
    portfolioReturns: portfolioReturns.value,
    benchmarkReturns: benchmarkReturns.value,
    beta: input.beta,
    ...(input.annualizationFactor !== undefined
      ? { annualizationFactor: input.annualizationFactor }
      : {}),
  });

  const sources = dedupeDataSourceReferences([
    ...portfolioSources,
    ...benchmarkSources,
    ...input.betaSources,
  ]);

  if (sources.length === 0) {
    throw new InvalidRiskDecompositionBuilderInputError(
      "Risk decomposition envelope must carry provenance.",
    );
  }

  // Last date in aligned sample window (decomposition.dates has length >= 2)
  const observedAt = decomposition.dates[decomposition.dates.length - 1];

  // RetrievedAt policy: latest actual timestamp among the two ReturnSeries inputs.
  // Beta provenance timestamps are not used because this derived envelope
  // is assembled directly from the return series datasets.
  const retrievedAt =
    portfolioReturns.retrievedAt >= benchmarkReturns.retrievedAt
      ? portfolioReturns.retrievedAt
      : benchmarkReturns.retrievedAt;

  // Compositional quality: conservative combination of input return qualities
  const quality = worstQuality([
    portfolioReturns.quality,
    benchmarkReturns.quality,
  ]);

  return {
    value: decomposition,
    sources,
    observedAt,
    retrievedAt,
    frequency: "annual",
    quality,
  };
}
