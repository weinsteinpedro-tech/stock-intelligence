/* Risk Decomposition Envelope Builder V1 tests (no network).                  */
/*                                                                            */
/* Run via `npm run test:static` (compiles to .testbuild, then node --test).   */
/*                                                                            */
/* Coverage map:                                                              */
/*   A  builder returns DataEnvelope<PortfolioRiskDecomposition>              */
/*   B  value equals direct pure-engine result                                */
/*   C  portfolio + benchmark + beta provenance union                         */
/*   D  duplicate provenance removed (portfolio/benchmark/beta)              */
/*   E  observedAt = last aligned date (not portfolio or benchmark envelope) */
/*   F  frequency = annual                                                    */
/*   G  both input frequencies must be daily                                  */
/*   H  beta negative works                                                   */
/*   I  beta zero works                                                       */
/*   J  malformed series propagates deterministic error                       */
/*   K  insufficient aligned dates deterministic                              */
/*   L  zero benchmark variance behavior unchanged                            */
/*   M  quality combined conservatively using existing helper                 */
/*   N  retrievedAt policy deterministic (latest of series inputs, not beta)  */
/*   O  no provider/network/UI imports                                        */
/*   P  existing pure decomposition fixture unchanged                         */
/*   Q  Beta/CAPM/Sharpe/Treynor fixtures unchanged                           */
/*   R  deterministic reruns                                                  */
/*   Micro-hardening:                                                         */
/*     - builder contract no longer exposes/uses asOf                         */
/*     - missing betaSources rejected                                         */
/*     - empty betaSources rejected                                           */
/*     - non-array betaSources rejected                                       */
/*     - valid betaSources accepted                                           */
/*     - betaSources deduplication with portfolio/benchmark                   */
/* -------------------------------------------------------------------------- */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildRiskDecompositionEnvelope,
  traceRiskDecomposition,
  InvalidRiskDecompositionBuilderInputError,
  UnsupportedFrequencyError,
} from "../.testbuild/financial-data/builders/index.js";
import {
  calculatePortfolioRiskDecomposition,
  InvalidRiskDecompositionInputError,
} from "../.testbuild/analytics/portfolio/index.js";
import {
  calculateCapmExpectedReturn,
  calculateSharpeRatio,
  calculateTreynorRatio,
} from "../.testbuild/analytics/index.js";
import {
  makeDataQuality,
  worstQuality,
} from "../.testbuild/financial-data/quality.js";

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

function series(assetId, points) {
  return { assetId, points };
}

function makeQuality(overrides = {}) {
  return makeDataQuality({
    freshness: "fresh",
    sourceTier: "primary",
    completeness: 1.0,
    warnings: [],
    ...overrides,
  });
}

const DATES = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
const BENCHMARK_X = [-2, -1, 0, 1, 2];
const BETA = 2;
const PORTFOLIO_P = [-4.5, -1.5, 2.5, 2.5, 3.5];

function dailyEnvelope(returnSeries, overrides = {}) {
  return {
    value: returnSeries,
    source: {
      provider: "provider-test",
      originalSource: "dataset-test",
      identifier: returnSeries.assetId,
    },
    observedAt: returnSeries.points[returnSeries.points.length - 1]?.date ?? "2026-09-05",
    retrievedAt: "2026-09-20T10:00:00.000Z",
    frequency: "daily",
    quality: makeQuality(),
    ...overrides,
  };
}

function fixturePortEnvelope(overrides = {}) {
  return dailyEnvelope(
    series(
      "portfolio",
      DATES.map((date, i) => ({ date, value: PORTFOLIO_P[i] })),
    ),
    {
      source: {
        provider: "port-provider",
        originalSource: "port-dataset",
        identifier: "port-id",
      },
      observedAt: "2026-09-10",
      retrievedAt: "2026-09-20T10:00:00.000Z",
      ...overrides,
    },
  );
}

