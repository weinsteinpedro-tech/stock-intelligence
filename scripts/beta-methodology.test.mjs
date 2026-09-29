/* Beta V1 methodology tests (no network).                                  */
/*                                                                          */
/* Run via `npm run test:static` (compiles lib/analytics +                 */
/* lib/financial-data to .testbuild, then node --test this file).           */
/*                                                                          */
/* Coverage map (A-N):                                                      */
/*   A  valid 1Y daily adjusted_close methodology                            */
/*   B  benchmark stays generic (caller-provided)                            */
/*   C  no SPY hardcoded anywhere in the analytics methodology               */
/*   D  asOf 2026-09-22 vs 1Y => 2025-09-22 / 2026-09-22                     */
/*   E  leap-year handling is correct                                        */
/*   F  invalid lookback rejected (0 / fractional / negative)                */
/*   G  empty benchmark id / symbol rejected                                 */
/*   H  non-daily frequency rejected (V1)                                    */
/*   I  non-adjusted_close price basis rejected (V1)                         */
/*   J  snapshot preserves benchmark/lookback/frequency/priceBasis           */
/*   K  requested range differs from the actual dataWindow                    */
/*   L  Beta math stays exactly the same (2 x series => beta = 2)            */
/*   M  beta = 2 remains green through the full pipeline                     */
/*   N  previous 330 tests keep their semantics (deterministic repeats)      */
/* ------------------------------------------------------------------------ */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AnalyticsEngine,
  betaIndicator,
  calculateBetaFromReturns,
  createBetaMethodology,
  IndicatorRegistry,
  InvalidBetaDateError,
  InvalidBetaMethodologyError,
  resolveBetaDateRange,
  snapshotBetaMethodology,
  traceBetaExecution,
} from "../.testbuild/analytics/index.js";
import {
  buildBenchmarkReturnSeries,
  buildBetaDataContext,
  buildReturnSeriesEnvelope,
} from "../.testbuild/financial-data/builders/index.js";

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

function methodology(benchmarkValue = { id: "SPY_BENCHMARK", symbol: "SPY" }) {
  return createBetaMethodology({ benchmark: benchmarkValue, lookbackYears: 1 });
}

function throwsError(fn, ErrorClass, namePart) {
  assert.throws(fn, (error) => {
    assert.ok(
      error instanceof ErrorClass,
      `expected ${ErrorClass.name}, got ${error?.constructor?.name}`,
    );
    if (namePart) {
      assert.ok(
        error.message.includes(namePart),
        `expected message to include "${namePart}", got "${error.message}"`,
      );
    }
    return true;
  });
}

const GENERIC_BENCH = { id: "MYBENCH", symbol: "MYBENCH" };

describe("A: valid 1Y daily adjusted_close methodology", () => {
  it("defaults to 1 year lookback, daily frequency, adjusted_close basis", () => {
    const m = methodology(GENERIC_BENCH);
    assert.deepEqual(m.lookback, { unit: "years", value: 1 });
    assert.equal(m.frequency, "daily");
    assert.equal(m.priceBasis, "adjusted_close");
  });
});

describe("B: benchmark stays generic", () => {
  it("accepts any caller-provided benchmark without assuming SPY", () => {
    const m = methodology(GENERIC_BENCH);
    assert.equal(m.benchmark.id, "MYBENCH");
    assert.equal(m.benchmark.symbol, "MYBENCH");
  });
});

describe("C: no SPY hardcoded in the analytics methodology", () => {
  it("beta-methodology.ts and beta.ts contain no S&P / SPY / Nasdaq reference", () => {
    for (const file of [
      "lib/analytics/indicators/beta-methodology.ts",
      "lib/analytics/indicators/beta.ts",
    ]) {
      const source = readRoot(file);
      for (const pattern of [/SPY/i, /S\s*&\s*P/i, /nasdaq/i]) {
        assert.equal(
          pattern.test(source),
          false,
          `${file} must not contain ${pattern}`,
        );
      }
    }
  });
});

describe("D: date range resolver", () => {
  it("asOf 2026-09-22 with a 1Y lookback => 2025-09-22 / 2026-09-22", () => {
    const m = methodology(GENERIC_BENCH);
    assert.deepEqual(
      resolveBetaDateRange({ asOf: "2026-09-22", methodology: m }),
      { startDate: "2025-09-22", endDate: "2026-09-22" },
    );
  });

  it("is calendar-deterministic, no Date.now(), weekend untouched", () => {
    const m = methodology(GENERIC_BENCH);
    const first = resolveBetaDateRange({ asOf: "2026-09-22", methodology: m });
    const second = resolveBetaDateRange({ asOf: "2026-09-22", methodology: m });
    assert.deepEqual(first, second);
  });
});

