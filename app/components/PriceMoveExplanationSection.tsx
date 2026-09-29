"use client";

import type { Evidence, PriceMoveExplanation, Source } from "@/lib/ai/types";
import { cleanEvidenceExcerpt } from "@/lib/ai/evidenceDisplay";
import {
  citedSources,
  evidenceSourceRows,
  formatDisplayDate,
  sourceAttributionLabel,
} from "@/lib/ai/attribution";

const DISCLAIMER =
  "AI-generated explanation of this price move, based on public information published around the move window. Not investment advice.";

function SourceLink({ source }: { source: Source }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline decoration-blue-300 hover:decoration-blue-600 dark:text-blue-400"
    >
      {source.title} ↗
    </a>
  );
}

function QualityBadge({
  quality,
}: {
  quality: "strong" | "moderate" | "limited";
}) {
  const styles: Record<string, string> = {
    strong: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    moderate:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    limited: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };
  const label = quality.charAt(0).toUpperCase() + quality.slice(1);
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[quality]}`}
    >
      {label} evidence
    </span>
  );
}

function EvidenceEntry({
  item,
  sources,
}: {
  item: Evidence;
  sources: Map<string, Source>;
}) {
  const rows = evidenceSourceRows(item, sources);
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
        Evidence
      </p>
      <p className="mt-1 text-sm">
        {cleanEvidenceExcerpt(
          item.description,
          rows.length === 1 ? rows[0].source.title : undefined,
          rows.length === 1 ? rows[0].source.publisher : undefined,
        )}
      </p>
      {rows.length === 1 ? (
        <div className="mt-1">
          <SourceLink source={rows[0].source} />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {rows[0].attribution}
          </p>
        </div>
      ) : rows.length > 1 ? (
        <>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Evidence basis
          </p>
          <ul className="mt-1 flex list-none flex-col gap-1.5">
            {rows.map((row, index) => (
              <li key={`${row.source.id}-${index}`}>
                <SourceLink source={row.source} />
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {row.attribution}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          Source link unavailable.
        </p>
      )}
    </div>
  );
}

export function PriceMoveExplanationSection({
  explanation,
}: {
  explanation: PriceMoveExplanation;
}) {
  const move = explanation.move;
  const sources = new Map(
    explanation.sources.map((source) => [source.id, source]),
  );
  const usedSources = citedSources(explanation.factors, sources);
  const rising = move.percentChange >= 0;
  const changeClass = rising
    ? "text-green-700 dark:text-green-400"
    : "text-red-700 dark:text-red-400";

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-sm font-semibold">Price Move Explanation</h3>

      <p className="text-sm">
        <span className="font-medium">
          {formatDisplayDate(move.fromDate)} → {formatDisplayDate(move.toDate)}
        </span>{" "}
        <span className="text-zinc-500 dark:text-zinc-400">
          {move.fromClose.toFixed(2)} → {move.toClose.toFixed(2)}
        </span>{" "}
        <span className={`font-semibold ${changeClass}`}>
          {rising ? "+" : ""}
          {move.percentChange.toFixed(2)}%
        </span>
      </p>

      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Summary
        </p>
        <p className="text-sm">{explanation.summary}</p>
      </div>

      {explanation.factors.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Possible drivers
          </p>
          <ul className="flex list-none flex-col gap-2">
            {explanation.factors.map((factor, index) => (
              <li
                key={index}
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{factor.title}</p>
                  <QualityBadge quality={factor.evidenceQuality} />
                </div>
                <p className="text-sm">{factor.explanation}</p>
                <ul className="flex list-none flex-col gap-2">
                  {factor.evidence.map((item, itemIndex) => (
                    <li key={itemIndex}>
                      <EvidenceEntry item={item} sources={sources} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      {explanation.uncertainty && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Uncertainty
          </p>
          <p className="text-sm">{explanation.uncertainty}</p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Sources used
        </p>
        {usedSources.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No external sources were referenced for this explanation.
          </p>
        ) : (
          <ul className="flex list-none flex-col gap-2">
            {usedSources.map((source) => (
              <li
                key={source.id}
                className="flex flex-col gap-0.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <SourceLink source={source} />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {sourceAttributionLabel(source)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">{DISCLAIMER}</p>
    </section>
  );
}