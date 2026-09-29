import type { DataEnvelope } from "../../financial-data/types";
import {
  dataEnvelopeToDataSourceReferences,
  dedupeDataSourceReferences,
} from "../../financial-data/provenance";
import type {
  IndicatorCalculation,
  IndicatorContext,
  IndicatorDefinition,
} from "../types";
import { isValidAnnualDecimalRate, RISK_FREE_RATE_DATA_KEY } from "./capm";
import { PORTFOLIO_ANNUAL_RETURN_DATA_KEY } from "./sharpe";

/**
 * Treynor ratio V1 — risk-adjusted return measured as annual portfolio excess
 * return per unit of systematic risk.
 *
 *   Treynor = (Rp - Rf) / β
 *
 * Pure and provider-agnostic: only numbers + the formula. Never annualizes,
 * never converts percentages, never fetches. Beta arrives as an INDICATOR
 * dependency (never recalculated here); portfolio return and risk-free rate
 * arrive as prepared AnnualDecimalRate envelopes. No dataWindow is invented —
 * temporal methodology belongs to the portfolio-return builder and the beta
 * methodology.
 */
export interface CalculateTreynorRatioInput {
  portfolioReturn: number;
  riskFreeRate: number;
  beta: number;
}

export class InvalidTreynorInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTreynorInputError";
  }
}

/**
 * Pure calculator for the Treynor ratio. Deterministically rejects non-finite
 * inputs and non-finite results, and beta === 0 (division by zero) so callers
 * never see NaN/Infinity. Zero beta is NOT epsilon-guessed.
 */
export function calculateTreynorRatio(
  input: CalculateTreynorRatioInput,
): number {
  const entries: ReadonlyArray<readonly [string, number]> = [
    ["portfolioReturn", input.portfolioReturn],
    ["riskFreeRate", input.riskFreeRate],
    ["beta", input.beta],
  ];
  for (const [name, value] of entries) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new InvalidTreynorInputError(
        `${name} must be a finite number; got ${String(value)}.`,
      );
    }
  }
  if (input.beta === 0) {
    throw new InvalidTreynorInputError(
      "Treynor ratio is undefined when beta is zero.",
    );
  }
  const value =
    (input.portfolioReturn - input.riskFreeRate) / input.beta;
  if (!Number.isFinite(value)) {
    throw new InvalidTreynorInputError(
      "Treynor ratio calculation produced a non-finite result.",
    );
  }
  return value;
}

export const treynorIndicator: IndicatorDefinition = {
  id: "treynor",
  name: "Treynor Ratio",
  version: "1.0.0",
  category: "risk-adjusted-return",
  dependencies: {
    data: [PORTFOLIO_ANNUAL_RETURN_DATA_KEY, RISK_FREE_RATE_DATA_KEY],
    indicators: ["beta"],
  },
  calculate(context: IndicatorContext): IndicatorCalculation {
    const betaResult = context.indicators.get("beta");
    const beta =
      betaResult && betaResult.status === "ok" && typeof betaResult.value === "number"
        ? betaResult.value
        : null;
    if (betaResult && betaResult.status !== "ok") {
      return {
        value: null,
        status: "error",
        warnings: [
          "Treynor requires a beta dependency with status \"ok\"; beta was not ok.",
        ],
      };
    }
    if (beta === null || !Number.isFinite(beta)) {
      return {
        value: null,
        status: "error",
        warnings: [
          "Treynor requires an ok, finite beta dependency; none was available.",
        ],
      };
    }
    if (beta === 0) {
      return {
        value: null,
        status: "error",
        warnings: ["Treynor ratio is undefined when beta is zero."],
      };
    }

    const portfolioEnvelope = context.data[
      PORTFOLIO_ANNUAL_RETURN_DATA_KEY
    ] as DataEnvelope<unknown> | undefined;
    const riskFreeEnvelope = context.data[
      RISK_FREE_RATE_DATA_KEY
    ] as DataEnvelope<unknown> | undefined;
    if (!portfolioEnvelope || !riskFreeEnvelope) {
      return {
        value: null,
        status: "insufficient_data",
        warnings: [
          `Both "${PORTFOLIO_ANNUAL_RETURN_DATA_KEY}" and "${RISK_FREE_RATE_DATA_KEY}" envelopes are required.`,
        ],
      };
    }

    if (!isValidAnnualDecimalRate(portfolioEnvelope.value)) {
      return {
        value: null,
        status: "error",
        warnings: [
          `"${PORTFOLIO_ANNUAL_RETURN_DATA_KEY}" must be an AnnualDecimalRate with period "annual" and representation "decimal".`,
        ],
      };
    }
    if (!isValidAnnualDecimalRate(riskFreeEnvelope.value)) {
      return {
        value: null,
        status: "error",
        warnings: [
          `"${RISK_FREE_RATE_DATA_KEY}" must be an AnnualDecimalRate with period "annual" and representation "decimal".`,
        ],
      };
    }

    let value: number;
    try {
      value = calculateTreynorRatio({
        portfolioReturn: portfolioEnvelope.value.rate,
        riskFreeRate: riskFreeEnvelope.value.rate,
        beta,
      });
    } catch (error) {
      return {
        value: null,
        status: "error",
        warnings: [
          `Invalid Treynor input: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }

    const sources = dedupeDataSourceReferences([
      ...(betaResult?.sources ?? []),
      ...dataEnvelopeToDataSourceReferences(portfolioEnvelope),
      ...dataEnvelopeToDataSourceReferences(riskFreeEnvelope),
    ]);

    return { value, status: "ok", sources, warnings: [] };
  },
  metadata: {
    description:
      "Risk-adjusted return measured as annual portfolio excess return per unit of systematic risk.",
    methodology:
      "Annualized portfolio return minus annual risk-free rate, divided by portfolio beta.",
    formula: "Treynor = (Rp - Rf) / β",
    units: "annual decimal return per unit beta",
  },
};