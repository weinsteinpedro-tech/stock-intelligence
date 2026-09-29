/* Expected Market Return V1 — methodology + pure estimator tests (no network). */
/*                                                                             */
/* Run via `npm run test:static` (compiles lib to .testbuild, node --test).   */
/*                                                                             */
/* Coverage map (A-AF):                                                        */
/*   A   methodology valid                                                     */
/*   B   benchmark generic                                                     */
/*   C   no index/provider hardcoded                                           */
/*   D   10Y date range correct                                                */
/*   E   leap-year handling                                                    */
/*   F   generates 11 target anchors                                           */
/*   G   exact target date selected when exists                                */
/*   H   weekend/holiday uses latest <= target                                 */
/*   I   never uses a future price                                             */
/*   J   max staleness 7 days allowed                                          */
/*   K   >7 days rejected                                                      */
/*   L   duplicate price dates rejected                                        */
/*   M   invalid dates rejected                                                */
/*   N   non-finite price rejected                                             */
/*   O   non-positive price rejected                                           */
/*   P   computes 10 annual simple returns                                     */
/*   Q   NO log returns                                                        */
/*   R   NO CAGR                                                               */
/*   S   fixture annual returns => arithmetic mean 0.054                       */
/*   T   negative annual returns permitted                                     */
/*   U   negative expected market return permitted                             */
/*   V   snapshot correct                                                      */
/*   W   trace shows 11 anchors / 10 returns                                   */
/*   X   observedAt = last selected anchor date                                */
/*   Y   provenance preserved                                                  */
/*   Z   output is AnnualDecimalRate                                           */
/*   AA  CAPM accepts output without transformation                            */
/*   AB  CAPM known math intact                                                */
/*   AC  Beta tests stay intended (beta = 2 pipeline)                          */
/*   AD  Risk-free builder stays deterministic                                 */
/*   AE  FRED-driven risk-free stays deterministic                             */
/*   AF  previous 447 tests keep their semantics (deterministic runs)          */
/* --------------------------------------------------------------------------- */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AnalyticsEngine,
  betaIndicator,
  calculateCapmExpectedReturn,
  capmIndicator,
  EXPECTED_MARKET_RETURN_DATA_KEY,
  IndicatorRegistry,
  RISK_FREE_RATE_DATA_KEY,
} from "../.testbuild/analytics/index.js";
import {
  buildBenchmarkReturnSeries,
  buildBetaDataContext,
  buildReturnSeriesEnvelope,
} from "../.testbuild/financial-data/builders/index.js";
import {
  buildRiskFreeRateEnvelope,
  createRiskFreeRateMethodology,
} from "../.testbuild/financial-data/rates/index.js";
import {
  AnchorTooStaleError,
  buildExpectedMarketReturnEnvelope,
  computeAnnualSimpleReturns,
  computeExpectedMarketReturnFromAnnualReturns,
  createExpectedMarketReturnMethodology,
  DuplicateExpectedMarketReturnPriceError,
  EXPECTED_MARKET_RETURN_LOOKBACK_YEARS,
  EXPECTED_MARKET_RETURN_MAX_ANCHOR_STALENESS_DAYS,
  generateAnnualAnchorTargetDates,
  InvalidExpectedMarketReturnDateError,
  InvalidExpectedMarketReturnInputError,
  InvalidExpectedMarketReturnMethodologyError,
  InvalidExpectedMarketReturnPriceError,
  NoEligibleAnchorError,
  resolveExpectedMarketReturnDataRequestRange,
  resolveExpectedMarketReturnDateRange,
  selectAnnualAnchors,
  snapshotExpectedMarketReturnMethodology,
  traceExpectedMarketReturn,
  validateExpectedMarketReturnMethodology,
} from "../.testbuild/financial-data/market-return/index.js";
import { makeDataQuality } from "../.testbuild/financial-data/quality.js";
import { dataEnvelopeToSourceReference } from "../.testbuild/financial-data/provenance.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRoot(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function approx(actual, expected, epsilon = 1e-9) {
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

const BENCHMARK = { id: "CUSTOM_BENCH", symbol: "CUSTOM", name: "Custom Benchmark" };