describe("E: leap years", () => {
  it("2024-02-29 rewinds to 2023-02-28 (2023 is not a leap year)", () => {
    const m = methodology(GENERIC_BENCH);
    assert.deepEqual(
      resolveBetaDateRange({ asOf: "2024-02-29", methodology: m }),
      { startDate: "2023-02-28", endDate: "2024-02-29" },
    );
  });

  it("2024-03-01 rewinds to 2023-03-01", () => {
    const m = methodology(GENERIC_BENCH);
    assert.deepEqual(
      resolveBetaDateRange({ asOf: "2024-03-01", methodology: m }),
      { startDate: "2023-03-01", endDate: "2024-03-01" },
    );
  });
});

describe("F: invalid lookback rejected", () => {
  it("lookbackYears 0 is rejected", () => {
    throwsError(
      () =>
        createBetaMethodology({
          benchmark: GENERIC_BENCH,
          lookbackYears: 0,
        }),
      InvalidBetaMethodologyError,
      "positive integer",
    );
  });

  it("fractional lookback is rejected", () => {
    throwsError(
      () =>
        createBetaMethodology({
          benchmark: GENERIC_BENCH,
          lookbackYears: 1.5,
        }),
      InvalidBetaMethodologyError,
      "positive integer",
    );
  });

  it("negative lookback is rejected", () => {
    throwsError(
      () =>
        createBetaMethodology({
          benchmark: GENERIC_BENCH,
          lookbackYears: -1,
        }),
      InvalidBetaMethodologyError,
      "positive integer",
    );
  });
});

describe("G: empty benchmark rejected", () => {
  it("empty benchmark id is rejected", () => {
    throwsError(
      () => createBetaMethodology({ benchmark: { id: "", symbol: "SPY" } }),
      InvalidBetaMethodologyError,
      "id",
    );
  });

  it("empty benchmark symbol is rejected", () => {
    throwsError(
      () => createBetaMethodology({ benchmark: { id: "SPY_BENCH", symbol: "" } }),
      InvalidBetaMethodologyError,
      "symbol",
    );
  });
});

describe("H: non-daily frequency rejected", () => {
  it("V1 rejects any frequency other than daily", () => {
    throwsError(
      () =>
        createBetaMethodology({
          benchmark: GENERIC_BENCH,
          frequency: "weekly",
        }),
      InvalidBetaMethodologyError,
      "daily",
    );
  });
});

describe("I: non-adjusted_close price basis rejected", () => {
  it("V1 rejects any price basis other than adjusted_close", () => {
    throwsError(
      () =>
        createBetaMethodology({
          benchmark: GENERIC_BENCH,
          priceBasis: "close",
        }),
      InvalidBetaMethodologyError,
      "adjusted_close",
    );
  });
});

describe("J: methodology snapshot", () => {
  it("preserves benchmark/lookback/frequency/priceBasis structurally", () => {
    const m = methodology({ id: "SPY_BENCHMARK", symbol: "SPY", name: "SPY" });
    const snapshot = snapshotBetaMethodology(m);
    assert.deepEqual(snapshot, {
      benchmarkId: "SPY_BENCHMARK",
      benchmarkSymbol: "SPY",
      lookback: { unit: "years", value: 1 },
      frequency: "daily",
      priceBasis: "adjusted_close",
    });
  });

  it("is a structural copy, not a live reference", () => {
    const m = methodology(GENERIC_BENCH);
    const snapshot = snapshotBetaMethodology(m);
    snapshot.lookback.value = 99;
    assert.equal(m.lookback.value, 1);
  });
});

describe("K: requested range vs actual dataWindow", () => {
  it("trace separates methodology intent from the effective sample", () => {
    const m = methodology({ id: "SPY_BENCHMARK", symbol: "SPY", name: "SPY" });
    const trace = traceBetaExecution({
      methodology: m,
      asOf: "2026-09-22",
      calculation: {
        dataWindow: {
          startDate: "2025-09-24",
          endDate: "2026-09-22",
          observations: 250,
        },
      },
    });
    assert.deepEqual(trace.requestedRange, {
      startDate: "2025-09-22",
      endDate: "2026-09-22",
    });
    assert.notEqual(
      trace.requestedRange.startDate,
      trace.actualDataWindow.startDate,
    );
    assert.equal(trace.actualDataWindow.endDate, "2026-09-22");
    assert.equal(trace.actualDataWindow.observations, 250);
    assert.equal(trace.methodologySnapshot.benchmarkSymbol, "SPY");
  });

  it("works without a dataWindow when the indicator never ran", () => {
    const m = methodology(GENERIC_BENCH);
    const trace = traceBetaExecution({
      methodology: m,
      asOf: "2026-09-22",
      calculation: {},
    });
    assert.equal(trace.actualDataWindow, undefined);
    assert.deepEqual(trace.requestedRange, {
      startDate: "2025-09-22",
      endDate: "2026-09-22",
    });
  });
});

