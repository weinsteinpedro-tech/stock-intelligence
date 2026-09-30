import type { DataFrequency, DataEnvelope, DataSource } from "../types";
import type { DataQuality } from "../quality";
import {
  type AnnualDecimalRate,
  buildRiskFreeRateEnvelope,
  InvalidRiskFreeDateError,
  type RateObservation,
  type RiskFreeSelectionPolicy,
  selectRiskFreeObservation,
} from "./risk-free-rate";

/**
 * EXPLICIT application-level policy for the US CAPM risk-free input.
 *
 * DGS1 is hardcoded HERE and only here, because this file IS the application
 * decision — NOT a default inside the FRED provider, the rates builder, or
 * CAPM. The provider remains generic and knows no instrument.
 */
export interface UsCapmRiskFreeV1Policy {
  instrument: {
    id: string;
    name?: string;
  };
  seriesId: string;
  /** FRED publishes this series in percentage points (4.45 means 4.45%). */
  sourceRepresentation: "percent";
  sourcePeriod: "annual";
  frequency: "daily";
  selectionPolicy: RiskFreeSelectionPolicy;
  outputPeriod: "annual";
  outputRepresentation: "decimal";
  maxObservationStalenessDays: number;
}

export const US_CAPM_RISK_FREE_V1: UsCapmRiskFreeV1Policy = {
  instrument: {
    id: "DGS1",
    name: "1-Year Treasury Constant Maturity",
  },
  seriesId: "DGS1",
  sourceRepresentation: "percent",
  sourcePeriod: "annual",
  frequency: "daily",
  selectionPolicy: "latest_on_or_before_as_of",
  outputPeriod: "annual",
  outputRepresentation: "decimal",
  maxObservationStalenessDays: 14,
};

/**
 * Provenance for this policy. The honest attribution is the FRB Board of
 * Governors (via the FRED API); no Treasury.gov claim is invented.
 */
export const US_CAPM_RISK_FREE_V1_SOURCE: DataSource = {
  provider: "fred",
  originalSource:
    "Board of Governors of the Federal Reserve System (US), H.15 Selected Interest Rates",
  identifier: "DGS1",
};

export class InvalidUsCapmRiskFreePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUsCapmRiskFreePolicyError";
  }
}

export class RiskFreeObservationTooStaleError extends Error {
  constructor(asOf: string, selectedDate: string, maxDays: number) {
    super(
      `Selected risk-free observation "${selectedDate}" is more than ${maxDays} calendar days older than asOf "${asOf}". Max acceptable staleness is ${maxDays} days.`,
    );
    this.name = "RiskFreeObservationTooStaleError";
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

function parseDate(iso: string): [number, number, number] {
  return [
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)),
    Number(iso.slice(8, 10)),
  ];
}

function toUtcEpoch(iso: string): number {
  const [year, month, day] = parseDate(iso);
  return Date.UTC(year, month - 1, day);
}

