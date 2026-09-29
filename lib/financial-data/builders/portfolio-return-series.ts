import {
  calculatePortfolioReturns,
} from "../../analytics/portfolio";
import type {
  PortfolioDefinition,
  ReturnSeries,
} from "../../analytics/portfolio";
import type { DataEnvelope } from "../types";
import {
  dataEnvelopeToDataSourceReferences,
  dedupeDataSourceReferences,
} from "../provenance";
import { worstQuality } from "../quality";
import { UnsupportedFrequencyError } from "./errors";

export interface PortfolioReturnSeriesBuildInput {
  portfolio: PortfolioDefinition;
  /** Keyed by assetId; values must be daily return envelopes. */
  assetReturns: ReadonlyMap<string, DataEnvelope<ReturnSeries>>;
  /** Wall-clock of data assembly. Comes from the caller; never fabricated. */
  retrievedAt: string;
}

function lastDateKey(points: readonly { date: string }[]): string {
  let last = "";
  for (const point of points) {
    if (point.date > last) last = point.date;
  }
  return last;
}

function maxRetrievedObservedAt(
  envelopes: readonly DataEnvelope<ReturnSeries>[],
): string {
  let latest = "";
  for (const envelope of envelopes) {
    if (envelope.observedAt > latest) latest = envelope.observedAt;
  }
  return latest;
}

/**
 * Pure, provider-agnostic builder: combines already-obtained per-asset return
 * envelopes into a portfolio return envelope via calculatePortfolioReturns().
 *
 * Only the envelopes of ACTIVE positions (weight !== 0) influence the result.
 * Extra series in assetReturns that do not belong to the portfolio, and
 * zero-weight positions, never affect frequency validation, quality,
 * provenance, or observedAt.
 *
 * - provenance: every upstream reference of active inputs is surfaced through
 *   `sources`; no single synthetic source is invented for a multi-asset
 *   portfolio.
 * - observedAt: derived deterministically from the portfolio's own returns.
 * - quality: worst-of aggregation over active inputs; stale/delayed inputs
 *   are never hidden.
 * - calculatePortfolioReturns() stays the source of truth for portfolio /
 *   weights / series validation (including map-key consistency).
 * - no network access.
 */
export function buildPortfolioReturnSeries(
  input: PortfolioReturnSeriesBuildInput,
): DataEnvelope<ReturnSeries> {
  const { portfolio, assetReturns, retrievedAt } = input;

  const activePositions = portfolio.positions.filter(
    (position) => position.weight !== 0,
  );

  const activeEnvelopes: DataEnvelope<ReturnSeries>[] = [];
  const seriesByAsset = new Map<string, ReturnSeries>();
  for (const position of activePositions) {
    const envelope = assetReturns.get(position.assetId);
    if (!envelope) continue;
    activeEnvelopes.push(envelope);
    seriesByAsset.set(position.assetId, envelope.value);
  }

  for (const envelope of activeEnvelopes) {
    if (envelope.frequency !== "daily") {
      throw new UnsupportedFrequencyError(
        `Portfolio builder supports only "daily" return inputs; an active portfolio asset uses "${envelope.frequency}". No resampling.`,
      );
    }
  }

  const portfolioReturns = calculatePortfolioReturns({
    portfolio,
    assetReturns: seriesByAsset,
  });

  const lastPortfolioDate = lastDateKey(portfolioReturns.points);
  const observedAt =
    lastPortfolioDate || maxRetrievedObservedAt(activeEnvelopes);

  const sources = dedupeDataSourceReferences(
    activeEnvelopes.flatMap((envelope) =>
      dataEnvelopeToDataSourceReferences(envelope),
    ),
  );

  return {
    value: portfolioReturns,
    sources,
    observedAt,
    retrievedAt,
    frequency: "daily",
    quality: worstQuality(activeEnvelopes.map((envelope) => envelope.quality)),
  };
}