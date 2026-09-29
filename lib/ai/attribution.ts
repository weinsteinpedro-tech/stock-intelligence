/* ------------------------------------------------------------------ */
/* Deterministic evidence attribution for the UI.                      */
/*                                                                     */
/* The app (NOT Gemini) is the authority for visible publisher/date    */
/* attribution. Given the resolved evidence of a prose field and the   */
/* source ledger, this builds attribution lines purely from            */
/* Evidence.sourceIds -> Source -> publisher/publishedDate.            */
/*                                                                     */
/* Pure and deterministic: no dates guessed, no DATE_UNKNOWN           */
/* propagated from one source to another, and sources that share       */
/* exactly the same metadata are shown once.                           */
/* ------------------------------------------------------------------ */

import type { Evidence, Source } from "./types";

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Pure calendar helpers. No Date parsing (avoid ambiguous engine behavior).
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const base = [
    31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
  ];
  if (month === 2 && isLeapYear(year)) return 29;
  return base[month - 1];
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  return day <= daysInMonth(year, month);
}

// "2026-05-01" -> "1 May 2026". Returns null for anything that is not a
// calendar-valid YYYY-MM-DD string, so the raw value is never fabricated.
export function formatDisplayDate(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) return null;
  return `${day} ${MONTH_SHORT[month - 1]} ${year}`;
}

// Builds one attribution line per distinct source metadata, ordered
// deterministically (publishedDate ascending, "date unverified" last,
// publisher name as tie-break). Deduplicated so the same publisher + date
// does not repeat. Returns "" when there is no external-source evidence.
export function formatEvidenceAttribution(
  evidence: Evidence[],
  sources: Map<string, Source>,
): string {
  const seen = new Set<string>();
  const lines: { date: string | null; text: string }[] = [];

  for (const item of evidence) {
    if (item.type !== "external_source") continue;
    for (const sourceId of item.sourceIds) {
      const source = sources.get(sourceId);
      if (!source) continue;
      const date = source.publishedDate;
      const key = `${date ?? "\u0000unknown\u0000"}\u0000${source.publisher}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push({
        date,
        text:
          date === null
            ? `${source.publisher} \u00B7 date unverified`
            : `${source.publisher} \u00B7 ${formatDisplayDate(date) ?? date}`,
      });
    }
  }

  lines.sort((a, b) => {
    if (a.date !== b.date) {
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      return a.date.localeCompare(b.date);
    }
    return a.text.localeCompare(b.text);
  });

  return lines.map((line) => line.text).join("\n");
}

/* ------------------------------------------------------------------ */
/* Per-source attribution for the Evidence UI.                         */
/*                                                                     */
/* Root-cause fix: an Evidence item may resolve to SEVERAL sources.    */
/* The UI must render each source as its OWN row (title link + its     */
/* own publisher/date), never a single title with blended metadata.    */
/* These helpers are pure so the behavior is unit-testable without     */
/* rendering React.                                                    */
/* ------------------------------------------------------------------ */

export const DATE_UNVERIFIED = "date unverified";

// Display date for ONE source: its own publishedDate formatted, or exactly
// "date unverified" when it has none. A date is never copied from another
// source. Falls back to the raw value instead of fabricating a date.
export function sourceDateLabel(publishedDate: string | null): string {
  if (publishedDate === null) return DATE_UNVERIFIED;
  return formatDisplayDate(publishedDate) ?? publishedDate;
}

// Single metadata label for ONE source: "<publisher> · <date|date unverified>".
export function sourceAttributionLabel(source: Source): string {
  return `${source.publisher} \u00B7 ${sourceDateLabel(source.publishedDate)}`;
}

export interface EvidenceSourceRow {
  source: Source;
  attribution: string;
}

// Resolves ONE Evidence item to its sources, one row per source, in evidence
// order. Metadata NEVER crosses sources. Unknown/hidden source ids are skipped
// (never guessed).
export function evidenceSourceRows(
  item: Evidence,
  sources: Map<string, Source>,
): EvidenceSourceRow[] {
  if (item.type !== "external_source") return [];
  const rows: EvidenceSourceRow[] = [];
  for (const sourceId of item.sourceIds) {
    const source = sources.get(sourceId);
    if (!source) continue;
    rows.push({ source, attribution: sourceAttributionLabel(source) });
  }
  return rows;
}

// Deduplicated list of the sources ACTUALLY cited by factor evidence, in
// first-appearance order. The same source cited twice is listed once.
export function citedSources(
  factors: { evidence: Evidence[] }[],
  sources: Map<string, Source>,
): Source[] {
  const seen = new Set<string>();
  const result: Source[] = [];
  for (const factor of factors) {
    for (const item of factor.evidence) {
      if (item.type !== "external_source") continue;
      for (const sourceId of item.sourceIds) {
        if (seen.has(sourceId)) continue;
        const source = sources.get(sourceId);
        if (!source) continue;
        seen.add(sourceId);
        result.push(source);
      }
    }
  }
  return result;
}