describe("L: Beta math stays exactly the same", () => {
  it("2 x benchmark returns => beta = 2, unmodified", () => {
    const portfolioReturns = {
      assetId: "PF",
      points: [
        { date: "2026-09-09", value: 0.02 },
        { date: "2026-09-10", value: 0.04 },
        { date: "2026-09-11", value: -0.02 },
        { date: "2026-09-12", value: 0.06 },
      ],
    };
    const benchmarkReturns = {
      assetId: "BENCH",
      points: [
        { date: "2026-09-09", value: 0.01 },
        { date: "2026-09-10", value: 0.02 },
        { date: "2026-09-11", value: -0.01 },
        { date: "2026-09-12", value: 0.03 },
      ],
    };
    const calc = calculateBetaFromReturns(portfolioReturns, benchmarkReturns);
    assert.equal(calc.status, "ok");
    approx(calc.value, 2);
    assert.equal(calc.observations, 4);
  });
});

describe("M: known beta = 2 stays green through the full pipeline", () => {
  it("builders + engine produce beta = 2 without touching the formula", () => {
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
      quality: {
        freshness: "fresh",
        sourceTier: "licensed",
        completeness: 1,
        warnings: [],
      },
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
      quality: {
        freshness: "fresh",
        sourceTier: "licensed",
        completeness: 1,
        warnings: [],
      },
      benchmark: { id: "BENCH", symbol: "BENCH" },
    });
    const context = buildBetaDataContext({
      portfolioReturns: portfolioEnvelope,
      benchmarkReturns: benchmarkEnvelope,
      asOf: "2026-09-12",
    });
    const registry = new IndicatorRegistry();
    registry.register(betaIndicator);
    const result = new AnalyticsEngine(registry)
      .calculate({ indicators: ["beta"], context })
      .get("beta");
    assert.equal(result.status, "ok");
    approx(result.value, 2);
    assert.equal(result.dataWindow.observations, 4);
  });
});

describe("N: previous 330 tests keep their semantics", () => {
  it("the date range resolver and the beta pipeline remain deterministic", () => {
    const run = () => {
      const m = methodology(GENERIC_BENCH);
      const range = resolveBetaDateRange({ asOf: "2026-09-22", methodology: m });
      const snapshot = snapshotBetaMethodology(m);
      return JSON.stringify({ range, snapshot });
    };
    assert.deepEqual(JSON.parse(run()), JSON.parse(run()));
  });

  it("invalid asOf is rejected deterministically", () => {
    const m = methodology(GENERIC_BENCH);
    for (const asOf of ["2026-09-32", "2026/09/22", "2026-13-01", "2026-02-30", "tomorrow", ""]) {
      throwsError(
        () => resolveBetaDateRange({ asOf, methodology: m }),
        InvalidBetaDateError,
      );
    }
    assert.ok(true);
  });
});

/* ------------------------------------------------------------------------ */

import {
  validateBetaMethodology,
} from "../.testbuild/analytics/index.js";

function rawMethodology(overrides = {}) {
  return {
    benchmark: { id: "BENCH", symbol: "BENCH" },
    lookback: { unit: "years", value: 1 },
    frequency: "daily",
    priceBasis: "adjusted_close",
    ...overrides,
  };
}

describe("Micro-hardening A: resolveBetaDateRange rejects empty benchmark", () => {
  it("a JSON-shaped methodology with an empty benchmark id is rejected", () => {
    throwsError(
      () =>
        resolveBetaDateRange({
          asOf: "2026-09-22",
          methodology: rawMethodology({ benchmark: { id: "", symbol: "BENCH" } }),
        }),
      InvalidBetaMethodologyError,
      "id",
    );
  });

  it("empty benchmark symbol is rejected too", () => {
    throwsError(
      () =>
        resolveBetaDateRange({
          asOf: "2026-09-22",
          methodology: rawMethodology({ benchmark: { id: "BENCH", symbol: "" } }),
        }),
      InvalidBetaMethodologyError,
      "symbol",
    );
  });
});

