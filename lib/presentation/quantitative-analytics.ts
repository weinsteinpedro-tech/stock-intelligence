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
    label: "Stock Risk",
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

  // Ratios (Beta, Sharpe, Treynor): display as decimal ratio (e.g. 1.25)
  if (
    normalized === "beta" ||
    normalized === "sharpe" ||
    normalized === "treynor"
  ) {
    return value.toFixed(2);
  }

  // Returns / Rates / Volatilities: display as percentages (e.g. 12.26%)
  if (normalized === "capm" || normalized.includes("risk")) {
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

/* -------------------------------------------------------------------------- */
/* Dynamic interpretation of already-computed quantitative metrics.            */
/*                                                                             */
/* Presentation only: this reads values that the analytics engine has already  */
/* produced and turns them into short, historical copy. It derives nothing     */
/* and computes nothing - it only classifies and compares values that are     */
/* already present in the snapshot, purely to choose wording.                  */
/* -------------------------------------------------------------------------- */

/** Minimal structural view of a computed metric; no engine types are imported. */
export interface InterpretableMetric {
  value: number | null;
  status: string;
}

/** Minimal structural view of a portfolio analysis snapshot. */
export interface InterpretableQuantitativeSnapshot {
  metrics: Partial<Record<CanonicalMetricKey, InterpretableMetric | undefined>>;
}

export interface QuantitativeMetricInterpretationInput {
  metricKey: CanonicalMetricKey;
  symbol: string;
  benchmarkSymbol: string;
  snapshot: InterpretableQuantitativeSnapshot | null | undefined;
}

export const QUANTITATIVE_NEUTRAL_INTERPRETATION =
  "Not enough reliable data is available to interpret this metric.";

export const QUANTITATIVE_ANALYTICS_DISCLAIMER =
  "Based on historical adjusted-close market data and the selected benchmark. These indicators help interpret risk and return, but do not predict future prices.";

/** Beta band edges for "in line with the benchmark" wording. */
const BETA_IN_LINE_MIN = 0.8;
const BETA_IN_LINE_MAX = 1.2;

/** Sharpe band edges for historical risk-adjusted compensation wording. */
const SHARPE_BAND_LOW = 0.5;
const SHARPE_BAND_MID = 1;
const SHARPE_BAND_HIGH = 2;

/** Presentation-only tolerance for "these two values are similar" wording. */
const SIMILAR_RELATIVE_TOLERANCE = 0.05;

/** Presentation-only tolerance for treating a value as "close to zero". */
const NEAR_ZERO_TOLERANCE = 1e-6;

function absoluteValue(value: number): number {
  return value < 0 ? -value : value;
}

function displayName(value: string | null | undefined, fallback: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Presentation-only relative distance used purely to choose wording.
 * Not a financial calculation and never alters a metric value.
 */
function relativeDifference(left: number, right: number): number {
  const leftAbs = absoluteValue(left);
  const rightAbs = absoluteValue(right);
  const scale = leftAbs > rightAbs ? leftAbs : rightAbs;
  if (scale === 0) return 0;
  return absoluteValue(left - right) / scale;
}

function isSimilar(left: number, right: number): boolean {
  return relativeDifference(left, right) <= SIMILAR_RELATIVE_TOLERANCE;
}

/**
 * Returns the metric value only when it is genuinely interpretable.
 * Never substitutes 0 for a missing or unusable value.
 */
function usableValue(
  metric: InterpretableMetric | null | undefined,
): number | null {
  if (!metric) return null;
  if (metric.status !== "ok") return null;
  if (typeof metric.value !== "number") return null;
  if (!Number.isFinite(metric.value)) return null;
  return metric.value;
}

function interpretBeta(
  symbol: string,
  benchmarkSymbol: string,
  value: number,
): string {
  if (value < 0) {
    return `${symbol}'s historical movement has tended to run opposite to ${benchmarkSymbol}, which is unusual and may not persist. If this relationship persists, broad market moves may affect the stock differently.`;
  }

  if (value < BETA_IN_LINE_MIN) {
    return `${symbol} has tended to move less than ${benchmarkSymbol}, suggesting lower sensitivity to broad market swings. If this relationship persists, general market moves may have a smaller effect on the stock.`;
  }

  if (value <= BETA_IN_LINE_MAX) {
    return `${symbol} has tended to move broadly in line with ${benchmarkSymbol}, suggesting similar sensitivity to overall market movements.`;
  }

  return `${symbol} has tended to move more strongly than ${benchmarkSymbol}, suggesting greater sensitivity to broad market swings. If this relationship persists, market moves may have a larger effect on the stock.`;
}

function interpretCapm(symbol: string, value: number): string {
  const formatted = formatMetricValue("capm", value, "ok");
  return `Based on its Beta, the current risk-free rate, and expected market return, CAPM associates ${symbol} with an annual expected return of ${formatted}. This is a theoretical reference, not a forecast of future performance.`;
}

function interpretSharpe(symbol: string, value: number): string {
  if (value < 0) {
    return `${symbol}'s historical returns did not compensate for the risk-free rate over the measured period.`;
  }

  if (value < SHARPE_BAND_LOW) {
    return `${symbol}'s historical return compensation for total volatility has been relatively limited.`;
  }

  if (value < SHARPE_BAND_MID) {
    return `${symbol}'s historical returns have provided moderate compensation for total volatility.`;
  }

  if (value < SHARPE_BAND_HIGH) {
    return `${symbol}'s historical returns have compensated reasonably well for total volatility.`;
  }

  return `${symbol}'s historical returns have shown strong compensation for total volatility.`;
}

function interpretTreynor(symbol: string, value: number): string {
  if (value > NEAR_ZERO_TOLERANCE) {
    const formatted = formatMetricValue("treynor", value, "ok");
    return `${symbol} has generated positive excess return per unit of market-related risk over the measured period. The current Treynor ratio is ${formatted}.`;
  }

  if (value < -NEAR_ZERO_TOLERANCE) {
    return `${symbol} has generated negative excess return per unit of market-related risk over the measured period.`;
  }

  return `${symbol}'s historical excess return per unit of market-related risk has been close to zero.`;
}

function interpretPortfolioRisk(
  symbol: string,
  benchmarkSymbol: string,
  value: number,
  marketRiskValue: number | null,
): string {
  if (marketRiskValue === null) return QUANTITATIVE_NEUTRAL_INTERPRETATION;

  if (isSimilar(value, marketRiskValue)) {
    return `${symbol} and ${benchmarkSymbol} have shown similar annualized volatility.`;
  }

  if (value > marketRiskValue) {
    return `${symbol} has been more volatile than ${benchmarkSymbol} over the measured period, indicating larger historical price fluctuations.`;
  }

  return `${symbol} has been less volatile than ${benchmarkSymbol} over the measured period, indicating smaller historical price fluctuations.`;
}

function interpretMarketRisk(
  symbol: string,
  benchmarkSymbol: string,
  value: number,
): string {
  const formatted = formatMetricValue("marketRisk", value, "ok");
  return `${benchmarkSymbol} has shown annualized volatility of ${formatted} over the measured period. This provides the market-risk reference used to evaluate ${symbol}.`;
}

function interpretSystematicRisk(
  symbol: string,
  value: number,
  idiosyncraticRiskValue: number | null,
): string {
  if (idiosyncraticRiskValue === null) return QUANTITATIVE_NEUTRAL_INTERPRETATION;

  if (isSimilar(value, idiosyncraticRiskValue)) {
    return `The market-related and company-specific volatility components of ${symbol} are of similar magnitude.`;
  }

  if (value > idiosyncraticRiskValue) {
    return `The market-related component of ${symbol}'s historical volatility is larger than its company-specific component, suggesting broader market movements have been especially important.`;
  }

  return `The market-related component is smaller than the company-specific component, suggesting ${symbol}'s historical volatility has depended less on broad market movements than on stock-specific factors.`;
}

function interpretIdiosyncraticRisk(
  symbol: string,
  value: number,
  systematicRiskValue: number | null,
): string {
  if (systematicRiskValue === null) return QUANTITATIVE_NEUTRAL_INTERPRETATION;

  if (isSimilar(value, systematicRiskValue)) {
    return `Company-specific and market-related volatility components of ${symbol} are of similar magnitude.`;
  }

  if (value > systematicRiskValue) {
    return `The company-specific component of ${symbol}'s historical volatility is larger than its market-related component. Company developments may therefore remain important alongside broader market conditions.`;
  }

  return `The company-specific component is smaller than the market-related component, so broad market movements have represented the larger historical volatility component.`;
}

/**
 * Produces a short, dynamic, historical interpretation for one canonical metric.
 *
 * Pure and deterministic: same input always yields the same string. Reads only
 * values already computed by the analytics engine and never recalculates them.
 * Uses the supplied `symbol` and `benchmarkSymbol` for stock-specific wording,
 * so it works for any symbol analyzed by the app. Never offers investment
 * advice and never states a deterministic future outcome.
 */
export function interpretQuantitativeMetric({
  metricKey,
  symbol: rawSymbol,
  benchmarkSymbol: rawBenchmarkSymbol,
  snapshot,
}: QuantitativeMetricInterpretationInput): string {
  const symbol = displayName(rawSymbol, "The stock");
  const benchmarkSymbol = displayName(rawBenchmarkSymbol, "the benchmark");
  const metrics = snapshot?.metrics;
  const value = usableValue(metrics?.[metricKey]);

  if (value === null) return QUANTITATIVE_NEUTRAL_INTERPRETATION;

  switch (metricKey) {
    case "beta":
      return interpretBeta(symbol, benchmarkSymbol, value);
    case "capm":
      return interpretCapm(symbol, value);
    case "sharpe":
      return interpretSharpe(symbol, value);
    case "treynor":
      return interpretTreynor(symbol, value);
    case "portfolioRisk":
      return interpretPortfolioRisk(
        symbol,
        benchmarkSymbol,
        value,
        usableValue(metrics?.marketRisk),
      );
    case "marketRisk":
      return interpretMarketRisk(symbol, benchmarkSymbol, value);
    case "systematicRisk":
      return interpretSystematicRisk(
        symbol,
        value,
        usableValue(metrics?.idiosyncraticRisk),
      );
    case "idiosyncraticRisk":
      return interpretIdiosyncraticRisk(
        symbol,
        value,
        usableValue(metrics?.systematicRisk),
      );
  }
}
