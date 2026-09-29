/**
 * Portfolio risk metric indicators V1 — pure and provider-agnostic.
 *
 * Four thin IndicatorDefinitions reading from ONE pre-computed
 * DataEnvelope<PortfolioRiskDecomposition>:
 *
 *   1. portfolioRiskIndicator     id: "portfolio_risk"
 *      reads envelope.value.annual.portfolioVolatility
 *
 *   2. marketRiskIndicator        id: "market_risk"
 *      reads envelope.value.annual.marketVolatility
 *
 *   3. systematicRiskIndicator    id: "systematic_risk"
 *      reads envelope.value.annual.systematicVolatility
 *
 *   4. idiosyncraticRiskIndicator  id: "idiosyncratic_risk"
 *      reads envelope.value.annual.idiosyncraticVolatility
 *
 * No indicator recalculates risk; all four depend on the exact same data key
 * RISK_DECOMPOSITION_DATA_KEY ("risk_decomposition").
 */

import type { PortfolioRiskDecomposition } from "../portfolio";
import type {
  IndicatorCalculation,
  IndicatorContext,
  IndicatorDataWindow,
  IndicatorDefinition,
} from "../types";
import type { DataEnvelope } from "../../financial-data/types";
import { dataEnvelopeToDataSourceReferences } from "../../financial-data/provenance";

export const RISK_DECOMPOSITION_DATA_KEY = "risk_decomposition";

type RiskMetricField =
  | "portfolioVolatility"
  | "marketVolatility"
  | "systematicVolatility"
  | "idiosyncraticVolatility";

/**
 * Shared validator and field extractor for the four risk metric indicators.
 * Strictly reads from the pre-computed decomposition without recalculating risk.
 */
function calculateRiskMetric(
  context: IndicatorContext,
  field: RiskMetricField,
  label: string,
): IndicatorCalculation {
  const envelope = context.data[
    RISK_DECOMPOSITION_DATA_KEY
  ] as DataEnvelope<unknown> | undefined;

  if (!envelope) {
    return {
      value: null,
      status: "insufficient_data",
      warnings: [`"${RISK_DECOMPOSITION_DATA_KEY}" envelope is required.`],
    };
  }

  if (typeof envelope !== "object" || envelope === null) {
    return {
      value: null,
      status: "error",
      warnings: [
        `"${RISK_DECOMPOSITION_DATA_KEY}" must be a valid DataEnvelope object.`,
      ],
    };
  }

  const value = envelope.value as
    | Partial<PortfolioRiskDecomposition>
    | undefined;
  if (typeof value !== "object" || value === null) {
    return {
      value: null,
      status: "error",
      warnings: [
        `"${RISK_DECOMPOSITION_DATA_KEY}.value" must be a PortfolioRiskDecomposition object.`,
      ],
    };
  }

  const annual = value.annual;
  if (typeof annual !== "object" || annual === null) {
    return {
      value: null,
      status: "error",
      warnings: [
        `"${RISK_DECOMPOSITION_DATA_KEY}.value.annual" must be a RiskDecompositionAnnual object.`,
      ],
    };
  }

  const metricValue = annual[field];
  if (typeof metricValue !== "number" || !Number.isFinite(metricValue)) {
    return {
      value: null,
      status: "error",
      warnings: [
        `${label} ("${field}") must be a finite number; got ${String(metricValue)}.`,
      ],
    };
  }

  if (metricValue < 0) {
    return {
      value: null,
      status: "error",
      warnings: [
        `${label} ("${field}") must be non-negative; got ${metricValue}.`,
      ],
    };
  }

  const sources = dataEnvelopeToDataSourceReferences(envelope);

  let dataWindow: IndicatorDataWindow | undefined;
  if (
    Array.isArray(value.dates) &&
    value.dates.length > 0 &&
    typeof value.observationCount === "number"
  ) {
    dataWindow = {
      startDate: value.dates[0],
      endDate: value.dates[value.dates.length - 1],
      observations: value.observationCount,
    };
  }

  const result: IndicatorCalculation = {
    value: metricValue,
    status: "ok",
    sources,
    warnings: [],
  };
  if (dataWindow) {
    result.dataWindow = dataWindow;
  }
  return result;
}

export const portfolioRiskIndicator: IndicatorDefinition = {
  id: "portfolio_risk",
  name: "Portfolio Risk",
  version: "1.0.0",
  category: "risk",
  dependencies: {
    data: [RISK_DECOMPOSITION_DATA_KEY],
    indicators: [],
  },
  calculate(context: IndicatorContext): IndicatorCalculation {
    return calculateRiskMetric(context, "portfolioVolatility", "Portfolio Risk");
  },
  metadata: {
    description: "Total annualized volatility of portfolio daily returns.",
    methodology:
      "Sample standard deviation of aligned portfolio daily returns, annualized using the risk decomposition methodology.",
    formula: "σp = sqrt(252 * Var(Rp))",
    units: "annual decimal volatility",
  },
};

export const marketRiskIndicator: IndicatorDefinition = {
  id: "market_risk",
  name: "Market Risk",
  version: "1.0.0",
  category: "risk",
  dependencies: {
    data: [RISK_DECOMPOSITION_DATA_KEY],
    indicators: [],
  },
  calculate(context: IndicatorContext): IndicatorCalculation {
    return calculateRiskMetric(context, "marketVolatility", "Market Risk");
  },
  metadata: {
    description: "Annualized volatility of the selected market benchmark.",
    methodology:
      "Sample standard deviation of aligned benchmark daily returns, annualized using the risk decomposition methodology.",
    formula: "σm = sqrt(252 * Var(Rm))",
    units: "annual decimal volatility",
  },
};

export const systematicRiskIndicator: IndicatorDefinition = {
  id: "systematic_risk",
  name: "Systematic Risk",
  version: "1.0.0",
  category: "risk",
  dependencies: {
    data: [RISK_DECOMPOSITION_DATA_KEY],
    indicators: [],
  },
  calculate(context: IndicatorContext): IndicatorCalculation {
    return calculateRiskMetric(context, "systematicVolatility", "Systematic Risk");
  },
  metadata: {
    description:
      "Annualized portfolio volatility attributable to beta exposure to the selected market benchmark.",
    methodology:
      "Absolute portfolio beta multiplied by annualized benchmark volatility.",
    formula: "σ_sys = |β| * σm",
    units: "annual decimal volatility",
  },
};

export const idiosyncraticRiskIndicator: IndicatorDefinition = {
  id: "idiosyncratic_risk",
  name: "Idiosyncratic Risk",
  version: "1.0.0",
  category: "risk",
  dependencies: {
    data: [RISK_DECOMPOSITION_DATA_KEY],
    indicators: [],
  },
  calculate(context: IndicatorContext): IndicatorCalculation {
    return calculateRiskMetric(context, "idiosyncraticVolatility", "Idiosyncratic Risk");
  },
  metadata: {
    description:
      "Annualized portfolio volatility not explained by beta exposure to the selected market benchmark.",
    methodology:
      "Sample standard deviation of market-model residual returns, annualized using the risk decomposition methodology.",
    formula: "σ_idio = sqrt(252 * Var(ε))",
    units: "annual decimal volatility",
  },
};
