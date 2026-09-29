"use client";

import type { PriceMoveSelection } from "@/lib/ai/price-move-selection";
import { formatDisplayDate } from "@/lib/ai/attribution";

export type PriceMoveStatus =
  | "idle"
  | "selected"
  | "loading"
  | "success"
  | "insufficient_evidence"
  | "error";

export const PRICE_MOVE_STATUS_MESSAGES: Record<
  Exclude<PriceMoveStatus, "idle" | "success">,
  string
> = {
  selected: 'Selected move — click "Explain this move" to research it.',
  loading: "Researching this price move...",
  insufficient_evidence:
    "Not enough reliable information was found to explain this move.",
  error: "The explanation service is temporarily unavailable.",
};

export function PriceMovePanel({
  move,
  status,
  alreadyExplained,
  onExplain,
  onClear,
}: {
  move: PriceMoveSelection | null;
  status: PriceMoveStatus;
  alreadyExplained: boolean;
  onExplain: () => void;
  onClear: () => void;
}) {
  if (!move) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        Click a point on the chart to analyze why the stock moved on that
        session (from the previous trading session&apos;s close).
      </div>
    );
  }

  const percent = move.percentChange;
  const rising = percent >= 0;
  const statusMessage =
    status === "selected" || status === "loading" || status === "insufficient_evidence" || status === "error"
      ? PRICE_MOVE_STATUS_MESSAGES[status]
      : null;
  const busy = status === "loading";
  const showExplain = status !== "loading" && !alreadyExplained;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium">
          {formatDisplayDate(move.fromDate)} →
        </span>
        <span className="font-medium">{formatDisplayDate(move.toDate)}</span>
        <span className="text-zinc-500 dark:text-zinc-400">
          {move.fromClose.toFixed(2)} → {move.toClose.toFixed(2)}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            rising
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
              : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
          }`}
        >
          {rising ? "+" : ""}
          {percent.toFixed(2)}%
        </span>
      </div>

      {statusMessage && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {statusMessage}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {showExplain && (
          <button
            type="button"
            onClick={onExplain}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            {status === "insufficient_evidence" || status === "error"
              ? "Try again"
              : "Explain this move"}
          </button>
        )}
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="rounded-lg border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Clear
        </button>
      </div>
    </div>
  );
}