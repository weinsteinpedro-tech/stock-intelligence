import { supabase } from "./supabase/client";
import { ensureAnonymousSession } from "./supabase/auth";
import type { AnalysisApiResponse, MarketSnapshot } from "@/lib/ai/types";

export type AnalysisResult = AnalysisApiResponse;

export interface AnalysisHistoryItem {
  id: string;
  symbol: string;
  companyName: string | null;
  generatedAt: string;
  createdAt: string;
  marketSnapshot: MarketSnapshot;
  analysis: AnalysisResult;
}

export interface SaveAnalysisHistoryInput {
  symbol: string;
  companyName: string | null;
  generatedAt: string;
  marketSnapshot: MarketSnapshot;
  analysis: AnalysisApiResponse;
}

const HISTORY_COLUMNS =
  "id, symbol, company_name, generated_at, market_snapshot, analysis, created_at";

interface AnalysisHistoryRow {
  id: string;
  symbol: string;
  company_name: string | null;
  generated_at: string;
  market_snapshot: unknown;
  analysis: unknown;
  created_at: string;
}

export async function saveAnalysisHistory(
  input: SaveAnalysisHistoryInput,
): Promise<void> {
  await ensureAnonymousSession();
  const { error } = await supabase.from("analysis_history").insert({
    symbol: input.symbol.toUpperCase(),
    company_name: input.companyName,
    generated_at: input.generatedAt,
    market_snapshot: input.marketSnapshot,
    analysis: input.analysis,
  });
  if (error) throw new Error(`Failed to save analysis history: ${error.message}`);
}

export async function getAnalysisHistory(
  symbol: string,
): Promise<AnalysisHistoryItem[]> {
  await ensureAnonymousSession();
  const { data, error } = await supabase
    .from("analysis_history")
    .select(HISTORY_COLUMNS)
    .eq("symbol", symbol.toUpperCase())
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to fetch analysis history: ${error.message}`);
  const rows = (data ?? []) as unknown as AnalysisHistoryRow[];
  return rows.map((row) => ({
    id: row.id,
    symbol: row.symbol,
    companyName: row.company_name,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    marketSnapshot: row.market_snapshot as MarketSnapshot,
    analysis: row.analysis as AnalysisResult,
  }));
}

export async function deleteAnalysisHistory(id: string): Promise<void> {
  await ensureAnonymousSession();
  const { error } = await supabase
    .from("analysis_history")
    .delete()
    .eq("id", id);
  if (error) throw new Error(`Failed to delete analysis history: ${error.message}`);
}