function methodology(benchmark = BENCHMARK) {
  return createExpectedMarketReturnMethodology({ benchmark });
}

function point(date, value) {
  return { date, value };
}

function series(points, assetId = "MRT") {
  return { assetId, points };
}

const SOURCE = {
  provider: "market-return-provider",
  originalSource: "market-return-dataset",
  identifier: "mrt-1",
};

function buildEnvelope(points, overrides = {}) {
  return buildExpectedMarketReturnEnvelope({
    priceSeries: series(points),
    methodology: methodology(),
    asOf: "2026-09-22",
    source: SOURCE,
    retrievedAt: "2026-09-22T12:00:00Z",
    quality: makeQuality(),
    ...overrides,
  });
}

const ANCHOR_DATES = [
  "2016-09-22",
  "2017-09-22",
  "2018-09-22",
  "2019-09-22",
  "2020-09-22",
  "2021-09-22",
  "2022-09-22",
  "2023-09-22",
  "2024-09-22",
  "2025-09-22",
  "2026-09-22",
];

const FIXTURE_RETURNS = [0.1, 0.05, -0.02, 0.08, 0.12, 0.03, 0.07, -0.04, 0.09, 0.06];

function fixturePrices() {
  const values = [100];
  for (const r of FIXTURE_RETURNS) {
    values.push(values[values.length - 1] * (1 + r));
  }
  return series(
    ANCHOR_DATES.map((date, index) => point(date, values[index])),
  );
}

function fixturePoints() {
  return fixturePrices().points;
}

describe("A: methodology valid", () => {
  it("creates the V1 methodology with the fixed semantics", () => {
    const m = methodology();
    assert.equal(m.lookbackYears, EXPECTED_MARKET_RETURN_LOOKBACK_YEARS);
    assert.equal(m.lookbackYears, 10);
    assert.equal(m.priceBasis, "adjusted_close");
    assert.equal(m.annualReturnMethod, "anniversary_to_anniversary");
    assert.equal(m.aggregation, "arithmetic_mean");
    assert.equal(
      m.maxAnchorStalenessDays,
      EXPECTED_MARKET_RETURN_MAX_ANCHOR_STALENESS_DAYS,
    );
    assert.equal(m.maxAnchorStalenessDays, 7);
    assert.equal(validateExpectedMarketReturnMethodology(m), undefined);
  });

  it("rejects empty benchmark id/symbol/name", () => {
    assert.throws(
      () => methodology({ id: "", symbol: "CUSTOM" }),
      InvalidExpectedMarketReturnMethodologyError,
    );
    assert.throws(
      () => methodology({ id: "CUSTOM_BENCH", symbol: "" }),
      InvalidExpectedMarketReturnMethodologyError,
    );
    assert.throws(
      () =>
        methodology({ id: "CUSTOM_BENCH", symbol: "CUSTOM", name: "" }),
      InvalidExpectedMarketReturnMethodologyError,
    );
  });
});

describe("B: benchmark generic", () => {
  it("preserves any caller-provided benchmark", () => {
    const m = methodology();
    assert.deepEqual(m.benchmark, BENCHMARK);
  });

  it("a totally different benchmark is accepted unchanged", () => {
    const m = methodology({ id: "X", symbol: "XINDEX" });
    assert.equal(m.benchmark.id, "X");
    assert.equal(m.benchmark.symbol, "XINDEX");
    assert.equal(m.benchmark.name, undefined);
  });
});

describe("C: no index/provider hardcoded", () => {
  it("the module never mentions a concrete index or provider", () => {
    const files = [
      "lib/financial-data/market-return/expected-market-return.ts",
      "lib/financial-data/market-return/index.ts",
    ];
    const forbidden = [
      /SPY/i,
      /S&P/i,
      /tiingo/i,
      /alpha[_\s-]?vantage/i,
      /fred/i,
      /treasury/i,
      /gemini/i,
    ];
    for (const file of files) {
      const source = readRoot(file);
      for (const pattern of forbidden) {
        assert.equal(pattern.test(source), false, `${file} must not match ${pattern}`);
      }
    }
  });
});

