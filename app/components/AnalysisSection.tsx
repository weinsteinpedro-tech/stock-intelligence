"use client";

import { useMemo, useRef, useState } from "react";
import type { MarketSnapshot, PriceMoveExplanation } from "@/lib/ai/types";
import { derivePriceMove, priceMoveCacheKey } from "@/lib/ai/price-move-selection";
import type { HistoricalPrice } from "@/lib/market-data";
import { FutureAnalysis } from "./FutureAnalysis";
import { AnalysisHistory } from "./AnalysisHistory";
import { HistoricalChart } from "./HistoricalChart";
import { PriceMovePanel } from "./PriceMovePanel";
import type { PriceMoveStatus } from "./PriceMovePanel";
import { PriceMoveExplanationSection } from "./PriceMoveExplanationSection";

interface AnalysisSectionProps {
  snapshot: MarketSnapshot;
  symbol: string;
  companyName: string | null;
  historicalData: HistoricalPrice[];
}

export function AnalysisSection({
  snapshot,
  symbol,
  companyName,
  historicalData,
}: AnalysisSectionProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [status, setStatus] = useState<PriceMoveStatus>("idle");
  const [explanation, setExplanation] = useState<PriceMoveExplanation | null>(
    null,
  );
  const cacheRef = useRef(new Map<string, PriceMoveExplanation>());

  const move = useMemo(
    () =>
      selectedDate
        ? derivePriceMove(historicalData, selectedDate)
        : null,
    [historicalData, selectedDate],
  );

  const alreadyExplained = explanation !== null;

  function handleSelectMove(date: string | null) {
    if (date === null) {
      setSelectedDate(null);
      setStatus("idle");
      setExplanation(null);
      return;
    }
    // Points with no previous trading session are not selectable.
    const derived = derivePriceMove(historicalData, date);
    if (!derived) return;

    const cached = cacheRef.current.get(priceMoveCacheKey(symbol, derived));
    setSelectedDate(date);
    setExplanation(cached ?? null);
    setStatus(cached ? "success" : "selected");
  }

  async function handleExplain() {
    if (!move) return;
    const key = priceMoveCacheKey(symbol, move);
    const cached = cacheRef.current.get(key);
    if (cached) {
      setExplanation(cached);
      setStatus("success");
      return;
    }

    setStatus("loading");
    try {
      const response = await fetch("/api/explain-price-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          companyName: snapshot.name,
          region: snapshot.region,
          currency: snapshot.currency,
          fromDate: move.fromDate,
          toDate: move.toDate,
          fromClose: move.fromClose,
          toClose: move.toClose,
          absoluteChange: move.absoluteChange,
          percentChange: move.percentChange,
          fromVolume: move.fromVolume,
          toVolume: move.toVolume,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const body = payload as { code?: string };
        setStatus(
          body.code === "insufficient_evidence"
            ? "insufficient_evidence"
            : "error",
        );
        return;
      }
      const result = payload as PriceMoveExplanation;
      cacheRef.current.set(key, result);
      setExplanation(result);
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  function handleClear() {
    setSelectedDate(null);
    setStatus("idle");
    setExplanation(null);
  }

  const priceMoveSection = explanation ? (
    <PriceMoveExplanationSection explanation={explanation} />
  ) : null;

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-sm font-semibold">Historical Chart</h2>
        <HistoricalChart
          data={historicalData}
          symbol={symbol}
          selectedDate={selectedDate}
          onSelectMove={handleSelectMove}
        />
        <div className="mt-3">
          <PriceMovePanel
            move={move}
            status={status}
            alreadyExplained={alreadyExplained}
            onExplain={handleExplain}
            onClear={handleClear}
          />
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-sm font-semibold">Future Factors Analysis</h2>
        <FutureAnalysis
          snapshot={snapshot}
          onHistorySaved={() => setRefreshKey((key) => key + 1)}
          priceMoveSection={priceMoveSection}
        />
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-sm font-semibold">Analysis History</h2>
        <AnalysisHistory
          symbol={symbol}
          companyName={companyName}
          refreshKey={refreshKey}
        />
      </section>
    </div>
  );
}