function fixtureBenchEnvelope(overrides = {}) {
  return dailyEnvelope(
    series(
      "benchmark",
      DATES.map((date, i) => ({ date, value: BENCHMARK_X[i] })),
    ),
    {
      source: {
        provider: "bench-provider",
        originalSource: "bench-dataset",
        identifier: "bench-id",
      },
      observedAt: "2026-09-08",
      retrievedAt: "2026-09-21T12:00:00.000Z",
      ...overrides,
    },
  );
}

const BETA_SOURCES = [
  {
    provider: "beta-calc",
    originalSource: "regression",
    identifier: "beta-1",
    retrievedAt: "2026-09-25T18:00:00.000Z",
  },
];

describe("A: builder returns DataEnvelope<PortfolioRiskDecomposition>", () => {
  it("produces a valid DataEnvelope with all expected fields", () => {
    const envelope = buildRiskDecompositionEnvelope({
      portfolioReturns: fixturePortEnvelope(),
      benchmarkReturns: fixtureBenchEnvelope(),
      beta: BETA,
      betaSources: BETA_SOURCES,
    });

    assert.equal(typeof envelope, "object");
    assert.equal(envelope !== null, true);
    assert.equal(envelope.frequency, "annual");
    assert.equal(envelope.observedAt, "2026-09-05");
    assert.equal(envelope.retrievedAt, "2026-09-21T12:00:00.000Z");
    assert.equal(typeof envelope.quality, "object");
    assert.equal(Array.isArray(envelope.sources), true);

    const val = envelope.value;
    assert.equal(val.beta, BETA);
    assert.equal(val.observationCount, 5);
    assert.deepEqual(val.dates, DATES);
    assert.equal(typeof val.daily, "object");
    assert.equal(typeof val.annual, "object");
    approx(val.daily.portfolioVariance, 11.5);
    approx(val.daily.marketVariance, 2.5);
  });

  it("traceRiskDecomposition returns window bounds from envelope or value", () => {
    const envelope = buildRiskDecompositionEnvelope({
      portfolioReturns: fixturePortEnvelope(),
      benchmarkReturns: fixtureBenchEnvelope(),
      beta: BETA,
      betaSources: BETA_SOURCES,
    });
    const traceFromEnvelope = traceRiskDecomposition(envelope);
    const traceFromValue = traceRiskDecomposition(envelope.value);

    assert.deepEqual(traceFromEnvelope, {
      alignedObservationCount: 5,
      firstAlignedDate: "2026-09-01",
      lastAlignedDate: "2026-09-05",
    });
    assert.deepEqual(traceFromValue, traceFromEnvelope);
  });

  it("rejects missing/invalid inputs", () => {
    assert.throws(
      () => buildRiskDecompositionEnvelope(null),
      InvalidRiskDecompositionBuilderInputError,
    );
    assert.throws(
      () =>
        buildRiskDecompositionEnvelope({
          portfolioReturns: null,
          benchmarkReturns: fixtureBenchEnvelope(),
          beta: BETA,
          betaSources: BETA_SOURCES,
        }),
      InvalidRiskDecompositionBuilderInputError,
    );
    assert.throws(
      () =>
        buildRiskDecompositionEnvelope({
          portfolioReturns: fixturePortEnvelope(),
          benchmarkReturns: null,
          beta: BETA,
          betaSources: BETA_SOURCES,
        }),
      InvalidRiskDecompositionBuilderInputError,
    );
  });

  it("rejects missing provenance on return envelopes", () => {
    const noSourcePort = dailyEnvelope(
      series("port", DATES.map((date, i) => ({ date, value: PORTFOLIO_P[i] }))),
      { source: undefined, sources: [] },
    );
    assert.throws(
      () =>
        buildRiskDecompositionEnvelope({
          portfolioReturns: noSourcePort,
          benchmarkReturns: fixtureBenchEnvelope(),
          beta: BETA,
          betaSources: BETA_SOURCES,
        }),
      InvalidRiskDecompositionBuilderInputError,
    );

    const noSourceBench = dailyEnvelope(
      series("bench", DATES.map((date, i) => ({ date, value: BENCHMARK_X[i] }))),
      { source: undefined, sources: [] },
    );
    assert.throws(
      () =>
        buildRiskDecompositionEnvelope({
          portfolioReturns: fixturePortEnvelope(),
          benchmarkReturns: noSourceBench,
          beta: BETA,
          betaSources: BETA_SOURCES,
        }),
      InvalidRiskDecompositionBuilderInputError,
    );
  });

  it("rejects invalid beta", () => {
    assert.throws(
      () =>
        buildRiskDecompositionEnvelope({
          portfolioReturns: fixturePortEnvelope(),
          benchmarkReturns: fixtureBenchEnvelope(),
          beta: NaN,
          betaSources: BETA_SOURCES,
        }),
      InvalidRiskDecompositionInputError,
    );
    assert.throws(
      () =>
        buildRiskDecompositionEnvelope({
          portfolioReturns: fixturePortEnvelope(),
          benchmarkReturns: fixtureBenchEnvelope(),
          beta: Infinity,
          betaSources: BETA_SOURCES,
        }),
      InvalidRiskDecompositionInputError,
    );
  });
});

