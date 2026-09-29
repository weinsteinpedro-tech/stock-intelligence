import type { DataSource } from "../types";
import type { RiskFreeSelectionPolicy } from "./risk-free-rate";

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