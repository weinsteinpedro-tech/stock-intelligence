"use client";

import type { ReactNode } from "react";
import type {
  AnalysisApiResponse,
  Catalyst,
  Evidence,
  MarketContext,
  MarketSnapshot,
  Scenario,
  Source,
  TechnicalTrend,
} from "@/lib/ai/types";
import { cleanEvidenceExcerpt } from "@/lib/ai/evidenceDisplay";
import { formatEvidenceAttribution } from "@/lib/ai/attribution";

type EvidenceQuality = "strong" | "moderate" | "limited";
type Horizon = "days" | "weeks" | "months";

export type AnalysisResultViewMode = "current" | "historical";

export interface AnalysisResultViewProps {
  analysis: AnalysisApiResponse;
  mode: AnalysisResultViewMode;
  marketSnapshot?: MarketSnapshot;
  /** Rendered between Technical Trend and Positive Factors (price-move section). */
  afterTechnicalTrend?: ReactNode;
}

const QUALITY_LABELS: Record<Source["quality"], string> = {
  primary: "Primary source",
  high_quality_secondary: "High-quality secondary source",
  other: "Other",
};

const HORIZON_LABELS: Record<Horizon, string> = {
  days: "Days",
  weeks: "Weeks",
  months: "Months",
};

const EVIDENCE_HINT = "Reported or sourced information";
const ASSUMPTIONS_HINT = "Conditions treated as true for this analysis";
const TECHNICAL_DATA_HINT = "Deterministic interpretation of measured metrics";

const DISCLAIMER =
  "AI-generated analysis based on current public information. Not investment advice.";

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

function SourcesForIds({
  ids,
  sources,
}: {
  ids: string[];
  sources: Map<string, Source>;
}) {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return null;
  return (
    <ul className="flex list-none flex-col gap-1">
      {unique.map((id) => {
        const source = sources.get(id);
        if (!source) return null;
        return (
          <li key={id} className="truncate text-sm">
            <SourceLink source={source} />
          </li>
        );
      })}
    </ul>
  );
}

function QualityBadge({ quality }: { quality: EvidenceQuality }) {
  const styles: Record<EvidenceQuality, string> = {
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

function ExternalEvidenceCard({
  item,
  sources,
}: {
  item: Evidence;
  sources: Map<string, Source>;
}) {
  const items = item.sourceIds.length > 0 ? item.sourceIds : [null];
  return (
    <li className="flex list-none flex-col gap-2">
      {items.map((sourceId, index) => {
        const source = sourceId === null ? undefined : sources.get(sourceId);
        const key = sourceId ?? `missing-${index}`;
        return (
          <div
            key={key}
            className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
              External evidence
            </p>
            {source ? (
              <>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {source.publisher} · {source.publishedDate ?? "date unverified"} ·
                  {QUALITY_LABELS[source.quality]}
                </p>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-sm font-medium text-blue-600 underline decoration-blue-300 hover:decoration-blue-600 dark:text-blue-400"
                >
                  {source.title} ↗
                </a>
              </>
            ) : (
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                Source link unavailable.
              </p>
            )}
            <p className="mt-1 text-sm">
              {cleanEvidenceExcerpt(
                item.description,
                source?.title,
                source?.publisher,
              )}
            </p>
          </div>
        );
      })}
    </li>
  );
}

function EvidenceCard({
  item,
  sources,
}: {
  item: Evidence;
  sources: Map<string, Source>;
}) {
  if (item.type === "app_data") {
    return (
      <li className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          App data
        </p>
        <p className="mt-1 text-sm">{item.description}</p>
      </li>
    );
  }
  return <ExternalEvidenceCard item={item} sources={sources} />;
}

function EvidenceList({
  evidence,
  sources,
}: {
  evidence: Evidence[];
  sources: Map<string, Source>;
}) {
  if (evidence.length === 0) return null;
  return (
    <ul className="flex list-none flex-col gap-2">
      {evidence.map((item, index) => (
        <EvidenceCard key={index} item={item} sources={sources} />
      ))}
    </ul>
  );
}

function KindBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-400">
      {children}
    </span>
  );
}

function FieldHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      {hint && <p className="text-xs text-zinc-400 dark:text-zinc-500">{hint}</p>}
    </div>
  );
}

function EvidenceBasis({
  evidence,
  sources,
}: {
  evidence: Evidence[];
  sources: Map<string, Source>;
}) {
  const attribution = formatEvidenceAttribution(evidence, sources);
  if (!attribution) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
        Evidence basis
      </p>
      <p className="whitespace-pre-line text-xs text-zinc-500 dark:text-zinc-400">
        {attribution}
      </p>
    </div>
  );
}

function StringList({
  items,
  label,
  hint,
  badge,
}: {
  items: string[];
  label: string;
  hint?: string;
  badge?: ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          {label}
        </p>
        {badge}
        {hint && <p className="text-xs text-zinc-400 dark:text-zinc-500">{hint}</p>}
      </div>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function FactorCard({
  factor,
  sources,
  kind,
}: {
  factor: {
    title: string;
    conclusion: string;
    evidence: Evidence[];
    assumptions: string[];
    rationale: string;
    evidenceQuality: EvidenceQuality;
    horizon: Horizon;
  };
  sources: Map<string, Source>;
  kind: "positive" | "negative";
}) {
  const allSourceIds = factor.evidence
    .filter((item) => item.type === "external_source")
    .flatMap((item) => item.sourceIds);

  return (
    <li
      className={`rounded-lg border p-4 ${
        kind === "positive"
          ? "border-green-200 bg-green-50/40 dark:border-green-900 dark:bg-green-950/30"
          : "border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/30"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold">{factor.title}</h4>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <QualityBadge quality={factor.evidenceQuality} />
        </div>
      </div>
      <EvidenceBasis evidence={factor.evidence} sources={sources} />
      <p className="mt-2 text-sm">{factor.conclusion}</p>

      <div className="mt-3 flex flex-col gap-3">
        <div>
          <FieldHeading label="Evidence" hint={EVIDENCE_HINT} />
          <div className="mt-1">
            <EvidenceList evidence={factor.evidence} sources={sources} />
          </div>
        </div>
        <StringList
          items={factor.assumptions}
          label="Assumptions"
          hint={ASSUMPTIONS_HINT}
        />
        <div>
          <EvidenceBasis evidence={factor.evidence} sources={sources} />
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              Why this matters
            </p>
            <KindBadge>Inference</KindBadge>
          </div>
          <p className="mt-1 text-sm">{factor.rationale}</p>
        </div>
        {(allSourceIds.length > 0 || factor.assumptions.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span>
              Horizon:{" "}
              <span className="font-medium">{HORIZON_LABELS[factor.horizon]}</span>
            </span>
            {factor.evidenceQuality === "limited" && (
              <span className="font-medium text-red-600 dark:text-red-400">
                Limited evidence — treat with caution
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function CatalystCard({
  catalyst,
  sources,
}: {
  catalyst: Catalyst;
  sources: Map<string, Source>;
}) {
  const allSourceIds = catalyst.evidence
    .filter((item) => item.type === "external_source")
    .flatMap((item) => item.sourceIds);

  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold">{catalyst.event}</h4>
        <QualityBadge quality={catalyst.evidenceQuality} />
      </div>
      <div className="mt-2 flex flex-col gap-3 text-sm">
        <p>
          <span className="font-medium">Timing: </span>
          {catalyst.timing}
        </p>
        <div>
          <EvidenceBasis evidence={catalyst.evidence} sources={sources} />
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              Possible impact
            </p>
            <KindBadge>Inference</KindBadge>
          </div>
          <p className="mt-1">{catalyst.possibleImpact}</p>
        </div>
        {catalyst.evidence.length > 0 && (
          <div>
            <FieldHeading label="Evidence" hint={EVIDENCE_HINT} />
            <div className="mt-1">
              <EvidenceList evidence={catalyst.evidence} sources={sources} />
            </div>
          </div>
        )}
        <StringList
          items={catalyst.assumptions}
          label="Assumptions"
          hint={ASSUMPTIONS_HINT}
        />
        {allSourceIds.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              Sources
            </p>
            <div className="mt-1">
              <SourcesForIds ids={allSourceIds} sources={sources} />
            </div>
          </div>
        )}
        {catalyst.evidenceQuality === "limited" && (
          <p className="text-xs font-medium text-red-600 dark:text-red-400">
            Limited evidence — treat with caution
          </p>
        )}
      </div>
    </li>
  );
}

function UncertaintyItem({
  uncertainty,
  sources,
}: {
  uncertainty: { title: string; explanation: string; evidence: Evidence[]; assumptions: string[] };
  sources: Map<string, Source>;
}) {
  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h4 className="text-sm font-semibold">{uncertainty.title}</h4>
      <EvidenceBasis evidence={uncertainty.evidence} sources={sources} />
      <p className="mt-2 text-sm">{uncertainty.explanation}</p>
      <div className="mt-3 flex flex-col gap-3">
        {uncertainty.evidence.length > 0 && (
          <div>
            <FieldHeading label="Evidence" hint={EVIDENCE_HINT} />
            <div className="mt-1">
              <EvidenceList evidence={uncertainty.evidence} sources={sources} />
            </div>
          </div>
        )}
        <StringList
          items={uncertainty.assumptions}
          label="Assumptions"
          hint={ASSUMPTIONS_HINT}
        />
      </div>
    </li>
  );
}

function ScenarioSection({
  section,
  scenario,
  sources,
}: {
  section: "Bull" | "Base" | "Bear";
  scenario: Scenario;
  sources: Map<string, Source>;
}) {
  const tone =
    section === "Bull"
      ? "border-green-200 dark:border-green-900"
      : section === "Bear"
        ? "border-red-200 dark:border-red-900"
        : "border-zinc-200 dark:border-zinc-800";
  return (
    <div className={`rounded-lg border bg-white p-4 dark:bg-zinc-900 ${tone}`}>
      <h4 className="text-sm font-semibold">{section} scenario</h4>
      <div className="mt-2 flex flex-col gap-3 text-sm">
        <StringList
          items={scenario.conditions}
          label="Conditions"
          badge={<KindBadge>Hypothetical conditions</KindBadge>}
        />
        <div>
          <EvidenceBasis evidence={scenario.evidence} sources={sources} />
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              Implications
            </p>
            <KindBadge>Inference</KindBadge>
          </div>
          <p className="mt-1">{scenario.implications}</p>
        </div>
        {scenario.evidence.length > 0 && (
          <div>
            <FieldHeading label="Evidence" hint={EVIDENCE_HINT} />
            <div className="mt-1">
              <EvidenceList evidence={scenario.evidence} sources={sources} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TechnicalTrendBlock({
  technicalTrend,
}: {
  technicalTrend: TechnicalTrend;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{technicalTrend.assessment}</p>
      {technicalTrend.evidence.length > 0 && (
        <div className="flex flex-col gap-1">
          <FieldHeading label="App data" hint={TECHNICAL_DATA_HINT} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="py-1.5 pr-4 font-medium">Metric</th>
                  <th className="py-1.5 pr-4 font-medium">Value</th>
                  <th className="py-1.5 font-medium">Interpretation</th>
                </tr>
              </thead>
              <tbody>
                {technicalTrend.evidence.map((item, index) => (
                  <tr
                    key={index}
                    className="border-b border-zinc-100 dark:border-zinc-800/50"
                  >
                    <td className="py-2 pr-4 font-medium">{item.metric}</td>
                    <td className="py-2 pr-4">
                      {item.value === null ? "—" : item.value.toLocaleString()}
                    </td>
                    <td className="py-2">{item.interpretation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <StringList
        items={technicalTrend.assumptions}
        label="Assumptions"
        hint={ASSUMPTIONS_HINT}
      />
    </div>
  );
}

function MarketContextBlock({
  context,
  sources,
}: {
  context: MarketContext;
  sources: Map<string, Source>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <EvidenceBasis evidence={context.evidence} sources={sources} />
      <p className="text-sm">{context.assessment}</p>
      {context.evidence.length > 0 && (
        <div>
          <FieldHeading label="Evidence" hint={EVIDENCE_HINT} />
          <div className="mt-1">
            <EvidenceList evidence={context.evidence} sources={sources} />
          </div>
        </div>
      )}
      <StringList
        items={context.assumptions}
        label="Assumptions"
        hint={ASSUMPTIONS_HINT}
      />
    </div>
  );
}

function SourcesPanel({ sources }: { sources: Source[] }) {
  if (sources.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        This analysis is based only on app data — no external sources were
        referenced.
      </p>
    );
  }
  return (
    <ul className="flex list-none flex-col gap-2">
      {sources.map((source) => (
        <li
          key={source.id}
          className="flex flex-col gap-0.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <SourceLink source={source} />
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {source.publisher} · {source.domain} ·{" "}
            {source.publishedDate ?? "date unverified"} ·{" "}
            {QUALITY_LABELS[source.quality]}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AnalysisResultView(props: AnalysisResultViewProps) {
  const { analysis, afterTechnicalTrend } = props;
  const sources = new Map(
    analysis.sources.map((source) => [source.id, source]),
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold">Summary</h3>
        <p className="text-sm">{analysis.analysis.summary}</p>
      </section>

      <section className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold">Market Context</h3>
        <MarketContextBlock
          context={analysis.analysis.marketContext}
          sources={sources}
        />
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold">Technical Trend</h3>
        <TechnicalTrendBlock technicalTrend={analysis.analysis.technicalTrend} />
      </section>

      {afterTechnicalTrend}

      {analysis.analysis.positiveFactors.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Positive Factors</h3>
          <ul className="flex list-none flex-col gap-3">
            {analysis.analysis.positiveFactors.map((factor, index) => (
              <FactorCard
                key={index}
                factor={factor}
                sources={sources}
                kind="positive"
              />
            ))}
          </ul>
        </section>
      )}

      {analysis.analysis.negativeFactors.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Negative Factors</h3>
          <ul className="flex list-none flex-col gap-3">
            {analysis.analysis.negativeFactors.map((factor, index) => (
              <FactorCard
                key={index}
                factor={factor}
                sources={sources}
                kind="negative"
              />
            ))}
          </ul>
        </section>
      )}

      {analysis.analysis.uncertainties.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Uncertainties</h3>
          <ul className="flex list-none flex-col gap-3">
            {analysis.analysis.uncertainties.map((uncertainty, index) => (
              <UncertaintyItem
                key={index}
                uncertainty={uncertainty}
                sources={sources}
              />
            ))}
          </ul>
        </section>
      )}

      {analysis.analysis.upcomingCatalysts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Upcoming Catalysts</h3>
          <ul className="flex list-none flex-col gap-3">
            {analysis.analysis.upcomingCatalysts.map((catalyst, index) => (
              <CatalystCard key={index} catalyst={catalyst} sources={sources} />
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Scenarios</h3>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <ScenarioSection
            section="Bull"
            scenario={analysis.analysis.scenarios.bull}
            sources={sources}
          />
          <ScenarioSection
            section="Base"
            scenario={analysis.analysis.scenarios.base}
            sources={sources}
          />
          <ScenarioSection
            section="Bear"
            scenario={analysis.analysis.scenarios.bear}
            sources={sources}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Sources used</h3>
        <SourcesPanel sources={analysis.sources} />
      </section>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">{DISCLAIMER}</p>
    </div>
  );
}