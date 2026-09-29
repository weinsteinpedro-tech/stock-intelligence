/* Sharpe Portfolio Inputs V1 tests (no network).                             */
/*                                                                            */
/* Run via `npm run test:static` (compiles lib to .testbuild, then            */
/* node --test this file).                                                    */
/*                                                                            */
/* Coverage map (A-AH):                                                       */
/*   A   methodology V1 is correct                                            */
/*   B   date range over 1Y is correct                                        */
/*   C   leap-year handling is correct                                        */
/*   D   window semantics are (startDate, endDate]                            */
/*   E   input order does not matter                                          */
/*   F   duplicate dates are rejected                                         */
/*   G   malformed dates are rejected                                         */
/*   H   non-finite returns are rejected                                      */
/*   I   negative returns are allowed                                         */
/*   J   both outputs use the same selectedObservationCount                   */
/*   K   daily mean is correct                                                */
/*   L   annual return uses mean * 252                                        */
/*   M   NO CAGR (arithmetic mean times factor)                               */
/*   N   NO geometric compounding                                             */
/*   O   sample variance divides by n-1                                       */
/*   P   [0.01, 0.02, 0.03] => sample std 0.01                                */
/*   Q   annualized volatility = daily std * sqrt(252)                        */
/*   R   minimum 2 observations required                                      */
/*   S   constant returns => volatility 0                                     */
/*   T   annualized return can be negative                                    */
/*   U   AnnualDecimalRate output is correct                                  */
/*   V   AnnualDecimalVolatility output is correct                            */
/*   W   observedAt = last selected return date                               */
/*   X   provenance preserved in BOTH envelopes                               */
/*   Y   retrievedAt preserved                                                */
/*   Z   quality preserved                                                    */
/*   AA  trace is correct                                                     */
/*   AB  both envelopes share the same window/metadata                        */
/*   AC  outputs feed directly into sharpeIndicator                           */
/*   AD  known Sharpe fixture stays 0.4                                       */
/*   AE  zero volatility never produces Infinity/NaN                          */
/*   AF  CAPM is unchanged                                                    */
/*   AG  Beta pipeline is unchanged                                           */
/*   AH  previous test semantics keep their determinism                       */
/* -------------------------------------------------------------------------- */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AnalyticsEngine,
  betaIndicator,
  calculateAnnualizedPortfolioPerformance,
  calculateCapmExpectedReturn,
  calculateSharpeRatio,
  createSharpePortfolioInputMethodology,
  DuplicateDateError,
  IndicatorRegistry,
  InvalidReturnSeriesError,
  InvalidSharpePortfolioInputError,
  InvalidSharpePortfolioInputMethodologyError,
  PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY,
  PORTFOLIO_ANNUAL_RETURN_DATA_KEY,
  resolveSharpePortfolioInputDateRange,
  resolveSharpePortfolioPriceRequestRange,
  RISK_FREE_RATE_DATA_KEY,
  SHARPE_PRICE_SEED_LOOKBACK_DAYS,
  sharpeIndicator,
  snapshotSharpePortfolioInputMethodology,
  traceSharpePortfolioInputPerformance,
  validateSharpePortfolioInputMethodology,
} from "../.testbuild/analytics/index.js";
import {
  buildBenchmarkReturnSeries,
  buildBetaDataContext,
  buildSharpePortfolioInputEnvelopes,
  buildReturnSeriesEnvelope,
} from "../.testbuild/financial-data/builders/index.js";
import { makeDataQuality } from "../.testbuild/financial-data/quality.js";
import { calculateSimpleReturns } from "../.testbuild/analytics/index.js";