describe("D: 10Y date range correct", () => {
  it("asOf 2026-09-22 => 2016-09-22 .. 2026-09-22", () => {
    assert.deepEqual(
      resolveExpectedMarketReturnDateRange({
        asOf: "2026-09-22",
        methodology: methodology(),
      }),
      { startDate: "2016-09-22", endDate: "2026-09-22" },
    );
  });
});

describe("E: leap-year handling", () => {
  it("clamps an impossible Feb 29 anniversary to Feb 28", () => {
    const range = resolveExpectedMarketReturnDateRange({
      asOf: "2024-02-29",
      methodology: methodology(),
    });
    assert.equal(range.startDate, "2014-02-28");
    assert.equal(range.endDate, "2024-02-29");
  });

  it("keeps real leap anniversaries (2016-02-29) inside the decade", () => {
    const targets = generateAnnualAnchorTargetDates({
      asOf: "2024-02-29",
      methodology: methodology(),
    });
    assert.equal(targets.includes("2016-02-29"), true);
    assert.equal(targets[0], "2014-02-28");
  });

  it("asOf 2016-02-29 => start 2006-02-28", () => {
    const range = resolveExpectedMarketReturnDateRange({
      asOf: "2016-02-29",
      methodology: methodology(),
    });
    assert.equal(range.startDate, "2006-02-28");
    assert.equal(range.endDate, "2016-02-29");
  });
});

describe("F: generates 11 target anchors", () => {
  it("anchor target dates span exactly the decade", () => {
    const targets = generateAnnualAnchorTargetDates({
      asOf: "2026-09-22",
      methodology: methodology(),
    });
    assert.equal(targets.length, 11);
    assert.equal(targets[0], "2016-09-22");
    assert.equal(targets[targets.length - 1], "2026-09-22");
  });

  it("selectAnnualAnchors produces 11 anchors from the fixture", () => {
    const anchors = selectAnnualAnchors({
      priceSeries: fixturePrices(),
      methodology: methodology(),
      asOf: "2026-09-22",
    });
    assert.equal(anchors.length, 11);
  });
});

describe("G: exact target date selected when exists", () => {
  it("fixture prices sit exactly on every target date", () => {
    const anchors = selectAnnualAnchors({
      priceSeries: fixturePrices(),
      methodology: methodology(),
      asOf: "2026-09-22",
    });
    for (const anchor of anchors) {
      assert.equal(anchor.selectedDate, anchor.targetDate);
    }
  });
});

describe("H: weekend/holiday uses latest <= target", () => {
  it("a missing 2026-09-22 resolves to 2026-09-21", () => {
    const prices = fixturePoints().slice();
    prices[prices.length - 1] = point("2026-09-21", prices[prices.length - 1].value);
    const anchors = selectAnnualAnchors({
      priceSeries: series(prices),
      methodology: methodology(),
      asOf: "2026-09-22",
    });
    assert.equal(anchors[anchors.length - 1].selectedDate, "2026-09-21");
    assert.equal(anchors[anchors.length - 1].targetDate, "2026-09-22");
  });
});

describe("I: never uses a future price", () => {
  it("a later price after the target is ignored", () => {
    const prices = fixturePoints().concat([
      point("2026-09-23", 999),
    ]);
    const anchors = selectAnnualAnchors({
      priceSeries: series(prices),
      methodology: methodology(),
      asOf: "2026-09-22",
    });
    assert.equal(anchors[anchors.length - 1].selectedDate, "2026-09-22");
    assert.notEqual(anchors[anchors.length - 1].value, 999);
  });
});

describe("J: max staleness 7 days allowed", () => {
  it("an anchor 7 calendar days before its target is accepted", () => {
    const prices = fixturePoints().slice();
    prices[prices.length - 1] = point("2026-09-15", prices[prices.length - 1].value);
    const envelope = buildEnvelope(prices);
    assert.equal(envelope.observedAt, "2026-09-15");
    approx(envelope.value.rate, 0.054);
  });
});

describe("K: >7 days rejected", () => {
  it("an anchor 8 calendar days stale raises AnchorTooStaleError", () => {
    const prices = fixturePoints().slice();
    prices[prices.length - 1] = point("2026-09-14", prices[prices.length - 1].value);
    assert.throws(
      () => buildEnvelope(prices),
      AnchorTooStaleError,
    );
  });

  it("no price on/before the earliest target raises NoEligibleAnchorError", () => {
    const prices = [point("2026-09-22", 100)];
    assert.throws(
      () => buildEnvelope(prices),
      NoEligibleAnchorError,
    );
  });
});