describe("B: value equals direct pure-engine result", () => {
  it("decomposition matches direct calculatePortfolioRiskDecomposition call", () => {
    const portEnv = fixturePortEnvelope();
    const benchEnv = fixtureBenchEnvelope();

    const direct = calculatePortfolioRiskDecomposition({
      portfolioReturns: portEnv.value,
      benchmarkReturns: benchEnv.value,
      beta: BETA,
    });

    const envelope = buildRiskDecompositionEnvelope({
      portfolioReturns: portEnv,
      benchmarkReturns: benchEnv,
      beta: BETA,
      betaSources: BETA_SOURCES,
    });

    assert.deepEqual(envelope.value, direct);
  });
});

describe("C: portfolio + benchmark + beta provenance union", () => {
  it("unions provenance from portfolio, benchmark and betaSources", () => {
    const portEnv = fixturePortEnvelope();
    const benchEnv = fixtureBenchEnvelope();
    const envelope = buildRiskDecompositionEnvelope({
      portfolioReturns: portEnv,
      benchmarkReturns: benchEnv,
      beta: BETA,
      betaSources: BETA_SOURCES,
    });

    assert.equal(envelope.sources.length, 3);
    assert.deepEqual(envelope.sources[0], {
      provider: "port-provider",
      originalSource: "port-dataset",
      identifier: "port-id",
      observedAt: "2026-09-10",
      retrievedAt: "2026-09-20T10:00:00.000Z",
    });
    assert.deepEqual(envelope.sources[1], {
      provider: "bench-provider",
      originalSource: "bench-dataset",
      identifier: "bench-id",
      observedAt: "2026-09-08",
      retrievedAt: "2026-09-21T12:00:00.000Z",
    });
    assert.deepEqual(envelope.sources[2], BETA_SOURCES[0]);
  });
});

describe("D: duplicate provenance removed", () => {
  it("deduplicates identical source references", () => {
    const sharedSource = {
      provider: "shared-provider",
      originalSource: "shared-dataset",
      identifier: "shared-id",
    };
    const portEnv = fixturePortEnvelope({
      source: sharedSource,
      observedAt: "2026-09-05",
      retrievedAt: "2026-09-20T10:00:00.000Z",
    });
    const benchEnv = fixtureBenchEnvelope({
      source: sharedSource,
      observedAt: "2026-09-05",
      retrievedAt: "2026-09-20T10:00:00.000Z",
    });

    const envelope = buildRiskDecompositionEnvelope({
      portfolioReturns: portEnv,
      benchmarkReturns: benchEnv,
      beta: BETA,
      betaSources: BETA_SOURCES,
    });

    // 1 deduplicated source from port/bench + 1 from beta
    assert.equal(envelope.sources.length, 2);
  });
});

