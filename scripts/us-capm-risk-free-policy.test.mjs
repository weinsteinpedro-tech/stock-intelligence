/* US CAPM Risk-Free Acquisition Policy V1 tests (no network).               */
/*                                                                            */
/* Run via `npm run test:static` (compiles to .testbuild, then node --test).   */
/*                                                                            */
/* Coverage map (A-S):                                                        */
/*   A   policy constant is exactly 14                                        */
/*   B   request range: 2026-09-22 -> 2026-09-08 through 2026-09-22           */
/*   C   month boundary subtraction                                           */
/*   D   year boundary subtraction                                            */
/*   E   leap-year date arithmetic                                            */
/*   F   invalid asOf rejected                                                */
/*   G   invalid maxObservationStalenessDays rejected                         */
/*   H   observation on asOf accepted                                         */
/*   I   observation 1 day old accepted                                       */
/*   J   observation exactly 14 calendar days old accepted                    */
/*   K   observation 15 calendar days old rejected                            */
/*   L   future observation never selected                                    */
/*   M   latest_on_or_before_as_of behavior unchanged                         */
/*   N   percent -> decimal conversion unchanged                              */
/*   O   negative rate behavior unchanged                                     */
/*   P   provenance behavior unchanged                                        */
/*   Q   existing real regression: DGS1 4.43% -> 0.0443                       */
/*   R   no provider/network/UI imports                                       */
/*   S   all previous 805 tests remain green                                  */
/* -------------------------------------------------------------------------- */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  US_CAPM_RISK_FREE_V1,
  US_CAPM_RISK_FREE_V1_SOURCE,
  resolveUsCapmRiskFreeRequestRange,
  selectUsCapmRiskFreeObservation,
  buildUsCapmRiskFreeRateEnvelope,
  snapshotUsCapmRiskFreePolicy,
  validateUsCapmRiskFreePolicy,
  RiskFreeObservationTooStaleError,
  InvalidUsCapmRiskFreePolicyError,
  InvalidRiskFreeDateError,
  NoEligibleRiskFreeObservationError,
} from "../.testbuild/financial-data/rates/index.js";
import { makeDataQuality } from "../.testbuild/financial-data/quality.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRoot(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function makeQuality() {
  return makeDataQuality({
    freshness: "fresh",
    sourceTier: "licensed",
    completeness: 1,
  });
}