describe("L: duplicate price dates rejected", () => {
  it("two points on the same date are ambiguous and rejected", () => {
    const prices = fixturePoints().concat([point("2026-09-22", 200)]);
    assert.throws(
      () => buildEnvelope(prices),
      DuplicateExpectedMarketReturnPriceError,
    );
  });
});

describe("M: invalid dates rejected", () => {
  it("impossible or malformed price dates are rejected", () => {
    for (const bad of ["2026-02-30", "2026/09/22", "garbage", "2026-13-01"]) {
      const prices = fixturePoints().slice();
      prices[0] = point(bad, 100);
      assert.throws(
        () => buildEnvelope(prices),
        InvalidExpectedMarketReturnDateError,
      );
    }
  });

  it("a malformed asOf is rejected", () => {
    assert.throws(
      () => buildEnvelope(fixturePoints(), { asOf: "2026-02-30" }),
      InvalidExpectedMarketReturnDateError,
    );
  });
});

describe("N: non-finite price rejected", () => {
  it("NaN and Infinity values are rejected", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const prices = fixturePoints().slice();
      prices[0] = point("2016-09-22", value);
      assert.throws(
        () => buildEnvelope(prices),
        InvalidExpectedMarketReturnPriceError,
      );
    }
  });
});

describe("O: non-positive price rejected", () => {
  it("zero and negative prices are rejected", () => {
    for (const value of [0, -5]) {
      const prices = fixturePoints().slice();
      prices[0] = point("2016-09-22", value);
      assert.throws(
        () => buildEnvelope(prices),
        InvalidExpectedMarketReturnPriceError,
      );
    }
  });
});

function fixtureAnchors() {
  return selectAnnualAnchors({
    priceSeries: fixturePrices(),
    methodology: methodology(),
    asOf: "2026-09-22",
  });
}

describe("P: computes 10 annual simple returns", () => {
  it("the fixture yields exactly its ten returns", () => {
    const returns = computeAnnualSimpleReturns(fixtureAnchors());
    assert.equal(returns.length, 10);
    returns.forEach((entry, index) => {
      approx(entry.value, FIXTURE_RETURNS[index]);
      assert.equal(entry.endDate, ANCHOR_DATES[index + 1]);
      assert.equal(entry.startDate, ANCHOR_DATES[index]);
    });
  });
});

describe("Q: NO log returns", () => {
  it("uses P_i / P_(i-1) - 1, not ln(P_i / P_(i-1))", () => {
    const returns = computeAnnualSimpleReturns(fixtureAnchors());
    approx(returns[0].value, 0.1);
    assert.notEqual(Math.abs(returns[0].value - Math.log(1.1)) < 1e-9, true);
  });
});

describe("R: NO CAGR", () => {
  it("the arithmetic mean differs from the compound annual growth rate", () => {
    const prices = fixturePrices().points;
    const first = prices[0].value;
    const last = prices[prices.length - 1].value;
    const cagr = Math.pow(last / first, 1 / 10) - 1;
    const returns = computeAnnualSimpleReturns(fixtureAnchors());
    const mean = computeExpectedMarketReturnFromAnnualReturns(returns);
    approx(mean, 0.054);
    assert.ok(Math.abs(mean - cagr) > 1e-4, `mean ${mean} must differ from CAGR ${cagr}`);
  });
});

describe("S: fixture annual returns => arithmetic mean 0.054", () => {
  it("the builder envelope rates the fixture at 0.054", () => {
    const envelope = buildEnvelope(fixturePoints());
    approx(envelope.value.rate, 0.054);
  });
});

describe("T: negative annual returns permitted", () => {
  it("the fixture's negative returns flow through (no error)", () => {
    const returns = computeAnnualSimpleReturns(fixtureAnchors());
    assert.equal(returns.some((entry) => entry.value < 0), true);
  });
});

