import type { DataEnvelope, DataSourceReference } from "../financial-data/types";

export type IndicatorStatus = "ok" | "insufficient_data" | "stale_data" | "error";

export type IndicatorCategory =
  | "risk"
  | "return"
  | "risk-adjusted-return"
  | "volatility"
  | "valuation"
  | "fundamental"
  | "portfolio"
  | "trend"
  | "timing"
  | "custom";

export interface IndicatorDependencySpec {
  data?: readonly string[];
  indicators?: readonly string[];
}

export interface IndicatorMetadata {
  description: string;
  methodology: string;
  formula?: string;
  units: string | null;
}

export interface IndicatorDataWindow {
  startDate: string;
  endDate: string;
  observations: number;
}

export interface IndicatorContext {
  data: Readonly<Record<string, DataEnvelope<unknown>>>;
  indicators: ReadonlyMap<string, IndicatorResult<unknown>>;
  asOf: string;
}

export interface IndicatorCalculation<T = number> {
  value: T | null;
  status: IndicatorStatus;
  asOf?: string;
  sources?: DataSourceReference[];
  warnings?: string[];
  dataWindow?: IndicatorDataWindow;
}

export interface IndicatorDefinition<T = number> {
  id: string;
  name: string;
  version: string;
  category: IndicatorCategory;
  dependencies?: IndicatorDependencySpec;
  calculate(context: IndicatorContext): IndicatorCalculation<T>;
  metadata: IndicatorMetadata;
}

export interface IndicatorResult<T = number> {
  id: string;
  name: string;
  version: string;
  value: T | null;
  status: IndicatorStatus;
  asOf: string;
  methodology: {
    description: string;
    formula?: string;
  };
  sources: DataSourceReference[];
  warnings: string[];
  dataWindow?: IndicatorDataWindow;
}