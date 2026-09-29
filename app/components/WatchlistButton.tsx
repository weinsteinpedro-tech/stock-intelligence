"use client";

import { useEffect, useState, useTransition } from "react";
import {
  isInWatchlist,
  addToWatchlist,
  removeFromWatchlist,
} from "@/lib/watchlist";

interface WatchlistButtonProps {
  symbol: string;
  name: string | null;
  region: string | null;
  currency: string | null;
}

export function WatchlistButton({
  symbol,
  name,
  region,
  currency,
}: WatchlistButtonProps) {
  const [inWatchlist, setInWatchlist] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    isInWatchlist(symbol)
      .then((result) => {
        if (!cancelled) setInWatchlist(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed");
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  function toggle() {
    setError(null);
    startTransition(async () => {
      try {
        if (inWatchlist) {
          await removeFromWatchlist(symbol);
          setInWatchlist(false);
        } else {
          await addToWatchlist({
            symbol,
            name: name ?? symbol,
            region,
            currency,
          });
          setInWatchlist(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Operation failed");
      }
    });
  }

  if (inWatchlist === null && !error) {
    return (
      <button
        type="button"
        disabled
        className="rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800"
      >
        Loading…
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        className={`rounded-lg px-5 py-2.5 text-sm font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
          inWatchlist
            ? "border border-red-300 bg-white text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-950"
            : "bg-blue-600 text-white hover:bg-blue-700"
        }`}
      >
        {inWatchlist ? "Remove from Watchlist" : "Add to Watchlist"}
      </button>
      {error && (
        <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}