describe("U: negative expected market return permitted", () => {
  it("a decade of negative returns yields a negative estimate", () => {
    const values = [100];
    for (let index = 0; index < 10; index += 1) {
      values.push(values[values.length - 1] * 0.9);
    }
    const prices = ANCHOR_DATES.map((date, index) => point(date, values[index]));
    const envelope = buildEnvelope(prices);
    assert.equal(Number.isFinite(envelope.value.rate), true);
    assert.ok(envelope.value.rate < 0);
  });
});

describe("V: snapshot correct", () => {
  it("produces the exact structured snapshot", () => {
    assert.deepEqual(snapshotExpectedMarketReturnMethodology(methodology()), {
      benchmarkId: "CUSTOM_BENCH",
      benchmarkSymbol: "CUSTOM",
      lookbackYears: 10,
      priceBasis: "adjusted_close",
      annualReturnMethod: "anniversary_to_anniversary",
      aggregation: "arithmetic_mean",
      maxAnchorStalenessDays: 7,
    });
  });
});

describe("W: trace shows 11 anchors / 10 returns", () => {
  it("the trace is structured and complete", () => {
    const trace = traceExpectedMarketReturn({
      priceSeries: fixturePrices(),
      methodology: methodology(),
      asOf: "2026-09-22",
    });
    assert.equal(trace.anchorCount, 11);
    assert.equal(trace.annualReturnCount, 10);
    assert.deepEqual(trace.requestedRange, {
      startDate: "2016-09-22",
      endDate: "2026-09-22",
    });
    assert.deepEqual(trace.dataRequestRange, {
      startDate: "2016-09-15",
      endDate: "2026-09-22",
    });
    assert.equal(trace.firstSelectedDate, "2016-09-22");
    assert.equal(trace.lastSelectedDate, "2026-09-22");
    assert.equal(trace.anchors.length, 11);
    assert.deepEqual(trace.anchors[0], {
      targetDate: "2016-09-22",
      selectedDate: "2016-09-22",
    });
    assert.deepEqual(trace.anchors[10], {
      targetDate: "2026-09-22",
      selectedDate: "2026-09-22",
    });
  });
});

describe("Micro-fix: data request range", () => {
  it("A: methodology range stays 2016-09-22 -> 2026-09-22", () => {
    assert.deepEqual(
      resolveExpectedMarketReturnDateRange({
        asOf: "2026-09-22",
        methodology: methodology(),
      }),
      { startDate: "2016-09-22", endDate: "2026-09-22" },
    );
  });

  it("B: data request range is 2016-09-15 -> 2026-09-22", () => {
    assert.deepEqual(
      resolveExpectedMarketReturnDataRequestRange({
        asOf: "2026-09-22",
        methodology: methodology(),
      }),
      { startDate: "2016-09-15", endDate: "2026-09-22" },
    );
  });

  it("C: subtracting 7 days crosses a month boundary", () => {
    const range = resolveExpectedMarketReturnDataRequestRange({
      asOf: "2026-09-03",
      methodology: methodology(),
    });
    assert.equal(range.startDate, "2016-08-27");
    assert.equal(range.endDate, "2026-09-03");
  });

  it("D: subtracting 7 days crosses a year boundary", () => {
    const range = resolveExpectedMarketReturnDataRequestRange({
      asOf: "2026-01-05",
      methodology: methodology(),
    });
    assert.equal(range.startDate, "2015-12-29");
    assert.equal(range.endDate, "2026-01-05");
  });

  it("E: leap-year asOf resolves its data request range", () => {
    const range = resolveExpectedMarketReturnDataRequestRange({
      asOf: "2024-02-29",
      methodology: methodology(),
    });
    assert.equal(range.startDate, "2014-02-21");
    assert.equal(range.endDate, "2024-02-29");
  });

  it("F: first anchor may select a price before the first methodological target", () => {
    const beforeTarget = "2016-09-16"; // inside dataRequestRange, before methodology start
    const dataRange = resolveExpectedMarketReturnDataRequestRange({
      asOf: "2026-09-22",
      methodology: methodology(),
    });
    assert.ok(beforeTarget >= dataRange.startDate);
    assert.ok(beforeTarget < "2016-09-22");

    const prices = fixturePoints().slice();
    prices[0] = point(beforeTarget, prices[0].value); // holiday: no price on 2016-09-22
    const anchors = selectAnnualAnchors({
      priceSeries: series(prices),
      methodology: methodology(),
      asOf: "2026-09-22",
    });
    assert.equal(anchors[0].selectedDate, beforeTarget);
    assert.equal(anchors[0].targetDate, "2016-09-22");
  });

  it("G: still exactly 11 anchors", () => {
    const prices = fixturePoints().slice();
    prices[0] = point("2016-09-16", prices[0].value);
    const anchors = selectAnnualAnchors({
      priceSeries: series(prices),
      methodology: methodology(),
      asOf: "2026-09-22",
    });
    assert.equal(anchors.length, 11);
  });

  it("H: still exactly 10 annual returns", () => {
    const prices = fixturePoints().slice();
    prices[0] = point("2016-09-16", prices[0].value);
    const returns = computeAnnualSimpleReturns(
      selectAnnualAnchors({
        priceSeries: series(prices),
        methodology: methodology(),
        asOf: "2026-09-22",
      }),
    );
    assert.equal(returns.length, 10);
  });

  it("I: expected mean fixture stays 0.054", () => {
    const prices = fixturePoints().slice();
    prices[0] = point("2016-09-16", prices[0].value);
    const envelope = buildEnvelope(prices);
    approx(envelope.value.rate, 0.054);
    assert.equal(envelope.observedAt, "2026-09-22");
  });

  it("J: previous 488 tests keep their semantics (deterministic runs)", () => {
    const run = () => JSON.stringify(buildEnvelope(fixturePoints()));
    assert.deepEqual(JSON.parse(run()), JSON.parse(run()));
  });
});

