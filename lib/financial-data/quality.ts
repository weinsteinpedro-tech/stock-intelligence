export type DataFreshness = "fresh" | "delayed" | "stale" | "unavailable";

export type SourceTier = "primary" | "licensed" | "secondary";

export interface DataQuality {
  freshness: DataFreshness;
  sourceTier: SourceTier;
  completeness: number;
  warnings: string[];
}

export function clampCompleteness(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function isValidCompleteness(value: number): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

export interface DataQualityInput {
  freshness: DataFreshness;
  sourceTier: SourceTier;
  completeness: number;
  warnings?: readonly string[];
}

export function makeDataQuality(input: DataQualityInput): DataQuality {
  return {
    freshness: input.freshness,
    sourceTier: input.sourceTier,
    completeness: clampCompleteness(input.completeness),
    warnings: Array.from(input.warnings ?? []),
  };
}

const FRESHNESS_RANK: Record<DataFreshness, number> = {
  unavailable: 0,
  stale: 1,
  delayed: 2,
  fresh: 3,
};

const SOURCE_TIER_RANK: Record<SourceTier, number> = {
  secondary: 0,
  licensed: 1,
  primary: 2,
};

export function worstFreshness(qualities: readonly DataQuality[]): DataFreshness {
  let worst: DataFreshness = "unavailable";
  let worstRank = Number.POSITIVE_INFINITY;
  for (const quality of qualities) {
    const rank = FRESHNESS_RANK[quality.freshness] ?? 0;
    if (rank < worstRank) {
      worstRank = rank;
      worst = quality.freshness;
    }
  }
  return worst;
}

export function worstSourceTier(qualities: readonly DataQuality[]): SourceTier {
  let worst: SourceTier = "secondary";
  let worstRank = Number.POSITIVE_INFINITY;
  for (const quality of qualities) {
    const rank = SOURCE_TIER_RANK[quality.sourceTier] ?? 0;
    if (rank < worstRank) {
      worstRank = rank;
      worst = quality.sourceTier;
    }
  }
  return worst;
}

/**
 * Compositional quality for derived data: freshness and source tier never
 * improve beyond the worst input, completeness is the conservative minimum,
 * and warnings are propagated and deduplicated. No financial policy.
 */
export function worstQuality(qualities: readonly DataQuality[]): DataQuality {
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const quality of qualities) {
    for (const warning of quality.warnings) {
      if (seen.has(warning)) continue;
      seen.add(warning);
      warnings.push(warning);
    }
  }
  return makeDataQuality({
    freshness: worstFreshness(qualities),
    sourceTier: worstSourceTier(qualities),
    completeness: qualities.length > 0
      ? Math.min(...qualities.map((quality) => quality.completeness))
      : 0,
    warnings,
  });
}