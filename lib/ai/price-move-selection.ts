/* ------------------------------------------------------------------ */
/* Price-move selection (pure, deterministic, UI/test-shared logic)    */
/*                                                                     */
/* Derives a "previous trading session close -> selected session       */
/* close" move using ONLY the already-loaded historical prices. Must   */
/* stay side-effect free (no imports at runtime) so both the client    */
/* chart and the static tests share the exact same math.               */
/* ------------------------------------------------------------------ */

export interface PriceBar {
  date: string;
  close: number | null;
  volume: number | null;
}

export interface PriceMoveSelection {
  fromDate: string;
  toDate: string;
  fromClose: number;
  toClose: number;
  absoluteChange: number;
  percentChange: number;
  fromVolume: number | null;
  toVolume: number | null;
}

// Resolves the trading session that is the immediate previous element in
// the series (weekends/holidays are already absent from the data), then
// computes the move. Returns null when there is no previous session or when
// either close is not a usable positive number.
export function derivePriceMove(
  prices: readonly PriceBar[],
  toDate: string,
): PriceMoveSelection | null {
  let index = -1;
  for (let i = 0; i < prices.length; i += 1) {
    if (prices[i].date === toDate) {
      index = i;
      break;
    }
  }
  if (index <= 0) return null;
  const previous = prices[index - 1];
  const current = prices[index];
  if (previous.close === null || current.close === null) return null;
  if (previous.close <= 0) return null;
  const fromClose = previous.close;
  const toClose = current.close;
  const absoluteChange = toClose - fromClose;
  const percentChange = (absoluteChange / fromClose) * 100;
  return {
    fromDate: previous.date,
    toDate: current.date,
    fromClose,
    toClose,
    absoluteChange,
    percentChange,
    fromVolume: previous.volume,
    toVolume: current.volume,
  };
}

// Stable session-local cache key. Same symbol + same previous->selected
// session pair always maps to the same key, so an already-explained move is
// reused without any network request.
export function priceMoveCacheKey(
  symbol: string,
  move: PriceMoveSelection,
): string {
  return `${symbol}:${move.fromDate}->${move.toDate}`;
}