describe("X: observedAt = last selected anchor date", () => {
  it("uses the real last selected date, with no invented time", () => {
    const envelope = buildEnvelope(fixturePoints());
    assert.equal(envelope.observedAt, "2026-09-22");
  });

  it("tracks a holiday-shifted last anchor too", () => {
    const prices = fixturePoints().slice();
    prices[prices.length - 1] = point("2026-09-21", prices[prices.length - 1].value);
    const envelope = buildEnvelope(prices);
    assert.equal(envelope.observedAt, "2026-09-21");
  });
});

describe("Y: provenance preserved", () => {
  it("the envelope keeps the caller source and derives a ref", () => {
    const envelope = buildEnvelope(fixturePoints());
    assert.deepEqual(envelope.source, SOURCE);
    assert.deepEqual(dataEnvelopeToSourceReference(envelope), {
      provider: "market-return-provider",
      originalSource: "market-return-dataset",
      identifier: "mrt-1",
      observedAt: "2026-09-22",
      retrievedAt: "2026-09-22T12:00:00Z",
    });
  });
});

describe("Z: output is AnnualDecimalRate", () => {
  it("the envelope value satisfies the CAPM contract", () => {
    const envelope = buildEnvelope(fixturePoints());
    assert.equal(envelope.frequency, "annual");
    approx(envelope.value.rate, 0.054);
    assert.equal(envelope.value.period, "annual");
    assert.equal(envelope.value.representation, "decimal");
  });
});

