/**
 * Presentation barrel.
 *
 * Display-only concerns (labels, formatting, user-facing messages) live here so
 * that the analytics engine stays a pure quantitative/domain module.
 * No React, provider, or network imports are allowed in this directory.
 */

export {
  CANONICAL_METRIC_METADATA,
  formatMetricValue,
  friendlyAnalyticsErrorMessage,
  interpretQuantitativeMetric,
  QUANTITATIVE_ANALYTICS_DISCLAIMER,
  QUANTITATIVE_NEUTRAL_INTERPRETATION,
} from "./quantitative-analytics";
export type {
  CanonicalMetricKey,
  InterpretableMetric,
  InterpretableQuantitativeSnapshot,
  MetricDisplayMetadata,
  QuantitativeMetricInterpretationInput,
} from "./quantitative-analytics";
