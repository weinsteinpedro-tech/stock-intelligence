/* Beta indicator tests (no network).                                      */
/*                                                                          */
/* Run via `npm run test:static` (compiles lib/analytics +                 */
/* lib/financial-data to .testbuild, then node --test this file).           */
/*                                                                          */
/* Coverage map (A-W):                                                      */
/*   A  indicator metadata correct                                          */
/*   B  units === null                                                      */
/*   C  category === "risk"                                                 */
/*   D  dependencies include portfolio_returns and benchmark_returns        */
/*   E  known proportional case => beta 2                                   */
/*   F  aligned dates only                                                  */
/*   G  unsorted ReturnSeries still works through normalization             */
/*   H  extra dates in one series ignored                                   */
/*   I  <2 aligned observations => insufficient_data                        */
/*   J  zero benchmark variance => insufficient_data (incl. section 15)     */
/*   K  mismatched frequencies => insufficient_data                         */
/*   L  missing portfolio_returns handled by Engine                         */
/*   M  missing benchmark_returns handled by Engine                         */
/*   N  malformed ReturnSeries never produces NaN/Infinity                  */
/*   O  sources preserve portfolio provenance                               */
/*   P  sources preserve benchmark provenance                               */
/*   Q  identical source references deduplicated                            */
/*   R  dataWindow observations correct                                     */
/*   S  dataWindow startDate/endDate correct                                */
/*   T  engine calculates beta through IndicatorRegistry                    */
/*   U  no benchmark name (SPY/S&P/Nasdaq) hardcoded                        */
/*   V  no network/provider/UI imports                                      */
/*   W  previous tests remain green (deterministic engine runs)             */
/* ------------------------------------------------------------------------ */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AnalyticsEngine,
  BENCHMARK_RETURNS_DATA_KEY,
  betaIndicator,
  calculateBetaFromReturns,
  IndicatorRegistry,
  PORTFOLIO_RETURNS_DATA_KEY,
} from "../.testbuild/analytics/index.js";

import { makeDataQuality } from "../.testbuild/financial-data/quality.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRoot(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

const AS_OF = "2026-09-10";

