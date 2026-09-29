/* Treynor Ratio V1 indicator tests (no network).                             */
/*                                                                            */
/* Run via `npm run test:static` (compiles lib/analytics to .testbuild,       */
/* then node --test this file).                                               */
/*                                                                            */
/* Coverage map (A-X):                                                        */
/*   A  treynorIndicator metadata is correct                                  */
/*   B  data deps = portfolio_annual_return + risk_free_rate; beta indicator  */
/*   C  pure known case: 0.12 / 0.04 / 0.8 => 0.10                            */
/*   D  zero excess return => 0                                               */
/*   E  negative Treynor works                                                */
/*   F  negative beta accepted                                                */
/*   G  negative risk-free rate accepted                                      */
/*   H  beta zero => no Infinity/NaN, deterministic status                    */
/*   I  non-finite beta rejected                                              */
/*   J  malformed portfolio-return envelope => error                          */
/*   K  malformed risk-free envelope => error                                 */
/*   L  wrong period => error                                                 */
/*   M  wrong representation => error                                         */
/*   N  missing portfolio return handled by the Engine                        */
/*   O  missing risk-free handled by the Engine                               */
/*   P  missing beta handled by the Engine                                    */
/*   Q  beta status non-ok prevents calculation                                */
/*   R  provenance union                                                      */
/*   S  provenance dedupe                                                     */
/*   T  no provider/network/UI imports in treynor.ts                          */
/*   U  Sharpe known fixture stays 0.4                                        */
/*   V  CAPM known fixture stays 0.112                                        */
/*   W  Beta pipeline stays unchanged                                         */
/*   X  previous test semantics stay green (deterministic reruns)             */
/* -------------------------------------------------------------------------- */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AnalyticsEngine,
  betaIndicator,
  calculateCapmExpectedReturn,
  calculateSharpeRatio,
  calculateTreynorRatio,
  IndicatorRegistry,
  InvalidTreynorInputError,
  PORTFOLIO_ANNUAL_RETURN_DATA_KEY,
  RISK_FREE_RATE_DATA_KEY,
  treynorIndicator,
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
      provider: "source-provider",
      originalSource: "source-dataset",
      identifier: "source-1",
    },
    observedAt: "2026-09-10T00:00:00Z",
    retrievedAt: "2026-09-10T12:00:00Z",
    frequency: "annual",
    quality: makeQuality(),
    ...overrides,
  };
}

function treynorContext(portfolio, riskFree, options = {}) {
  return {
    data: {
      [PORTFOLIO_ANNUAL_RETURN_DATA_KEY]: rateEnvelope(portfolio),
      [RISK_FREE_RATE_DATA_KEY]: rateEnvelope(riskFree),
    },
    indicators: new Map(),
    asOf: "2026-09-10",
    ...options,
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
        value: options.value ?? 1.2,
        status: options.status ?? "ok",
        sources: options.sources ?? [],
        warnings: [],
      };
    },
    metadata: { description: "", methodology: "", units: null },
  });
  registry.register(treynorIndicator);
  return { registry, calls };
}

function treynorEngine(registry) {
  return new AnalyticsEngine(registry);
}

describe("A: treynorIndicator metadata is correct", () => {
  it("exposes id, name, version, category and full metadata", () => {
    assert.equal(treynorIndicator.id, "treynor");
    assert.equal(treynorIndicator.name, "Treynor Ratio");
    assert.equal(treynorIndicator.version, "1.0.0");
    assert.equal(treynorIndicator.category, "risk-adjusted-return");
    assert.equal(
      treynorIndicator.metadata.description,
      "Risk-adjusted return measured as annual portfolio excess return per unit of systematic risk.",
    );
    assert.equal(
      treynorIndicator.metadata.methodology,
      "Annualized portfolio return minus annual risk-free rate, divided by portfolio beta.",
    );
    assert.equal(
      treynorIndicator.metadata.formula,
      "Treynor = (Rp - Rf) / β",
    );
    assert.equal(
      treynorIndicator.metadata.units,
      "annual decimal return per unit beta",
    );
  });
});

describe("B: dependencies are correct", () => {
  it("declares portfolio_annual_return + risk_free_rate data and beta indicator", () => {
    assert.deepEqual(
      [...treynorIndicator.dependencies.data],
      [PORTFOLIO_ANNUAL_RETURN_DATA_KEY, RISK_FREE_RATE_DATA_KEY],
    );
    assert.deepEqual([...treynorIndicator.dependencies.indicators], ["beta"]);
  });
});

