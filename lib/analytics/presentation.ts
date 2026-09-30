/**
 * Presentation and display formatting helpers for Quantitative Analytics V1.
 * Pure presentation only; does not modify raw metric calculation values.
 */

export type CanonicalMetricKey =
  | "beta"
  | "capm"
  | "sharpe"
  | "treynor"
  | "portfolioRisk"
  | "marketRisk"
  | "systematicRisk"
  | "idiosyncraticRisk";

export interface MetricDisplayMetadata {
  key: CanonicalMetricKey;
  indicatorId: string;
  label: string;
  group: "performance" | "risk";
  description: string;
}

export const CANONICAL_METRIC_METADATA: readonly MetricDisplayMetadata[] = [
  {
    key: "beta",
    indicatorId: "beta",
    label: "Beta",
    group: "performance",
    description: "Sensitivity of the stock's returns to the benchmark.",
  },
  {
    key: "capm",
    indicatorId: "capm",
    label: "CAPM Expected Return",
    group: "performance",
    description:
      "Annual return implied by Beta, the risk-free rate, and expected market return.",
  },
  {
    key: "sharpe",
    indicatorId: "sharpe",
    label: "Sharpe Ratio",
    group: "performance",
    description: "Return above the risk-free rate relative to total volatility.",
  },
  {
    key: "treynor",
    indicatorId: "treynor",
    label: "Treynor Ratio",
    group: "performance",
    description: "Return above the risk-free rate relative to Beta.",
  },
  {
    key: "portfolioRisk",
    indicatorId: "portfolio_risk",
    label: "Portfolio Risk",
    group: "risk",
    description: "Annualized volatility of the stock.",
  },
  {
    key: "marketRisk",
    indicatorId: "market_risk",
    label: "Market Risk",
    group: "risk",
    description: "Annualized volatility of the benchmark.",
  },
  {
    key: "systematicRisk",
    indicatorId: "systematic_risk",
    label: "Systematic Risk",
    group: "risk",
    description: "Estimated volatility associated with benchmark exposure.",
  },
  {
    key: "idiosyncraticRisk",
    indicatorId: "idiosyncratic_risk",
    label: "Idiosyncratic Risk",
    group: "risk",
    description: "Estimated volatility not explained by benchmark exposure.",
  },
] as const;

/**
 * Formats a raw quantitative metric for display.
 * Never displays null as 0.
 * Never hides a non-ok status by formatting it as a number.
 */
export function formatMetricValue(
  metricKeyOrId: string,
  value: number | null,
  status: string,
): string {
  if (status !== "ok" || value === null || !Number.isFinite(value)) {
    return "Unavailable";
  }

  const normalized = metricKeyOrId.toLowerCase().replace(/_/g, "");

  // Ratios (Beta, Sharpe): display as decimal ratio (e.g. 1.25)
  if (normalized === "beta" || normalized === "sharpe") {
    return value.toFixed(2);
  }

  // Returns / Rates / Volatilities: display as percentages (e.g. 12.26%)
  if (
    normalized === "capm" ||
    normalized === "treynor" ||
    normalized.includes("risk")
  ) {
    return `${(value * 100).toFixed(2)}%`;
  }

  // Default fallback
  return value.toFixed(2);
}

/**
 * Maps API status codes and error codes to user-friendly messages.
 * Never exposes raw exceptions, provider URLs, API keys, or stack traces.
 */
export function friendlyAnalyticsErrorMessage(
  statusCode?: number,
  errorCode?: string,
): string {
  if (
    statusCode === 422 ||
    errorCode === "insufficient_data" ||
    errorCode === "missing_adjusted_close" ||
    errorCode === "risk_free_rate_stale" ||
    errorCode === "risk_free_rate_unavailable" ||
    errorCode === "market_return_anchor_stale" ||
    errorCode === "market_return_anchor_missing" ||
    errorCode === "expected_market_return_error" ||
    errorCode === "analysis_input_error"
  ) {
    return "The available market data is insufficient for this analysis.";
  }

  if (statusCode === 429 || errorCode === "rate_limit") {
    return "Data provider rate limit reached. Try again later.";
  }

  if (statusCode === 502 || errorCode === "upstream_provider_error") {
    return "Market data is temporarily unavailable.";
  }

  return "Quantitative analysis is temporarily unavailable.";
}
