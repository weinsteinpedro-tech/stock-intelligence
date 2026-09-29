import type { HistoricalPrice } from "./types";

export interface StockIndicators {
  return1D: number | null;
  return1M: number | null;
  sma20: number | null;
  sma50: number | null;
  volatility20D: number | null;
  avgVolume20D: number | null;
  volumeVsAvg: number | null;
  periodHigh: number | null;
  periodLow: number | null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const avg = mean(values);
  if (avg === null) return null;
  const variance =
    values.reduce((acc, v) => acc + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function subtractMonths(dateStr: string, months: number): string {
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;

  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() - months, 1);
  const daysInTargetMonth = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  target.setDate(clampedDay);

  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const dayStr = String(target.getDate()).padStart(2, "0");
  return `${year}-${month}-${dayStr}`;
}

function pctChange(later: number, earlier: number): number {
  return ((later - earlier) / earlier) * 100;
}

export function calculateIndicators(
  series: HistoricalPrice[],
): StockIndicators {
  const closes = series
    .map((point) => point.close)
    .filter((value): value is number => value !== null);
  const lastIndex = closes.length - 1;
  const lastPrice = lastIndex >= 0 ? closes[lastIndex] : null;

  let return1D: number | null = null;
  if (lastIndex >= 1 && lastPrice !== null && closes[lastIndex - 1] !== 0) {
    return1D = pctChange(lastPrice, closes[lastIndex - 1]);
  }

  let return1M: number | null = null;
  if (lastPrice !== null && series.length > 0) {
    const lastDate = series[series.length - 1].date;
    const target = new Date(`${subtractMonths(lastDate, 1)}T00:00:00`);
    const valid = series
      .filter((point) => point.close !== null)
      .map((point) => ({ date: new Date(`${point.date}T00:00:00`), close: point.close as number }));

    let closest = valid[0];
    let minDiff = Number.POSITIVE_INFINITY;
    for (const point of valid) {
      if (Number.isNaN(point.date.getTime())) continue;
      const diff = Math.abs(point.date.getTime() - target.getTime());
      if (diff < minDiff) {
        minDiff = diff;
        closest = point;
      }
    }

    const MS_PER_DAY = 86_400_000;
    const maxDaysOff = 7;
    if (
      closest &&
      !Number.isNaN(closest.date.getTime()) &&
      minDiff <= maxDaysOff * MS_PER_DAY
    ) {
      return1M = closest.close === lastPrice ? 0 : pctChange(lastPrice, closest.close);
    }
  }

  const sma20 = closes.length >= 20 ? mean(closes.slice(-20)) : null;
  const sma50 = closes.length >= 50 ? mean(closes.slice(-50)) : null;

  let volatility20D: number | null = null;
  const recentCloses = closes.slice(-21);
  if (recentCloses.length >= 21) {
    const dailyReturns: number[] = [];
    for (let i = 1; i < recentCloses.length; i++) {
      if (recentCloses[i - 1] !== 0) {
        dailyReturns.push(
          (recentCloses[i] - recentCloses[i - 1]) / recentCloses[i - 1],
        );
      }
    }
    const dailyStd = stdDev(dailyReturns);
    if (dailyReturns.length >= 20 && dailyStd !== null) {
      volatility20D = dailyStd * Math.sqrt(252) * 100;
    }
  }

  const volumes = series
    .filter((point) => point.volume !== null)
    .map((point) => point.volume as number);
  const avgVolume20D =
    volumes.length >= 20 ? mean(volumes.slice(-20)) : null;

  const lastVolume = series[series.length - 1]?.volume ?? null;
  let volumeVsAvg: number | null = null;
  if (lastVolume !== null && avgVolume20D !== null && avgVolume20D !== 0) {
    volumeVsAvg = lastVolume / avgVolume20D;
  }

  const highs = series
    .filter((point) => point.high !== null)
    .map((point) => point.high as number);
  const lows = series
    .filter((point) => point.low !== null)
    .map((point) => point.low as number);

  const periodHigh = highs.length > 0 ? Math.max(...highs) : null;
  const periodLow = lows.length > 0 ? Math.min(...lows) : null;

  return {
    return1D,
    return1M,
    sma20,
    sma50,
    volatility20D,
    avgVolume20D,
    volumeVsAvg,
    periodHigh,
    periodLow,
  };
}