describe("C: pure known case", () => {
  it("0.12 / 0.04 / 0.8 => 0.10", () => {
    approx(
      calculateTreynorRatio({
        portfolioReturn: 0.12,
        riskFreeRate: 0.04,
        beta: 0.8,
      }),
      0.1,
    );
  });

  it("0.00 / 0.04 / 0.8 => -0.05", () => {
    approx(
      calculateTreynorRatio({
        portfolioReturn: 0.0,
        riskFreeRate: 0.04,
        beta: 0.8,
      }),
      -0.05,
    );
  });
});

describe("D: zero excess return", () => {
  it("0.04 / 0.04 / 0.8 => 0", () => {
    assert.equal(
      calculateTreynorRatio({
        portfolioReturn: 0.04,
        riskFreeRate: 0.04,
        beta: 0.8,
      }),
      0,
    );
  });
});

describe("E: negative Treynor works", () => {
  it("0.04 / 0.12 / 0.8 => -0.10", () => {
    approx(
      calculateTreynorRatio({
        portfolioReturn: 0.04,
        riskFreeRate: 0.12,
        beta: 0.8,
      }),
      -0.1,
    );
  });
});

describe("F: negative beta accepted", () => {
  it("0.12 / 0.04 / -0.8 => -0.10", () => {
    approx(
      calculateTreynorRatio({
        portfolioReturn: 0.12,
        riskFreeRate: 0.04,
        beta: -0.8,
      }),
      -0.1,
    );
  });
});

describe("G: negative risk-free rate accepted", () => {
  it("0.08 / -0.02 / 0.8 => 0.125", () => {
    approx(
      calculateTreynorRatio({
        portfolioReturn: 0.08,
        riskFreeRate: -0.02,
        beta: 0.8,
      }),
      0.125,
    );
  });
});

describe("H: beta zero", () => {
  it("pure calculator throws deterministically (undefined)", () => {
    assert.throws(
      () =>
        calculateTreynorRatio({
          portfolioReturn: 0.12,
          riskFreeRate: 0.04,
          beta: 0,
        }),
      InvalidTreynorInputError,
    );
  });

  it("indicator returns a deterministic error, never Infinity/NaN", () => {
    const { registry } = stubBetaRegistry({ value: 0 });
    const engine = treynorEngine(registry);
    const result = engine
      .calculate({
        indicators: ["treynor"],
        context: treynorContext(annualDecimalRate(0.12), annualDecimalRate(0.04)),
      })
      .get("treynor");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.ok(!Number.isNaN(result.value));
    assert.match(result.warnings[0], /undefined when beta is zero/);
  });
});

describe("I: non-finite beta rejected", () => {
  it("pure calculator throws deterministically", () => {
    assert.throws(
      () =>
        calculateTreynorRatio({
          portfolioReturn: 0.12,
          riskFreeRate: 0.04,
          beta: NaN,
        }),
      InvalidTreynorInputError,
    );
  });

  it("indicator returns error for a non-finite ok beta", () => {
    const { registry } = stubBetaRegistry({ value: Infinity });
    const engine = treynorEngine(registry);
    const result = engine
      .calculate({
        indicators: ["treynor"],
        context: treynorContext(annualDecimalRate(0.12), annualDecimalRate(0.04)),
      })
      .get("treynor");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
  });
});

describe("J: malformed portfolio-return envelope", () => {
  it("indicator returns status error, never NaN", () => {
    const { registry } = stubBetaRegistry();
    const engine = treynorEngine(registry);
    const result = engine
      .calculate({
        indicators: ["treynor"],
        context: treynorContext(
          { rate: NaN, period: "annual", representation: "decimal" },
          annualDecimalRate(0.04),
        ),
      })
      .get("treynor");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.match(result.warnings[0], /portfolio_annual_return/);
  });
});

describe("K: malformed risk-free envelope", () => {
  it("indicator returns status error, never NaN", () => {
    const { registry } = stubBetaRegistry();
    const engine = treynorEngine(registry);
    const result = engine
      .calculate({
        indicators: ["treynor"],
        context: treynorContext(annualDecimalRate(0.12), { rate: NaN }),
      })
      .get("treynor");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.match(result.warnings[0], /risk_free_rate/);
  });
});

describe("L: wrong period => error", () => {
  it("portfolio return with daily period is rejected", () => {
    const { registry } = stubBetaRegistry();
    const engine = treynorEngine(registry);
    const result = engine
      .calculate({
        indicators: ["treynor"],
        context: treynorContext(
          { rate: 0.12, period: "daily", representation: "decimal" },
          annualDecimalRate(0.04),
        ),
      })
      .get("treynor");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
  });
});

