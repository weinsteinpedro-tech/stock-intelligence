"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StockMatch } from "@/lib/market-data";

export function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState<StockMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setSubmitted(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Search failed");
      }
      const data = await res.json();
      setResults(data.matches ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    runSearch();
  }

  function selectResult(result: StockMatch) {
    const params = new URLSearchParams();
    if (result.name) params.set("name", result.name);
    if (result.currency) params.set("currency", result.currency);
    if (result.region) params.set("region", result.region);
    router.push(`/stocks/${result.symbol}?${params.toString()}`);
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSubmitted(false);
            }}
            placeholder="Search by symbol or company name..."
            className="w-full rounded-lg border border-zinc-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
          />
        </div>
        <button
          type="submit"
          disabled={!query.trim() || loading}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Search
        </button>
      </form>

      {submitted && !loading && (
        <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
          {error && (
            <p className="px-4 py-3 text-sm text-red-600">{error}</p>
          )}
          {!error && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-zinc-500">No results</p>
          )}
          {!error &&
            results.map((result) => (
              <button
                key={result.symbol}
                type="button"
                onClick={() => selectResult(result)}
                className="flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >
                <span className="truncate">
                  <span className="text-sm font-semibold">{result.symbol}</span>
                  <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">
                    {result.name}
                  </span>
                </span>
                <span className="flex shrink-0 gap-2 text-xs text-zinc-400">
                  {result.region && <span>{result.region}</span>}
                  {result.currency && <span>{result.currency}</span>}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
