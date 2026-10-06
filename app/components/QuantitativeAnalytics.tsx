"use client";

import { useState } from "react";
import type { PortfolioAnalysisSnapshot } from "@/lib/application";
import {
  CANONICAL_METRIC_METADATA,
  formatMetricValue,
  friendlyAnalyticsErrorMessage,
  interpretQuantitativeMetric,
  QUANTITATIVE_ANALYTICS_DISCLAIMER,
  type MetricDisplayMetadata,
} from "@/lib/presentation";

export interface QuantitativeAnalyticsProps {
  symbol: string;
  benchmarkSymbol: string;
  asOf: string;
}

type Status = "idle" | "loading" | "success" | "error";

interface ErrorState {
  code: string;
  message: string;
}

export function QuantitativeAnalytics({
  symbol,
  benchmarkSymbol,
  asOf,
}: QuantitativeAnalyticsProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [data, setData] = useState<PortfolioAnalysisSnapshot | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);

  const canAnalyze = typeof asOf === "string" && asOf.trim().length > 0;

  async function handleRun() {
    if (status === "loading" || !canAnalyze) return;

    setStatus("loading");
    setError(null);

    try {
      const response = await fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          benchmarkSymbol,
          asOf,
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        const errCode = json?.error?.code ?? "server_error";
        const message = friendlyAnalyticsErrorMessage(response.status, errCode);
        setError({ code: errCode, message });
        setStatus("error");
        return;
      }

      setData(json.data as PortfolioAnalysisSnapshot);
      setStatus("success");
    } catch {
      setError({
        code: "network_error",
        message: friendlyAnalyticsErrorMessage(500, "network_error"),
      });
      setStatus("error");
    }
  }

  const performanceMetrics = CANONICAL_METRIC_METADATA.filter(
    (m) => m.group === "performance",
  );
  const riskMetrics = CANONICAL_METRIC_METADATA.filter(
    (m) => m.group === "risk",
  );

  function renderMetricCard(metadata: MetricDisplayMetadata) {
    const metric = data?.metrics?.[metadata.key];
    const valueStr = formatMetricValue(
      metadata.key,
      metric?.value ?? null,
      metric?.status ?? "unavailable",
    );
    const interpretation = interpretQuantitativeMetric({
      metricKey: metadata.key,
      symbol,
      benchmarkSymbol,
      snapshot: data,
    });
    const hasWarnings = (metric?.warnings?.length ?? 0) > 0;

    return (
      <div
        key={metadata.key}
        className="flex flex-col justify-between rounded-md border border-zinc-200 bg-zinc-50/50 p-3.5 dark:border-zinc-800 dark:bg-zinc-800/40"
      >
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {metadata.label}
            </span>
            {metric && metric.status !== "ok" && (
              <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                {metric.status}
              </span>
            )}
          </div>
          <p className="mt-1 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {valueStr}
          </p>
        </div>

        <div className="mt-2.5">
          <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
            {interpretation}
          </p>
          {hasWarnings && metric?.warnings && (
            <div className="mt-1.5 rounded bg-amber-50 p-1.5 text-[10px] text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
              {metric.warnings.map((w: string, idx: number) => (
                <p key={idx}>{w}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Quantitative Analysis
            </h2>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              Benchmark: {benchmarkSymbol}
            </span>
            {asOf && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                · As of: {asOf}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Historical risk, factor sensitivity, and risk-adjusted return metrics
            relative to the benchmark.
          </p>
        </div>

        {status === "idle" && (
          <button
            type="button"
            onClick={handleRun}
            disabled={!canAnalyze}
            className="w-full shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            Run quantitative analysis
          </button>
        )}

        {status === "loading" && (
          <button
            type="button"
            disabled
            className="flex w-full shrink-0 cursor-wait items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white opacity-80 sm:w-auto"
          >
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Calculating metrics…
          </button>
        )}
      </div>

      {!canAnalyze && status === "idle" && (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Quantitative analysis requires historical market data for this symbol.
        </p>
      )}

      {status === "loading" && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="h-24 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800"
            />
          ))}
        </div>
      )}

      {status === "error" && error && (
        <div className="mt-4 flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900/60 dark:bg-red-950/40">
          <p className="font-medium text-red-800 dark:text-red-300">
            {error.message}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRun}
              className="w-fit rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700"
            >
              Retry
            </button>
            <span className="text-xs text-red-600 dark:text-red-400">
              Only runs on explicit request.
            </span>
          </div>
        </div>
      )}

      {status === "success" && data && (
        <div className="mt-6 flex flex-col gap-6">
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Performance &amp; Return
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {performanceMetrics.map(renderMetricCard)}
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Risk
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {riskMetrics.map(renderMetricCard)}
            </div>
          </div>

          <div className="border-t border-zinc-100 pt-3 text-[11px] text-zinc-400 dark:border-zinc-800">
            <p>{QUANTITATIVE_ANALYTICS_DISCLAIMER}</p>
            <p className="mt-0.5">
              As of {asOf} · Benchmark {benchmarkSymbol}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