describe("M: wrong representation => error", () => {
  it("risk-free as percentage is rejected", () => {
    const { registry } = stubBetaRegistry();
    const engine = treynorEngine(registry);
    const result = engine
      .calculate({
        indicators: ["treynor"],
        context: treynorContext(
          annualDecimalRate(0.12),
          { rate: 0.04, period: "annual", representation: "percentage" },
        ),
      })
      .get("treynor");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
  });
});

describe("N: missing portfolio-return dependency", () => {
  it("Engine returns insufficient_data with a clear warning", () => {
    const { registry } = stubBetaRegistry();
    const engine = treynorEngine(registry);
    const context = treynorContext(annualDecimalRate(0.12), annualDecimalRate(0.04));
    delete context.data[PORTFOLIO_ANNUAL_RETURN_DATA_KEY];
    const result = engine.calculate({ indicators: ["treynor"], context }).get("treynor");
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.value, null);
    assert.match(result.warnings[0], /portfolio_annual_return/);
  });
});

describe("O: missing risk-free dependency", () => {
  it("Engine returns insufficient_data with a clear warning", () => {
    const { registry } = stubBetaRegistry();
    const engine = treynorEngine(registry);
    const context = treynorContext(annualDecimalRate(0.12), annualDecimalRate(0.04));
    delete context.data[RISK_FREE_RATE_DATA_KEY];
    const result = engine.calculate({ indicators: ["treynor"], context }).get("treynor");
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.value, null);
    assert.match(result.warnings[0], /risk_free_rate/);
  });
});

describe("P: missing beta handled by the Engine", () => {
  it("an insufficient beta dependency blocks treynor", () => {
    const { registry } = stubBetaRegistry({ status: "insufficient_data", value: null });
    const engine = treynorEngine(registry);
    const result = engine
      .calculate({
        indicators: ["treynor"],
        context: treynorContext(annualDecimalRate(0.12), annualDecimalRate(0.04)),
      })
      .get("treynor");
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.value, null);
    assert.match(result.warnings[0], /Depends on insufficient indicator/);
  });
});

describe("Q: beta status non-ok prevents calculation", () => {
  it("a stale/error beta blocks treynor with a deterministic error", () => {
    for (const status of ["error", "stale_data"]) {
      const { registry } = stubBetaRegistry({ status, value: 0.8 });
      const engine = treynorEngine(registry);
      const result = engine
        .calculate({
          indicators: ["treynor"],
          context: treynorContext(annualDecimalRate(0.12), annualDecimalRate(0.04)),
        })
        .get("treynor");
      assert.equal(result.status, "error", `status ${status}`);
      assert.equal(result.value, null, `status ${status}`);
    }
  });
});

describe("R: provenance union", () => {
  it("unions beta sources + portfolio + risk-free references", () => {
    const betaSources = [
      {
        provider: "beta-provider",
        originalSource: "beta-dataset",
        identifier: "beta-series",
        observedAt: "2026-09-09T00:00:00Z",
        retrievedAt: "2026-09-10T12:00:00Z",
      },
      {
        provider: "benchmark-provider",
        originalSource: "benchmark-dataset",
        identifier: "bench-series",
        observedAt: "2026-09-09T00:00:00Z",
        retrievedAt: "2026-09-10T12:00:00Z",
      },
    ];
    const { registry } = stubBetaRegistry({
      value: 0.8,
      sources: betaSources,
    });
    const engine = treynorEngine(registry);
    const context = treynorContext(annualDecimalRate(0.12), annualDecimalRate(0.04));
    context.data[PORTFOLIO_ANNUAL_RETURN_DATA_KEY] = rateEnvelope(
      annualDecimalRate(0.12),
      {
        source: {
          provider: "portfolio-provider",
          originalSource: "portfolio-dataset",
          identifier: "portfolio-series",
        },
      },
    );
    context.data[RISK_FREE_RATE_DATA_KEY] = rateEnvelope(
      annualDecimalRate(0.04),
      {
        source: {
          provider: "rf-provider",
          originalSource: "rf-dataset",
          identifier: "rf-1",
        },
      },
    );
    const result = engine.calculate({ indicators: ["treynor"], context }).get("treynor");
    assert.equal(result.status, "ok");
    assert.equal(result.sources.length, 4);
    assert.deepEqual(
      new Set(result.sources.map((source) => source.identifier)),
      new Set(["beta-series", "bench-series", "portfolio-series", "rf-1"]),
    );
  });
});