describe("E: observedAt = last aligned date", () => {
  it("uses the last date of the aligned sample, not portfolio or benchmark envelope", () => {
    const extraPort = { date: "2026-09-09", value: 0.1 };
    const extraBench = { date: "2026-09-10", value: 0.1 };

    const portEnv = dailyEnvelope(
      series("port", [
        ...DATES.map((date, i) => ({ date, value: PORTFOLIO_P[i] })),
        extraPort,
      ]),
      { observedAt: "2026-09-25" },
    );
    const benchEnv = dailyEnvelope(
      series("bench", [
        ...DATES.map((date, i) => ({ date, value: BENCHMARK_X[i] })),
        extraBench,
      ]),
      { observedAt: "2026-09-24" },
    );

    const envelope = buildRiskDecompositionEnvelope({
      portfolioReturns: portEnv,
      benchmarkReturns: benchEnv,
      beta: BETA,
      betaSources: BETA_SOURCES,
    });

    // Aligned intersection is strictly DATES, ending on 2026-09-05
    assert.equal(envelope.observedAt, "2026-09-05");
    assert.notEqual(envelope.observedAt, portEnv.observedAt);
    assert.notEqual(envelope.observedAt, benchEnv.observedAt);
  });
});

describe("F: frequency = annual", () => {
  it("envelope frequency is annual, preserving daily and annual within value", () => {
    const envelope = buildRiskDecompositionEnvelope({
      portfolioReturns: fixturePortEnvelope(),
      benchmarkReturns: fixtureBenchEnvelope(),
      beta: BETA,
      betaSources: BETA_SOURCES,
    });
    assert.equal(envelope.frequency, "annual");
    assert.ok(envelope.value.daily);
    assert.ok(envelope.value.annual);
  });
});

describe("G: both input frequencies must be daily", () => {
  it("rejects weekly portfolio frequency with UnsupportedFrequencyError", () => {
    assert.throws(
      () =>
        buildRiskDecompositionEnvelope({
          portfolioReturns: fixturePortEnvelope({ frequency: "weekly" }),
          benchmarkReturns: fixtureBenchEnvelope(),
          beta: BETA,
          betaSources: BETA_SOURCES,
        }),
      UnsupportedFrequencyError,
    );
  });

  it("rejects monthly benchmark frequency with UnsupportedFrequencyError", () => {
    assert.throws(
      () =>
        buildRiskDecompositionEnvelope({
          portfolioReturns: fixturePortEnvelope(),
          benchmarkReturns: fixtureBenchEnvelope({ frequency: "monthly" }),
          beta: BETA,
          betaSources: BETA_SOURCES,
        }),
      UnsupportedFrequencyError,
    );
  });
});

describe("H: beta negative works", () => {
  it("computes systematic variance with beta^2 and volatility with |beta|", () => {
    const envelope = buildRiskDecompositionEnvelope({
      portfolioReturns: fixturePortEnvelope(),
      benchmarkReturns: fixtureBenchEnvelope(),
      beta: -1.5,
      betaSources: BETA_SOURCES,
    });
    assert.equal(envelope.value.beta, -1.5);
    approx(envelope.value.daily.systematicVariance, 2.25 * 2.5);
    approx(
      envelope.value.annual.systematicVolatility,
      1.5 * Math.sqrt(2.5 * 252),
    );
    assert.ok(envelope.value.annual.systematicVolatility > 0);
  });
});

describe("I: beta zero works", () => {
  it("produces systematic risk of 0 and idiosyncratic risk equals portfolio risk", () => {
    const envelope = buildRiskDecompositionEnvelope({
      portfolioReturns: fixturePortEnvelope(),
      benchmarkReturns: fixtureBenchEnvelope(),
      beta: 0,
      betaSources: BETA_SOURCES,
    });
    assert.equal(envelope.value.beta, 0);
    approx(envelope.value.daily.systematicVariance, 0);
    approx(envelope.value.annual.systematicVolatility, 0);
    approx(
      envelope.value.daily.idiosyncraticVariance,
      envelope.value.daily.portfolioVariance,
    );
  });
});