function approx(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} ≈ ${expected} (epsilon ${epsilon})`,
  );
}

function returnSeries(assetId, points) {
  return { assetId, points };
}

function returnsEnvelope(value, overrides = {}) {
  return {
    value,
    source: {
      provider: "test-provider",
      originalSource: "test-original",
      identifier: "series-1",
    },
    observedAt: "2026-09-10T00:00:00Z",
    retrievedAt: "2026-09-10T12:00:00Z",
    frequency: "daily",
    quality: makeDataQuality({
      freshness: "fresh",
      sourceTier: "licensed",
      completeness: 1,
    }),
    ...overrides,
  };
}

function makeContext(data) {
  return { data, indicators: new Map(), asOf: AS_OF };
}

function betaEngine() {
  const registry = new IndicatorRegistry();
  registry.register(betaIndicator);
  return new AnalyticsEngine(registry);
}

function proportionalSets() {
  const benchmarkPoints = [
    { date: "2026-09-08", value: 0.01 },
    { date: "2026-09-09", value: 0.02 },
    { date: "2026-09-10", value: -0.01 },
    { date: "2026-09-11", value: 0.03 },
  ];
  const portfolioPoints = benchmarkPoints.map((point) => ({
    date: point.date,
    value: point.value * 2,
  }));
  return {
    portfolio: returnSeries("portfolio", portfolioPoints),
    benchmark: returnSeries("benchmark", benchmarkPoints),
  };
}

describe("A: betaIndicator metadata is correct", () => {
  it("exposes id, name, version and descriptive metadata", () => {
    assert.equal(betaIndicator.id, "beta");
    assert.equal(betaIndicator.name, "Beta");
    assert.equal(betaIndicator.version, "1.0.0");
    assert.equal(
      betaIndicator.metadata.description,
      "Sensitivity of portfolio returns to benchmark returns.",
    );
    assert.equal(
      betaIndicator.metadata.methodology,
      "Sample covariance of aligned portfolio and benchmark returns divided by sample variance of benchmark returns.",
    );
    assert.equal(betaIndicator.metadata.formula, "β = Cov(Rp, Rm) / Var(Rm)");
  });
});

describe("B: units is null", () => {
  it("a beta ratio has no units", () => {
    assert.equal(betaIndicator.metadata.units, null);
  });
});

describe("C: category is risk", () => {
  it("beta belongs to the risk category", () => {
    assert.equal(betaIndicator.category, "risk");
  });
});

describe("D: data dependencies include both return keys", () => {
  it("declares portfolio_returns and benchmark_returns", () => {
    assert.deepEqual(betaIndicator.dependencies.data, [
      PORTFOLIO_RETURNS_DATA_KEY,
      BENCHMARK_RETURNS_DATA_KEY,
    ]);
    assert.equal(PORTFOLIO_RETURNS_DATA_KEY, "portfolio_returns");
    assert.equal(BENCHMARK_RETURNS_DATA_KEY, "benchmark_returns");
  });
});

describe("E: known proportional case => beta 2", () => {
  it("portfolio = 2 x benchmark produces beta 2", () => {
    const { portfolio, benchmark } = proportionalSets();
    const result = calculateBetaFromReturns(portfolio, benchmark);
    assert.equal(result.status, "ok");
    approx(result.value, 2);
  });
});

describe("F: aligned dates only", () => {
  it("uses only common dates (Sep 8 and Sep 10)", () => {
    const portfolio = returnSeries("portfolio", [
      { date: "2026-09-08", value: 0.1 },
      { date: "2026-09-09", value: 0.2 },
      { date: "2026-09-10", value: 0.3 },
    ]);
    const benchmark = returnSeries("benchmark", [
      { date: "2026-09-08", value: 0.01 },
      { date: "2026-09-10", value: 0.02 },
      { date: "2026-09-11", value: 0.03 },
    ]);
    const result = calculateBetaFromReturns(portfolio, benchmark);
    assert.equal(result.status, "ok");
    assert.equal(result.observations, 2);
    assert.equal(result.startDate, "2026-09-08");
    assert.equal(result.endDate, "2026-09-10");
  });
});

describe("G: unsorted ReturnSeries still works through normalization", () => {
  it("reorders unsorted inputs before aligning", () => {
    const sorted = proportionalSets();
    const unsorted = {
      portfolio: returnSeries("portfolio", sorted.portfolio.points.slice().reverse()),
      benchmark: returnSeries("benchmark", sorted.benchmark.points.slice().reverse()),
    };
    const a = calculateBetaFromReturns(sorted.portfolio, sorted.benchmark);
    const b = calculateBetaFromReturns(unsorted.portfolio, unsorted.benchmark);
    assert.equal(a.observations, b.observations);
    approx(a.value, b.value);
    approx(b.value, 2);
  });
});

describe("H: extra dates in one series are ignored", () => {
  it("only the intersection participates", () => {
    const { portfolio, benchmark } = proportionalSets();
    const extra = portfolio.points.slice();
    extra.push({ date: "2026-09-14", value: 0.08 });
    const result = calculateBetaFromReturns(
      returnSeries("portfolio", extra),
      benchmark,
    );
    assert.equal(result.status, "ok");
    assert.equal(result.observations, 4);
    approx(result.value, 2);
  });
});

describe("I: <2 aligned observations => insufficient_data", () => {
  it("returns value null with a descriptive warning", () => {
    const portfolio = returnSeries("portfolio", [
      { date: "2026-09-08", value: 0.1 },
      { date: "2026-09-09", value: 0.2 },
    ]);
    const benchmark = returnSeries("benchmark", [
      { date: "2026-09-08", value: 0.01 },
    ]);
    const result = calculateBetaFromReturns(portfolio, benchmark);
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.value, null);
    assert.equal(result.observations, 1);
    assert.ok(result.reason.includes("aligned observations"));
  });
});

describe("J: zero benchmark variance => insufficient_data", () => {
  it("constant benchmark returns lead to no beta (section 15 edge case)", () => {
    const portfolio = returnSeries("portfolio", [
      { date: "2026-09-08", value: 0.1 },
      { date: "2026-09-09", value: 0.2 },
      { date: "2026-09-10", value: 0.3 },
    ]);
    const benchmark = returnSeries("benchmark", [
      { date: "2026-09-08", value: 0.01 },
      { date: "2026-09-09", value: 0.01 },
      { date: "2026-09-10", value: 0.01 },
    ]);
    const result = calculateBetaFromReturns(portfolio, benchmark);
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.value, null);
    assert.ok(result.reason.includes("Benchmark variance is zero or unavailable"));
    assert.notEqual(result.value, 0);
    assert.equal(Number.isNaN(result.value), false);
    assert.notEqual(result.value, Number.POSITIVE_INFINITY);
    assert.notEqual(result.value, Number.NEGATIVE_INFINITY);
  });
});

describe("K: mismatched frequencies => insufficient_data", () => {
  it("port daily vs benchmark weekly never computes", () => {
    const { portfolio, benchmark } = proportionalSets();
    const engine = betaEngine();
    const results = engine.calculate({
      indicators: ["beta"],
      context: makeContext({
        [PORTFOLIO_RETURNS_DATA_KEY]: returnsEnvelope(portfolio),
        [BENCHMARK_RETURNS_DATA_KEY]: returnsEnvelope(benchmark, {
          frequency: "weekly",
        }),
      }),
    });
    const result = results.get("beta");
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.value, null);
    assert.ok(
      result.warnings.some((warning) => warning.includes("Frequencies do not match")),
    );
  });
});

describe("L: missing portfolio_returns handled by Engine", () => {
  it("sin portfolio => insufficient_data warning names the key", () => {
    const { benchmark } = proportionalSets();
    const engine = betaEngine();
    const results = engine.calculate({
      indicators: ["beta"],
      context: makeContext({
        [BENCHMARK_RETURNS_DATA_KEY]: returnsEnvelope(benchmark),
      }),
    });
    const result = results.get("beta");
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.value, null);
    assert.ok(result.warnings.some((warning) => warning.includes("portfolio_returns")));
  });
});

describe("M: missing benchmark_returns handled by Engine", () => {
  it("sin benchmark => insufficient_data warning names the key", () => {
    const { portfolio } = proportionalSets();
    const engine = betaEngine();
    const results = engine.calculate({
      indicators: ["beta"],
      context: makeContext({
        [PORTFOLIO_RETURNS_DATA_KEY]: returnsEnvelope(portfolio),
      }),
    });
    const result = results.get("beta");
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.value, null);
    assert.ok(result.warnings.some((warning) => warning.includes("benchmark_returns")));
  });
});

describe("N: malformed ReturnSeries never produces NaN/Infinity", () => {
  it("NaN point values surface as a deterministic error result", () => {
    const portfolio = returnSeries("portfolio", [
      { date: "2026-09-08", value: Number.NaN },
      { date: "2026-09-09", value: 0.2 },
    ]);
    const { benchmark } = proportionalSets();
    const engine = betaEngine();
    const results = engine.calculate({
      indicators: ["beta"],
      context: makeContext({
        [PORTFOLIO_RETURNS_DATA_KEY]: returnsEnvelope(portfolio),
        [BENCHMARK_RETURNS_DATA_KEY]: returnsEnvelope(benchmark),
      }),
    });
    const result = results.get("beta");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.equal(Number.isNaN(result.value), false);
    assert.notEqual(result.value, Number.POSITIVE_INFINITY);
    assert.notEqual(result.value, Number.NEGATIVE_INFINITY);
  });

  it("a value that is not a ReturnSeries at all is rejected", () => {
    const engine = betaEngine();
    const results = engine.calculate({
      indicators: ["beta"],
      context: makeContext({
        [PORTFOLIO_RETURNS_DATA_KEY]: returnsEnvelope({ assetId: 1 }),
        [BENCHMARK_RETURNS_DATA_KEY]: returnsEnvelope({ assetId: 2 }),
      }),
    });
    const result = results.get("beta");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.ok(result.warnings.some((warning) => warning.includes("ReturnSeries")));
  });
});

describe("O: sources preserve portfolio provenance", () => {
  it("the portfolio reference keeps provider/originalSource/identifier/timestamps", () => {
    const { portfolio, benchmark } = proportionalSets();
    const engine = betaEngine();
    const portfolioEnvelope = returnsEnvelope(portfolio, {
      source: {
        provider: "provider-portfolio",
        originalSource: "portfolio-dataset",
        identifier: "pf-1",
      },
      observedAt: "2026-09-10T00:00:00Z",
      retrievedAt: "2026-09-10T13:00:00Z",
    });
    const results = engine.calculate({
      indicators: ["beta"],
      context: makeContext({
        [PORTFOLIO_RETURNS_DATA_KEY]: portfolioEnvelope,
        [BENCHMARK_RETURNS_DATA_KEY]: returnsEnvelope(benchmark),
      }),
    });
    const result = results.get("beta");
    assert.ok(
      result.sources.some(
        (source) =>
          source.provider === "provider-portfolio" &&
          source.originalSource === "portfolio-dataset" &&
          source.identifier === "pf-1" &&
          source.observedAt === "2026-09-10T00:00:00Z" &&
          source.retrievedAt === "2026-09-10T13:00:00Z",
      ),
    );
  });
});

describe("P: sources preserve benchmark provenance", () => {
  it("the benchmark reference keeps its own provenance", () => {
    const { portfolio, benchmark } = proportionalSets();
    const engine = betaEngine();
    const benchmarkEnvelope = returnsEnvelope(benchmark, {
      source: {
        provider: "provider-benchmark",
        originalSource: "benchmark-dataset",
        identifier: "bm-1",
      },
      observedAt: "2026-09-10T08:00:00Z",
      retrievedAt: "2026-09-10T14:00:00Z",
    });
    const results = engine.calculate({
      indicators: ["beta"],
      context: makeContext({
        [PORTFOLIO_RETURNS_DATA_KEY]: returnsEnvelope(portfolio),
        [BENCHMARK_RETURNS_DATA_KEY]: benchmarkEnvelope,
      }),
    });
    const result = results.get("beta");
    assert.ok(
      result.sources.some(
        (source) =>
          source.provider === "provider-benchmark" &&
          source.originalSource === "benchmark-dataset" &&
          source.identifier === "bm-1" &&
          source.observedAt === "2026-09-10T08:00:00Z" &&
          source.retrievedAt === "2026-09-10T14:00:00Z",
      ),
    );
  });
});

describe("Q: identical source references are deduplicated", () => {
  it("both envelopes from the same source produce a single reference", () => {
    const { portfolio, benchmark } = proportionalSets();
    const engine = betaEngine();
    const shared = {
      provider: "provider-shared",
      originalSource: "shared-dataset",
      identifier: "all-series",
    };
    const results = engine.calculate({
      indicators: ["beta"],
      context: makeContext({
        [PORTFOLIO_RETURNS_DATA_KEY]: returnsEnvelope(portfolio, {
          source: shared,
          observedAt: "2026-09-10T00:00:00Z",
          retrievedAt: "2026-09-10T12:00:00Z",
        }),
        [BENCHMARK_RETURNS_DATA_KEY]: returnsEnvelope(benchmark, {
          source: shared,
          observedAt: "2026-09-10T00:00:00Z",
          retrievedAt: "2026-09-10T12:00:00Z",
        }),
      }),
    });
    const result = results.get("beta");
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].provider, "provider-shared");
  });
});

describe("R: dataWindow observations is correct", () => {
  it("successful beta counts the aligned observations", () => {
    const { portfolio, benchmark } = proportionalSets();
    const engine = betaEngine();
    const results = engine.calculate({
      indicators: ["beta"],
      context: makeContext({
        [PORTFOLIO_RETURNS_DATA_KEY]: returnsEnvelope(portfolio),
        [BENCHMARK_RETURNS_DATA_KEY]: returnsEnvelope(benchmark),
      }),
    });
    const result = results.get("beta");
    assert.equal(result.dataWindow.observations, 4);
  });
});

describe("S: dataWindow startDate/endDate are correct", () => {
  it("reports the first and last aligned date", () => {
    const { portfolio, benchmark } = proportionalSets();
    const engine = betaEngine();
    const results = engine.calculate({
      indicators: ["beta"],
      context: makeContext({
        [PORTFOLIO_RETURNS_DATA_KEY]: returnsEnvelope(portfolio),
        [BENCHMARK_RETURNS_DATA_KEY]: returnsEnvelope(benchmark),
      }),
    });
    const result = results.get("beta");
    assert.equal(result.dataWindow.startDate, "2026-09-08");
    assert.equal(result.dataWindow.endDate, "2026-09-11");
  });
});

describe("T: engine calculates beta through IndicatorRegistry", () => {
  it("registers betaIndicator and resolves it by id", () => {
    const { portfolio, benchmark } = proportionalSets();
    const engine = betaEngine();
    const results = engine.calculate({
      indicators: ["beta"],
      context: makeContext({
        [PORTFOLIO_RETURNS_DATA_KEY]: returnsEnvelope(portfolio),
        [BENCHMARK_RETURNS_DATA_KEY]: returnsEnvelope(benchmark),
      }),
    });
    const result = results.get("beta");
    assert.equal(result.status, "ok");
    assert.equal(result.name, "Beta");
    assert.equal(result.id, "beta");
    approx(result.value, 2);
    assert.equal(result.dataWindow.observations, 4);
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].provider, "test-provider");
  });
});

describe("U: no benchmark name (SPY/S&P/Nasdaq) hardcoded", () => {
  it("the beta source never names a specific index", () => {
    const source = readRoot("lib/analytics/indicators/beta.ts");
    assert.equal(/SPY/i.test(source), false);
    assert.equal(/S\s*&\s*P/i.test(source), false);
    assert.equal(/Nasdaq/i.test(source), false);
  });
});

describe("V: no network/provider/UI imports", () => {
  const files = [
    "lib/analytics/indicators/beta.ts",
    "lib/analytics/indicators/index.ts",
    "lib/analytics/index.ts",
  ];
  const forbidden = [
    /from ["']next\//,
    /from ["']react\/?["']/,
    /from ["']app\//,
    /\"@\/components\//,
    /alpha[_\s-]?vantage/i,
    /gemini/i,
    /supabase/i,
    /node-fetch/,
    /market-data/,
  ];
  it("beta sources stay inside the analytics boundary", () => {
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

describe("W: previous tests remain green (deterministic engine runs)", () => {
  it("two calculate() invocations produce identical beta results", () => {
    const { portfolio, benchmark } = proportionalSets();
    const engine = betaEngine();
    const run = () =>
      engine.calculate({
        indicators: ["beta"],
        context: makeContext({
          [PORTFOLIO_RETURNS_DATA_KEY]: returnsEnvelope(portfolio),
          [BENCHMARK_RETURNS_DATA_KEY]: returnsEnvelope(benchmark),
        }),
      });
    assert.equal(
      JSON.stringify(Object.fromEntries(run())),
      JSON.stringify(Object.fromEntries(run())),
    );
  });

  it("the pure calculator and the engine agree on the famous case", () => {
    const { portfolio, benchmark } = proportionalSets();
    const pure = calculateBetaFromReturns(portfolio, benchmark);
    const engine = betaEngine();
    const result = engine
      .calculate({
        indicators: ["beta"],
        context: makeContext({
          [PORTFOLIO_RETURNS_DATA_KEY]: returnsEnvelope(portfolio),
          [BENCHMARK_RETURNS_DATA_KEY]: returnsEnvelope(benchmark),
        }),
      })
      .get("beta");
    approx(result.value, pure.value);
  });
});