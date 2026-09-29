"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getWatchlist,
  removeFromWatchlist,
  type WatchlistRow,
} from "@/lib/watchlist";

export function WatchlistSection() {
  const [items, setItems] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getWatchlist()
      .then(setItems)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  }, []);

  function retry() {
    setLoading(true);
    setError(null);
    getWatchlist()
      .then(setItems)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  }

  function remove(symbol: string) {
    removeFromWatchlist(symbol)
      .then(() => setItems((prev) => prev.filter((i) => i.symbol !== symbol)))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to remove"),
      );
  }

  if (loading) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        Loading watchlist…
      </p>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-dashed border-red-300 p-8 text-center text-sm text-red-600 dark:border-red-800 dark:text-red-400">
        <p>{error}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-2 underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        No stocks in your watchlist yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-center justify-between gap-3 px-4 py-3"
        >
          <Link
            href={`/stocks/${item.symbol}?name=${encodeURIComponent(item.name)}&currency=${encodeURIComponent(item.currency ?? "")}&region=${encodeURIComponent(item.region ?? "")}`}
            className="min-w-0 flex-1"
          >
            <span className="text-sm font-semibold">{item.symbol}</span>
            <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">
              {item.name}
            </span>
            {(item.region || item.currency) && (
              <span className="ml-2 text-xs text-zinc-400">
                {[item.region, item.currency].filter(Boolean).join(" · ")}
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => remove(item.symbol)}
            className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