export function daysBetweenDates(fromIso: string, toIso: string): number {
  return Math.round((toUtcEpoch(toIso) - toUtcEpoch(fromIso)) / 86400000);
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function subtractCalendarDays(iso: string, days: number): string {
  const date = new Date(toUtcEpoch(iso) - days * 86400000);
  return formatDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

export function validateUsCapmRiskFreePolicy(
  policy: UsCapmRiskFreeV1Policy,
): void {
  if (typeof policy !== "object" || policy === null) {
    throw new InvalidUsCapmRiskFreePolicyError("Policy must be an object.");
  }
  if (
    typeof policy.maxObservationStalenessDays !== "number" ||
    !Number.isFinite(policy.maxObservationStalenessDays) ||
    policy.maxObservationStalenessDays < 0 ||
    !Number.isInteger(policy.maxObservationStalenessDays)
  ) {
    throw new InvalidUsCapmRiskFreePolicyError(
      `maxObservationStalenessDays must be a non-negative integer; got "${String(policy?.maxObservationStalenessDays)}".`,
    );
  }
  if (policy.seriesId !== "DGS1") {
    throw new InvalidUsCapmRiskFreePolicyError(
      `seriesId must be "DGS1"; got "${String(policy.seriesId)}".`,
    );
  }
  if (policy.selectionPolicy !== "latest_on_or_before_as_of") {
    throw new InvalidUsCapmRiskFreePolicyError(
      `selectionPolicy must be "latest_on_or_before_as_of"; got "${String(policy.selectionPolicy)}".`,
    );
  }
  if (policy.sourceRepresentation !== "percent") {
    throw new InvalidUsCapmRiskFreePolicyError(
      `sourceRepresentation must be "percent"; got "${String(policy.sourceRepresentation)}".`,
    );
  }
  if (policy.sourcePeriod !== "annual") {
    throw new InvalidUsCapmRiskFreePolicyError(
      `sourcePeriod must be "annual"; got "${String(policy.sourcePeriod)}".`,
    );
  }
  if (policy.outputPeriod !== "annual") {
    throw new InvalidUsCapmRiskFreePolicyError(
      `outputPeriod must be "annual"; got "${String(policy.outputPeriod)}".`,
    );
  }
  if (policy.outputRepresentation !== "decimal") {
    throw new InvalidUsCapmRiskFreePolicyError(
      `outputRepresentation must be "decimal"; got "${String(policy.outputRepresentation)}".`,
    );
  }
  if (
    !policy.instrument ||
    typeof policy.instrument.id !== "string" ||
    policy.instrument.id.length === 0
  ) {
    throw new InvalidUsCapmRiskFreePolicyError(
      "instrument.id must be a non-empty string.",
    );
  }
}

export interface UsCapmRiskFreeRequestRange {
  startDate: string;
  endDate: string;
}

/**
 * Resolves the provider acquisition date range needed for US CAPM risk-free V1.
 *
 * endDate = asOf
 * startDate = asOf minus policy.maxObservationStalenessDays calendar days
 *
 * Both bounds are inclusive at the acquisition layer.
 */
export function resolveUsCapmRiskFreeRequestRange(input: {
  asOf: string;
  policy?: UsCapmRiskFreeV1Policy;
}): UsCapmRiskFreeRequestRange {
  assertCanonicalDate(input?.asOf, "asOf");
  const policy = input?.policy ?? US_CAPM_RISK_FREE_V1;
  validateUsCapmRiskFreePolicy(policy);

  return {
    startDate: subtractCalendarDays(input.asOf, policy.maxObservationStalenessDays),
    endDate: input.asOf,
  };
}

/**
 * Policy-aware observation selection.
 *
 * 1. Validates asOf and policy.
 * 2. Selects latest eligible observation on or before asOf (never future).
 * 3. Enforces that the observation's calendar age does not exceed
 *    policy.maxObservationStalenessDays.
 */
export function selectUsCapmRiskFreeObservation(input: {
  observations: readonly RateObservation[];
  asOf: string;
  policy?: UsCapmRiskFreeV1Policy;
}): RateObservation {
  assertCanonicalDate(input?.asOf, "asOf");
  const policy = input?.policy ?? US_CAPM_RISK_FREE_V1;
  validateUsCapmRiskFreePolicy(policy);

  const selected = selectRiskFreeObservation({
    observations: input.observations,
    asOf: input.asOf,
    methodology: {
      instrument: policy.instrument,
      selectionPolicy: policy.selectionPolicy,
      outputPeriod: policy.outputPeriod,
      outputRepresentation: policy.outputRepresentation,
    },
  });

  const ageInDays = daysBetweenDates(selected.date, input.asOf);
  if (ageInDays > policy.maxObservationStalenessDays) {
    throw new RiskFreeObservationTooStaleError(
      input.asOf,
      selected.date,
      policy.maxObservationStalenessDays,
    );
  }

  return selected;
}

export interface BuildUsCapmRiskFreeEnvelopeInput {
  observations: readonly RateObservation[];
  asOf: string;
  retrievedAt: string;
  quality: DataQuality;
  source?: DataSource;
  frequency?: DataFrequency;
  policy?: UsCapmRiskFreeV1Policy;
}

/**
 * Builds the DataEnvelope<AnnualDecimalRate> for US CAPM V1 using the
 * policy-enforced staleness rule and attribution.
 */
export function buildUsCapmRiskFreeRateEnvelope(
  input: BuildUsCapmRiskFreeEnvelopeInput,
): DataEnvelope<AnnualDecimalRate> {
  const policy = input?.policy ?? US_CAPM_RISK_FREE_V1;
  validateUsCapmRiskFreePolicy(policy);

  const selected = selectUsCapmRiskFreeObservation({
    observations: input.observations,
    asOf: input.asOf,
    policy,
  });

  return buildRiskFreeRateEnvelope({
    observations: [selected],
    methodology: {
      instrument: policy.instrument,
      selectionPolicy: policy.selectionPolicy,
      outputPeriod: policy.outputPeriod,
      outputRepresentation: policy.outputRepresentation,
    },
    asOf: input.asOf,
    source: input.source ?? US_CAPM_RISK_FREE_V1_SOURCE,
    retrievedAt: input.retrievedAt,
    quality: input.quality,
    frequency: input.frequency ?? policy.frequency,
  });
}

export interface UsCapmRiskFreeV1PolicySnapshot {
  seriesId: string;
  instrumentId: string;
  instrumentName?: string;
  selectionPolicy: RiskFreeSelectionPolicy;
  sourceRepresentation: "percent";
  sourcePeriod: "annual";
  frequency: "daily";
  outputPeriod: "annual";
  outputRepresentation: "decimal";
  maxObservationStalenessDays: number;
}

export function snapshotUsCapmRiskFreePolicy(
  policy: UsCapmRiskFreeV1Policy = US_CAPM_RISK_FREE_V1,
): UsCapmRiskFreeV1PolicySnapshot {
  validateUsCapmRiskFreePolicy(policy);
  return {
    seriesId: policy.seriesId,
    instrumentId: policy.instrument.id,
    instrumentName: policy.instrument.name,
    selectionPolicy: policy.selectionPolicy,
    sourceRepresentation: policy.sourceRepresentation,
    sourcePeriod: policy.sourcePeriod,
    frequency: policy.frequency,
    outputPeriod: policy.outputPeriod,
    outputRepresentation: policy.outputRepresentation,
    maxObservationStalenessDays: policy.maxObservationStalenessDays,
  };
}
