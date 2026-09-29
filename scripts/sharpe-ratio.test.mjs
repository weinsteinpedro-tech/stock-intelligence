/* Sharpe Ratio V1 indicator tests (no network).                              */
/*                                                                            */
/* Run via `npm run test:static` (compiles lib/analytics to .testbuild,       */
/* then node --test this file).                                               */
/*                                                                            */
/* Coverage map (A-W):                                                        */
/*   A  sharpeIndicator metadata is correct                                   */
/*   B  dependencies are the three data keys, no indicator deps               */
/*   C  pure calculator known case: 0.12 / 0.04 / 0.20 => 0.4                 */
/*   D  zero excess return => 0                                               */
/*   E  negative Sharpe works                                                 */
/*   F  negative risk-free rate is accepted                                   */
/*   G  malformed portfolio return => error, never NaN                        */
/*   H  malformed risk-free rate => error                                     */
/*   I  malformed volatility => error                                         */
/*   J  negative volatility => error                                          */
/*   K  zero volatility => no Infinity/NaN, status deterministic              */
/*   L  period !== annual => error                                            */
/*   M  representation !== decimal => error                                   */
/*   N  missing portfolio-return dependency handled by the Engine             */
/*   O  missing risk-free dependency handled by the Engine                    */
/*   P  missing volatility dependency handled by the Engine                   */
/*   Q  provenance unions portfolio + risk-free + volatility                  */
/*   R  identical provenance is deduplicated deterministically                */
/*   S  result is dimensionless / units null                                  */
/*   T  no provider/network/UI imports in sharpe.ts                           */
/*   U  CAPM known result unchanged                                           */
/*   V  known Beta pipeline unchanged                                         */
/*   W  previous tests keep their semantics (deterministic runs)              */
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
  IndicatorRegistry,
  InvalidSharpeInputError,
  PORTFOLIO_ANNUAL_RETURN_DATA_KEY,
  PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY,
  RISK_FREE_RATE_DATA_KEY,
  sharpeIndicator,
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

function annualDecimalVolatility(volatility) {
  return { volatility, period: "annual", representation: "decimal" };
}

function envelope(value, overrides = {}) {
  return {
    value,
    provider: "envelope-provider",
    overrideProvider: null,
    source: overrides.source ?? {
      provider: "sharpe-provider",
      originalSource: "sharpe-dataset",
      identifier: "default-1",
    },
    observedAt: overrides.observedAt ?? "2026-09-10T00:00:00Z",
    retrievedAt: overrides.retrievedAt ?? "2026-09-10T12:00:00Z",
    frequency: overrides.frequency ?? "annual",
    quality: makeQuality(),
  };
}

function sharpeContext(portfolio, riskFree, volatility) {
  return {
    data: {
      [PORTFOLIO_ANNUAL_RETURN_DATA_KEY]: envelope(portfolio),
      [RISK_FREE_RATE_DATA_KEY]: envelope(riskFree),
      [PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY]: envelope(volatility),
    },
    indicators: new Map(),
    asOf: "2026-09-10",
  };
}

function sharpeEngine() {
  const registry = new IndicatorRegistry();
  registry.register(sharpeIndicator);
  return new AnalyticsEngine(registry);
}

describe("A: sharpeIndicator metadata is correct", () => {
  it("exposes id, name, version, category and full metadata", () => {
    assert.equal(sharpeIndicator.id, "sharpe");
    assert.equal(sharpeIndicator.name, "Sharpe Ratio");
    assert.equal(sharpeIndicator.version, "1.0.0");
    assert.equal(sharpeIndicator.category, "risk-adjusted-return");
    assert.equal(sharpeIndicator.metadata.units, null);
    assert.equal(
      sharpeIndicator.metadata.description,
      "Risk-adjusted return measured as annual portfolio excess return divided by annualized portfolio volatility.",
    );
    assert.equal(
      sharpeIndicator.metadata.methodology,
      "Annual portfolio return minus annual risk-free rate, divided by annualized portfolio volatility.",
    );
    assert.equal(sharpeIndicator.metadata.formula, "Sharpe = (Rp - Rf) / σp");
  });
});

describe("B: sharpeIndicator dependencies are correct", () => {
  it("declares the three data keys and no indicator deps", () => {
    assert.deepEqual(
      [...sharpeIndicator.dependencies.data],
      [
        PORTFOLIO_ANNUAL_RETURN_DATA_KEY,
        RISK_FREE_RATE_DATA_KEY,
        PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY,
      ],
    );
    assert.deepEqual([...sharpeIndicator.dependencies.indicators], []);
  });

  it("exports data keys with expected string values", () => {
    assert.equal(PORTFOLIO_ANNUAL_RETURN_DATA_KEY, "portfolio_annual_return");
    assert.equal(
      PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY,
      "portfolio_annualized_volatility",
    );
    assert.equal(RISK_FREE_RATE_DATA_KEY, "risk_free_rate");
  });
});

