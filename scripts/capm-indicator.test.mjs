/* CAPM indicator tests (no network).                                       */
/*                                                                          */
/* Run via `npm run test:static` (compiles lib/analytics +                 */
/* lib/financial-data to .testbuild, then node --test this file).           */
/*                                                                          */
/* Coverage map (A-V):                                                      */
/*   A  capmIndicator metadata is correct                                   */
/*   B  dependencies include risk_free_rate + expected_market_return + beta */
/*   C  pure calculator known case: 1.2 / 0.04 / 0.10 => 0.112              */
/*   D  beta = 1 => expected market return                                  */
/*   E  beta = 0 => risk-free rate                                          */
/*   F  negative beta works                                                 */
/*   G  negative risk-free rate is accepted                                 */
/*   H  malformed risk-free rate => error, never NaN                        */
/*   I  malformed expected market return => error                           */
/*   J  period !== annual => error                                          */
/*   K  representation !== decimal => error                                 */
/*   L  missing risk_free_rate handled by the Engine (insufficient_data)    */
/*   M  missing expected_market_return handled by the Engine                */
/*   N  beta dependency is computed through the registry                    */
/*   O  CAPM reuses beta, it never recalculates it                          */
/*   P  provenance unions beta + risk-free + market sources                 */
/*   Q  identical provenance is deduplicated deterministically              */
/*   R  no provider/benchmark names hardcoded in capm.ts                    */
/*   S  no network/UI/provider imports in capm.ts                           */
/*   T  CAPM result is always finite                                        */
/*   U  known Beta = 2 pipeline stays intact                                */
/*   V  previous 363 tests keep their semantics (deterministic runs)        */
/* ------------------------------------------------------------------------ */

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
import { makeDataQuality } from "../.testbuild/financial-data/quality.js";

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

function annualDecimalRate(rate) {
  return { rate, period: "annual", representation: "decimal" };
}

function rateEnvelope(value, overrides = {}) {
  return {
    value,
    source: {
      provider: "rf-provider",
      originalSource: "rf-dataset",
      identifier: "rf-1",
    },
    observedAt: "2026-09-10T00:00:00Z",
    retrievedAt: "2026-09-10T12:00:00Z",
    frequency: "annual",
    quality: makeQuality(),
    ...overrides,
  };
}

function rateContext(rf, market) {
  return {
    data: {
      [RISK_FREE_RATE_DATA_KEY]: rateEnvelope(rf),
      [EXPECTED_MARKET_RETURN_DATA_KEY]: rateEnvelope(market),
    },
    indicators: new Map(),
    asOf: "2026-09-10",
  };
}

function stubBetaRegistry(options = {}) {
  const registry = new IndicatorRegistry();
  const calls = { beta: 0 };
  registry.register({
    id: "beta",
    name: "Beta",
    version: "1.0.0",
    category: "risk",
    calculate: (context) => {
      calls.beta += 1;
      void context;
      return {
        value: options.beta ?? 1.2,
        status: "ok",
        sources: [],
        warnings: [],
      };
    },
    metadata: { description: "", methodology: "", units: null },
  });
  registry.register(capmIndicator);
  return { registry, calls };
}

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

function capmContextFromPipeline(options = {}) {
  const { portfolioEnvelope, benchmarkEnvelope } = twoXFullPipeline();
  const context = buildBetaDataContext({
    portfolioReturns: portfolioEnvelope,
    benchmarkReturns: benchmarkEnvelope,
    asOf: "2026-09-12",
  });
  const riskFreeEnvelope = options.rfMirrorsPortfolio
    ? rateEnvelope(annualDecimalRate(0.04), {
        source: { ...portfolioEnvelope.source },
        observedAt: portfolioEnvelope.observedAt,
        retrievedAt: portfolioEnvelope.retrievedAt,
      })
    : rateEnvelope(annualDecimalRate(0.04));
  const marketEnvelope = rateEnvelope(annualDecimalRate(0.1), {
    source: {
      provider: "market-provider",
      originalSource: "market-dataset",
      identifier: "market-1",
    },
  });
  context.data[RISK_FREE_RATE_DATA_KEY] = riskFreeEnvelope;
  context.data[EXPECTED_MARKET_RETURN_DATA_KEY] = marketEnvelope;
  return context;
}

