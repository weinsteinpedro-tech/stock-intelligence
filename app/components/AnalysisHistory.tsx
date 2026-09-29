"use client";

import { useEffect, useState } from "react";
import type { AnalysisHistoryItem } from "@/lib/analysis-history";
import {
  deleteAnalysisHistory,
  getAnalysisHistory,
} from "@/lib/analysis-history";
import { AnalysisResultView } from "./AnalysisResultView";

interface AnalysisHistoryProps {
  symbol: string;
  companyName: string | null;
  refreshKey?: number;
}

type LoadState = "loading" | "loaded" | "error";

function formatGeneratedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AnalysisHistory({
  symbol,
  refreshKey = 0,
}: AnalysisHistoryProps) {
  const [items, setItems] = useState<AnalysisHistoryItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteErrorId, setDeleteErrorId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAnalysisHistory(symbol)
      .then((history) => {
        if (cancelled) return;
        setItems(history);
        setExpandedId(null);
        setLoadState("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, refreshKey, reloadKey]);

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this saved analysis?")) return;
    setDeletingId(id);
    setDeleteError(null);
    try {
      await deleteAnalysisHistory(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch (error) {
      setDeleteErrorId(id);
      setDeleteError(
        error instanceof Error ? error.message : "Could not delete analysis.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (loadState === "loading") {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Loading history…
      </p>
    );
  }

  if (loadState === "error") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-red-600 dark:text-red-400">
          Could not load analysis history.
        </p>
        <button
          type="button"
          onClick={() => {
            setLoadState("loading");
            setDeleteError(null);
            setReloadKey((key) => key + 1);
          }}
          className="w-fit rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No analyses yet.</p>;
  }

  return (
    <ul className="flex list-none flex-col gap-3">
      {items.map((item) => {
        const isExpanded = expandedId === item.id;
        return (
          <li
            key={item.id}
            className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold">
                  {item.symbol}
                  {item.companyName ? (
                    <span className="font-normal text-zinc-500 dark:text-zinc-400">
                      {" "}
                      — {item.companyName}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {formatGeneratedAt(item.generatedAt)}
                </p>
              </div>
            </div>

            <p className="line-clamp-3 text-sm text-zinc-600 dark:text-zinc-300">
              {item.analysis.analysis.summary}
            </p>

            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              <div>
                <dt className="font-medium">Positive Factors</dt>
                <dd className="mt-0.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  {item.analysis.analysis.positiveFactors.length}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Negative Factors</dt>
                <dd className="mt-0.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  {item.analysis.analysis.negativeFactors.length}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Sources used</dt>
                <dd className="mt-0.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  {item.analysis.sources.length}
                </dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
              >
                {isExpanded ? "Hide analysis" : "View analysis"}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(item.id)}
                disabled={deletingId === item.id}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-red-950 dark:hover:text-red-400"
              >
                {deletingId === item.id ? "Deleting…" : "Delete"}
              </button>
            </div>

            {deleteErrorId === item.id && deleteError && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {deleteError}
              </p>
            )}

            {isExpanded && (
              <div className="flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <div className="flex flex-col gap-0.5 rounded-lg bg-white px-3 py-2 dark:bg-zinc-900">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Historical analysis
                  </p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-300">
                    Generated {formatGeneratedAt(item.generatedAt)}
                  </p>
                </div>
                <AnalysisResultView analysis={item.analysis} mode="historical" />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}