describe("C: pure calculator known case", () => {
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

describe("D: zero excess return", () => {
  it("0.04 / 0.04 / 0.20 => 0", () => {
    assert.equal(
      calculateSharpeRatio({
        portfolioReturn: 0.04,
        riskFreeRate: 0.04,
        portfolioVolatility: 0.2,
      }),
      0,
    );
  });
});

describe("E: negative Sharpe works", () => {
  it("-0.10 / 0.04 / 0.20 => -0.7", () => {
    approx(
      calculateSharpeRatio({
        portfolioReturn: -0.1,
        riskFreeRate: 0.04,
        portfolioVolatility: 0.2,
      }),
      -0.7,
    );
  });
});

describe("F: negative risk-free rate is accepted", () => {
  it("0.08 / -0.02 / 0.20 => 0.5", () => {
    approx(
      calculateSharpeRatio({
        portfolioReturn: 0.08,
        riskFreeRate: -0.02,
        portfolioVolatility: 0.2,
      }),
      0.5,
    );
  });
});

describe("G: malformed portfolio return", () => {
  it("pure calculator throws deterministically for non-finite", () => {
    assert.throws(
      () =>
        calculateSharpeRatio({
          portfolioReturn: NaN,
          riskFreeRate: 0.04,
          portfolioVolatility: 0.2,
        }),
      InvalidSharpeInputError,
    );
  });

  it("indicator returns status error, never NaN or Infinity", () => {
    const engine = sharpeEngine();
    const result = engine
      .calculate({
        indicators: ["sharpe"],
        context: sharpeContext(
          annualDecimalRate(NaN),
          annualDecimalRate(0.04),
          annualDecimalVolatility(0.2),
        ),
      })
      .get("sharpe");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.match(result.warnings[0], /portfolio_annual_return/);
  });
});

describe("H: malformed risk-free rate", () => {
  it("indicator returns status error, never NaN or Infinity", () => {
    const engine = sharpeEngine();
    const result = engine
      .calculate({
        indicators: ["sharpe"],
        context: sharpeContext(
          annualDecimalRate(0.12),
          { rate: NaN, period: "annual", representation: "decimal" },
          annualDecimalVolatility(0.2),
        ),
      })
      .get("sharpe");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.match(result.warnings[0], /risk_free_rate/);
  });
});

describe("I: malformed volatility", () => {
  it("pure calculator throws deterministically for non-finite", () => {
    assert.throws(
      () =>
        calculateSharpeRatio({
          portfolioReturn: 0.12,
          riskFreeRate: 0.04,
          portfolioVolatility: Infinity,
        }),
      InvalidSharpeInputError,
    );
  });

  it("indicator returns status error, never NaN or Infinity", () => {
    const engine = sharpeEngine();
    const result = engine
      .calculate({
        indicators: ["sharpe"],
        context: sharpeContext(
          annualDecimalRate(0.12),
          annualDecimalRate(0.04),
          { volatility: NaN, period: "annual", representation: "decimal" },
        ),
      })
      .get("sharpe");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.match(result.warnings[0], /portfolio_annualized_volatility/);
  });
});

describe("J: negative volatility", () => {
  it("pure calculator throws deterministically", () => {
    assert.throws(
      () =>
        calculateSharpeRatio({
          portfolioReturn: 0.12,
          riskFreeRate: 0.04,
          portfolioVolatility: -0.2,
        }),
      InvalidSharpeInputError,
    );
  });

  it("indicator returns status error with a clear warning", () => {
    const engine = sharpeEngine();
    const result = engine
      .calculate({
        indicators: ["sharpe"],
        context: sharpeContext(
          annualDecimalRate(0.12),
          annualDecimalRate(0.04),
          annualDecimalVolatility(-0.2),
        ),
      })
      .get("sharpe");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.match(result.warnings[0], /undefined/);
  });
});

describe("K: zero volatility", () => {
  it("pure calculator throws deterministically (Sharpe undefined)", () => {
    assert.throws(
      () =>
        calculateSharpeRatio({
          portfolioReturn: 0.12,
          riskFreeRate: 0.04,
          portfolioVolatility: 0,
        }),
      InvalidSharpeInputError,
    );
  });

  it("indicator never returns Infinity/NaN; status is deterministic", () => {
    const engine = sharpeEngine();
    const result = engine
      .calculate({
        indicators: ["sharpe"],
        context: sharpeContext(
          annualDecimalRate(0.12),
          annualDecimalRate(0.04),
          annualDecimalVolatility(0),
        ),
      })
      .get("sharpe");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.ok(!Number.isNaN(result.value));
  });
});

describe("L: period !== annual", () => {
  it("portfolio return with daily period => error", () => {
    const engine = sharpeEngine();
    const result = engine
      .calculate({
        indicators: ["sharpe"],
        context: sharpeContext(
          { rate: 0.12, period: "daily", representation: "decimal" },
          annualDecimalRate(0.04),
          annualDecimalVolatility(0.2),
        ),
      })
      .get("sharpe");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
  });

  it("volatility with daily period => error", () => {
    const engine = sharpeEngine();
    const result = engine
      .calculate({
        indicators: ["sharpe"],
        context: sharpeContext(
          annualDecimalRate(0.12),
          annualDecimalRate(0.04),
          { volatility: 0.2, period: "daily", representation: "decimal" },
        ),
      })
      .get("sharpe");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
  });
});

describe("M: representation !== decimal", () => {
  it("portfolio return as percentage => error", () => {
    const engine = sharpeEngine();
    const result = engine
      .calculate({
        indicators: ["sharpe"],
        context: sharpeContext(
          { rate: 0.12, period: "annual", representation: "percentage" },
          annualDecimalRate(0.04),
          annualDecimalVolatility(0.2),
        ),
      })
      .get("sharpe");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
  });

  it("risk-free as percentage => error", () => {
    const engine = sharpeEngine();
    const result = engine
      .calculate({
        indicators: ["sharpe"],
        context: sharpeContext(
          annualDecimalRate(0.12),
          { rate: 0.04, period: "annual", representation: "percentage" },
          annualDecimalVolatility(0.2),
        ),
      })
      .get("sharpe");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
  });
});

describe("N: missing portfolio-return dependency", () => {
  it("Engine returns insufficient_data with a clear warning", () => {
    const engine = sharpeEngine();
    const context = sharpeContext(
      annualDecimalRate(0.12),
      annualDecimalRate(0.04),
      annualDecimalVolatility(0.2),
    );
    delete context.data[PORTFOLIO_ANNUAL_RETURN_DATA_KEY];
    const result = engine.calculate({ indicators: ["sharpe"], context }).get("sharpe");
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.value, null);
    assert.match(result.warnings[0], /Missing data input/);
    assert.match(result.warnings[0], /portfolio_annual_return/);
  });
});

describe("O: missing risk-free dependency", () => {
  it("Engine returns insufficient_data with a clear warning", () => {
    const engine = sharpeEngine();
    const context = sharpeContext(
      annualDecimalRate(0.12),
      annualDecimalRate(0.04),
      annualDecimalVolatility(0.2),
    );
    delete context.data[RISK_FREE_RATE_DATA_KEY];
    const result = engine.calculate({ indicators: ["sharpe"], context }).get("sharpe");
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.value, null);
    assert.match(result.warnings[0], /risk_free_rate/);
  });
});

