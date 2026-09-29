"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { AnalysisApiResponse, MarketSnapshot } from "@/lib/ai/types";
import { saveAnalysisHistory } from "@/lib/analysis-history";
import { AnalysisResultView } from "./AnalysisResultView";

type Status =
  | "idle"
  | "loading"
  | "success"
  | "insufficient_evidence"
  | "error";

interface FutureAnalysisProps {
  snapshot: MarketSnapshot;
  onHistorySaved?: () => void;
  /** Price-move explanation section; shown standalone until an analysis succeeds. */
  priceMoveSection?: ReactNode;
}

const SAVE_WARNING =
  "Analysis completed, but it could not be saved to history.";

function friendlyMessage(code: string | undefined): string {
  switch (code) {
    case "invalid_request":
      return "The request data is invalid. Reload the page and try again.";
    case "gemini_unavailable":
      return "Gemini analysis is unavailable right now. Please try again later.";
    case "service_unavailable":
      return "The research service is unavailable right now. Please try again later.";
    case "rate_limit":
      return "The AI service is rate-limited. Please wait a moment and try again.";
    case "network_error":
      return "A network error occurred. Please try again.";
    case "invalid_response":
      return "The AI returned an invalid response. Please try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export function FutureAnalysis({
  snapshot,
  onHistorySaved,
  priceMoveSection,
}: FutureAnalysisProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [result, setResult] = useState<AnalysisApiResponse | null>(null);
  const [saveWarning, setSaveWarning] = useState(false);

  const canAnalyze =
    snapshot.asOfDate !== "" && snapshot.latestPrice !== null;

  async function persistAnalysis(analysis: AnalysisApiResponse) {
    try {
      await saveAnalysisHistory({
        symbol: snapshot.symbol,
        companyName: snapshot.name,
        generatedAt: analysis.generatedAt,
        marketSnapshot: snapshot,
        analysis,
      });
      onHistorySaved?.();
    } catch {
      setSaveWarning(true);
    }
  }

  async function runAnalysis() {
    setStatus("loading");
    setError(null);
    setResult(null);
    setSaveWarning(false);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const body = payload as { code?: string; error?: string };
        const code = body.code ?? "server_error";
        if (code === "insufficient_evidence") {
          setStatus("insufficient_evidence");
          return;
        }
        setStatus("error");
        setError({
          code,
          message: typeof body.error === "string" ? body.error : friendlyMessage(code),
        });
        return;
      }
      const analysis = payload as unknown as AnalysisApiResponse;
      setStatus("success");
      setResult(analysis);
      void persistAnalysis(analysis);
    } catch {
      setStatus("error");
      setError({ code: "network_error", message: friendlyMessage("network_error") });
    }
  }

  const button = (
    <button
      type="button"
      onClick={runAnalysis}
      disabled={status === "loading" || !canAnalyze}
      className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
    >
      {status === "loading" ? "Analyzing current factors…" : "Analyze future factors"}
    </button>
  );

  if (!canAnalyze) {
    return (
      <div className="flex flex-col gap-2">
        {button}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Analysis requires historical data for this symbol.
        </p>
        {priceMoveSection && (
          <div className="mt-2 flex flex-col gap-2">{priceMoveSection}</div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {button}

      {status === "idle" && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Analyzes recent public information that may affect this stock over the
          next 1–6 months.
        </p>
      )}

      {status === "error" && error && (
        <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm dark:border-red-900 dark:bg-red-950">
          <p className="font-medium text-red-700 dark:text-red-300">
            {error.message}
          </p>
          <p className="text-xs text-red-500 dark:text-red-400">
            You can try again by pressing the button above.
          </p>
        </div>
      )}

      {status === "insufficient_evidence" && (
        <div className="flex flex-col gap-2 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm dark:border-yellow-700 dark:bg-yellow-950">
          <p className="font-medium text-yellow-800 dark:text-yellow-200">
            Not enough verifiable information
          </p>
          <p className="text-yellow-700 dark:text-yellow-300">
            The research did not return enough recent, verifiable public
            information about this company to produce a well-supported analysis.
            Rather than guessing, we are not providing one. You can try again
            later by pressing the button above.
          </p>
        </div>
      )}

      {status === "success" && result && (
        <div className="mt-2 flex flex-col gap-2">
          {saveWarning && (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
              {SAVE_WARNING}
            </p>
          )}
          <AnalysisResultView
            analysis={result}
            marketSnapshot={snapshot}
            mode="current"
            afterTechnicalTrend={priceMoveSection}
          />
        </div>
      )}

      {priceMoveSection && status !== "success" && (
        <div className="mt-2 flex flex-col gap-2">{priceMoveSection}</div>
      )}
    </div>
  );
}