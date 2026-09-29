import type { DataFrequency, DataSource, DataEnvelope } from "../types";
import type { DataQuality } from "../quality";
import { isValidDataSource } from "../provenance";

/**
 * Risk-free rate V1 — methodology + pure builder (no external data source
 * yet, no network).
 *
 * Prepares the CAPM input `risk_free_rate` as a DataEnvelope<AnnualDecimalRate>
 * already normalized to { rate, period: "annual", representation: "decimal" }.
 * All of this is provider-agnostic: the instrument is a caller decision and
 * is NEVER hardcoded here.
 *
 * CAPM keeps knowing only DataEnvelope<AnnualDecimalRate>. Nothing in this
 * module imports analytics.
 */

export type RiskFreeSelectionPolicy = "latest_on_or_before_as_of";

export interface RiskFreeInstrument {
  id: string;
  name?: string;
}

export interface RiskFreeRateMethodology {
  instrument: RiskFreeInstrument;
  selectionPolicy: RiskFreeSelectionPolicy;
  outputPeriod: "annual";
  outputRepresentation: "decimal";
}

/** An observation already fetched by some future source. Provider-agnostic. */
export interface RateObservation {
  date: string;
  value: number;
  representation: "decimal" | "percent";
  period: "annual";
}

/** The normalized output contract that CAPM consumes. */
export interface AnnualDecimalRate {
  rate: number;
  period: "annual";
  representation: "decimal";
}

export interface RiskFreeRateSnapshot {
  instrumentId: string;
  selectionPolicy: RiskFreeSelectionPolicy;
  outputPeriod: "annual";
  outputRepresentation: "decimal";
}

export interface RiskFreeRateTrace {
  methodologySnapshot: RiskFreeRateSnapshot;
  asOf: string;
  selectedObservationDate: string;
}

export class InvalidRiskFreeMethodologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRiskFreeMethodologyError";
  }
}

export class InvalidRiskFreeDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRiskFreeDateError";
  }
}

export class InvalidRiskFreeObservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRiskFreeObservationError";
  }
}

export class DuplicateRiskFreeObservationError extends Error {
  constructor(date: string) {
    super(`Duplicate risk-free observation for date "${date}".`);
    this.name = "DuplicateRiskFreeObservationError";
  }
}

export class NoEligibleRiskFreeObservationError extends Error {
  constructor(asOf: string) {
    super(
      `No risk-free observation on or before asOf "${asOf}". No future data is used.`,
    );
    this.name = "NoEligibleRiskFreeObservationError";
  }
}

export class InvalidRiskFreeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRiskFreeInputError";
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCanonicalCalendarDate(date: string): boolean {
  if (typeof date !== "string" || !DATE_PATTERN.test(date)) return false;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function assertCanonicalDate(value: unknown, field: string): void {
  if (typeof value !== "string" || !isCanonicalCalendarDate(value)) {
    throw new InvalidRiskFreeDateError(
      `Invalid ${field} "${String(value)}". Expected a real canonical YYYY-MM-DD date.`,
    );
  }
}

export function createRiskFreeRateMethodology(input: {
  instrument: RiskFreeInstrument;
}): RiskFreeRateMethodology {
  const methodology: RiskFreeRateMethodology = {
    instrument: { id: input.instrument.id, name: input.instrument.name },
    selectionPolicy: "latest_on_or_before_as_of",
    outputPeriod: "annual",
    outputRepresentation: "decimal",
  };
  validateRiskFreeRateMethodology(methodology);
  return methodology;
}

export function validateRiskFreeRateMethodology(
  methodology: RiskFreeRateMethodology,
): void {
  if (
    typeof methodology.instrument?.id !== "string" ||
    methodology.instrument.id.length === 0
  ) {
    throw new InvalidRiskFreeMethodologyError(
      "Risk-free rate methodology requires a non-empty instrument id.",
    );
  }
  if (
    methodology.instrument.name !== undefined &&
    (typeof methodology.instrument.name !== "string" ||
      methodology.instrument.name.length === 0)
  ) {
    throw new InvalidRiskFreeMethodologyError(
      "Risk-free rate methodology instrument name, when present, must be a non-empty string.",
    );
  }
  if (methodology.selectionPolicy !== "latest_on_or_before_as_of") {
    throw new InvalidRiskFreeMethodologyError(
      `Risk-free rate methodology only supports selectionPolicy "latest_on_or_before_as_of"; got "${String(methodology.selectionPolicy)}".`,
    );
  }
  if (methodology.outputPeriod !== "annual") {
    throw new InvalidRiskFreeMethodologyError(
      `Risk-free rate methodology outputPeriod must be "annual"; got "${String(methodology.outputPeriod)}".`,
    );
  }
  if (methodology.outputRepresentation !== "decimal") {
    throw new InvalidRiskFreeMethodologyError(
      `Risk-free rate methodology outputRepresentation must be "decimal"; got "${String(methodology.outputRepresentation)}".`,
    );
  }
}

function validateObservation(observation: RateObservation): void {
  if (typeof observation !== "object" || observation === null) {
    throw new InvalidRiskFreeObservationError(
      "Risk-free observation must be an object.",
    );
  }
  assertCanonicalDate(observation.date, "observation date");
  if (
    typeof observation.value !== "number" ||
    !Number.isFinite(observation.value)
  ) {
    throw new InvalidRiskFreeObservationError(
      `Risk-free observation value must be a finite number; got ${String(observation.value)}.`,
    );
  }
  if (observation.period !== "annual") {
    throw new InvalidRiskFreeObservationError(
      `Risk-free observation period must be "annual"; got "${String(observation.period)}".`,
    );
  }
  if (
    observation.representation !== "decimal" &&
    observation.representation !== "percent"
  ) {
    throw new InvalidRiskFreeObservationError(
      `Risk-free observation representation must be "decimal" or "percent"; got "${String(observation.representation)}".`,
    );
  }
}

function validateObservations(
  observations: readonly RateObservation[],
): void {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new InvalidRiskFreeObservationError(
      "At least one risk-free observation is required.",
    );
  }
  const seen = new Set<string>();
  for (const observation of observations) {
    validateObservation(observation);
    if (seen.has(observation.date)) {
      throw new DuplicateRiskFreeObservationError(observation.date);
    }
    seen.add(observation.date);
  }
}

