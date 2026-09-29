import { AnalysisSection } from "@/app/components/AnalysisSection";
import { WatchlistButton } from "@/app/components/WatchlistButton";
import { getMarketDataProvider } from "@/lib/market-data";
import type { HistoricalPrice } from "@/lib/market-data";
import { calculateIndicators } from "@/lib/market-data/indicators";

function formatNumber(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${formatted}` : formatted;
}

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatVolume(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatRatio(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(2)}×`;
}

function percentColor(value: number | null): string {
  if (value === null) return "";
  if (value > 0) return "text-green-600 dark:text-green-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "";
}

export default async function StockPage(
  props: PageProps<"/stocks/[symbol]">,
) {
  const { symbol } = await props.params;
  const searchParams = await props.searchParams;
  const uppercase = symbol.toUpperCase();
  const name = typeof searchParams.name === "string" ? searchParams.name : null;
  const currency =
    typeof searchParams.currency === "string" ? searchParams.currency : null;
  const region =
    typeof searchParams.region === "string" ? searchParams.region : null;

  let series: HistoricalPrice[] = [];
  let queryError: string | null = null;
  try {
    const provider = getMarketDataProvider();
    series = await provider.getDailySeries(uppercase);
  } catch (error) {
    queryError = error instanceof Error ? error.message : "Unknown error";
  }

  const last = series.length > 0 ? series[series.length - 1] : null;
  const previous = series.length > 1 ? series[series.length - 2] : null;

  const lastPrice = last?.close ?? null;
  const prevClose = previous?.close ?? null;
  const change =
    lastPrice !== null && prevClose !== null ? lastPrice - prevClose : null;
  const changePercent =
    change !== null && prevClose ? (change / prevClose) * 100 : null;

  const indicators = calculateIndicators(series);

  const snapshot = {
    symbol: uppercase,
    name,
    region,
    currency,
    asOfDate: last?.date ?? "",
    latestPrice: lastPrice,
    indicators: {
      return1D: indicators.return1D,
      return1M: indicators.return1M,
      sma20: indicators.sma20,
      sma50: indicators.sma50,
      volatility20D: indicators.volatility20D,
      avgVolume20D: indicators.avgVolume20D,
      volumeVsAvg: indicators.volumeVsAvg,
      periodHigh: indicators.periodHigh,
      periodLow: indicators.periodLow,
    },
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
        <h1 className="text-2xl font-bold">{uppercase}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {name ?? "—"}
        </p>
      </section>

      <section className="flex flex-col gap-4 sm:flex-row">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Last price
          </p>
          <p className="text-2xl font-bold">
            {lastPrice !== null
              ? formatNumber(lastPrice, currency)
              : "No data"}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Change</p>
          <div className="flex flex-col">
            <p
              className={`text-2xl font-bold ${
                change !== null
                  ? change > 0
                    ? "text-green-600 dark:text-green-400"
                    : change < 0
                      ? "text-red-600 dark:text-red-400"
                      : ""
                  : ""
              }`}
            >
              {change !== null
                ? `${change > 0 ? "+" : ""}${formatNumber(change, currency)}`
                : "—"}
            </p>
            <p
              className={`text-sm ${
                changePercent !== null
                  ? changePercent > 0
                    ? "text-green-600 dark:text-green-400"
                    : changePercent < 0
                      ? "text-red-600 dark:text-red-400"
                      : ""
                  : ""
              }`}
            >
              {formatPercent(changePercent)}
            </p>
          </div>
        </div>
      </section>

      {queryError && (
        <p className="text-sm text-red-600 dark:text-red-400">{queryError}</p>
      )}

      <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-sm font-semibold">Financial Indicators</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Return 1D
            </p>
            <p
              className={`mt-1 text-lg font-semibold ${percentColor(indicators.return1D)}`}
            >
              {formatPercent(indicators.return1D)}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Return 1M
            </p>
            <p
              className={`mt-1 text-lg font-semibold ${percentColor(indicators.return1M)}`}
            >
              {formatPercent(indicators.return1M)}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">SMA 20</p>
            <p className="mt-1 text-lg font-semibold">
              {formatNumber(indicators.sma20, currency)}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">SMA 50</p>
            <p className="mt-1 text-lg font-semibold">
              {formatNumber(indicators.sma50, currency)}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Volatility 20D
            </p>
            <p className="mt-1 text-lg font-semibold">
              {formatPercent(indicators.volatility20D)}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Avg Volume 20D
            </p>
            <p className="mt-1 text-lg font-semibold">
              {formatVolume(indicators.avgVolume20D)}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Volume vs Avg
            </p>
            <p className="mt-1 text-lg font-semibold">
              {formatRatio(indicators.volumeVsAvg)}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Period High / Low
            </p>
            <p className="mt-1 text-sm font-semibold">
              {formatNumber(indicators.periodHigh, currency)}
              {" / "}
              {formatNumber(indicators.periodLow, currency)}
            </p>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <WatchlistButton
          symbol={uppercase}
          name={name}
          region={region}
          currency={currency}
        />
      </section>

      <AnalysisSection
        snapshot={snapshot}
        symbol={uppercase}
        companyName={name}
        historicalData={series}
      />
    </div>
  );
}