describe("J: malformed series propagates deterministic error", () => {
  it("rejects non-finite return values in portfolio series", () => {
    const badPort = dailyEnvelope(
      series("port", [
        { date: "2026-09-01", value: NaN },
        { date: "2026-09-02", value: 0.01 },
      ]),
    );
    assert.throws(
      () =>
        buildRiskDecompositionEnvelope({
          portfolioReturns: badPort,
          benchmarkReturns: fixtureBenchEnvelope(),
          beta: BETA,
          betaSources: BETA_SOURCES,
        }),
      Error,
    );
  });

  it("rejects malformed dates in benchmark series", () => {
    const badBench = dailyEnvelope(
      series("bench", [
        { date: "2026-02-30", value: 0.01 },
        { date: "2026-09-02", value: 0.01 },
      ]),
    );
    assert.throws(
      () =>
        buildRiskDecompositionEnvelope({
          portfolioReturns: fixturePortEnvelope(),
          benchmarkReturns: badBench,
          beta: BETA,
          betaSources: BETA_SOURCES,
        }),
      Error,
    );
  });
});

describe("K: insufficient aligned dates deterministic", () => {
  it("rejects series with fewer than 2 aligned observations", () => {
    const singlePort = dailyEnvelope(
      series("port", [{ date: "2026-09-01", value: 0.01 }]),
    );
    const singleBench = dailyEnvelope(
      series("bench", [{ date: "2026-09-01", value: 0.02 }]),
    );
    assert.throws(
      () =>
        buildRiskDecompositionEnvelope({
          portfolioReturns: singlePort,
          benchmarkReturns: singleBench,
          beta: BETA,
          betaSources: BETA_SOURCES,
        }),
      InvalidRiskDecompositionInputError,
    );
  });

  it("rejects series with zero aligned observations", () => {
    const disjointPort = dailyEnvelope(
      series("port", [
        { date: "2026-09-01", value: 0.01 },
        { date: "2026-09-02", value: 0.02 },
      ]),
    );
    const disjointBench = dailyEnvelope(
      series("bench", [
        { date: "2026-10-01", value: 0.01 },
        { date: "2026-10-02", value: 0.02 },
      ]),
    );
    assert.throws(
      () =>
        buildRiskDecompositionEnvelope({
          portfolioReturns: disjointPort,
          benchmarkReturns: disjointBench,
          beta: BETA,
          betaSources: BETA_SOURCES,
        }),
      InvalidRiskDecompositionInputError,
    );
  });
});

describe("L: zero benchmark variance behavior unchanged", () => {
  it("rejects constant benchmark series with exact zero variance", () => {
    const constantBench = dailyEnvelope(
      series("bench", [
        { date: "2026-09-01", value: 0.125 },
        { date: "2026-09-02", value: 0.125 },
        { date: "2026-09-03", value: 0.125 },
      ]),
    );
    const portEnv = dailyEnvelope(
      series("port", [
        { date: "2026-09-01", value: 0.01 },
        { date: "2026-09-02", value: 0.02 },
        { date: "2026-09-03", value: 0.03 },
      ]),
    );
    assert.throws(
      () =>
        buildRiskDecompositionEnvelope({
          portfolioReturns: portEnv,
          benchmarkReturns: constantBench,
          beta: 1,
          betaSources: BETA_SOURCES,
        }),
      InvalidRiskDecompositionInputError,
    );
  });
});