const DATA_FREQUENCIES: readonly string[] = [
  "intraday",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "annual",
  "irregular",
];

/**
 * Picks the observation with the latest date that is on or before asOf.
 * A future observation is NEVER used; if none is eligible the error is
 * deterministic. "latest_on_or_before_as_of" is the only V1 policy.
 */
export function selectRiskFreeObservation(input: {
  observations: readonly RateObservation[];
  asOf: string;
  methodology: RiskFreeRateMethodology;
}): RateObservation {
  validateRiskFreeRateMethodology(input.methodology);
  assertCanonicalDate(input.asOf, "asOf");
  validateObservations(input.observations);

  let selected: RateObservation | undefined;
  for (const observation of input.observations) {
    if (observation.date > input.asOf) continue;
    if (selected === undefined || observation.date > selected.date) {
      selected = observation;
    }
  }
  if (selected === undefined) {
    throw new NoEligibleRiskFreeObservationError(input.asOf);
  }
  return selected;
}

/**
 * Normalizes an observation to the AnnualDecimalRate contract. The percent ->
 * decimal conversion (4.2 => 0.042) belongs to this rate layer, never to
 * CAPM. No other conversion is performed.
 */
export function toAnnualDecimalRate(
  observation: RateObservation,
): AnnualDecimalRate {
  validateObservation(observation);
  const rate =
    observation.representation === "percent"
      ? observation.value / 100
      : observation.value;
  return { rate, period: "annual", representation: "decimal" };
}

export function snapshotRiskFreeRateMethodology(
  methodology: RiskFreeRateMethodology,
): RiskFreeRateSnapshot {
  validateRiskFreeRateMethodology(methodology);
  return {
    instrumentId: methodology.instrument.id,
    selectionPolicy: methodology.selectionPolicy,
    outputPeriod: methodology.outputPeriod,
    outputRepresentation: methodology.outputRepresentation,
  };
}

export function traceRiskFreeSelection(input: {
  observations: readonly RateObservation[];
  asOf: string;
  methodology: RiskFreeRateMethodology;
}): RiskFreeRateTrace {
  const selected = selectRiskFreeObservation(input);
  return {
    methodologySnapshot: snapshotRiskFreeRateMethodology(input.methodology),
    asOf: input.asOf,
    selectedObservationDate: selected.date,
  };
}

export interface BuildRiskFreeRateEnvelopeInput {
  observations: readonly RateObservation[];
  methodology: RiskFreeRateMethodology;
  asOf: string;
  source: DataSource;
  retrievedAt: string;
  quality: DataQuality;
  /** The caller knows the cadence of the underlying observation source. */
  frequency: DataFrequency;
}

/**
 * Builds the DataEnvelope<AnnualDecimalRate> consumed by CAPM. observedAt is
 * the RATE observation date actually selected (YYYY-MM-DD, no invented time
 * or timezone); retrievedAt comes from the caller. No Date.now() anywhere.
 */
export function buildRiskFreeRateEnvelope(
  input: BuildRiskFreeRateEnvelopeInput,
): DataEnvelope<AnnualDecimalRate> {
  validateRiskFreeRateMethodology(input.methodology);
  assertCanonicalDate(input.asOf, "asOf");
  validateObservations(input.observations);
  if (typeof input.retrievedAt !== "string" || input.retrievedAt.length === 0) {
    throw new InvalidRiskFreeInputError(
      "retrievedAt must be a non-empty string.",
    );
  }
  if (!isValidDataSource(input.source)) {
    throw new InvalidRiskFreeInputError(
      "source must be a valid DataSource.",
    );
  }
  if (typeof input.quality !== "object" || input.quality === null) {
    throw new InvalidRiskFreeInputError("quality must be a DataQuality object.");
  }
  if (!DATA_FREQUENCIES.includes(input.frequency)) {
    throw new InvalidRiskFreeInputError(
      `frequency must be one of ${DATA_FREQUENCIES.join(", ")}; got "${String(input.frequency)}".`,
    );
  }

  const selected = selectRiskFreeObservation({
    observations: input.observations,
    asOf: input.asOf,
    methodology: input.methodology,
  });

  return {
    value: toAnnualDecimalRate(selected),
    source: input.source,
    observedAt: selected.date,
    retrievedAt: input.retrievedAt,
    frequency: input.frequency,
    quality: input.quality,
  };
}