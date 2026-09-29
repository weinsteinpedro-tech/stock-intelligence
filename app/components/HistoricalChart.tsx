"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MouseHandlerDataParam } from "recharts";
import type { HistoricalPrice } from "@/lib/market-data";

type Range = "1M" | "3M";

const RANGE_LABELS: Range[] = ["1M", "3M"];

const RANGE_MONTHS: Record<Range, number> = {
  "1M": 1,
  "3M": 3,
};

function findSelectedPoint(
  data: HistoricalPrice[],
  selectedDate: string | null,
): { date: string; close: number } | null {
  if (!selectedDate) return null;
  for (const point of data) {
    if (point.date === selectedDate && point.close !== null) {
      return { date: point.date, close: point.close };
    }
  }
  return null;
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

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return DATE_FORMATTER.format(parsed);
}

function tickFormatter(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface TooltipEntry {
  value?: number | string;
}

interface TooltipContentProps {
  active?: boolean;
  label?: string;
  payload?: TooltipEntry[];
}

function ChartTooltip({ active, label, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const value = payload[0]?.value;
  const price =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : null;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900">
      <p className="font-medium text-zinc-500 dark:text-zinc-400">
        {label ? formatDate(label) : ""}
      </p>
      <p className="font-semibold">
        {price === null || Number.isNaN(price)
          ? "—"
          : price.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
      </p>
    </div>
  );
}

export function HistoricalChart({
  data,
  symbol,
  selectedDate,
  onSelectMove,
}: {
  data: HistoricalPrice[];
  symbol: string;
  selectedDate: string | null;
  onSelectMove: (date: string | null) => void;
}) {
  const [range, setRange] = useState<Range>("1M");

  const chartData = useMemo(() => {
    if (data.length === 0) return [];
    const lastDate = data[data.length - 1].date;
    const cutoff = subtractMonths(lastDate, RANGE_MONTHS[range]);
    return data
      .filter((point) => point.close !== null)
      .filter((point) => point.date >= cutoff)
      .map((point) => ({
        date: point.date,
        close: point.close,
      }));
  }, [data, range]);

  const selectedPoint = findSelectedPoint(data, selectedDate);

  function handleChartClick(nextState: MouseHandlerDataParam) {
    if (typeof nextState.activeLabel !== "string") return;
    const date = nextState.activeLabel;
    onSelectMove(selectedDate === date ? null : date);
  }

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-400">
        No historical data available.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          {RANGE_LABELS.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => setRange(label)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                range === label
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Tip: click a point to select its move from the previous session.
        </p>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
            onClick={handleChartClick}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="currentColor"
              className="text-zinc-200 dark:text-zinc-800"
            />
            <XAxis
              dataKey="date"
              tickFormatter={tickFormatter}
              tick={{ fontSize: 12 }}
              minTickGap={24}
              stroke="currentColor"
              className="text-zinc-500"
            />
            <YAxis
              domain={["auto", "auto"]}
              width={60}
              tick={{ fontSize: 12 }}
              tickFormatter={(value: number) =>
                value.toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })
              }
              stroke="currentColor"
              className="text-zinc-500"
            />
            <Tooltip content={<ChartTooltip />} />
            <Line
              type="monotone"
              dataKey="close"
              name="Close"
              stroke="#2563eb"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
              connectNulls
            />
            {selectedPoint ? (
              <ReferenceDot
                x={selectedPoint.date}
                y={selectedPoint.close}
                r={5}
                fill="#dc2626"
                stroke="#fff"
                strokeWidth={2}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {symbol} · displayed points: {chartData.length} of {data.length}
      </p>
    </div>
  );
}