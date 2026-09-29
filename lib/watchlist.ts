import { supabase } from "./supabase/client";
import { ensureAnonymousSession } from "./supabase/auth";

export interface WatchlistStock {
  symbol: string;
  name: string;
  region: string | null;
  currency: string | null;
}

export interface WatchlistRow {
  id: string;
  user_id: string;
  symbol: string;
  name: string;
  region: string | null;
  currency: string | null;
  created_at: string;
}

export async function getWatchlist(): Promise<WatchlistRow[]> {
  await ensureAnonymousSession();
  const { data, error } = await supabase
    .from("watchlist")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to fetch watchlist: ${error.message}`);
  return data ?? [];
}

export async function isInWatchlist(symbol: string): Promise<boolean> {
  await ensureAnonymousSession();
  const { data, error } = await supabase
    .from("watchlist")
    .select("id")
    .eq("symbol", symbol.toUpperCase())
    .limit(1);
  if (error) throw new Error(`Failed to check watchlist: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function addToWatchlist(stock: WatchlistStock): Promise<void> {
  await ensureAnonymousSession();
  const { error } = await supabase.from("watchlist").insert({
    symbol: stock.symbol.toUpperCase(),
    name: stock.name,
    region: stock.region,
    currency: stock.currency,
  });
  if (error) {
    if (error.code === "23505") return;
    throw new Error(`Failed to add to watchlist: ${error.message}`);
  }
}

export async function removeFromWatchlist(
  symbol: string,
): Promise<void> {
  await ensureAnonymousSession();
  const { error } = await supabase
    .from("watchlist")
    .delete()
    .eq("symbol", symbol.toUpperCase());
  if (error) throw new Error(`Failed to remove from watchlist: ${error.message}`);
}
