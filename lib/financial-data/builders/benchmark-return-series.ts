import type { ReturnSeries } from "../../analytics/portfolio";
import type { DataEnvelope } from "../types";
import { buildReturnSeriesEnvelope } from "./return-series";
import type { ReturnSeriesBuildInput } from "./return-series";

/**
 * A benchmark is a caller decision. No specific market index or symbol is
 * hardcoded anywhere.
 */
export interface BenchmarkDefinition {
  id: string;
  symbol: string;
  name?: string;
}

export interface BenchmarkReturnSeriesBuildInput
  extends ReturnSeriesBuildInput {
  benchmark: BenchmarkDefinition;
}

/**
 * Wraps already-obtained price data for a benchmark into a
 * DataEnvelope<ReturnSeries>. The resulting assetId is the benchmark id, so
 * it unambiguously identifies the benchmark. Nothing is downloaded inside.
 */
export function buildBenchmarkReturnSeries(
  input: BenchmarkReturnSeriesBuildInput,
): DataEnvelope<ReturnSeries> {
  const { benchmark, ...rest } = input;
  return buildReturnSeriesEnvelope({
    ...rest,
    priceSeries: {
      assetId: benchmark.id,
      points: input.priceSeries.points,
    },
  });
}