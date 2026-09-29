import { alignMultipleReturnSeries } from "./align-series";
import { validatePortfolioWeights } from "./weights";
import type {
  PortfolioReturnsRequest,
  ReturnPoint,
  ReturnSeries,
} from "./types";
import {
  AssetSeriesKeyMismatchError,
  InvalidPortfolioDefinitionError,
  InvalidPortfolioWeightsError,
  MissingAssetReturnSeriesError,
  NonFiniteReturnError,
} from "./types";

/**
 * Computes the static-weight portfolio return series:
 *
 *   Rp_t = Σ wi * Ri,t
 *
 * All asset series are aligned by date intersection first; a date missing
 * from any active asset disappears from the whole portfolio. Positions with
 * weight === 0 need no series, do not participate in alignment, do not
 * restrict dates, and do not contribute. Weights must be validated and sum to
 * ~1 before calling; normalization is never implicit.
 */
export function calculatePortfolioReturns(
  request: PortfolioReturnsRequest,
): ReturnSeries {
  const { portfolio, assetReturns } = request;
  if (typeof portfolio.id !== "string" || portfolio.id.length === 0) {
    throw new InvalidPortfolioDefinitionError(
      "Portfolio id must be a non-empty string.",
    );
  }

  const validation = validatePortfolioWeights(portfolio.positions);
  if (!validation.valid) {
    throw new InvalidPortfolioWeightsError(validation.errors.join(" "));
  }

  const seriesByAsset = new Map<string, ReturnSeries>();
  for (const [key, series] of assetReturns) {
    if (!series || series.assetId !== key) {
      throw new AssetSeriesKeyMismatchError(
        `Map key "${key}" does not match ReturnSeries.assetId "${series ? series.assetId : "undefined"}".`,
      );
    }
    seriesByAsset.set(key, series);
  }

  const active = portfolio.positions.filter((position) => position.weight !== 0);
  const assigned: ReturnSeries[] = [];
  for (const position of active) {
    const series = seriesByAsset.get(position.assetId);
    if (!series) {
      throw new MissingAssetReturnSeriesError(
        `Missing return series for asset "${position.assetId}".`,
      );
    }
    assigned.push(series);
  }

  const aligned = alignMultipleReturnSeries(assigned);
  const valueArrays = active.map(
    (position) => aligned.series.get(position.assetId) ?? [],
  );

  const points: ReturnPoint[] = [];
  for (let i = 0; i < aligned.dates.length; i += 1) {
    let total = 0;
    for (let j = 0; j < active.length; j += 1) {
      total += active[j].weight * valueArrays[j][i];
    }
    if (!Number.isFinite(total)) {
      throw new NonFiniteReturnError(
        `Non-finite portfolio return at "${aligned.dates[i]}".`,
      );
    }
    points.push({ date: aligned.dates[i], value: total });
  }

  return { assetId: portfolio.id, points };
}