describe("M: quality combined conservatively using existing helper", () => {
  it("merges qualities with worstQuality: worst freshness, worst tier, min completeness", () => {
    const portQuality = makeQuality({
      freshness: "fresh",
      sourceTier: "licensed",
      completeness: 0.95,
      warnings: ["port-warning"],
    });
    const benchQuality = makeQuality({
      freshness: "delayed",
      sourceTier: "primary",
      completeness: 0.85,
      warnings: ["bench-warning"],
    });

    const envelope = buildRiskDecompositionEnvelope({
      portfolioReturns: fixturePortEnvelope({ quality: portQuality }),
      benchmarkReturns: fixtureBenchEnvelope({ quality: benchQuality }),
      beta: BETA,
      betaSources: BETA_SOURCES,
    });

    const expected = worstQuality([portQuality, benchQuality]);
    assert.deepEqual(envelope.quality, expected);
    assert.equal(envelope.quality.freshness, "delayed");
    assert.equal(envelope.quality.sourceTier, "licensed");
    assert.equal(envelope.quality.completeness, 0.85);
    assert.deepEqual(envelope.quality.warnings, ["port-warning", "bench-warning"]);
  });
});

describe("N: retrievedAt policy deterministic", () => {
  it("uses latest actual timestamp between portfolio and benchmark, ignoring beta", () => {
    const portEnv = fixturePortEnvelope({
      retrievedAt: "2026-09-20T10:00:00.000Z",
    });
    const benchEnv = fixtureBenchEnvelope({
      retrievedAt: "2026-09-22T08:00:00.000Z",
    });
    const betaProvenance = [
      {
        provider: "beta",
        originalSource: "beta",
        retrievedAt: "2026-09-29T23:59:59.000Z",
      },
    ];

    const envelope = buildRiskDecompositionEnvelope({
      portfolioReturns: portEnv,
      benchmarkReturns: benchEnv,
      beta: BETA,
      betaSources: betaProvenance,
    });

    assert.equal(envelope.retrievedAt, "2026-09-22T08:00:00.000Z");
    assert.notEqual(envelope.retrievedAt, betaProvenance[0].retrievedAt);
  });
});

describe("O: no provider/network/UI imports", () => {
  const FORBIDDEN = [
    /market-data/,
    /alpha[_s-]?vantage/,
    /gemini/,
    /supabase/,
    /node-fetch/,
    /tavily/,
    new RegExp('https?:' + '//'),
    new RegExp('\\bfetch\\s*\\('),
    /react/,
    /next/,
  ];

  FORBIDDEN.forEach((rx, i) => {
    it(`forbidden pattern #${i} (${rx})`, () => {
      const src = readRoot("lib/financial-data/builders/risk-decomposition.ts");
      assert.equal(rx.test(src), false, `forbidden pattern ${rx} found in source`);
    });
  });

  it("is exported from lib/financial-data/builders/index.ts", () => {
    const index = readRoot("lib/financial-data/builders/index.ts");
    assert.match(index, /buildRiskDecompositionEnvelope/);
    assert.match(index, /traceRiskDecomposition/);
  });
});

describe("P: existing pure decomposition fixture unchanged", () => {
  it("reproduces known synthetic fixture variances exactly", () => {
    const envelope = buildRiskDecompositionEnvelope({
      portfolioReturns: fixturePortEnvelope(),
      benchmarkReturns: fixtureBenchEnvelope(),
      beta: BETA,
      betaSources: BETA_SOURCES,
    });
    approx(envelope.value.daily.portfolioVariance, 11.5);
    approx(envelope.value.daily.marketVariance, 2.5);
    approx(envelope.value.daily.systematicVariance, 10.0);
    approx(envelope.value.daily.idiosyncraticVariance, 1.5);
    approx(envelope.value.alphaDaily, 0.5);
  });
});

describe("Q: Beta / CAPM / Sharpe / Treynor fixtures unchanged", () => {
  it("CAPM known fixture stays 0.112", () => {
    approx(
      calculateCapmExpectedReturn({
        riskFreeRate: 0.04,
        beta: 0.8,
        expectedMarketReturn: 0.13,
      }),
      0.112,
    );
  });
  it("Sharpe known fixture stays 0.4", () => {
    approx(
      calculateSharpeRatio({
        portfolioReturn: 0.1,
        riskFreeRate: 0.04,
        portfolioVolatility: 0.15,
      }),
      0.4,
    );
  });
  it("Treynor known fixture stays 0.10", () => {
    approx(
      calculateTreynorRatio({
        portfolioReturn: 0.12,
        riskFreeRate: 0.04,
        beta: 0.8,
      }),
      0.1,
    );
  });
});