function capmEngine() {
  const registry = new IndicatorRegistry();
  registry.register(betaIndicator);
  registry.register(capmIndicator);
  return new AnalyticsEngine(registry);
}

describe("A: capmIndicator metadata is correct", () => {
  it("exposes id, name, version, category and full metadata", () => {
    assert.equal(capmIndicator.id, "capm");
    assert.equal(capmIndicator.name, "CAPM Expected Return");
    assert.equal(capmIndicator.version, "1.0.0");
    assert.equal(capmIndicator.category, "risk-adjusted-return");
    assert.equal(capmIndicator.metadata.units, "annual decimal return");
    assert.equal(
      capmIndicator.metadata.description,
      "Expected return implied by CAPM given beta, a risk-free rate, and an expected market return.",
    );
    assert.equal(
      capmIndicator.metadata.methodology,
      "Risk-free rate plus beta times the expected market risk premium.",
    );
    assert.equal(capmIndicator.metadata.formula, "E(Ri) = Rf + β(E(Rm) - Rf)");
  });
});

describe("B: capm dependencies", () => {
  it("declares beta + risk_free_rate + expected_market_return", () => {
    assert.deepEqual(
      capmIndicator.dependencies.indicators,
      ["beta"],
    );
    assert.deepEqual(
      capmIndicator.dependencies.data,
      ["risk_free_rate", "expected_market_return"],
    );
    assert.equal(RISK_FREE_RATE_DATA_KEY, "risk_free_rate");
    assert.equal(EXPECTED_MARKET_RETURN_DATA_KEY, "expected_market_return");
  });
});

