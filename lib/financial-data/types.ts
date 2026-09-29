import type { DataQuality } from "./quality";

export interface DataSource {
  provider: string;
  originalSource: string;
  identifier?: string;
}

export interface DataSourceReference {
  provider: string;
  originalSource: string;
  identifier?: string;
  observedAt?: string;
  retrievedAt?: string;
}

export type DataFrequency =
  | "intraday"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "annual"
  | "irregular";

export interface DataEnvelope<T> {
  value: T;
  /**
   * Primary source. Optional: derived envelopes (e.g. portfolio returns built
   * from several assets) do NOT invent a single source and instead populate
   * `sources` with every upstream reference.
   */
  source?: DataSource;
  /** All contributing upstream sources for derived envelopes. */
  sources?: DataSourceReference[];
  observedAt: string;
  retrievedAt: string;
  frequency: DataFrequency;
  quality: DataQuality;
}