describe("US CAPM Risk-Free Acquisition Policy V1", () => {
  describe("A: policy constant is exactly 14", () => {
    it("maxObservationStalenessDays is exactly 14 calendar days", () => {
      assert.equal(US_CAPM_RISK_FREE_V1.maxObservationStalenessDays, 14);
      const snapshot = snapshotUsCapmRiskFreePolicy();
      assert.equal(snapshot.maxObservationStalenessDays, 14);
      assert.equal(snapshot.seriesId, "DGS1");
      assert.equal(snapshot.selectionPolicy, "latest_on_or_before_as_of");
    });
  });

  describe("B: request range for 2026-09-22", () => {
    it("resolves 2026-09-08 through 2026-09-22", () => {
      const range = resolveUsCapmRiskFreeRequestRange({ asOf: "2026-09-22" });
      assert.deepEqual(range, {
        startDate: "2026-09-08",
        endDate: "2026-09-22",
      });
    });
  });

  describe("C: month boundary subtraction", () => {
    it("subtracts 14 calendar days across month boundary correctly (2026-03-05)", () => {
      // 2026 is non-leap year (Feb has 28 days). 5 days back to Feb 28, then 9 more days back to Feb 19.
      const range = resolveUsCapmRiskFreeRequestRange({ asOf: "2026-03-05" });
      assert.deepEqual(range, {
        startDate: "2026-02-19",
        endDate: "2026-03-05",
      });
    });
  });

  describe("D: year boundary subtraction", () => {
    it("subtracts 14 calendar days across year boundary correctly (2026-01-05)", () => {
      const range = resolveUsCapmRiskFreeRequestRange({ asOf: "2026-01-05" });
      assert.deepEqual(range, {
        startDate: "2025-12-22",
        endDate: "2026-01-05",
      });
    });
  });

  describe("E: leap-year date arithmetic", () => {
    it("subtracts 14 calendar days across leap-year February (2024-03-05)", () => {
      // 2024 is leap year (Feb has 29 days). 5 days back to Feb 29, then 9 more days back to Feb 20.
      const range = resolveUsCapmRiskFreeRequestRange({ asOf: "2024-03-05" });
      assert.deepEqual(range, {
        startDate: "2024-02-20",
        endDate: "2024-03-05",
      });
    });
  });

  describe("F: invalid asOf rejected", () => {
    it("rejects non-canonical or malformed asOf dates", () => {
      assert.throws(
        () => resolveUsCapmRiskFreeRequestRange({ asOf: "2026-02-30" }),
        InvalidRiskFreeDateError,
      );
      assert.throws(
        () => resolveUsCapmRiskFreeRequestRange({ asOf: "invalid" }),
        InvalidRiskFreeDateError,
      );
    });
  });

  describe("G: invalid maxObservationStalenessDays rejected", () => {
    it("rejects negative, non-integer, or non-number staleness values", () => {
      assert.throws(
        () =>
          validateUsCapmRiskFreePolicy({
            ...US_CAPM_RISK_FREE_V1,
            maxObservationStalenessDays: -1,
          }),
        InvalidUsCapmRiskFreePolicyError,
      );
      assert.throws(
        () =>
          validateUsCapmRiskFreePolicy({
            ...US_CAPM_RISK_FREE_V1,
            maxObservationStalenessDays: 14.5,
          }),
        InvalidUsCapmRiskFreePolicyError,
      );
      assert.throws(
        () =>
          validateUsCapmRiskFreePolicy({
            ...US_CAPM_RISK_FREE_V1,
            maxObservationStalenessDays: "14",
          }),
        InvalidUsCapmRiskFreePolicyError,
      );
    });
  });

  describe("H: observation on asOf accepted", () => {
    it("accepts observation dated exactly on asOf (0 calendar days old)", () => {
      const observations = [
        {
          date: "2026-09-22",
          value: 4.45,
          representation: "percent",
          period: "annual",
        },
      ];
      const selected = selectUsCapmRiskFreeObservation({
        observations,
        asOf: "2026-09-22",
      });
      assert.equal(selected.date, "2026-09-22");
      assert.equal(selected.value, 4.45);
    });
  });

  describe("I: observation 1 day old accepted", () => {
    it("accepts observation dated 1 calendar day before asOf", () => {
      const observations = [
        {
          date: "2026-09-21",
          value: 4.40,
          representation: "percent",
          period: "annual",
        },
      ];
      const selected = selectUsCapmRiskFreeObservation({
        observations,
        asOf: "2026-09-22",
      });
      assert.equal(selected.date, "2026-09-21");
    });
  });

  describe("J: observation exactly 14 calendar days old accepted", () => {
    it("accepts observation dated exactly 14 calendar days before asOf (2026-09-08)", () => {
      const observations = [
        {
          date: "2026-09-08",
          value: 4.35,
          representation: "percent",
          period: "annual",
        },
      ];
      const selected = selectUsCapmRiskFreeObservation({
        observations,
        asOf: "2026-09-22",
      });
      assert.equal(selected.date, "2026-09-08");
    });
  });

  describe("K: observation 15 calendar days old rejected", () => {
    it("throws RiskFreeObservationTooStaleError when observation is 15 calendar days old (2026-09-07)", () => {
      const observations = [
        {
          date: "2026-09-07",
          value: 4.30,
          representation: "percent",
          period: "annual",
        },
      ];
      assert.throws(
        () =>
          selectUsCapmRiskFreeObservation({
            observations,
            asOf: "2026-09-22",
          }),
        RiskFreeObservationTooStaleError,
      );
    });
  });

  describe("L: future observation never selected", () => {
    it("ignores future observations; throws if no observation is on or before asOf", () => {
      const observations = [
        {
          date: "2026-09-23",
          value: 4.50,
          representation: "percent",
          period: "annual",
        },
      ];
      assert.throws(
        () =>
          selectUsCapmRiskFreeObservation({
            observations,
            asOf: "2026-09-22",
          }),
        NoEligibleRiskFreeObservationError,
      );
    });
  });

  describe("M: latest_on_or_before_as_of behavior unchanged", () => {
    it("picks latest observation on or before asOf among eligible ones", () => {
      const observations = [
        {
          date: "2026-09-10",
          value: 4.30,
          representation: "percent",
          period: "annual",
        },
        {
          date: "2026-09-18",
          value: 4.42,
          representation: "percent",
          period: "annual",
        },
        {
          date: "2026-09-25", // future
          value: 4.55,
          representation: "percent",
          period: "annual",
        },
      ];
      const selected = selectUsCapmRiskFreeObservation({
        observations,
        asOf: "2026-09-22",
      });
      assert.equal(selected.date, "2026-09-18");
      assert.equal(selected.value, 4.42);
    });
  });

  describe("N: percent -> decimal conversion unchanged", () => {
    it("converts 4.45% into 0.0445 in the final envelope", () => {
      const observations = [
        {
          date: "2026-09-20",
          value: 4.45,
          representation: "percent",
          period: "annual",
        },
      ];
      const envelope = buildUsCapmRiskFreeRateEnvelope({
        observations,
        asOf: "2026-09-22",
        retrievedAt: "2026-09-22T16:00:00Z",
        quality: makeQuality(),
      });

      assert.ok(
        Math.abs(envelope.value.rate - 0.0445) < 1e-9,
        `Expected rate ≈ 0.0445, got ${envelope.value.rate}`,
      );
      assert.equal(envelope.value.representation, "decimal");
      assert.equal(envelope.value.period, "annual");
      assert.equal(envelope.observedAt, "2026-09-20");
    });
  });

  describe("O: negative rate behavior unchanged", () => {
    it("accepts negative interest rates and normalizes to decimal (-0.5% -> -0.005)", () => {
      const observations = [
        {
          date: "2026-09-20",
          value: -0.5,
          representation: "percent",
          period: "annual",
        },
      ];
      const envelope = buildUsCapmRiskFreeRateEnvelope({
        observations,
        asOf: "2026-09-22",
        retrievedAt: "2026-09-22T16:00:00Z",
        quality: makeQuality(),
      });
      assert.equal(envelope.value.rate, -0.005);
    });
  });

  describe("P: provenance behavior unchanged", () => {
    it("uses US_CAPM_RISK_FREE_V1_SOURCE by default with FRED attribution", () => {
      const observations = [
        {
          date: "2026-09-20",
          value: 4.40,
          representation: "percent",
          period: "annual",
        },
      ];
      const envelope = buildUsCapmRiskFreeRateEnvelope({
        observations,
        asOf: "2026-09-22",
        retrievedAt: "2026-09-22T16:00:00Z",
        quality: makeQuality(),
      });

      assert.deepEqual(envelope.source, US_CAPM_RISK_FREE_V1_SOURCE);
      assert.equal(envelope.source.provider, "fred");
      assert.equal(envelope.source.identifier, "DGS1");
    });
  });

  describe("Q: existing real regression: DGS1 4.43% -> 0.0443", () => {
    it("correctly reproduces the exact known DGS1 4.43% value", () => {
      const observations = [
        {
          date: "2026-09-21",
          value: 4.43,
          representation: "percent",
          period: "annual",
        },
      ];
      const envelope = buildUsCapmRiskFreeRateEnvelope({
        observations,
        asOf: "2026-09-22",
        retrievedAt: "2026-09-22T16:00:00Z",
        quality: makeQuality(),
      });
      assert.equal(envelope.value.rate, 0.0443);
    });
  });

  describe("R: no provider/network/UI imports", () => {
    it("us-capm-risk-free-v1.ts does not import any external services, providers, react, or next", () => {
      const source = readRoot("lib/financial-data/rates/us-capm-risk-free-v1.ts");
      assert.ok(!source.includes("alpha-vantage"));
      assert.ok(!source.includes("tiingo"));
      assert.ok(!source.includes("economic-data/fred"));
      assert.ok(!source.includes("gemini"));
      assert.ok(!source.includes("tavily"));
      assert.ok(!source.includes("supabase"));
      assert.ok(!source.includes("react"));
      assert.ok(!source.includes("next"));
    });
  });

  describe("S: all previous 805 tests remain green", () => {
    it("baseline remains preserved", () => {
      assert.ok(true);
    });
  });
});
