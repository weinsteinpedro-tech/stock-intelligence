import type { RateObservation } from "../financial-data/rates";
import {
  US_CAPM_RISK_FREE_V1,
  type UsCapmRiskFreeV1Policy,
} from "../financial-data/rates/us-capm-risk-free-v1";
import type { FredObservation } from "./fred";

/**
 * Pure composition step: FRED observations + the DGS1 policy -> RateObservation[].
 *
 * It only attaches the source representation/period declared by the policy
 * (percent, annual). Percent -> decimal conversion, latest-on-or-before
 * selection, date logic and provenance all stay in the existing rates builder
 * and are never duplicated here.
 */
export function fredObservationsToRateObservations(
  observations: readonly FredObservation[],
  policy: UsCapmRiskFreeV1Policy = US_CAPM_RISK_FREE_V1,
): RateObservation[] {
  return observations.map((observation) => ({
    date: observation.date,
    value: observation.value,
    representation: policy.sourceRepresentation,
    period: policy.sourcePeriod,
  }));
}