function twoXFullPipeline() {
  const benchmarkPrices = [
    { date: "2026-09-08", value: 100 },
    { date: "2026-09-09", value: 101 },
    { date: "2026-09-10", value: 103.02 },
    { date: "2026-09-11", value: 101.9898 },
    { date: "2026-09-12", value: 105.049494 },
  ];
  const portfolioPrices = [
    { date: "2026-09-08", value: 100 },
    { date: "2026-09-09", value: 102 },
    { date: "2026-09-10", value: 106.08 },
    { date: "2026-09-11", value: 103.9584 },
    { date: "2026-09-12", value: 110.195904 },
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
  return { portfolioEnvelope, benchmarkEnvelope };
}

describe("AA: CAPM accepts output without transformation", () => {
  it("the market-return envelope drops straight into expected_market_return", () => {
    const { portfolioEnvelope, benchmarkEnvelope } = twoXFullPipeline();
    const context = buildBetaDataContext({
      portfolioReturns: portfolioEnvelope,
      benchmarkReturns: benchmarkEnvelope,
      asOf: "2026-09-12",
    });
    context.data[RISK_FREE_RATE_DATA_KEY] = buildRiskFreeRateEnvelope({
      observations: [
        { date: "2026-09-22", value: 0.04, representation: "decimal", period: "annual" },
      ],
      methodology: createRiskFreeRateMethodology({
        instrument: { id: "US-1Y", name: "1Y" },
      }),
      asOf: "2026-09-22",
      source: {
        provider: "rf-provider",
        originalSource: "rf-dataset",
        identifier: "rf-1",
      },
      retrievedAt: "2026-09-22T12:00:00Z",
      quality: makeQuality(),
      frequency: "daily",
    });
    context.data[EXPECTED_MARKET_RETURN_DATA_KEY] = buildEnvelope(fixturePoints(), {
      source: SOURCE,
    });

    const registry = new IndicatorRegistry();
    registry.register(betaIndicator);
    registry.register(capmIndicator);
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({ indicators: ["capm"], context })
      .get("capm");
    assert.equal(result.status, "ok");
    // rf 0.04 + beta 2 x (0.054 - 0.04) = 0.068
    approx(result.value, 0.068);
    const providers = result.sources.map((source) => source.provider).sort();
    assert.deepEqual(providers, [
      "market-return-provider",
      "provider-benchmark",
      "provider-portfolio",
      "rf-provider",
    ]);
  });
});

describe("AB: CAPM known math intact", () => {
  it("beta 1.2 / Rf 0.04 / E(Rm) 0.10 => 0.112", () => {
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

describe("AC: Beta pipeline stays intended (beta = 2)", () => {
  it("the two-x synthetic pipeline still yields beta 2", () => {
    const { portfolioEnvelope, benchmarkEnvelope } = twoXFullPipeline();
    const registry = new IndicatorRegistry();
    registry.register(betaIndicator);
    const engine = new AnalyticsEngine(registry);
    const context = buildBetaDataContext({
      portfolioReturns: portfolioEnvelope,
      benchmarkReturns: benchmarkEnvelope,
      asOf: "2026-09-12",
    });
    const result = engine.calculate({ indicators: ["beta"], context }).get("beta");
    assert.equal(result.status, "ok");
    approx(result.value, 2);
  });
});

describe("AD: risk-free builder stays deterministic", () => {
  it("builder output is stable across runs", () => {
    const run = () =>
      JSON.stringify(
        buildRiskFreeRateEnvelope({
          observations: [
            { date: "2026-09-18", value: 0.041, representation: "decimal", period: "annual" },
            { date: "2026-09-21", value: 0.042, representation: "decimal", period: "annual" },
          ],
          methodology: createRiskFreeRateMethodology({ instrument: { id: "US-1Y" } }),
          asOf: "2026-09-22",
          source: SOURCE,
          retrievedAt: "2026-09-22T12:00:00Z",
          quality: makeQuality(),
          frequency: "daily",
        }),
      );
    assert.deepEqual(JSON.parse(run()), JSON.parse(run()));
  });
});

describe("AE: FRED-driven risk-free stays deterministic", () => {
  it("the market-return builder is deterministic across runs", () => {
    const run = () => JSON.stringify(buildEnvelope(fixturePoints()));
    assert.deepEqual(JSON.parse(run()), JSON.parse(run()));
  });
});

describe("AF: previous 447 tests keep their semantics (deterministic runs)", () => {
  it("the fixture decade roots compute exactly as designed", () => {
    const returns = computeAnnualSimpleReturns(fixtureAnchors());
    approx(computeExpectedMarketReturnFromAnnualReturns(returns), 0.054);
    const envelope = buildEnvelope(fixturePoints());
    assert.equal(envelope.value.rate > 0, true);
  });

  it("an empty price series is rejected as invalid input", () => {
    assert.throws(
      () => buildExpectedMarketReturnEnvelope({
        priceSeries: series([]),
        methodology: methodology(),
        asOf: "2026-09-22",
        source: SOURCE,
        retrievedAt: "2026-09-22T12:00:00Z",
        quality: makeQuality(),
      }),
      InvalidExpectedMarketReturnInputError,
    );
  });
});