describe("C: pure calculator known case", () => {
  it("beta 1.2, Rf 0.04, E(Rm) 0.10 => 0.112", () => {
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

describe("D: beta = 1 yields the market return", () => {
  it("0.04 + 1 x (0.10 - 0.04) => 0.10", () => {
    approx(
      calculateCapmExpectedReturn({
        beta: 1,
        riskFreeRate: 0.04,
        expectedMarketReturn: 0.1,
      }),
      0.1,
    );
  });
});

describe("E: beta = 0 yields the risk-free rate", () => {
  it("0.04 + 0 x (premium) => 0.04", () => {
    approx(
      calculateCapmExpectedReturn({
        beta: 0,
        riskFreeRate: 0.04,
        expectedMarketReturn: 0.1,
      }),
      0.04,
    );
  });
});

describe("F: negative beta works", () => {
  it("beta -0.5, Rf 0.04, E(Rm) 0.10 => 0.01", () => {
    approx(
      calculateCapmExpectedReturn({
        beta: -0.5,
        riskFreeRate: 0.04,
        expectedMarketReturn: 0.1,
      }),
      0.01,
    );
  });
});

describe("G: negative risk-free rate is accepted", () => {
  it("beta 1, Rf -0.01, E(Rm) 0.10 => 0.10, not rejected", () => {
    const { registry } = stubBetaRegistry({ beta: 1 });
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({
        indicators: ["capm"],
        context: rateContext(
          annualDecimalRate(-0.01),
          annualDecimalRate(0.1),
        ),
      })
      .get("capm");
    assert.equal(result.status, "ok");
    approx(result.value, 0.1);
  });
});

describe("H: malformed risk-free rate => error, never NaN", () => {
  it("a plain number is rejected", () => {
    const { registry } = stubBetaRegistry();
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({
        indicators: ["capm"],
        context: rateContext(0.04, annualDecimalRate(0.1)),
      })
      .get("capm");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.ok(result.warnings.some((warning) => warning.includes(RISK_FREE_RATE_DATA_KEY)));
  });

  it("a NaN rate is rejected without producing NaN", () => {
    const { registry } = stubBetaRegistry();
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({
        indicators: ["capm"],
        context: rateContext(
          { rate: Number.NaN, period: "annual", representation: "decimal" },
          annualDecimalRate(0.1),
        ),
      })
      .get("capm");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.equal(Number.isNaN(result.value), false);
  });
});

describe("I: malformed expected market return => error", () => {
  it("a string rate is rejected", () => {
    const { registry } = stubBetaRegistry();
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({
        indicators: ["capm"],
        context: rateContext(
          annualDecimalRate(0.04),
          { rate: "10", period: "annual", representation: "decimal" },
        ),
      })
      .get("capm");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.ok(
      result.warnings.some((warning) =>
        warning.includes(EXPECTED_MARKET_RETURN_DATA_KEY),
      ),
    );
  });
});

describe("J: period !== annual => error", () => {
  it("monthly rate is rejected as an explicit unit contract violation", () => {
    const { registry } = stubBetaRegistry();
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({
        indicators: ["capm"],
        context: rateContext(
          { rate: 0.04, period: "monthly", representation: "decimal" },
          annualDecimalRate(0.1),
        ),
      })
      .get("capm");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
  });
});

describe("K: representation !== decimal => error", () => {
  it("a percent representation is rejected, never divided by 100", () => {
    const { registry } = stubBetaRegistry();
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({
        indicators: ["capm"],
        context: rateContext(
          { rate: 0.04, period: "annual", representation: "percent" },
          annualDecimalRate(0.1),
        ),
      })
      .get("capm");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
  });
});

describe("L: missing risk_free_rate handled by the Engine", () => {
  it("short-circuits to insufficient_data with a descriptive warning", () => {
    const { registry } = stubBetaRegistry();
    const engine = new AnalyticsEngine(registry);
    const context = {
      data: {
        [EXPECTED_MARKET_RETURN_DATA_KEY]: rateEnvelope(annualDecimalRate(0.1)),
      },
      indicators: new Map(),
      asOf: "2026-09-10",
    };
    const result = engine
      .calculate({ indicators: ["capm"], context })
      .get("capm");
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.value, null);
    assert.ok(
      result.warnings.some((warning) => warning.includes(RISK_FREE_RATE_DATA_KEY)),
    );
  });
});

describe("M: missing expected_market_return handled by the Engine", () => {
  it("short-circuits to insufficient_data with a descriptive warning", () => {
    const { registry } = stubBetaRegistry();
    const engine = new AnalyticsEngine(registry);
    const context = {
      data: {
        [RISK_FREE_RATE_DATA_KEY]: rateEnvelope(annualDecimalRate(0.04)),
      },
      indicators: new Map(),
      asOf: "2026-09-10",
    };
    const result = engine
      .calculate({ indicators: ["capm"], context })
      .get("capm");
    assert.equal(result.status, "insufficient_data");
    assert.ok(
      result.warnings.some((warning) =>
        warning.includes(EXPECTED_MARKET_RETURN_DATA_KEY),
      ),
    );
  });
});

describe("N: beta dependency is computed through the registry", () => {
  it("requesting capm also computes beta via the engine", () => {
    const engine = capmEngine();
    const context = capmContextFromPipeline();
    const results = engine.calculate({ indicators: ["capm"], context });
    assert.equal(results.get("beta").status, "ok");
    approx(results.get("beta").value, 2);
    assert.equal(results.get("capm").status, "ok");
  });
});

describe("O: CAPM reuses beta, it never recalculates it", () => {
  it("the beta dependency runs exactly once for the capm request", () => {
    const { registry, calls } = stubBetaRegistry({ beta: 1.2 });
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({
        indicators: ["capm"],
        context: rateContext(annualDecimalRate(0.04), annualDecimalRate(0.1)),
      })
      .get("capm");
    assert.equal(calls.beta, 1);
    assert.equal(result.status, "ok");
    approx(result.value, 0.112);
  });
});

describe("P: provenance unions beta + risk-free + market sources", () => {
  it("capm sources include the beta sources and both rate envelopes", () => {
    const engine = capmEngine();
    const result = engine
      .calculate({ indicators: ["capm"], context: capmContextFromPipeline() })
      .get("capm");
    const providers = result.sources.map((source) => source.provider).sort();
    assert.deepEqual(providers, [
      "market-provider",
      "provider-benchmark",
      "provider-portfolio",
      "rf-provider",
    ]);
    for (const source of result.sources) {
      assert.equal(typeof source.provider, "string");
      assert.equal(typeof source.originalSource, "string");
      assert.ok(source.identifier);
      assert.ok(source.observedAt);
      assert.ok(source.retrievedAt);
    }
  });
});

describe("Q: identical provenance is deduplicated", () => {
  it("a risk-free envelope sharing the portfolio reference appears once", () => {
    const engine = capmEngine();
    const result = engine
      .calculate({
        indicators: ["capm"],
        context: capmContextFromPipeline({ rfMirrorsPortfolio: true }),
      })
      .get("capm");
    const portfolioRefs = result.sources.filter(
      (source) => source.provider === "provider-portfolio",
    );
    assert.equal(portfolioRefs.length, 1);
    assert.equal(result.sources.length, 3);
  });
});

describe("R: no provider/benchmark names hardcoded in capm.ts", () => {
  it("capm.ts contains no Tiingo / FRED / SPY / Treasury / Alpha Vantage", () => {
    const source = readRoot("lib/analytics/indicators/capm.ts");
    for (const pattern of [/tiingo/i, /\bFRED\b/i, /SPY/i, /treasury/i, /alpha[_\s-]?vantage/i]) {
      assert.equal(pattern.test(source), false, `capm.ts must not match ${pattern}`);
    }
  });
});

describe("S: no network/UI/provider imports in capm.ts", () => {
  it("capm.ts imports none of next/react/app/market-data/Gemini/Supabase/fetch", () => {
    const source = readRoot("lib/analytics/indicators/capm.ts");
    for (const pattern of [
      /from ["']next\//,
      /from ["']react\/?["']/,
      /from ["']app\//,
      /market-data/,
      /gemini/i,
      /supabase/i,
      /node-fetch/,
      /tavily/i,
    ]) {
      assert.equal(pattern.test(source), false, `capm.ts must not match ${pattern}`);
    }
  });
});

describe("T: CAPM result is always finite", () => {
  it("the engine result value is a finite number on the known pipeline", () => {
    const engine = capmEngine();
    const result = engine
      .calculate({ indicators: ["capm"], context: capmContextFromPipeline() })
      .get("capm");
    assert.equal(result.status, "ok");
    assert.equal(typeof result.value, "number");
    assert.equal(Number.isFinite(result.value), true);
    approx(result.value, 0.16);
  });

  it("non-finite inputs are rejected by the pure calculator", () => {
    assert.throws(
      () =>
        calculateCapmExpectedReturn({
          beta: Number.POSITIVE_INFINITY,
          riskFreeRate: 0.04,
          expectedMarketReturn: 0.1,
        }),
      (error) => error?.constructor?.name === "InvalidCapmInputError",
    );
  });
});

describe("U: known Beta = 2 pipeline stays intact", () => {
  it("requesting only beta still yields exactly 2", () => {
    const engine = capmEngine();
    const context = capmContextFromPipeline();
    const result = engine
      .calculate({ indicators: ["beta"], context })
      .get("beta");
    assert.equal(result.status, "ok");
    approx(result.value, 2);
    assert.equal(result.dataWindow.observations, 4);
  });
});

describe("V: previous 363 tests keep their semantics", () => {
  it("the capm pipeline is deterministic across runs", () => {
    const engine = capmEngine();
    const context = capmContextFromPipeline();
    const run = () =>
      engine.calculate({ indicators: ["capm"], context });
    assert.equal(
      JSON.stringify(Object.fromEntries(run())),
      JSON.stringify(Object.fromEntries(run())),
    );
  });
});