describe("R: all previous test semantics remain green (deterministic reruns)", () => {
  it("builder produces identical output across 5 deterministic reruns", () => {
    const run = () =>
      buildRiskDecompositionEnvelope({
        portfolioReturns: fixturePortEnvelope(),
        benchmarkReturns: fixtureBenchEnvelope(),
        beta: BETA,
        betaSources: BETA_SOURCES,
      });

    const first = run();
    for (let i = 0; i < 4; i += 1) {
      assert.deepEqual(run(), first);
    }
  });
});

describe("Micro-hardening: asOf removed and betaSources required", () => {
  it("A: builder contract does not contain asOf in interface or builder logic", () => {
    const src = readRoot("lib/financial-data/builders/risk-decomposition.ts");
    assert.equal(/asOf/.test(src), false, "asOf should be completely removed");
  });

  it("B: missing betaSources is rejected deterministically", () => {
    assert.throws(
      () =>
        buildRiskDecompositionEnvelope({
          portfolioReturns: fixturePortEnvelope(),
          benchmarkReturns: fixtureBenchEnvelope(),
          beta: BETA,
        }),
      InvalidRiskDecompositionBuilderInputError,
    );
    assert.throws(
      () =>
        buildRiskDecompositionEnvelope({
          portfolioReturns: fixturePortEnvelope(),
          benchmarkReturns: fixtureBenchEnvelope(),
          beta: BETA,
          betaSources: undefined,
        }),
      InvalidRiskDecompositionBuilderInputError,
    );
  });

  it("C: empty betaSources is rejected deterministically", () => {
    assert.throws(
      () =>
        buildRiskDecompositionEnvelope({
          portfolioReturns: fixturePortEnvelope(),
          benchmarkReturns: fixtureBenchEnvelope(),
          beta: BETA,
          betaSources: [],
        }),
      InvalidRiskDecompositionBuilderInputError,
    );
  });

  it("D: non-array betaSources is rejected deterministically", () => {
    for (const invalid of [null, "invalid", 123, {}]) {
      assert.throws(
        () =>
          buildRiskDecompositionEnvelope({
            portfolioReturns: fixturePortEnvelope(),
            benchmarkReturns: fixtureBenchEnvelope(),
            beta: BETA,
            betaSources: invalid,
          }),
        InvalidRiskDecompositionBuilderInputError,
      );
    }
  });

  it("E: valid betaSources is accepted and populated in envelope sources", () => {
    const customBetaSources = [
      {
        provider: "custom-beta-provider",
        originalSource: "ols-regression",
        identifier: "beta-ols-1y",
        observedAt: "2026-09-05",
        retrievedAt: "2026-09-20T11:00:00.000Z",
      },
    ];

    const envelope = buildRiskDecompositionEnvelope({
      portfolioReturns: fixturePortEnvelope(),
      benchmarkReturns: fixtureBenchEnvelope(),
      beta: BETA,
      betaSources: customBetaSources,
    });

    assert.ok(envelope.sources.some((s) => s.identifier === "beta-ols-1y"));
  });

  it("F: betaSources that duplicate portfolio/benchmark provenance dedupe correctly", () => {
    const duplicateBetaSources = [
      {
        provider: "port-provider",
        originalSource: "port-dataset",
        identifier: "port-id",
        observedAt: "2026-09-10",
        retrievedAt: "2026-09-20T10:00:00.000Z",
      },
    ];

    const envelope = buildRiskDecompositionEnvelope({
      portfolioReturns: fixturePortEnvelope(),
      benchmarkReturns: fixtureBenchEnvelope(),
      beta: BETA,
      betaSources: duplicateBetaSources,
    });

    // port source was duplicated in betaSources, so total deduped sources should be 2 (port + bench)
    assert.equal(envelope.sources.length, 2);
  });
});
