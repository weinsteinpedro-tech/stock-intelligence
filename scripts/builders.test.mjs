/* Data-layer builders tests (no network).                                */
/*                                                                          */
/* Run via `npm run test:static` (compiles lib/analytics +                 */
/* lib/financial-data to .testbuild, then node --test this file).           */
/*                                                                          */
/* Coverage map (A-R):                                                      */
/*   A  close basis works                                                   */
/*   B  adjusted_close missing => explicit error                            */
/*   C  no silent fallback adjusted => close                                */
/*   D  return builder uses calculateSimpleReturns                          */
/*   E  return envelope preserves provider/originalSource                   */
/*   F  observedAt equals the last ReturnSeries date                        */
/*   G  benchmark stays generic                                             */
/*   H  benchmark symbol/id not hardcoded                                   */
/*   I  portfolio builder combines returns correctly                        */
/*   J  portfolio builder never improves freshness                          */
/*   K  upstream warnings are preserved                                     */
/*   L  completeness propagates conservatively                              */
/*   M  beta context uses exactly portfolio_returns + benchmark_returns     */
/*   N  frequency mismatch is rejected                                      */
/*   O  builders make no network calls                                      */
/*   P  lib/analytics still never imports market-data/builders              */
/*   Q  existing beta still gives beta = 2 through the full pipeline        */
/*   R  previous 263 tests keep their semantics (deterministic repeats)     */
/* ------------------------------------------------------------------------ */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AnalyticsEngine,
  BENCHMARK_RETURNS_DATA_KEY,
  betaIndicator,
  IndicatorRegistry,
  MissingAssetReturnSeriesError,
  PORTFOLIO_RETURNS_DATA_KEY,
} from "../.testbuild/analytics/index.js";
import {
  buildBenchmarkReturnSeries,
  buildBetaDataContext,
  buildPortfolioReturnSeries,
  buildReturnSeriesEnvelope,
  UnsupportedFrequencyError,
} from "../.testbuild/financial-data/builders/index.js";
import {
  historicalPricesToPriceSeries,
  InvalidMarketCloseError,
} from "../.testbuild/financial-data/adapters/market-prices.js";
import { makeDataQuality } from "../.testbuild/financial-data/quality.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRoot(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function listTs(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) listTs(path, acc);
    else if (entry.endsWith(".ts")) acc.push(path);
  }
  return acc;
}