describe("P: missing volatility dependency", () => {
  it("Engine returns insufficient_data with a clear warning", () => {
    const engine = sharpeEngine();
    const context = sharpeContext(
      annualDecimalRate(0.12),
      annualDecimalRate(0.04),
      annualDecimalVolatility(0.2),
    );
    delete context.data[PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY];
    const result = engine.calculate({ indicators: ["sharpe"], context }).get("sharpe");
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.value, null);
    assert.match(result.warnings[0], /portfolio_annualized_volatility/);
  });
});

describe("Q: provenance union", () => {
  it("unions portfolio + risk-free + volatility sources with correct values", () => {
    const engine = sharpeEngine();
    const context = {
      data: {
        [PORTFOLIO_ANNUAL_RETURN_DATA_KEY]: envelope(annualDecimalRate(0.12), {
          source: {
            provider: "pf-provider",
            originalSource: "pf-dataset",
            identifier: "pf-1",
          },
          observedAt: "2026-01-01T00:00:00Z",
          retrievedAt: "2026-01-01T12:00:00Z",
        }),
        [RISK_FREE_RATE_DATA_KEY]: envelope(annualDecimalRate(0.04), {
          source: {
            provider: "rf-provider",
            originalSource: "rf-dataset",
            identifier: "rf-1",
          },
          observedAt: "2026-01-02T00:00:00Z",
          retrievedAt: "2026-01-02T12:00:00Z",
        }),
        [PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY]: envelope(
          annualDecimalVolatility(0.2),
          {
            source: {
              provider: "vol-provider",
              originalSource: "vol-dataset",
              identifier: "vol-1",
            },
            observedAt: "2026-01-03T00:00:00Z",
            retrievedAt: "2026-01-03T12:00:00Z",
          },
        ),
      },
      indicators: new Map(),
      asOf: "2026-09-10",
    };
    const result = engine.calculate({ indicators: ["sharpe"], context }).get("sharpe");
    assert.equal(result.status, "ok");
    assert.equal(result.sources.length, 3);
    assert.deepEqual(
      new Set(result.sources.map((source) => source.identifier)),
      new Set(["pf-1", "rf-1", "vol-1"]),
    );
  });
});