describe("S: provenance dedupe", () => {
  it("an identical source in beta and portfolio return appears once", () => {
    const shared = {
      provider: "shared-provider",
      originalSource: "shared-dataset",
      identifier: "shared-1",
      observedAt: "2026-09-09T00:00:00Z",
      retrievedAt: "2026-09-10T12:00:00Z",
    };
    const { registry } = stubBetaRegistry({ value: 0.8, sources: [shared] });
    const engine = treynorEngine(registry);
    const context = treynorContext(annualDecimalRate(0.12), annualDecimalRate(0.04));
    context.data[PORTFOLIO_ANNUAL_RETURN_DATA_KEY] = rateEnvelope(
      annualDecimalRate(0.12),
      {
        source: {
          provider: shared.provider,
          originalSource: shared.originalSource,
          identifier: shared.identifier,
        },
        observedAt: shared.observedAt,
        retrievedAt: shared.retrievedAt,
      },
    );
    const result = engine.calculate({ indicators: ["treynor"], context }).get("treynor");
    assert.equal(result.status, "ok");
    const sharedCount = result.sources.filter(
      (source) => source.identifier === "shared-1",
    ).length;
    assert.equal(sharedCount, 1);
    assert.equal(result.sources.length, 2);
  });
});

describe("T: no provider/network/UI imports in treynor.ts", () => {
  it("does not import providers, network, React, or framework code", () => {
    const source = readRoot("lib/analytics/indicators/treynor.ts");
    const forbidden = /from ["'](next|react|app\/|@\/components)|node-fetch|fetch\(|Alpha\s*Vantage|Gemini|Supabase|localStorage|document\./i;
    assert.ok(!forbidden.test(source), "found forbidden import/reference");
  });

  it("does not invoke any provider by name", () => {
    const source = readRoot("lib/analytics/indicators/treynor.ts");
    const providerNames = /tiingo|fred|alphavantage|alpha[\s_-]*vantage/i;
    assert.ok(!providerNames.test(source), "found provider name in source");
  });

  it("is re-exported from indicators/index.ts and analytics/index.ts", () => {
    const indicatorsIndex = readRoot("lib/analytics/indicators/index.ts");
    const analyticsIndex = readRoot("lib/analytics/index.ts");
    assert.match(indicatorsIndex, /treynorIndicator/);
    assert.match(indicatorsIndex, /calculateTreynorRatio/);
    assert.match(analyticsIndex, /treynorIndicator/);
    assert.match(analyticsIndex, /calculateTreynorRatio/);
  });
});

describe("U: Sharpe known fixture stays 0.4", () => {
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

describe("V: CAPM known fixture stays 0.112", () => {
  it("1.2 / 0.04 / 0.10 => 0.112", () => {
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

describe("W: Beta pipeline stays unchanged", () => {
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

describe("X: previous test semantics stay green", () => {
  it("treynor calculation is deterministic across identical runs", () => {
    const { registry } = stubBetaRegistry({ value: 0.8 });
    const engine = treynorEngine(registry);
    const context = treynorContext(annualDecimalRate(0.12), annualDecimalRate(0.04));
    const first = engine.calculate({ indicators: ["treynor"], context }).get("treynor");
    const second = engine.calculate({ indicators: ["treynor"], context }).get("treynor");
    assert.equal(first.value, second.value);
    assert.equal(JSON.stringify(first.sources), JSON.stringify(second.sources));
  });
});

describe("Real-value fixture (deterministic, no network)", () => {
  it("AAPL scalars already validated reproduce the Treynor ratio", () => {
    const portfolioAnnualReturn = 0.3177767745150221;
    const riskFreeRate = 0.0443;
    const beta = 0.6677929239278289;
    const expected = (portfolioAnnualReturn - riskFreeRate) / beta;
    const actual = calculateTreynorRatio({
      portfolioReturn: portfolioAnnualReturn,
      riskFreeRate,
      beta,
    });
    assert.ok(Number.isFinite(actual));
    approx(actual, expected);
    approx(actual, 0.4095233188553191, 1e-12);
  });

  it("runs end-to-end through the engine with the real scalars", () => {
    const { registry } = stubBetaRegistry({ value: 0.6677929239278289 });
    const engine = treynorEngine(registry);
    const result = engine
      .calculate({
        indicators: ["treynor"],
        context: treynorContext(
          annualDecimalRate(0.3177767745150221),
          annualDecimalRate(0.0443),
        ),
      })
      .get("treynor");
    assert.equal(result.status, "ok");
    assert.ok(Number.isFinite(result.value));
    approx(result.value, 0.4095233188553191, 1e-12);
  });
});