function approx(actual, expected, epsilon = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} ≈ ${expected} (epsilon ${epsilon})`,
  );
}

function makeQuality() {
  return makeDataQuality({
    freshness: "fresh",
    sourceTier: "licensed",
    completeness: 1,
  });
}

function returnSeries(points, assetId = "PF") {
  return { assetId, points };
}

function dailyEnvelope(series, overrides = {}) {
  return {
    value: series,
    source: overrides.source ?? {
      provider: "pf-provider",
      originalSource: "pf-dataset",
      identifier: "pf-series",
    },
    observedAt: overrides.observedAt ?? "2025-09-24",
    retrievedAt: overrides.retrievedAt ?? "2026-09-22T15:00:00Z",
    frequency: "daily",
    quality: makeQuality(),
    ...overrides,
  };
}

const METHODOLOGY = createSharpePortfolioInputMethodology();
const AS_OF = "2025-09-24";

function fixtureSeries() {
  return returnSeries([
    { date: "2025-09-21", value: 0.01 },
    { date: "2025-09-22", value: 0.02 },
    { date: "2025-09-23", value: 0.03 },
  ]);
}

function fixtureEnvelope() {
  return dailyEnvelope(fixtureSeries(), {
    observedAt: "2025-09-23",
  });
}

const FIXTURE_STD = 0.01;
const FIXTURE_ANNUALIZED_VOL =
  FIXTURE_STD * Math.sqrt(252);
const FIXTURE_ANNUALIZED_RETURN = 0.02 * 252;

describe("A: methodology V1 is correct", () => {
  it("createSharpePortfolioInputMethodology returns the exact V1 contract", () => {
    assert.deepEqual(METHODOLOGY, {
      lookbackYears: 1,
      frequency: "daily",
      annualizationFactor: 252,
      returnAnnualization: "arithmetic_mean_times_factor",
      volatilityEstimator: "sample_standard_deviation",
      volatilityAnnualization: "sqrt_factor",
    });
  });

  it("validate rejects every non-V1 value", () => {
    const mutations = [
      { lookbackYears: 2 },
      { frequency: "weekly" },
      { annualizationFactor: 365 },
      { returnAnnualization: "cagr" },
      { volatilityEstimator: "population_standard_deviation" },
      { volatilityAnnualization: "multiply_252" },
    ];
    for (const mutation of mutations) {
      assert.throws(
        () => validateSharpePortfolioInputMethodology({ ...METHODOLOGY, ...mutation }),
        InvalidSharpePortfolioInputMethodologyError,
        `should reject ${JSON.stringify(mutation)}`,
      );
    }
  });

  it("snapshot is identical to the V1 contract", () => {
    assert.deepEqual(snapshotSharpePortfolioInputMethodology(METHODOLOGY), {
      lookbackYears: 1,
      frequency: "daily",
      annualizationFactor: 252,
      returnAnnualization: "arithmetic_mean_times_factor",
      volatilityEstimator: "sample_standard_deviation",
      volatilityAnnualization: "sqrt_factor",
    });
  });
});

describe("B: date range over 1Y is correct", () => {
  it("asOf 2026-09-22 maps to (2025-09-22, 2026-09-22]", () => {
    assert.deepEqual(
      resolveSharpePortfolioInputDateRange({
        asOf: "2026-09-22",
        methodology: METHODOLOGY,
      }),
      { startDate: "2025-09-22", endDate: "2026-09-22" },
    );
  });
});

describe("C: leap-year handling is correct", () => {
  it("Feb-29 asOf rewinds to Feb-28 in a non-leap year", () => {
    assert.deepEqual(
      resolveSharpePortfolioInputDateRange({
        asOf: "2024-02-29",
        methodology: METHODOLOGY,
      }),
      { startDate: "2023-02-28", endDate: "2024-02-29" },
    );
  });

  it("Mar-01 after a leap day maps a full year back", () => {
    assert.deepEqual(
      resolveSharpePortfolioInputDateRange({
        asOf: "2025-03-01",
        methodology: METHODOLOGY,
      }),
      { startDate: "2024-03-01", endDate: "2025-03-01" },
    );
  });

  it("Feb-28 in a non-leap year maps to Feb-28", () => {
    assert.deepEqual(
      resolveSharpePortfolioInputDateRange({
        asOf: "2026-02-28",
        methodology: METHODOLOGY,
      }),
      { startDate: "2025-02-28", endDate: "2026-02-28" },
    );
  });
});

describe("D: window semantics are (startDate, endDate]", () => {
  it("excludes the return dated exactly at startDate, includes endDate", () => {
    const result = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: "2025-09-22",
      returnSeries: returnSeries([
        { date: "2024-09-21", value: 0.1 },
        { date: "2024-09-22", value: 0.2 },
        { date: "2024-09-23", value: 0.3 },
        { date: "2025-09-21", value: 0.4 },
        { date: "2025-09-22", value: 0.5 },
      ]),
    });
    assert.deepEqual(
      result.selectedReturns.map((point) => point.date),
      ["2024-09-23", "2025-09-21", "2025-09-22"],
    );
  });
});

describe("E: input order does not matter", () => {
  it("reversed points yield the same chronological selection", () => {
    const reversed = returnSeries([
      { date: "2025-09-23", value: 0.03 },
      { date: "2025-09-21", value: 0.01 },
      { date: "2025-09-22", value: 0.02 },
    ]);
    const result = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: AS_OF,
      returnSeries: reversed,
    });
    assert.deepEqual(
      result.selectedReturns.map((point) => point.date),
      ["2025-09-21", "2025-09-22", "2025-09-23"],
    );
    approx(result.annualizedReturn, FIXTURE_ANNUALIZED_RETURN);
    approx(result.annualizedVolatility, FIXTURE_ANNUALIZED_VOL);
  });
});

describe("F: duplicate dates are rejected", () => {
  it("calculate throws DuplicateDateError", () => {
    assert.throws(
      () =>
        calculateAnnualizedPortfolioPerformance({
          methodology: METHODOLOGY,
          asOf: AS_OF,
          returnSeries: returnSeries([
            { date: "2025-09-21", value: 0.01 },
            { date: "2025-09-21", value: 0.02 },
            { date: "2025-09-22", value: 0.03 },
          ]),
        }),
      DuplicateDateError,
    );
  });
});

describe("G: malformed dates are rejected", () => {
  it("impossible calendar dates throw InvalidReturnSeriesError", () => {
    assert.throws(
      () =>
        calculateAnnualizedPortfolioPerformance({
          methodology: METHODOLOGY,
          asOf: AS_OF,
          returnSeries: returnSeries([
            { date: "2025-02-30", value: 0.01 },
            { date: "2025-09-22", value: 0.02 },
          ]),
        }),
      InvalidReturnSeriesError,
    );
  });

  it("non-canonical strings throw InvalidReturnSeriesError", () => {
    assert.throws(
      () =>
        calculateAnnualizedPortfolioPerformance({
          methodology: METHODOLOGY,
          asOf: AS_OF,
          returnSeries: returnSeries([
            { date: "9/22/2025", value: 0.01 },
            { date: "2025-09-22", value: 0.02 },
          ]),
        }),
      InvalidReturnSeriesError,
    );
  });
});

describe("H: non-finite returns are rejected", () => {
  it("NaN and Infinity throw InvalidReturnSeriesError", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.throws(
        () =>
          calculateAnnualizedPortfolioPerformance({
            methodology: METHODOLOGY,
            asOf: AS_OF,
            returnSeries: returnSeries([
              { date: "2025-09-21", value },
              { date: "2025-09-22", value: 0.02 },
            ]),
          }),
        InvalidReturnSeriesError,
        `should reject ${String(value)}`,
      );
    }
  });
});

describe("I: negative returns are allowed", () => {
  it("a negative series computes without error", () => {
    const result = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: AS_OF,
      returnSeries: returnSeries([
        { date: "2025-09-21", value: -0.01 },
        { date: "2025-09-22", value: -0.02 },
        { date: "2025-09-23", value: -0.03 },
      ]),
    });
    approx(result.dailyMeanReturn, -0.02);
    assert.ok(result.annualizedReturn < 0);
  });
});

describe("J: both outputs use the same selectedObservationCount", () => {
  it("pure calculation and builder trace report identical counts", () => {
    const pure = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: AS_OF,
      returnSeries: fixtureSeries(),
    });
    const built = buildSharpePortfolioInputEnvelopes({
      returnEnvelope: dailyEnvelope(fixtureSeries(), { observedAt: "2025-09-23" }),
      methodology: METHODOLOGY,
      asOf: AS_OF,
    });
    assert.equal(pure.selectedReturns.length, 3);
    assert.equal(pure.dataWindow.observations, 3);
    assert.equal(built.trace.selectedObservationCount, 3);
    assert.equal(
      built.trace.selectedObservationCount,
      pure.dataWindow.observations,
    );
  });
});

describe("K: daily mean is correct", () => {
  it("mean([0.01, 0.02, 0.03]) is 0.02", () => {
    const result = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: AS_OF,
      returnSeries: fixtureSeries(),
    });
    approx(result.dailyMeanReturn, 0.02);
  });
});

describe("L: annual return uses mean * 252", () => {
  it("0.02 * 252 => 5.04", () => {
    const result = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: AS_OF,
      returnSeries: fixtureSeries(),
    });
    approx(result.annualizedReturn, 5.04);
    approx(result.annualizedReturn, result.dailyMeanReturn * 252);
  });
});

describe("M: NO CAGR", () => {
  it("arithmetic mean times factor is NOT compound annual growth", () => {
    const result = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: AS_OF,
      returnSeries: fixtureSeries(),
    });
    const cagrOneYear = (1.01 * 1.02 * 1.03) ** (1 / 1) - 1;
    assert.ok(Math.abs(result.annualizedReturn - cagrOneYear) > 4);
    approx(result.annualizedReturn, FIXTURE_ANNUALIZED_RETURN);
  });
});

describe("N: NO geometric compounding", () => {
  it("no product(1+r) appears anywhere in the result", () => {
    const result = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: AS_OF,
      returnSeries: fixtureSeries(),
    });
    const geometric = 1.01 * 1.02 * 1.03 - 1;
    assert.notEqual(result.annualizedReturn, geometric);
    assert.equal(result.annualizedVolatility, FIXTURE_ANNUALIZED_VOL);
  });
});

describe("O: sample variance divides by n-1", () => {
  it("dailySampleVolatility uses the n-1 divisor", () => {
    const result = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: AS_OF,
      returnSeries: fixtureSeries(),
    });
    const sampleStd = Math.sqrt(
      ((0.01 - 0.02) ** 2 + (0.02 - 0.02) ** 2 + (0.03 - 0.02) ** 2) / 2,
    );
    const populationStd = Math.sqrt(
      ((0.01 - 0.02) ** 2 + (0.02 - 0.02) ** 2 + (0.03 - 0.02) ** 2) / 3,
    );
    approx(result.dailySampleVolatility, sampleStd);
    assert.ok(Math.abs(result.dailySampleVolatility - populationStd) > 1e-4);
  });
});

describe("P: [0.01, 0.02, 0.03] => sample std 0.01", () => {
  it("dailySampleVolatility is exactly 0.01", () => {
    const result = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: AS_OF,
      returnSeries: fixtureSeries(),
    });
    approx(result.dailySampleVolatility, FIXTURE_STD);
  });
});

describe("Q: annualized volatility = daily std * sqrt(252)", () => {
  it("0.01 * sqrt(252) => ~0.15874507866387544", () => {
    const result = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: AS_OF,
      returnSeries: fixtureSeries(),
    });
    approx(result.annualizedVolatility, 0.15874507866387544);
  });
});

describe("R: minimum 2 observations required", () => {
  it("a single point inside the window throws", () => {
    assert.throws(
      () =>
        calculateAnnualizedPortfolioPerformance({
          methodology: METHODOLOGY,
          asOf: AS_OF,
          returnSeries: returnSeries([
            { date: "2025-09-21", value: 0.01 },
            { date: "2025-09-22", value: 0.02 },
            { date: "2025-09-23", value: 0.03 },
            { date: "2025-09-24", value: 0.04 },
          ].filter((point) => point.date !== "2025-09-22" && point.date !== "2025-09-23" && point.date !== "2025-09-24")),
        }),
      InvalidSharpePortfolioInputError,
    );
  });

  it("two points compute successfully", () => {
    const result = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: AS_OF,
      returnSeries: returnSeries([
        { date: "2025-09-22", value: 0.01 },
        { date: "2025-09-23", value: 0.03 },
      ]),
    });
    assert.equal(result.dataWindow.observations, 2);
  });
});

describe("S: constant returns => volatility 0", () => {
  it("produces annualized volatility of exactly 0", () => {
    const result = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: AS_OF,
      returnSeries: returnSeries([
        { date: "2025-09-21", value: 0.01 },
        { date: "2025-09-22", value: 0.01 },
        { date: "2025-09-23", value: 0.01 },
      ]),
    });
    assert.equal(result.dailySampleVolatility, 0);
    assert.equal(result.annualizedVolatility, 0);
  });
});

describe("T: annualized return can be negative", () => {
  it("negative daily returns annualize negative", () => {
    const result = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: AS_OF,
      returnSeries: returnSeries([
        { date: "2025-09-22", value: -0.01 },
        { date: "2025-09-23", value: -0.02 },
      ]),
    });
    approx(result.dailyMeanReturn, -0.015);
    approx(result.annualizedReturn, -3.78);
  });
});

describe("U: AnnualDecimalRate output is correct", () => {
  it("portfolioAnnualReturn.value matches the contract", () => {
    const built = buildSharpePortfolioInputEnvelopes({
      returnEnvelope: fixtureEnvelope(),
      methodology: METHODOLOGY,
      asOf: AS_OF,
    });
    assert.deepEqual(built.portfolioAnnualReturn.value, {
      rate: FIXTURE_ANNUALIZED_RETURN,
      period: "annual",
      representation: "decimal",
    });
    assert.equal(built.portfolioAnnualReturn.frequency, "annual");
  });
});

describe("V: AnnualDecimalVolatility output is correct", () => {
  it("portfolioAnnualizedVolatility.value matches the contract", () => {
    const built = buildSharpePortfolioInputEnvelopes({
      returnEnvelope: fixtureEnvelope(),
      methodology: METHODOLOGY,
      asOf: AS_OF,
    });
    assert.deepEqual(built.portfolioAnnualizedVolatility.value, {
      volatility: FIXTURE_ANNUALIZED_VOL,
      period: "annual",
      representation: "decimal",
    });
    assert.equal(built.portfolioAnnualizedVolatility.frequency, "annual");
  });
});

describe("W: observedAt = last selected return date", () => {
  it("is the final selected daily return date, not asOf", () => {
    const built = buildSharpePortfolioInputEnvelopes({
      returnEnvelope: fixtureEnvelope(),
      methodology: METHODOLOGY,
      asOf: AS_OF,
    });
    assert.equal(built.portfolioAnnualReturn.observedAt, "2025-09-23");
    assert.equal(
      built.portfolioAnnualizedVolatility.observedAt,
      "2025-09-23",
    );
    assert.equal(built.trace.lastSelectedDate, "2025-09-23");
  });
});

describe("X: provenance preserved in BOTH envelopes", () => {
  it("multi-source envelope keeps every reference in both outputs", () => {
    const sources = [
      {
        provider: "provider-a",
        originalSource: "dataset-a",
        identifier: "asset-a",
        observedAt: "2025-09-23",
        retrievedAt: "2026-09-22T15:00:00Z",
      },
      {
        provider: "provider-b",
        originalSource: "dataset-b",
        identifier: "asset-b",
        observedAt: "2025-09-23",
        retrievedAt: "2026-09-22T15:00:00Z",
      },
      {
        provider: "provider-b",
        originalSource: "dataset-b",
        identifier: "asset-c",
        observedAt: "2025-09-23",
        retrievedAt: "2026-09-22T15:00:00Z",
      },
    ];
    const envelope = dailyEnvelope(fixtureSeries(), {
      source: undefined,
      sources,
      observedAt: "2025-09-23",
    });
    const built = buildSharpePortfolioInputEnvelopes({
      returnEnvelope: envelope,
      methodology: METHODOLOGY,
      asOf: AS_OF,
    });
    assert.deepEqual(built.portfolioAnnualReturn.sources, sources);
    assert.deepEqual(built.portfolioAnnualizedVolatility.sources, sources);
  });

  it("single-source envelope flows into a reference in both outputs", () => {
    const envelope = dailyEnvelope(fixtureSeries(), {
      source: {
        provider: "pf-provider",
        originalSource: "pf-dataset",
        identifier: "pf-series",
      },
      observedAt: "2025-09-23",
    });
    const built = buildSharpePortfolioInputEnvelopes({
      returnEnvelope: envelope,
      methodology: METHODOLOGY,
      asOf: AS_OF,
    });
    for (const output of [
      built.portfolioAnnualReturn,
      built.portfolioAnnualizedVolatility,
    ]) {
      assert.equal(output.sources.length, 1);
      assert.equal(output.sources[0].provider, "pf-provider");
      assert.equal(output.sources[0].identifier, "pf-series");
      assert.equal(output.sources[0].observedAt, "2025-09-23");
      assert.equal(output.sources[0].retrievedAt, "2026-09-22T15:00:00Z");
    }
  });

  it("an envelope without provenance is rejected", () => {
    assert.throws(
      () =>
        buildSharpePortfolioInputEnvelopes({
          returnEnvelope: dailyEnvelope(fixtureSeries(), {
            source: undefined,
            sources: [],
            observedAt: "2025-09-23",
          }),
          methodology: METHODOLOGY,
          asOf: AS_OF,
        }),
      InvalidSharpePortfolioInputError,
    );
  });
});

describe("Y: retrievedAt preserved", () => {
  it("both envelopes keep the input retrievedAt", () => {
    const envelope = dailyEnvelope(fixtureSeries(), {
      observedAt: "2025-09-23",
      retrievedAt: "2026-09-22T16:00:00Z",
    });
    const built = buildSharpePortfolioInputEnvelopes({
      returnEnvelope: envelope,
      methodology: METHODOLOGY,
      asOf: AS_OF,
    });
    assert.equal(built.portfolioAnnualReturn.retrievedAt, "2026-09-22T16:00:00Z");
    assert.equal(
      built.portfolioAnnualizedVolatility.retrievedAt,
      "2026-09-22T16:00:00Z",
    );
  });
});

describe("Z: quality preserved", () => {
  it("both envelopes carry the exact same quality object", () => {
    const quality = makeQuality();
    const envelope = dailyEnvelope(fixtureSeries(), {
      observedAt: "2025-09-23",
      quality,
    });
    const built = buildSharpePortfolioInputEnvelopes({
      returnEnvelope: envelope,
      methodology: METHODOLOGY,
      asOf: AS_OF,
    });
    assert.strictEqual(built.portfolioAnnualReturn.quality, quality);
    assert.strictEqual(
      built.portfolioAnnualizedVolatility.quality,
      quality,
    );
  });
});

describe("AA: trace is correct", () => {
  it("snapshot, requestedRange and selected bounds are all present", () => {
    const built = buildSharpePortfolioInputEnvelopes({
      returnEnvelope: fixtureEnvelope(),
      methodology: METHODOLOGY,
      asOf: "2025-09-30",
    });
    assert.deepEqual(built.trace.methodologySnapshot, METHODOLOGY);
    assert.deepEqual(built.trace.requestedRange, {
      startDate: "2024-09-30",
      endDate: "2025-09-30",
    });
    assert.equal(built.trace.selectedObservationCount, 3);
    assert.equal(built.trace.firstSelectedDate, "2025-09-21");
    assert.equal(built.trace.lastSelectedDate, "2025-09-23");
  });

  it("traceSharpePortfolioInputPerformance matches the builder trace", () => {
    const calculation = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: AS_OF,
      returnSeries: fixtureSeries(),
    });
    const expected = traceSharpePortfolioInputPerformance({
      methodology: METHODOLOGY,
      asOf: AS_OF,
      calculation,
    });
    const built = buildSharpePortfolioInputEnvelopes({
      returnEnvelope: fixtureEnvelope(),
      methodology: METHODOLOGY,
      asOf: AS_OF,
    });
    assert.deepEqual(built.trace, expected);
  });
});

describe("AB: both envelopes share the same window/metadata", () => {
  it("observedAt, sources, retrievedAt, quality and frequency all match", () => {
    const built = buildSharpePortfolioInputEnvelopes({
      returnEnvelope: fixtureEnvelope(),
      methodology: METHODOLOGY,
      asOf: AS_OF,
    });
    const a = built.portfolioAnnualReturn;
    const b = built.portfolioAnnualizedVolatility;
    assert.equal(a.observedAt, b.observedAt);
    assert.deepEqual(a.sources, b.sources);
    assert.equal(a.retrievedAt, b.retrievedAt);
    assert.strictEqual(a.quality, b.quality);
    assert.equal(a.frequency, "annual");
    assert.equal(b.frequency, "annual");
  });
});

describe("AC: outputs feed directly into sharpeIndicator", () => {
  it("engine computes a finite ok Sharpe using the built envelopes", () => {
    const built = buildSharpePortfolioInputEnvelopes({
      returnEnvelope: fixtureEnvelope(),
      methodology: METHODOLOGY,
      asOf: AS_OF,
    });
    const riskFreeEnvelope = {
      value: { rate: 0.04, period: "annual", representation: "decimal" },
      source: {
        provider: "rf-provider",
        originalSource: "rf-dataset",
        identifier: "rf-1",
      },
      observedAt: AS_OF,
      retrievedAt: "2026-09-22T15:00:00Z",
      frequency: "annual",
      quality: makeQuality(),
    };
    const registry = new IndicatorRegistry();
    registry.register(sharpeIndicator);
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({
        indicators: ["sharpe"],
        context: {
          data: {
            [PORTFOLIO_ANNUAL_RETURN_DATA_KEY]: built.portfolioAnnualReturn,
            [RISK_FREE_RATE_DATA_KEY]: riskFreeEnvelope,
            [PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY]:
              built.portfolioAnnualizedVolatility,
          },
          indicators: new Map(),
          asOf: AS_OF,
        },
      })
      .get("sharpe");
    assert.equal(result.status, "ok");
    assert.ok(Number.isFinite(result.value));
    approx(result.value, (5.04 - 0.04) / FIXTURE_ANNUALIZED_VOL, 1e-9);
  });
});

describe("AD: known Sharpe fixture stays 0.4", () => {
  it("0.12 / 0.04 / 0.20 => 0.4", () => {
    approx(
      calculateSharpeRatio({
        portfolioReturn: 0.12,
        riskFreeRate: 0.04,
        portfolioVolatility: 0.2,
      }),
      0.4,
    );
  });
});

describe("AE: zero volatility never produces Infinity/NaN", () => {
  it("constant returns => volatility 0 => sharpe status error, no NaN", () => {
    const constantEnvelope = dailyEnvelope(
      returnSeries([
        { date: "2025-09-21", value: 0.01 },
        { date: "2025-09-22", value: 0.01 },
        { date: "2025-09-23", value: 0.01 },
      ]),
      { observedAt: "2025-09-23" },
    );
    const built = buildSharpePortfolioInputEnvelopes({
      returnEnvelope: constantEnvelope,
      methodology: METHODOLOGY,
      asOf: AS_OF,
    });
    assert.equal(built.portfolioAnnualizedVolatility.value.volatility, 0);
    const riskFreeEnvelope = {
      value: { rate: 0.04, period: "annual", representation: "decimal" },
      source: {
        provider: "rf-provider",
        originalSource: "rf-dataset",
        identifier: "rf-1",
      },
      observedAt: AS_OF,
      retrievedAt: "2026-09-22T15:00:00Z",
      frequency: "annual",
      quality: makeQuality(),
    };
    const registry = new IndicatorRegistry();
    registry.register(sharpeIndicator);
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({
        indicators: ["sharpe"],
        context: {
          data: {
            [PORTFOLIO_ANNUAL_RETURN_DATA_KEY]: built.portfolioAnnualReturn,
            [RISK_FREE_RATE_DATA_KEY]: riskFreeEnvelope,
            [PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY]:
              built.portfolioAnnualizedVolatility,
          },
          indicators: new Map(),
          asOf: AS_OF,
        },
      })
      .get("sharpe");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.ok(!Number.isNaN(result.value));
  });
});

describe("AF: CAPM is unchanged", () => {
  it("0.112 fixture still holds", () => {
    approx(
      calculateCapmExpectedReturn({
        beta: 1.2,
        riskFreeRate: 0.04,
        expectedMarketReturn: 0.1,
      }),
      0.112,
    );
  });
});

describe("AG: Beta pipeline is unchanged", () => {
  it("beta stays deterministic across engine runs", () => {
    const portfolioPrices = [
      { date: "2026-09-10", value: 100 },
      { date: "2026-09-11", value: 104 },
      { date: "2026-09-12", value: 103.9584 },
    ];
    const benchmarkPrices = [
      { date: "2026-09-10", value: 100 },
      { date: "2026-09-11", value: 101 },
      { date: "2026-09-12", value: 100.99 },
    ];
    const portfolioEnvelope = buildReturnSeriesEnvelope({
      priceSeries: { assetId: "PF", points: portfolioPrices },
      source: {
        provider: "provider-portfolio",
        originalSource: "portfolio-dataset",
        identifier: "pf-series",
      },
      frequency: "daily",
      retrievedAt: "2026-09-12T12:00:00Z",
      quality: makeQuality(),
    });
    const benchmarkEnvelope = buildBenchmarkReturnSeries({
      priceSeries: { assetId: "BENCH", points: benchmarkPrices },
      source: {
        provider: "provider-benchmark",
        originalSource: "benchmark-dataset",
        identifier: "bench-series",
      },
      frequency: "daily",
      retrievedAt: "2026-09-12T12:00:00Z",
      quality: makeQuality(),
      benchmark: { id: "BENCH", symbol: "BENCH" },
    });
    const context = buildBetaDataContext({
      portfolioReturns: portfolioEnvelope,
      benchmarkReturns: benchmarkEnvelope,
      asOf: "2026-09-12",
    });
    const registry = new IndicatorRegistry();
    registry.register(betaIndicator);
    const engine = new AnalyticsEngine(registry);
    const first = engine.calculate({ indicators: ["beta"], context }).get("beta");
    const second = engine.calculate({ indicators: ["beta"], context }).get("beta");
    assert.equal(first.status, "ok");
    assert.equal(first.value, second.value);
    assert.ok(Number.isFinite(first.value));
  });
});

describe("AH: previous test semantics keep their determinism", () => {
  it("the full builder path is stable across identical runs", () => {
    const run = () =>
      buildSharpePortfolioInputEnvelopes({
        returnEnvelope: fixtureEnvelope(),
        methodology: METHODOLOGY,
        asOf: AS_OF,
      });
    const first = run();
    const second = run();
    assert.deepEqual(first, second);
  });
});

/* ------------------------------------------------------------------------ */
/* Micro-fix: Sharpe price request range (seed buffer for the FIRST daily   */
/* return; never additional metric lookback).                               */
/*                                                                          */
/*   A  return range stays (2025-09-22, 2026-09-22]                        */
/*   B  price request range: 2025-09-15 -> 2026-09-22                       */
/*   C  -7 days crosses a month boundary correctly                          */
/*   D  -7 days crosses a year boundary correctly                           */
/*   E  leap-year arithmetic is correct                                     */
/*   F  a seed price BEFORE startDate enables the first in-window return    */
/*   G  the seed does not create an in-sample return dated <= startDate     */
/*   H  annualizedReturn/volatility are unchanged                           */
/*   I  prior 573-test semantics stay green (deterministic reruns)          */
/* ------------------------------------------------------------------------ */

describe("Micro-fix A: return range stays unchanged", () => {
  it("asOf 2026-09-22 still maps to (2025-09-22, 2026-09-22]", () => {
    assert.deepEqual(
      resolveSharpePortfolioInputDateRange({
        asOf: "2026-09-22",
        methodology: METHODOLOGY,
      }),
      { startDate: "2025-09-22", endDate: "2026-09-22" },
    );
  });
});

describe("Micro-fix B: price request range", () => {
  it("extends 7 calendar days before the return window start", () => {
    assert.deepEqual(
      resolveSharpePortfolioPriceRequestRange({
        asOf: "2026-09-22",
        methodology: METHODOLOGY,
      }),
      { startDate: "2025-09-15", endDate: "2026-09-22" },
    );
  });

  it("exports the fixed 7-day seed constant", () => {
    assert.equal(SHARPE_PRICE_SEED_LOOKBACK_DAYS, 7);
  });
});

describe("Micro-fix C: subtract 7 days crosses a month boundary", () => {
  it("2025-03-03 - 7d => 2025-02-24", () => {
    assert.deepEqual(
      resolveSharpePortfolioPriceRequestRange({
        asOf: "2026-03-03",
        methodology: METHODOLOGY,
      }),
      { startDate: "2025-02-24", endDate: "2026-03-03" },
    );
  });
});

describe("Micro-fix D: subtract 7 days crosses a year boundary", () => {
  it("2025-01-05 - 7d => 2024-12-29", () => {
    assert.deepEqual(
      resolveSharpePortfolioPriceRequestRange({
        asOf: "2026-01-05",
        methodology: METHODOLOGY,
      }),
      { startDate: "2024-12-29", endDate: "2026-01-05" },
    );
  });
});

describe("Micro-fix E: leap-year arithmetic is correct", () => {
  it("2024-03-01 - 7d => 2024-02-23 (leap February has 29 days)", () => {
    assert.deepEqual(
      resolveSharpePortfolioPriceRequestRange({
        asOf: "2025-03-01",
        methodology: METHODOLOGY,
      }),
      { startDate: "2024-02-23", endDate: "2025-03-01" },
    );
  });

  it("2024-02-28 - 7d => 2024-02-21", () => {
    assert.deepEqual(
      resolveSharpePortfolioPriceRequestRange({
        asOf: "2025-02-28",
        methodology: METHODOLOGY,
      }),
      { startDate: "2024-02-21", endDate: "2025-02-28" },
    );
  });
});

describe("Micro-fix F+G: seed price semantics", () => {
  it("seed prices before startDate enable the first in-window return", () => {
    const prices = [
      { date: "2025-09-19", value: 100 },
      { date: "2025-09-22", value: 110 },
      { date: "2025-09-23", value: 121 },
      { date: "2025-09-24", value: 133.1 },
    ];
    const returns = calculateSimpleReturns({
      assetId: "PF",
      points: prices,
    });
    const result = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: "2026-09-22",
      returnSeries: returns,
    });
    assert.deepEqual(
      result.selectedReturns.map((point) => point.date),
      ["2025-09-23", "2025-09-24"],
    );
    assert.equal(result.dataWindow.startDate, "2025-09-23");
  });

  it("price on startDate/seed prices never create an in-sample date <= startDate", () => {
    const prices = [
      { date: "2025-09-19", value: 100 },
      { date: "2025-09-22", value: 110 },
      { date: "2025-09-23", value: 121 },
      { date: "2025-09-24", value: 133.1 },
    ];
    const returns = calculateSimpleReturns({
      assetId: "PF",
      points: prices,
    });
    assert.deepEqual(
      returns.points.map((point) => point.date),
      ["2025-09-22", "2025-09-23", "2025-09-24"],
    );
    const result = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: "2026-09-22",
      returnSeries: returns,
    });
    assert.ok(
      result.selectedReturns.every((point) => point.date > "2025-09-22"),
    );
    assert.ok(
      result.selectedReturns.every((point) => point.date <= "2026-09-22"),
    );
  });
});

describe("Micro-fix H: annualizedReturn/volatility are unchanged", () => {
  it("the [0.01, 0.02, 0.03] fixture still yields 5.04 and 0.1587...", () => {
    const result = calculateAnnualizedPortfolioPerformance({
      methodology: METHODOLOGY,
      asOf: AS_OF,
      returnSeries: fixtureSeries(),
    });
    approx(result.annualizedReturn, FIXTURE_ANNUALIZED_RETURN);
    approx(result.annualizedVolatility, FIXTURE_ANNUALIZED_VOL);
  });
});

describe("Micro-fix I: prior 573-test semantics stay green", () => {
  it("the price-request helper is deterministic across identical runs", () => {
    const run = () =>
      resolveSharpePortfolioPriceRequestRange({
        asOf: "2026-09-22",
        methodology: METHODOLOGY,
      });
    assert.deepEqual(run(), run());
  });

  it("the price-request range is never part of the selected Sharpe window", () => {
    const request = resolveSharpePortfolioPriceRequestRange({
      asOf: "2026-09-22",
      methodology: METHODOLOGY,
    });
    const returnRange = resolveSharpePortfolioInputDateRange({
      asOf: "2026-09-22",
      methodology: METHODOLOGY,
    });
    assert.ok(request.startDate < returnRange.startDate);
    assert.equal(request.endDate, returnRange.endDate);
  });
});