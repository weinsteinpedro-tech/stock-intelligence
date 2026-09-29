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

export const PORTFOLIO_ANNUAL_RETURN_DATA_KEY = "portfolio_annual_return";
export const PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY =
  "portfolio_annualized_volatility";

/**
 * Annualized volatility is NOT a rate/return, so it gets its own contract
 * instead of being shoehorned into AnnualDecimalRate.
 */
export interface AnnualDecimalVolatility {
  volatility: number;
  period: "annual";
  representation: "decimal";
}

export function isValidAnnualDecimalVolatility(
  value: unknown,
): value is AnnualDecimalVolatility {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.volatility === "number" &&
    Number.isFinite(record.volatility) &&
    record.period === "annual" &&
    record.representation === "decimal"
  );
}

export interface CalculateSharpeRatioInput {
  portfolioReturn: number;
  riskFreeRate: number;
  portfolioVolatility: number;
}

export class InvalidSharpeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSharpeInputError";
  }
}

/**
 * Pure Sharpe ratio: (Rp - Rf) / σp on annual decimals. No annualization, no
 * percentage conversion, no fetching. Deterministically rejects non-finite
 * inputs and non-finite results so callers never see NaN/Infinity.
 */
export function calculateSharpeRatio(
  input: CalculateSharpeRatioInput,
): number {
  const entries: ReadonlyArray<readonly [string, number]> = [
    ["portfolioReturn", input.portfolioReturn],
    ["riskFreeRate", input.riskFreeRate],
    ["portfolioVolatility", input.portfolioVolatility],
  ];
  for (const [name, value] of entries) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new InvalidSharpeInputError(
        `${name} must be a finite number; got ${String(value)}.`,
      );
    }
  }
  if (input.portfolioVolatility <= 0) {
    throw new InvalidSharpeInputError(
      "portfolioVolatility must be > 0; the Sharpe ratio is undefined for zero or negative volatility.",
    );
  }
  const value =
    (input.portfolioReturn - input.riskFreeRate) / input.portfolioVolatility;
  if (!Number.isFinite(value)) {
    throw new InvalidSharpeInputError(
      "Sharpe ratio calculation produced a non-finite result.",
    );
  }
  return value;
}

export const sharpeIndicator: IndicatorDefinition = {
  id: "sharpe",
  name: "Sharpe Ratio",
  version: "1.0.0",
  category: "risk-adjusted-return",
  dependencies: {
    data: [
      PORTFOLIO_ANNUAL_RETURN_DATA_KEY,
      RISK_FREE_RATE_DATA_KEY,
      PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY,
    ],
    indicators: [],
  },
  calculate(context: IndicatorContext): IndicatorCalculation {
    const portfolioEnvelope = context.data[
      PORTFOLIO_ANNUAL_RETURN_DATA_KEY
    ] as DataEnvelope<unknown> | undefined;
    const riskFreeEnvelope = context.data[
      RISK_FREE_RATE_DATA_KEY
    ] as DataEnvelope<unknown> | undefined;
    const volatilityEnvelope = context.data[
      PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY
    ] as DataEnvelope<unknown> | undefined;
    if (!portfolioEnvelope || !riskFreeEnvelope || !volatilityEnvelope) {
      return {
        value: null,
        status: "insufficient_data",
        warnings: [
          `"${PORTFOLIO_ANNUAL_RETURN_DATA_KEY}", "${RISK_FREE_RATE_DATA_KEY}" and "${PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY}" envelopes are required.`,
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
    if (!isValidAnnualDecimalVolatility(volatilityEnvelope.value)) {
      return {
        value: null,
        status: "error",
        warnings: [
          `"${PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY}" must be an AnnualDecimalVolatility with period "annual" and representation "decimal".`,
        ],
      };
    }

    let value: number;
    try {
      value = calculateSharpeRatio({
        portfolioReturn: portfolioEnvelope.value.rate,
        riskFreeRate: riskFreeEnvelope.value.rate,
        portfolioVolatility: volatilityEnvelope.value.volatility,
      });
    } catch (error) {
      return {
        value: null,
        status: "error",
        warnings: [
          `Invalid Sharpe input: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }

    const sources = dedupeDataSourceReferences([
      ...dataEnvelopeToDataSourceReferences(portfolioEnvelope),
      ...dataEnvelopeToDataSourceReferences(riskFreeEnvelope),
      ...dataEnvelopeToDataSourceReferences(volatilityEnvelope),
    ]);

    return { value, status: "ok", sources, warnings: [] };
  },
  metadata: {
    description:
      "Risk-adjusted return measured as annual portfolio excess return divided by annualized portfolio volatility.",
    methodology:
      "Annual portfolio return minus annual risk-free rate, divided by annualized portfolio volatility.",
    formula: "Sharpe = (Rp - Rf) / σp",
    units: null,
  },
};