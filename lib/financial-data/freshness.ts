import type { DataFreshness } from "./quality";

export const DEFAULT_FRESH_WITHIN_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_DELAYED_WITHIN_MS = 3 * 24 * 60 * 60 * 1000;

export interface FreshnessThresholds {
  freshWithinMs: number;
  delayedWithinMs: number;
}

function toMs(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function ageInMs(
  observedAt: string | null | undefined,
  retrievedAt: string | null | undefined,
): number | null {
  const observedMs = toMs(observedAt);
  const retrievedMs = toMs(retrievedAt);
  if (observedMs === null || retrievedMs === null) return null;
  return retrievedMs - observedMs;
}

export function classifyFreshness(
  observedAt: string | null | undefined,
  retrievedAt: string | null | undefined,
  thresholds: FreshnessThresholds = {
    freshWithinMs: DEFAULT_FRESH_WITHIN_MS,
    delayedWithinMs: DEFAULT_DELAYED_WITHIN_MS,
  },
): DataFreshness {
  const age = ageInMs(observedAt, retrievedAt);
  if (age === null || age < 0) return "unavailable";
  if (age <= thresholds.freshWithinMs) return "fresh";
  if (age <= thresholds.delayedWithinMs) return "delayed";
  return "stale";
}