describe("Micro-hardening B: resolveBetaDateRange rejects weekly frequency", () => {
  it("frequency 'weekly' from plain JS is rejected at the public API", () => {
    throwsError(
      () =>
        resolveBetaDateRange({
          asOf: "2026-09-22",
          methodology: rawMethodology({ frequency: "weekly" }),
        }),
      InvalidBetaMethodologyError,
      "daily",
    );
  });
});

describe("Micro-hardening C: resolveBetaDateRange rejects close price basis", () => {
  it("priceBasis 'close' from plain JS is rejected at the public API", () => {
    throwsError(
      () =>
        resolveBetaDateRange({
          asOf: "2026-09-22",
          methodology: rawMethodology({ priceBasis: "close" }),
        }),
      InvalidBetaMethodologyError,
      "adjusted_close",
    );
  });
});

describe("Micro-hardening D: resolveBetaDateRange rejects invalid lookback", () => {
  it("lookback.unit 'days' is rejected", () => {
    throwsError(
      () =>
        resolveBetaDateRange({
          asOf: "2026-09-22",
          methodology: rawMethodology({ lookback: { unit: "days", value: 1 } }),
        }),
      InvalidBetaMethodologyError,
      "unit",
    );
  });

  it("lookback.value 0 is rejected", () => {
    throwsError(
      () =>
        resolveBetaDateRange({
          asOf: "2026-09-22",
          methodology: rawMethodology({ lookback: { unit: "years", value: 0 } }),
        }),
      InvalidBetaMethodologyError,
      "positive integer",
    );
  });
});

describe("Micro-hardening E: snapshotBetaMethodology rejects invalid methodology", () => {
  it("a raw object with priceBasis 'close' is rejected", () => {
    throwsError(
      () => snapshotBetaMethodology(rawMethodology({ priceBasis: "close" })),
      InvalidBetaMethodologyError,
      "adjusted_close",
    );
  });
});

describe("Micro-hardening F: traceBetaExecution rejects invalid methodology", () => {
  it("a raw object with frequency 'weekly' is rejected", () => {
    throwsError(
      () =>
        traceBetaExecution({
          methodology: rawMethodology({ frequency: "weekly" }),
          asOf: "2026-09-22",
          calculation: {},
        }),
      InvalidBetaMethodologyError,
      "daily",
    );
  });
});

describe("Micro-hardening G: valid raw methodology still resolves identically", () => {
  it("factory-built and raw-valid methodologies produce the same range", () => {
    const raw = rawMethodology({ benchmark: { id: "SPY_BENCHMARK", symbol: "SPY" } });
    const viaFactory = methodology({ id: "SPY_BENCHMARK", symbol: "SPY" });
    assert.deepEqual(
      resolveBetaDateRange({ asOf: "2026-09-22", methodology: raw }),
      resolveBetaDateRange({ asOf: "2026-09-22", methodology: viaFactory }),
    );
    assert.equal(validateBetaMethodology(raw), undefined);
  });
});

describe("Micro-hardening H: Beta = 2 stays intact", () => {
  it("the full pipeline beta = 2 is unchanged by validation wiring", () => {
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
      quality: {
        freshness: "fresh",
        sourceTier: "licensed",
        completeness: 1,
        warnings: [],
      },
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
      quality: {
        freshness: "fresh",
        sourceTier: "licensed",
        completeness: 1,
        warnings: [],
      },
      benchmark: { id: "BENCH", symbol: "BENCH" },
    });
    const context = buildBetaDataContext({
      portfolioReturns: portfolioEnvelope,
      benchmarkReturns: benchmarkEnvelope,
      asOf: "2026-09-12",
    });
    const registry = new IndicatorRegistry();
    registry.register(betaIndicator);
    const result = new AnalyticsEngine(registry)
      .calculate({ indicators: ["beta"], context })
      .get("beta");
    assert.equal(result.status, "ok");
    approx(result.value, 2);
    assert.equal(result.dataWindow.observations, 4);
  });
});

describe("Micro-hardening I: previous 352 tests keep their semantics", () => {
  it("validation is repeatable and deterministic on the same input", () => {
    const run = () => {
      const m = methodology(GENERIC_BENCH);
      const range = resolveBetaDateRange({ asOf: "2026-09-22", methodology: m });
      const snapshot = snapshotBetaMethodology(m);
      const raw = rawMethodology();
      const rawRange = resolveBetaDateRange({ asOf: "2026-09-22", methodology: raw });
      return JSON.stringify({ range, snapshot, rawRange });
    };
    assert.deepEqual(JSON.parse(run()), JSON.parse(run()));
  });
});