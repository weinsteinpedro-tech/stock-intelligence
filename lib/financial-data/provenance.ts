import type {
  DataEnvelope,
  DataSource,
  DataSourceReference,
} from "./types";

export function makeDataSource(
  provider: string,
  originalSource: string,
  identifier?: string,
): DataSource {
  return {
    provider,
    originalSource,
    ...(identifier ? { identifier } : {}),
  };
}

export interface DataSourceReferenceInput {
  provider: string;
  originalSource: string;
  identifier?: string;
  observedAt?: string;
  retrievedAt?: string;
}

export function makeDataSourceReference(
  input: DataSourceReferenceInput,
): DataSourceReference {
  const { provider, originalSource } = input;
  return {
    provider,
    originalSource,
    ...(input.identifier ? { identifier: input.identifier } : {}),
    ...(input.observedAt ? { observedAt: input.observedAt } : {}),
    ...(input.retrievedAt ? { retrievedAt: input.retrievedAt } : {}),
  };
}

export function isValidDataSource(value: unknown): value is DataSource {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const validBase =
    typeof record.provider === "string" && record.provider.length > 0 &&
    typeof record.originalSource === "string" &&
    record.originalSource.length > 0;
  if (!validBase) return false;
  if (record.identifier === undefined) return true;
  return (
    typeof record.identifier === "string" && record.identifier.length > 0
  );
}

/**
 * Derives a structured DataSourceReference from a single-source envelope.
 * Returns undefined when the envelope carries no primary source.
 */
export function dataEnvelopeToSourceReference<T>(
  envelope: DataEnvelope<T>,
): DataSourceReference | undefined {
  if (!envelope.source) return undefined;
  return makeDataSourceReference({
    provider: envelope.source.provider,
    originalSource: envelope.source.originalSource,
    ...(envelope.source.identifier
      ? { identifier: envelope.source.identifier }
      : {}),
    observedAt: envelope.observedAt,
    retrievedAt: envelope.retrievedAt,
  });
}

/**
 * Returns every contributing reference of an envelope: its explicit
 * `sources` list when present (derived/multi-source envelopes), otherwise
 * the single reference derivable from `source`.
 */
export function dataEnvelopeToDataSourceReferences<T>(
  envelope: DataEnvelope<T>,
): DataSourceReference[] {
  if (envelope.sources && envelope.sources.length > 0) {
    return envelope.sources.slice();
  }
  const single = dataEnvelopeToSourceReference(envelope);
  return single ? [single] : [];
}

/**
 * Deduplicates structural source references deterministically. Order is
 * preserved; identical references (equal JSON shape) appear only once.
 */
export function dedupeDataSourceReferences(
  sources: readonly DataSourceReference[],
): DataSourceReference[] {
  const seen = new Set<string>();
  const deduped: DataSourceReference[] = [];
  for (const source of sources) {
    const key = JSON.stringify(source);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(source);
  }
  return deduped;
}