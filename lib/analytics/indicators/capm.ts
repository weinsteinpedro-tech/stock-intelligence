import type { DataEnvelope } from "../../financial-data/types";
import {
  dataEnvelopeToDataSourceReferences,
  dedupeDataSourceReferences,
} from "../../financial-data/provenance";
import type { AnnualDecimalRate } from "../../financial-data/rates/risk-free-rate";
import type {
  IndicatorCalculation,
  IndicatorContext,
  IndicatorDefinition,
} from "../types";

export type { AnnualDecimalRate } from "../../financial-data/rates/risk-free-rate";

export const RISK_FREE_RATE_DATA_KEY = "risk_free_rate";
export const EXPECTED_MARKET_RETURN_DATA_KEY = "expected_market_return";

/**
 * Explicit unit contract for rate inputs. CAPM V1 accepts ONLY annual rates
 * expressed as decimals (0.04 = 4%). No conversion, no inference: percentage
 * or non-annual values are rejected deterministically. Conversion into this
 * shape belongs to future builders, never to this indicator.
 */
export interface CalculateCapmExpectedReturnInput {
  beta: number;
  riskFreeRate: number;
  expectedMarketReturn: number;
}

export class InvalidCapmInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCapmInputError";
  }
}

/**
 * Pure CAPM calculator. Knows only numbers and the CAPM formula:
 *
 *   E(Ri) = Rf + β × (E(Rm) - Rf)
 *
 * Works on decimal representation. Never converts percentages, never
 * annualizes. Deterministically rejects non-finite inputs and non-finite
 * results so callers never see NaN/Infinity.
 */
export function calculateCapmExpectedReturn(
  input: CalculateCapmExpectedReturnInput,
): number {
  const entries: ReadonlyArray<readonly [string, number]> = [
    ["beta", input.beta],
    ["riskFreeRate", input.riskFreeRate],
    ["expectedMarketReturn", input.expectedMarketReturn],
  ];
  for (const [name, value] of entries) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new InvalidCapmInputError(
        `${name} must be a finite number; got ${String(value)}.`,
      );
    }
  }
  const value =
    input.riskFreeRate +
    input.beta * (input.expectedMarketReturn - input.riskFreeRate);
  if (!Number.isFinite(value)) {
    throw new InvalidCapmInputError(
      "CAPM calculation produced a non-finite result.",
    );
  }
  return value;
}

export function isValidAnnualDecimalRate(value: unknown): value is AnnualDecimalRate {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.rate === "number" &&
    Number.isFinite(record.rate) &&
    record.period === "annual" &&
    record.representation === "decimal"
  );
}

export const capmIndicator: IndicatorDefinition = {
  id: "capm",
  name: "CAPM Expected Return",
  version: "1.0.0",
  category: "risk-adjusted-return",
  dependencies: {
    data: [RISK_FREE_RATE_DATA_KEY, EXPECTED_MARKET_RETURN_DATA_KEY],
    indicators: ["beta"],
  },
  calculate(context: IndicatorContext): IndicatorCalculation {
    const betaResult = context.indicators.get("beta");
    const beta =
      betaResult && betaResult.status === "ok" && typeof betaResult.value === "number"
        ? betaResult.value
        : null;
    if (beta === null || !Number.isFinite(beta)) {
      return {
        value: null,
        status: "error",
        warnings: [
          "CAPM requires an ok, finite beta dependency; none was available.",
        ],
      };
    }

    const riskFreeEnvelope = context.data[
      RISK_FREE_RATE_DATA_KEY
    ] as DataEnvelope<unknown> | undefined;
    const marketEnvelope = context.data[
      EXPECTED_MARKET_RETURN_DATA_KEY
    ] as DataEnvelope<unknown> | undefined;
    if (!riskFreeEnvelope || !marketEnvelope) {
      return {
        value: null,
        status: "insufficient_data",
        warnings: [
          `Both "${RISK_FREE_RATE_DATA_KEY}" and "${EXPECTED_MARKET_RETURN_DATA_KEY}" envelopes are required.`,
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
    if (!isValidAnnualDecimalRate(marketEnvelope.value)) {
      return {
        value: null,
        status: "error",
        warnings: [
          `"${EXPECTED_MARKET_RETURN_DATA_KEY}" must be an AnnualDecimalRate with period "annual" and representation "decimal".`,
        ],
      };
    }

    let value: number;
    try {
      value = calculateCapmExpectedReturn({
        beta,
        riskFreeRate: riskFreeEnvelope.value.rate,
        expectedMarketReturn: marketEnvelope.value.rate,
      });
    } catch (error) {
      return {
        value: null,
        status: "error",
        warnings: [
          `Invalid CAPM input: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }

    const sources = dedupeDataSourceReferences([
      ...(betaResult?.sources ?? []),
      ...dataEnvelopeToDataSourceReferences(riskFreeEnvelope),
      ...dataEnvelopeToDataSourceReferences(marketEnvelope),
    ]);

    return { value, status: "ok", sources, warnings: [] };
  },
  metadata: {
    description:
      "Expected return implied by CAPM given beta, a risk-free rate, and an expected market return.",
    methodology: "Risk-free rate plus beta times the expected market risk premium.",
    formula: "E(Ri) = Rf + β(E(Rm) - Rf)",
    units: "annual decimal return",
  },
};