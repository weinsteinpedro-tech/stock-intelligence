import type { PortfolioPosition, PortfolioWeightValidation } from "./types";
import { InvalidPortfolioWeightsError } from "./types";

export const PORTFOLIO_WEIGHT_TOLERANCE = 1e-8;

function collectStructuralErrors(
  positions: readonly PortfolioPosition[],
): string[] {
  const errors: string[] = [];
  if (positions.length === 0) {
    errors.push("Portfolio must contain at least one position.");
    return errors;
  }
  const seen = new Set<string>();
  for (const position of positions) {
    if (
      typeof position !== "object" ||
      position === null ||
      typeof position.assetId !== "string" ||
      position.assetId.length === 0
    ) {
      errors.push("Position assetId must be a non-empty string.");
      continue;
    }
    if (seen.has(position.assetId)) {
      errors.push(`Duplicate asset "${position.assetId}" in portfolio.`);
    }
    seen.add(position.assetId);
    if (typeof position.weight !== "number" || !Number.isFinite(position.weight)) {
      errors.push(`Weight for "${position.assetId}" must be a finite number.`);
      continue;
    }
    if (position.weight < 0) {
      errors.push(`Weight for "${position.assetId}" must be non-negative.`);
    }
  }
  return errors;
}

/**
 * V1 rule: static weights, no short positions, weights must sum to ~1
 * within PORTFOLIO_WEIGHT_TOLERANCE. Returns an explicit validation result;
 * it does not normalize.
 */
export function validatePortfolioWeights(
  positions: readonly PortfolioPosition[],
): PortfolioWeightValidation {
  const errors = collectStructuralErrors(positions);
  let sum = 0;
  for (const position of positions) {
    if (typeof position.weight === "number" && Number.isFinite(position.weight)) {
      sum += position.weight;
    }
  }
  if (Math.abs(sum - 1) > PORTFOLIO_WEIGHT_TOLERANCE) {
    errors.push(
      `Weights must sum to 1 (within tolerance ${PORTFOLIO_WEIGHT_TOLERANCE}); sum is ${sum}.`,
    );
  }
  return { valid: errors.length === 0, errors, sum };
}

/**
 * Explicitly normalizes weights to sum to 1 by dividing by the current sum.
 * Callers must opt in consciously; normalization is never implicit in
 * calculation. Rejects structurally invalid portfolios and zero sums.
 */
export function normalizePortfolioWeights(
  positions: readonly PortfolioPosition[],
): PortfolioPosition[] {
  const structuralErrors = collectStructuralErrors(positions);
  if (structuralErrors.length > 0) {
    throw new InvalidPortfolioWeightsError(structuralErrors.join(" "));
  }
  let sum = 0;
  for (const position of positions) {
    sum += position.weight;
  }
  if (!Number.isFinite(sum) || sum === 0) {
    throw new InvalidPortfolioWeightsError(
      "Portfolio weight sum must be nonzero to normalize.",
    );
  }
  return positions.map((position) => ({
    assetId: position.assetId,
    weight: position.weight / sum,
  }));
}