function approx(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} ≈ ${expected} (epsilon ${epsilon})`,
  );
}

function priceSeries(assetId, points) {
  return { assetId, points };
}

function makeQuality(qualityInput = {}) {
  return makeDataQuality({
    freshness: qualityInput.freshness ?? "fresh",
    sourceTier: qualityInput.sourceTier ?? "licensed",
    completeness: qualityInput.completeness ?? 1,
    warnings: qualityInput.warnings ?? [],
  });
}

function seriesInput(priceSeriesValue, overrides = {}) {
  return {
    priceSeries: priceSeriesValue,
    source: {
      provider: "test-provider",
      originalSource: "test-original",
      identifier: "series-1",
    },
    frequency: "daily",
    retrievedAt: "2026-09-12T12:00:00Z",
    quality: makeQuality(),
    ...overrides,
  };
}

function rawEnvelope(value, overrides = {}) {
  return {
    value,
    source: {
      provider: "test-provider",
      originalSource: "test-original",
      identifier: "series-1",
    },
    observedAt: "2026-09-12T00:00:00Z",
    retrievedAt: "2026-09-12T12:00:00Z",
    frequency: "daily",
    quality: makeQuality(),
    ...overrides,
  };
}

function singleAssetPortfolio(assetId, weight = 1) {
  return {
    id: "PF",
    positions: [{ assetId, weight }],
  };
}

function dailyA() {
  return buildReturnSeriesEnvelope(
    seriesInput(
      priceSeries("A", [
        { date: "2026-09-08", value: 100 },
        { date: "2026-09-09", value: 102 },
      ]),
    ),
  );
}

describe("A: close basis works", () => {
  it("priceBasis close matches the default behavior", () => {
    const historical = [
      { date: "2026-09-08", open: 1, high: 1, low: 1, close: 100, volume: 1 },
      { date: "2026-09-09", open: 1, high: 1, low: 1, close: 105, volume: 1 },
    ];
    const explicit = historicalPricesToPriceSeries(historical, "AAPL", {
      priceBasis: "close",
    });
    const defaulted = historicalPricesToPriceSeries(historical, "AAPL");
    assert.deepEqual(explicit, defaulted);
    assert.deepEqual(explicit.points.map((point) => point.value), [100, 105]);
  });
});

describe("B: adjusted_close missing => explicit error", () => {
  it("throws when the provider data has no adjustedClose field", () => {
    const historical = [
      { date: "2026-09-08", open: 1, high: 1, low: 1, close: 100, volume: 1 },
    ];
    assert.throws(
      () =>
        historicalPricesToPriceSeries(historical, "AAPL", {
          priceBasis: "adjusted_close",
        }),
      InvalidMarketCloseError,
    );
  });
});

describe("C: no silent fallback adjusted => close", () => {
  it("never converts with close when adjusted_close is requested", () => {
    const historical = [
      { date: "2026-09-08", open: 1, high: 1, low: 1, close: 100, volume: 1 },
      { date: "2026-09-09", open: 1, high: 1, low: 1, close: 105, volume: 1 },
    ];
    let message = "";
    try {
      historicalPricesToPriceSeries(historical, "AAPL", {
        priceBasis: "adjusted_close",
      });
    } catch (error) {
      message = error.message;
    }
    assert.match(message, /adjusted_close/);
    assert.match(message, /No fallback to close/);
  });
});

describe("D: return builder uses calculateSimpleReturns", () => {
  it("computes R_t = P_t / P_(t-1) - 1 with ending dates", () => {
    const envelope = buildReturnSeriesEnvelope(
      seriesInput(
        priceSeries("A", [
          { date: "2026-09-08", value: 100 },
          { date: "2026-09-09", value: 105 },
          { date: "2026-09-10", value: 110 },
        ]),
      ),
    );
    assert.equal(envelope.value.assetId, "A");
    assert.deepEqual(
      envelope.value.points.map((point) => point.date),
      ["2026-09-09", "2026-09-10"],
    );
    approx(envelope.value.points[0].value, 0.05);
    approx(envelope.value.points[1].value, 110 / 105 - 1);
  });
});

describe("E: return envelope preserves provider/originalSource", () => {
  it("carries the input source untouched", () => {
    const source = {
      provider: "provider-xyz",
      originalSource: "dataset-xyz",
      identifier: "id-xyz",
    };
    const envelope = buildReturnSeriesEnvelope(
      seriesInput(
        priceSeries("A", [
          { date: "2026-09-08", value: 100 },
          { date: "2026-09-09", value: 105 },
        ]),
        { source },
      ),
    );
    assert.deepEqual(envelope.source, source);
  });
});

describe("F: observedAt equals the last ReturnSeries date", () => {
  it("derives observedAt deterministically from the returns", () => {
    const envelope = buildReturnSeriesEnvelope(
      seriesInput(
        priceSeries("A", [
          { date: "2026-09-08", value: 100 },
          { date: "2026-09-09", value: 105 },
          { date: "2026-09-10", value: 110 },
        ]),
      ),
    );
    assert.equal(envelope.observedAt, "2026-09-10");
    assert.equal(envelope.retrievedAt, "2026-09-12T12:00:00Z");
  });
});

describe("G: benchmark stays generic", () => {
  it("a benchmark id/symbol is just a caller decision", () => {
    const envelope = buildBenchmarkReturnSeries({
      ...seriesInput(
        priceSeries("MY_BENCH", [
          { date: "2026-09-08", value: 100 },
          { date: "2026-09-09", value: 101 },
        ]),
      ),
      benchmark: { id: "MY_BENCH", symbol: "MY_BENCH" },
    });
    assert.equal(envelope.value.assetId, "MY_BENCH");
    assert.equal(envelope.value.points.length, 1);
  });
});

describe("H: benchmark symbol/id is not hardcoded", () => {
  it("no SPY/S&P/Nasdaq appears in the benchmark builder", () => {
    const source = readRoot("lib/financial-data/builders/benchmark-return-series.ts");
    assert.equal(/SPY/i.test(source), false);
    assert.equal(/S\s*&\s*P/i.test(source), false);
    assert.equal(/Nasdaq/i.test(source), false);
    assert.equal(/benchmark\s*:\s*["']SPY/i.test(source), false);
  });
});

function twoAssetData() {
  const envelopeA = buildReturnSeriesEnvelope(
    seriesInput(
      priceSeries("A", [
        { date: "2026-09-08", value: 100 },
        { date: "2026-09-09", value: 110 },
        { date: "2026-09-10", value: 104.5 },
      ]),
      {
        source: {
          provider: "provider-A",
          originalSource: "dataset-A",
          identifier: "a-1",
        },
        quality: makeQuality({ freshness: "fresh", completeness: 0.9 }),
      },
    ),
  );
  const envelopeB = buildReturnSeriesEnvelope(
    seriesInput(
      priceSeries("B", [
        { date: "2026-09-08", value: 200 },
        { date: "2026-09-09", value: 210 },
        { date: "2026-09-10", value: 231 },
      ]),
      {
        source: {
          provider: "provider-B",
          originalSource: "dataset-B",
          identifier: "b-1",
        },
        quality: makeQuality({
          freshness: "stale",
          completeness: 0.7,
          warnings: ["late close", "missing volume"],
        }),
      },
    ),
  );
  const portfolio = {
    id: "PF",
    positions: [
      { assetId: "A", weight: 0.6 },
      { assetId: "B", weight: 0.4 },
    ],
  };
  return { portfolio, envelopeA, envelopeB };
}

describe("I: portfolio builder combines returns correctly", () => {
  it("computes Rp = 0.6*Ra + 0.4*Rb via calculatePortfolioReturns", () => {
    const { portfolio, envelopeA, envelopeB } = twoAssetData();
    const result = buildPortfolioReturnSeries({
      portfolio,
      assetReturns: new Map([
        ["A", envelopeA],
        ["B", envelopeB],
      ]),
      retrievedAt: "2026-09-13T00:00:00Z",
    });
    approx(result.value.points[0].value, 0.08);
    approx(result.value.points[1].value, 0.01);
    assert.deepEqual(
      result.value.points.map((point) => point.date),
      ["2026-09-09", "2026-09-10"],
    );
    assert.equal(result.frequency, "daily");
  });
});

describe("J: portfolio builder never improves freshness", () => {
  it("worst input freshness is preserved", () => {
    const { portfolio, envelopeA, envelopeB } = twoAssetData();
    const result = buildPortfolioReturnSeries({
      portfolio,
      assetReturns: new Map([
        ["A", envelopeA],
        ["B", envelopeB],
      ]),
      retrievedAt: "2026-09-13T00:00:00Z",
    });
    assert.equal(result.quality.freshness, "stale");
    assert.equal(result.quality.sourceTier, "licensed");
  });
});

describe("K: upstream warnings are preserved", () => {
  it("propagates and deduplicates warnings", () => {
    const { portfolio, envelopeA, envelopeB } = twoAssetData();
    const result = buildPortfolioReturnSeries({
      portfolio,
      assetReturns: new Map([
        ["A", envelopeA],
        ["B", envelopeB],
      ]),
      retrievedAt: "2026-09-13T00:00:00Z",
    });
    assert.deepEqual(Array.from(result.quality.warnings).sort(), [
      "late close",
      "missing volume",
    ]);
  });
});

describe("L: completeness propagates conservatively", () => {
  it("takes the minimum input completeness", () => {
    const { portfolio, envelopeA, envelopeB } = twoAssetData();
    const result = buildPortfolioReturnSeries({
      portfolio,
      assetReturns: new Map([
        ["A", envelopeA],
        ["B", envelopeB],
      ]),
      retrievedAt: "2026-09-13T00:00:00Z",
    });
    assert.equal(result.quality.completeness, 0.7);
  });
});

describe("M: beta context uses exactly the two data keys", () => {
  it("builds portfolio_returns + benchmark_returns for the engine", () => {
    const portfolioEnvelope = buildReturnSeriesEnvelope(
      seriesInput(
        priceSeries("A", [
          { date: "2026-09-08", value: 100 },
          { date: "2026-09-09", value: 102 },
        ]),
      ),
    );
    const benchmarkEnvelope = buildBenchmarkReturnSeries({
      ...seriesInput(
        priceSeries("BENCH", [
          { date: "2026-09-08", value: 100 },
          { date: "2026-09-09", value: 101 },
        ]),
      ),
      benchmark: { id: "BENCH", symbol: "BENCH" },
    });
    const context = buildBetaDataContext({
      portfolioReturns: portfolioEnvelope,
      benchmarkReturns: benchmarkEnvelope,
      asOf: "2026-09-10",
    });
    assert.deepEqual(Object.keys(context.data).sort(), [
      "benchmark_returns",
      "portfolio_returns",
    ]);
    assert.equal(
      context.data[PORTFOLIO_RETURNS_DATA_KEY],
      portfolioEnvelope,
    );
    assert.equal(
      context.data[BENCHMARK_RETURNS_DATA_KEY],
      benchmarkEnvelope,
    );
    assert.equal(context.asOf, "2026-09-10");
  });
});

describe("N: frequency mismatch is rejected", () => {
  it("portfolio builder rejects non-daily inputs", () => {
    assert.throws(
      () =>
        buildPortfolioReturnSeries({
          portfolio: {
            id: "PF",
            positions: [{ assetId: "A", weight: 1 }],
          },
          assetReturns: new Map([
            [
              "A",
              {
                value: priceSeries("A", []),
                source: { provider: "p", originalSource: "o" },
                observedAt: "2026-09-10",
                retrievedAt: "2026-09-10",
                frequency: "weekly",
                quality: makeQuality(),
              },
            ],
          ]),
          retrievedAt: "2026-09-10",
        }),
      UnsupportedFrequencyError,
    );
  });

  it("return builder rejects non-daily price data", () => {
    assert.throws(
      () =>
        buildReturnSeriesEnvelope(
          seriesInput(
            priceSeries("A", [
              { date: "2026-09-08", value: 100 },
              { date: "2026-09-09", value: 105 },
            ]),
            { frequency: "weekly" },
          ),
        ),
      UnsupportedFrequencyError,
    );
  });
});

describe("O: builders make no network calls", () => {
  const files = [
    "lib/financial-data/builders/errors.ts",
    "lib/financial-data/builders/return-series.ts",
    "lib/financial-data/builders/benchmark-return-series.ts",
    "lib/financial-data/builders/portfolio-return-series.ts",
    "lib/financial-data/builders/beta-context.ts",
    "lib/financial-data/builders/index.ts",
    "lib/financial-data/adapters/market-prices.ts",
  ];
  const forbidden = [
    /from ["']next\//,
    /from ["']react\/?["']/,
    /from ["']app\//,
    /\"@\/components\//,
    /alpha[_\s-]?vantage/i,
    /tavily/i,
    /gemini/i,
    /supabase/i,
    /node-fetch/,
    /\bfetch\s*\(/,
  ];
  it("no builder imports network/UI providers", () => {
    for (const file of files) {
      const source = readRoot(file);
      for (const pattern of forbidden) {
        assert.equal(
          pattern.test(source),
          false,
          `${file} must not match ${pattern}`,
        );
      }
    }
  });
});

describe("P: lib/analytics still never imports market-data/builders", () => {
  const files = listTs(join(ROOT, "lib/analytics"));
  it("no analytics source references the data layer or network modules", () => {
    assert.ok(files.length > 10);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.equal(
        /market-data/.test(source),
        false,
        `${file} must not import market-data`,
      );
      assert.equal(
        /financial-data\/builders/.test(source),
        false,
        `${file} must not import financial-data/builders`,
      );
      for (const pattern of [/alpha[_\s-]?vantage/i, /gemini/i, /supabase/i, /node-fetch/, /tavily/i]) {
        assert.equal(pattern.test(source), false, `${file} must not match ${pattern}`);
      }
    }
  });
});

function fullPipelineSets() {
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
  const portfolioEnvelope = buildReturnSeriesEnvelope(
    seriesInput(priceSeries("PF", portfolioPrices), {
      source: {
        provider: "provider-portfolio",
        originalSource: "portfolio-dataset",
        identifier: "pf-series",
      },
    }),
  );
  const benchmarkEnvelope = buildBenchmarkReturnSeries({
    ...seriesInput(priceSeries("BENCH", benchmarkPrices), {
      source: {
        provider: "provider-benchmark",
        originalSource: "benchmark-dataset",
        identifier: "bench-series",
      },
    }),
    benchmark: { id: "BENCH", symbol: "BENCH" },
  });
  return { portfolioEnvelope, benchmarkEnvelope };
}

describe("Q: existing beta still gives beta = 2 through the full pipeline", () => {
  it("portfolio = 2 x benchmark via builders => engine beta = 2, provenance intact", () => {
    const { portfolioEnvelope, benchmarkEnvelope } = fullPipelineSets();
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
    const providers = result.sources
      .map((source) => source.provider)
      .sort();
    assert.deepEqual(providers, ["provider-benchmark", "provider-portfolio"]);
    assert.ok(
      Object.keys(context.data).length === 2 &&
        PORTFOLIO_RETURNS_DATA_KEY in context.data &&
        BENCHMARK_RETURNS_DATA_KEY in context.data,
    );
  });
});

describe("R: previous 263 tests keep their semantics", () => {
  it("the engine remains deterministic on the beta pipeline", () => {
    const { portfolioEnvelope, benchmarkEnvelope } = fullPipelineSets();
    const context = buildBetaDataContext({
      portfolioReturns: portfolioEnvelope,
      benchmarkReturns: benchmarkEnvelope,
      asOf: "2026-09-12",
    });
    const registry = new IndicatorRegistry();
    registry.register(betaIndicator);
    const engine = new AnalyticsEngine(registry);
    const run = () =>
      engine.calculate({ indicators: ["beta"], context });
    assert.equal(
      JSON.stringify(Object.fromEntries(run())),
      JSON.stringify(Object.fromEntries(run())),
    );
  });

  it("the 60/40 portfolio combination is still exact", () => {
    const { portfolio, envelopeA, envelopeB } = twoAssetData();
    const result = buildPortfolioReturnSeries({
      portfolio,
      assetReturns: new Map([
        ["A", envelopeA],
        ["B", envelopeB],
      ]),
      retrievedAt: "2026-09-13T00:00:00Z",
    });
    approx(result.value.points[0].value, 0.08, 1e-12);
    approx(result.value.points[1].value, 0.01, 1e-12);
  });
});

describe("Micro-fix A: unrelated stale/weekly asset return does not affect the portfolio", () => {
  it("an extra weekly/stale envelope is ignored entirely", () => {
    const envA = dailyA();
    const unrelated = rawEnvelope(priceSeries("UNRELATED", []), {
      frequency: "weekly",
      quality: makeQuality({
        freshness: "stale",
        sourceTier: "secondary",
        completeness: 0.1,
        warnings: ["unrelated warning"],
      }),
      source: {
        provider: "provider-unrelated",
        originalSource: "dataset-unrelated",
        identifier: "u-1",
      },
    });
    const result = buildPortfolioReturnSeries({
      portfolio: singleAssetPortfolio("A"),
      assetReturns: new Map([
        ["A", envA],
        ["UNRELATED", unrelated],
      ]),
      retrievedAt: "2026-09-13T00:00:00Z",
    });
    assert.equal(result.frequency, "daily");
    assert.equal(result.quality.freshness, "fresh");
    assert.equal(result.quality.completeness, 1);
  });
});

describe("Micro-fix B: unrelated source never appears in result.sources", () => {
  it("sources only reflect active portfolio assets", () => {
    const envA = dailyA();
    const unrelated = rawEnvelope(priceSeries("UNRELATED", []), {
      source: {
        provider: "provider-unrelated",
        originalSource: "dataset-unrelated",
        identifier: "u-1",
      },
    });
    const result = buildPortfolioReturnSeries({
      portfolio: singleAssetPortfolio("A"),
      assetReturns: new Map([
        ["A", envA],
        ["UNRELATED", unrelated],
      ]),
      retrievedAt: "2026-09-13T00:00:00Z",
    });
    const providers = result.sources.map((source) => source.provider);
    assert.deepEqual(providers, ["test-provider"]);
  });
});

describe("Micro-fix C: unrelated warnings never appear", () => {
  it("only active-input warnings are propagated", () => {
    const envA = dailyA();
    const unrelated = rawEnvelope(priceSeries("UNRELATED", []), {
      quality: makeQuality({ warnings: ["unrelated warning"] }),
    });
    const result = buildPortfolioReturnSeries({
      portfolio: singleAssetPortfolio("A"),
      assetReturns: new Map([
        ["A", envA],
        ["UNRELATED", unrelated],
      ]),
      retrievedAt: "2026-09-13T00:00:00Z",
    });
    assert.deepEqual(Array.from(result.quality.warnings), []);
  });
});

describe("Micro-fix D: zero-weight weekly asset does not raise UnsupportedFrequencyError", () => {
  it("weight === 0 is never frequency-validated", () => {
    const envA = dailyA();
    const envB = rawEnvelope(priceSeries("B", []), { frequency: "weekly" });
    const result = buildPortfolioReturnSeries({
      portfolio: {
        id: "PF",
        positions: [
          { assetId: "A", weight: 1 },
          { assetId: "B", weight: 0 },
        ],
      },
      assetReturns: new Map([
        ["A", envA],
        ["B", envB],
      ]),
      retrievedAt: "2026-09-13T00:00:00Z",
    });
    assert.equal(result.frequency, "daily");
  });
});

describe("Micro-fix E: zero-weight stale asset does not degrade freshness", () => {
  it("weight === 0 participates in no quality aggregation", () => {
    const envA = dailyA();
    const envB = rawEnvelope(priceSeries("B", []), {
      quality: makeQuality({ freshness: "stale", completeness: 0.2 }),
    });
    const result = buildPortfolioReturnSeries({
      portfolio: {
        id: "PF",
        positions: [
          { assetId: "A", weight: 1 },
          { assetId: "B", weight: 0 },
        ],
      },
      assetReturns: new Map([
        ["A", envA],
        ["B", envB],
      ]),
      retrievedAt: "2026-09-13T00:00:00Z",
    });
    assert.equal(result.quality.freshness, "fresh");
    assert.equal(result.quality.completeness, 1);
  });
});

describe("Micro-fix F: zero-weight source never appears in sources", () => {
  it("weight === 0 contributes no provenance", () => {
    const envA = dailyA();
    const envB = rawEnvelope(priceSeries("B", []), {
      source: {
        provider: "provider-B",
        originalSource: "dataset-B",
        identifier: "b-1",
      },
    });
    const result = buildPortfolioReturnSeries({
      portfolio: {
        id: "PF",
        positions: [
          { assetId: "A", weight: 1 },
          { assetId: "B", weight: 0 },
        ],
      },
      assetReturns: new Map([
        ["A", envA],
        ["B", envB],
      ]),
      retrievedAt: "2026-09-13T00:00:00Z",
    });
    const providers = result.sources.map((source) => source.provider);
    assert.deepEqual(providers, ["test-provider"]);
    assert.equal(result.observedAt, "2026-09-09");
  });
});

describe("Micro-fix G: positive missing asset still fails explicitly", () => {
  it("a 50/50 portfolio with only A still raises MissingAssetReturnSeriesError", () => {
    const envA = dailyA();
    assert.throws(
      () =>
        buildPortfolioReturnSeries({
          portfolio: {
            id: "PF",
            positions: [
              { assetId: "A", weight: 0.5 },
              { assetId: "B", weight: 0.5 },
            ],
          },
          assetReturns: new Map([["A", envA]]),
          retrievedAt: "2026-09-13T00:00:00Z",
        }),
      MissingAssetReturnSeriesError,
    );
  });
});

describe("Micro-fix H: two positive assets still aggregate worst quality", () => {
  it("freshness/completeness come from the worst active input", () => {
    const { portfolio, envelopeA, envelopeB } = twoAssetData();
    const result = buildPortfolioReturnSeries({
      portfolio,
      assetReturns: new Map([
        ["A", envelopeA],
        ["B", envelopeB],
      ]),
      retrievedAt: "2026-09-13T00:00:00Z",
    });
    assert.equal(result.quality.freshness, "stale");
    assert.equal(result.quality.completeness, 0.7);
  });
});

describe("Micro-fix I: 60/40 combination still yields 0.08 and 0.01", () => {
  it("the weighted return values are unchanged after the fix", () => {
    const { portfolio, envelopeA, envelopeB } = twoAssetData();
    const result = buildPortfolioReturnSeries({
      portfolio,
      assetReturns: new Map([
        ["A", envelopeA],
        ["B", envelopeB],
      ]),
      retrievedAt: "2026-09-13T00:00:00Z",
    });
    approx(result.value.points[0].value, 0.08, 1e-12);
    approx(result.value.points[1].value, 0.01, 1e-12);
    const providers = result.sources.map((source) => source.provider).sort();
    assert.deepEqual(providers, ["provider-A", "provider-B"]);
  });
});

describe("Micro-fix J: builders -> Beta still yields beta = 2", () => {
  it("the full pipeline keeps beta exactly 2", () => {
    const { portfolioEnvelope, benchmarkEnvelope } = fullPipelineSets();
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
  });
});

describe("Micro-fix K: previous tests keep their behavior", () => {
  it("buildPortfolioReturnSeries stays deterministic", () => {
    const { portfolio, envelopeA, envelopeB } = twoAssetData();
    const run = () =>
      buildPortfolioReturnSeries({
        portfolio,
        assetReturns: new Map([
          ["A", envelopeA],
          ["B", envelopeB],
        ]),
        retrievedAt: "2026-09-13T00:00:00Z",
      });
    assert.equal(
      JSON.stringify(run()),
      JSON.stringify(run()),
    );
  });
});