describe("R: provenance dedupe", () => {
  it("identical portfolio and volatility provenance dedupes to 2 sources", () => {
    const engine = sharpeEngine();
    const shared = {
      source: {
        provider: "shared-provider",
        originalSource: "shared-dataset",
        identifier: "shared-1",
      },
      observedAt: "2026-01-01T00:00:00Z",
      retrievedAt: "2026-01-01T12:00:00Z",
    };
    const context = {
      data: {
        [PORTFOLIO_ANNUAL_RETURN_DATA_KEY]: envelope(
          annualDecimalRate(0.12),
          shared,
        ),
        [RISK_FREE_RATE_DATA_KEY]: envelope(annualDecimalRate(0.04), {
          source: {
            provider: "rf-provider",
            originalSource: "rf-dataset",
            identifier: "rf-1",
          },
          observedAt: "2026-01-02T00:00:00Z",
          retrievedAt: "2026-01-02T12:00:00Z",
        }),
        [PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY]: envelope(
          annualDecimalVolatility(0.2),
          shared,
        ),
      },
      indicators: new Map(),
      asOf: "2026-09-10",
    };
    const result = engine.calculate({ indicators: ["sharpe"], context }).get("sharpe");
    assert.equal(result.status, "ok");
    assert.equal(result.sources.length, 2);
    assert.deepEqual(
      new Set(result.sources.map((source) => source.identifier)),
      new Set(["shared-1", "rf-1"]),
    );
  });
});

describe("S: result is dimensionless / units null", () => {
  it("metadata units are null and the engine result value is a plain number", () => {
    const engine = sharpeEngine();
    const result = engine
      .calculate({
        indicators: ["sharpe"],
        context: sharpeContext(
          annualDecimalRate(0.12),
          annualDecimalRate(0.04),
          annualDecimalVolatility(0.2),
        ),
      })
      .get("sharpe");
    assert.equal(sharpeIndicator.metadata.units, null);
    assert.equal(typeof result.value, "number");
    approx(result.value, 0.4);
  });
});

describe("T: no provider/network/UI imports in sharpe.ts", () => {
  it("does not import providers, network, React, or framework code", () => {
    const source = readRoot("lib/analytics/indicators/sharpe.ts");
    const forbidden = /from ["'](next|react|app\/|@\/components)|node-fetch|fetch\(|Alpha\s*Vantage|Gemini|Supabase|localStorage|document\./i;
    assert.ok(!forbidden.test(source), "found forbidden import/reference");
  });

  it("does not invoke any provider by name", () => {
    const source = readRoot("lib/analytics/indicators/sharpe.ts");
    const providerNames = /tiingo|fred|alphavantage|alpha[\s_-]*vantage/i;
    assert.ok(!providerNames.test(source), "found provider name in source");
  });

  it("is re-exported from indicators/index.ts and analytics/index.ts", () => {
    const indicatorsIndex = readRoot("lib/analytics/indicators/index.ts");
    const analyticsIndex = readRoot("lib/analytics/index.ts");
    assert.match(indicatorsIndex, /sharpeIndicator/);
    assert.match(indicatorsIndex, /calculateSharpeRatio/);
    assert.match(indicatorsIndex, /PORTFOLIO_ANNUAL_RETURN_DATA_KEY/);
    assert.match(analyticsIndex, /sharpeIndicator/);
    assert.match(analyticsIndex, /calculateSharpeRatio/);
    assert.match(
      analyticsIndex,
      /PORTFOLIO_ANNUALIZED_VOLATILITY_DATA_KEY/,
    );
  });
});

describe("U: CAPM known result unchanged", () => {
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

describe("V: known Beta pipeline unchanged", () => {
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

describe("W: previous tests keep their semantics", () => {
  it("sharpe calculation is deterministic across identical runs", () => {
    const engine = sharpeEngine();
    const context = sharpeContext(
      annualDecimalRate(0.12),
      annualDecimalRate(0.04),
      annualDecimalVolatility(0.2),
    );
    const first = engine.calculate({ indicators: ["sharpe"], context }).get("sharpe");
    const second = engine.calculate({ indicators: ["sharpe"], context }).get("sharpe");
    assert.equal(first.value, second.value);
    deepEqualSources(first.sources, second.sources);
  });
});

function deepEqualSources(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}