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
} from "./quantitative-analytics";
export type {
  CanonicalMetricKey,
  MetricDisplayMetadata,
} from "./quantitative-analytics";
