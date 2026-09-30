/* Static + unit tests for the Analytics Engine subsystem (V1).         */
/*                                                                       */
/* Run via `npm run test:static` (compiles lib/analytics +               */
/* lib/financial-data to .testbuild, then node --test this file).        */
/*                                                                       */
/* Coverage map (A-W):                                                   */
/*   A  registry register/get/has/list (list returns a snapshot)         */
/*   B  duplicate indicator id is rejected                                */
/*   C  simple indicator calculation                                     */
/*   D  indicator dependency resolution                                  */
/*   E  nested dependencies                                               */
/*   F  a dependency is computed exactly once per calculate()            */
/*   G  missing data => insufficient_data (safe propagation)             */
/*   H  missing indicator dependency is detected                         */
/*   I  circular dependency detection                                    */
/*   J  NaN result is rejected                                           */
/*   K  Infinity result is rejected                                      */
/*   L  results are deterministic across runs                            */
/*   M  mean                                                            */
/*   N  population variance                                              */
/*   O  sample variance                                                  */
/*   P  standard deviation                                              */
/*   Q  covariance [population]                                          */
/*   R  sample covariance                                                */
/*   S  empty arrays => null                                            */
/*   T  insufficient observations => null                               */
/*   U  unequal covariance array lengths => null                        */
/*   V  inputs are never mutated                                        */
/*   W  analytics sources do not import forbidden/adjacent modules      */
/* -------------------------------------------------------------------- */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AnalyticsEngine,
  betaIndicator,
  BENCHMARK_RETURNS_DATA_KEY,
  DuplicateIndicatorError,
  IndicatorCycleError,
  IndicatorRegistry,
  PORTFOLIO_RETURNS_DATA_KEY,
  UnknownIndicatorError,
} from "../.testbuild/analytics/index.js";
import * as math from "../.testbuild/analytics/math.js";
import {
  classifyFreshness,
  DEFAULT_DELAYED_WITHIN_MS,
  DEFAULT_FRESH_WITHIN_MS,
} from "../.testbuild/financial-data/freshness.js";
import {
  clampCompleteness,
  makeDataQuality,
} from "../.testbuild/financial-data/quality.js";
import {
  makeDataSource,
  isValidDataSource,
  makeDataSourceReference,
} from "../.testbuild/financial-data/provenance.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRoot(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

const AS_OF = "2026-09-10";

function envelope(value, overrides = {}) {
  return {
    value,
    source: { provider: "test-provider", originalSource: "test-original", identifier: "series-1" },
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

function makeContext(data = {}, asOf = AS_OF) {
  return { data, indicators: new Map(), asOf };
}

function buildRegistry(overrides = {}) {
  const registry = new IndicatorRegistry();
  const define = (base) => {
    const definition = { ...base, ...(overrides[base.id] ?? {}) };
    registry.register(definition);
    return definition;
  };

  const counters = { mean: 0 };
  define({
    id: "mean",
    name: "Mean",
    version: "1.0.0",
    category: "trend",
    dependencies: { data: ["series"] },
    calculate: (context) => {
      counters.mean += 1;
      const series = context.data.series.value;
      if (!Array.isArray(series) || series.length === 0) {
        return {
          value: null,
          status: "insufficient_data",
          warnings: ["series has no values"],
        };
      }
      const value = math.mean(series);
      if (value === null) {
        return { value: null, status: "insufficient_data" };
      }
      return {
        value,
        status: "ok",
        sources: [
          {
            provider: context.data.series.source.provider,
            originalSource: context.data.series.source.originalSource,
            identifier: context.data.series.source.identifier,
            observedAt: context.data.series.observedAt,
            retrievedAt: context.data.series.retrievedAt,
          },
        ],
        warnings: [],
      };
    },
    metadata: {
      description: "Arithmetic mean of the series",
      methodology: "sum(n) / n",
      formula: "x̄ = (Σx) / n",
      units: "units",
    },
  });

  define({
    id: "twice",
    name: "Twice Mean",
    version: "1.0.0",
    category: "custom",
    dependencies: { indicators: ["mean"] },
    calculate: (context) => {
      const meanResult = context.indicators.get("mean");
      if (!meanResult || meanResult.value === null) {
        return { value: null, status: "insufficient_data" };
      }
      return {
        value: meanResult.value * 2,
        status: "ok",
        sources: meanResult.sources,
      };
    },
    metadata: {
      description: "Twice the mean",
      methodology: "mean * 2",
      units: "units",
    },
  });

  define({
    id: "quad",
    name: "Quadruple Mean",
    version: "1.0.0",
    category: "custom",
    dependencies: { indicators: ["twice"] },
    calculate: (context) => {
      const twiceResult = context.indicators.get("twice");
      if (!twiceResult || twiceResult.value === null) {
        return { value: null, status: "insufficient_data" };
      }
      return { value: twiceResult.value * 2, status: "ok", sources: twiceResult.sources };
    },
    metadata: {
      description: "Four times the mean",
      methodology: "twice * 2",
      units: "units",
    },
  });

  return { registry, counters };
}

describe("A: registry register/get/has/list", () => {
  it("get returns the registered definition and has reflects membership", () => {
    const { registry } = buildRegistry();
    assert.equal(registry.has("mean"), true);
    assert.equal(registry.has("missing"), false);
    assert.equal(registry.get("mean").id, "mean");
    assert.equal(registry.get("missing"), undefined);
  });

  it("list returns a snapshot that cannot mutate the registry", () => {
    const { registry } = buildRegistry();
    const ids = registry.list().map((indicator) => indicator.id);
    assert.deepEqual(ids.sort(), ["mean", "quad", "twice"]);
    const snapshot = registry.list();
    snapshot.length = 0;
    assert.equal(registry.list().length, 3);
  });
});

describe("B: duplicate indicator id is rejected", () => {
  it("registering the same id twice throws DuplicateIndicatorError", () => {
    const { registry, counters } = buildRegistry();
    assert.throws(
      () =>
        registry.register({
          id: "mean",
          name: "Mean Clone",
          version: "1.0.0",
          category: "custom",
          calculate: () => ({ value: 1, status: "ok" }),
          metadata: { description: "d", methodology: "m", units: "u" },
        }),
      DuplicateIndicatorError,
    );
    assert.equal(counters.mean, 0);
  });
});

describe("C: simple indicator calculation", () => {
  it("computes ok with value, asOf, methodology and sources", () => {
    const { registry } = buildRegistry();
    const engine = new AnalyticsEngine(registry);
    const results = engine.calculate({
      indicators: ["mean"],
      context: makeContext({ series: envelope([1, 2, 3, 4]) }),
    });
    const result = results.get("mean");
    assert.equal(result.status, "ok");
    assert.equal(result.value, 2.5);
    assert.equal(result.asOf, AS_OF);
    assert.equal(result.name, "Mean");
    assert.equal(result.version, "1.0.0");
    assert.equal(result.methodology.description, "sum(n) / n");
    assert.equal(result.methodology.formula, "x̄ = (Σx) / n");
    assert.deepEqual(result.sources, [
      {
        provider: "test-provider",
        originalSource: "test-original",
        identifier: "series-1",
        observedAt: "2026-09-10T00:00:00Z",
        retrievedAt: "2026-09-10T12:00:00Z",
      },
    ]);
    assert.deepEqual(result.warnings, []);
  });
});

describe("D: indicator dependency resolution", () => {
  it("computes the dependency first and exposes it in the result map", () => {
    const { registry } = buildRegistry();
    const engine = new AnalyticsEngine(registry);
    const results = engine.calculate({
      indicators: ["twice"],
      context: makeContext({ series: envelope([10, 20, 30]) }),
    });
    assert.equal(results.get("twice").value, 40);
    assert.equal(results.get("twice").status, "ok");
    assert.equal(results.get("mean").value, 20);
    assert.equal(results.get("mean").status, "ok");
  });
});

describe("E: nested dependencies", () => {
  it("resolves quad -> twice -> mean", () => {
    const { registry } = buildRegistry();
    const engine = new AnalyticsEngine(registry);
    const results = engine.calculate({
      indicators: ["quad"],
      context: makeContext({ series: envelope([5, 5, 5]) }),
    });
    assert.equal(results.get("quad").value, 20);
    assert.equal(results.get("twice").value, 10);
    assert.equal(results.get("mean").value, 5);
  });
});

describe("F: dependency computed exactly once per calculate()", () => {
  it("a dependency shared by two requested indicators runs once", () => {
    const { registry, counters } = buildRegistry();
    const engine = new AnalyticsEngine(registry);
    const results = engine.calculate({
      indicators: ["mean", "twice", "mean", "quad"],
      context: makeContext({ series: envelope([2, 4, 6]) }),
    });
    assert.equal(counters.mean, 1);
    assert.equal(results.size, 3);
  });
});

describe("G: missing data => insufficient_data (safe propagation)", () => {
  it("marks the missing-data indicator insufficient with a descriptive warning", () => {
    const { registry } = buildRegistry();
    const engine = new AnalyticsEngine(registry);
    const results = engine.calculate({
      indicators: ["mean"],
      context: makeContext({}),
    });
    const result = results.get("mean");
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.value, null);
    assert.ok(result.warnings.some((warning) => warning.includes("series")));
  });

  it("propagates insufficient_data to indicators that depend on it", () => {
    const { registry } = buildRegistry();
    const engine = new AnalyticsEngine(registry);
    const results = engine.calculate({
      indicators: ["quad"],
      context: makeContext({}),
    });
    assert.equal(results.get("mean").status, "insufficient_data");
    assert.equal(results.get("twice").status, "insufficient_data");
    assert.equal(results.get("quad").status, "insufficient_data");
    assert.ok(
      results
        .get("twice")
        .warnings.some((warning) => warning.includes("insufficient indicator(s): mean")),
    );
    assert.ok(
      results
        .get("quad")
        .warnings.some((warning) => warning.includes("insufficient indicator(s): twice")),
    );
  });
});

describe("H: missing indicator dependency is detected", () => {
  it("throws UnknownIndicatorError when a dependency id is not in the registry", () => {
    const { registry } = buildRegistry();
    registry.register({
      id: "depends-on-missing",
      name: "Depends On Missing",
      version: "1.0.0",
      category: "custom",
      dependencies: { indicators: ["does-not-exist"] },
      calculate: () => ({ value: 1, status: "ok" }),
      metadata: { description: "d", methodology: "m", units: "u" },
    });
    const engine = new AnalyticsEngine(registry);
    assert.throws(
      () =>
        engine.calculate({
          indicators: ["depends-on-missing"],
          context: makeContext(),
        }),
      UnknownIndicatorError,
    );
  });

  it("throws UnknownIndicatorError when a requested indicator does not exist", () => {
    const { registry } = buildRegistry();
    const engine = new AnalyticsEngine(registry);
    assert.throws(
      () => engine.calculate({ indicators: ["nope"], context: makeContext() }),
      UnknownIndicatorError,
    );
  });
});

describe("I: circular dependency detection", () => {
  it("rejects a direct A->B->A cycle with IndicatorCycleError", () => {
    const { registry } = buildRegistry();
    const stub = (id) => ({
      id,
      name: id,
      version: "1.0.0",
      category: "custom",
      dependencies: {
        indicators: [id === "a" ? "b" : "a"],
      },
      calculate: () => ({ value: 1, status: "ok" }),
      metadata: { description: "d", methodology: "m", units: "u" },
    });
    registry.register(stub("a"));
    registry.register(stub("b"));
    const engine = new AnalyticsEngine(registry);
    assert.throws(
      () => engine.calculate({ indicators: ["a"], context: makeContext() }),
      (error) => error instanceof IndicatorCycleError,
    );
  });

  it("detects self-referencing indicators too", () => {
    const { registry } = buildRegistry();
    registry.register({
      id: "self",
      name: "Self",
      version: "1.0.0",
      category: "custom",
      dependencies: { indicators: ["self"] },
      calculate: () => ({ value: 1, status: "ok" }),
      metadata: { description: "d", methodology: "m", units: "u" },
    });
    const engine = new AnalyticsEngine(registry);
    assert.throws(
      () => engine.calculate({ indicators: ["self"], context: makeContext() }),
      IndicatorCycleError,
    );
  });
});

describe("J: NaN result is rejected", () => {
  it("converts an ok NaN result into status error with value null", () => {
    const { registry } = buildRegistry();
    registry.register({
      id: "nan-indicator",
      name: "NaN Indicator",
      version: "1.0.0",
      category: "custom",
      calculate: () => ({ value: Number.NaN, status: "ok" }),
      metadata: { description: "d", methodology: "m", units: "u" },
    });
    const engine = new AnalyticsEngine(registry);
    const results = engine.calculate({
      indicators: ["nan-indicator"],
      context: makeContext(),
    });
    const result = results.get("nan-indicator");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.ok(
      result.warnings.some((warning) => warning.includes("non-finite")),
    );
  });
});

describe("K: Infinity result is rejected", () => {
  it("converts an ok Infinity result into status error with value null", () => {
    const { registry } = buildRegistry();
    registry.register({
      id: "infinity-indicator",
      name: "Infinity Indicator",
      version: "1.0.0",
      category: "custom",
      calculate: () => ({ value: Number.POSITIVE_INFINITY, status: "ok" }),
      metadata: { description: "d", methodology: "m", units: "u" },
    });
    const engine = new AnalyticsEngine(registry);
    const results = engine.calculate({
      indicators: ["infinity-indicator"],
      context: makeContext(),
    });
    const result = results.get("infinity-indicator");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
  });

  it("a throwing indicator is converted to a deterministic error result", () => {
    const { registry } = buildRegistry();
    registry.register({
      id: "throwing",
      name: "Throwing",
      version: "1.0.0",
      category: "custom",
      calculate: () => {
        throw new Error("boom");
      },
      metadata: { description: "d", methodology: "m", units: "u" },
    });
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({ indicators: ["throwing"], context: makeContext() })
      .get("throwing");
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.ok(result.warnings.some((warning) => warning.includes("boom")));
  });
});

describe("L: results are deterministic across runs", () => {
  it("two calculate() invocations produce identical results", () => {
    const { registry } = buildRegistry();
    const engine = new AnalyticsEngine(registry);
    const context = makeContext({ series: envelope([1, 2, 3, 4, 5]) });
    const run = () =>
      engine.calculate({ indicators: ["quad"], context });
    assert.equal(
      JSON.stringify(Object.fromEntries(run())),
      JSON.stringify(Object.fromEntries(run())),
    );
  });
});

describe("M: mean", () => {
  it("returns the arithmetic mean", () => {
    assert.equal(math.mean([1, 2, 3, 4]), 2.5);
    assert.equal(math.mean([5]), 5);
  });
});

describe("N: population variance", () => {
  it("computes the biased (population) variance", () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    const meanValue = math.mean(values);
    const expected =
      values.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) /
      values.length;
    assert.equal(math.variance(values), expected);
    assert.equal(math.variance([1, 1, 1]), 0);
  });
});

describe("O: sample variance", () => {
  it("uses the n-1 denominator", () => {
    assert.equal(math.sampleVariance([1, 2, 3]), 1);
    assert.equal(math.sampleVariance([1, 1, 1]), 0);
  });
});

describe("P: standard deviation", () => {
  it("is the square root of the population variance", () => {
    assert.equal(math.standardDeviation([2, 4, 4, 4, 5, 5, 7, 9]), 2);
    assert.equal(math.standardDeviation([7]), 0);
  });

  it("sample standard deviation uses the sample variance", () => {
    const std = math.sampleStandardDeviation([1, 2, 3]);
    assert.equal(std, 1);
  });
});

describe("Q: covariance [population]", () => {
  it("computes the biased covariance of two series", () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [2, 4, 6, 8, 10];
    assert.equal(math.covariance(xs, ys), 4);
    assert.equal(math.covariance([1, 2, 3], [1, 2, 3]), 2 / 3);
  });
});

describe("R: sample covariance", () => {
  it("uses the n-1 denominator", () => {
    assert.equal(math.sampleCovariance([1, 2, 3], [1, 2, 3]), 1);
    assert.equal(math.sampleCovariance([1, 2, 3], [2, 4, 6]), 2);
  });
});

describe("S: empty arrays => null", () => {
  it("every math helper returns null for []", () => {
    assert.equal(math.mean([]), null);
    assert.equal(math.variance([]), null);
    assert.equal(math.sampleVariance([]), null);
    assert.equal(math.standardDeviation([]), null);
    assert.equal(math.sampleStandardDeviation([]), null);
    assert.equal(math.covariance([], []), null);
    assert.equal(math.sampleCovariance([], []), null);
  });
});

describe("T: insufficient observations => null", () => {
  it("sample variance and deviation need at least two values", () => {
    assert.equal(math.sampleVariance([7]), null);
    assert.equal(math.sampleStandardDeviation([7]), null);
    assert.equal(math.sampleCovariance([1], [2]), null);
  });

  it("single-value population variance is defined as zero", () => {
    assert.equal(math.variance([7]), 0);
    assert.equal(math.standardDeviation([7]), 0);
  });
});

describe("U: unequal covariance array lengths => null", () => {
  it("covariance requires equal-length series", () => {
    assert.equal(math.covariance([1, 2, 3], [1, 2]), null);
    assert.equal(math.sampleCovariance([1, 2, 3], [1, 2, 3, 4]), null);
  });
});

describe("V: inputs are never mutated", () => {
  it("math helpers leave the input arrays unchanged", () => {
    const xs = [1, 2, 3, 4];
    const ys = [2, 4, 6, 8];
    const xsBefore = xs.slice();
    const ysBefore = ys.slice();
    math.mean(xs);
    math.variance(xs);
    math.sampleVariance(xs);
    math.standardDeviation(xs);
    math.sampleStandardDeviation(xs);
    math.covariance(xs, ys);
    math.sampleCovariance(xs, ys);
    assert.deepEqual(xs, xsBefore);
    assert.deepEqual(ys, ysBefore);
  });

  it("the engine leaves the context and envelopes untouched", () => {
    const { registry } = buildRegistry();
    const engine = new AnalyticsEngine(registry);
    const series = envelope([1, 2, 3, 4, 5]);
    const context = makeContext({ series }, AS_OF);
    const originalContext = JSON.stringify({
      dataKeys: Object.keys(context.data),
      series: context.data.series,
      indicatorsSize: context.indicators.size,
    });
    engine.calculate({ indicators: ["quad"], context });
    assert.deepEqual(
      {
        dataKeys: Object.keys(context.data),
        series: context.data.series,
        indicatorsSize: context.indicators.size,
      },
      JSON.parse(originalContext),
    );
  });
});

describe("W: no forbidden/adjacent imports in analytics sources", () => {
  const files = [
    "lib/financial-data/types.ts",
    "lib/financial-data/quality.ts",
    "lib/financial-data/freshness.ts",
    "lib/financial-data/provenance.ts",
    "lib/analytics/types.ts",
    "lib/analytics/registry.ts",
    "lib/analytics/engine.ts",
    "lib/analytics/math.ts",
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
    /analysis.history/i,
    /clients\.supabase/i,
    /node-fetch/,
  ];
  it("analytics/financial-data sources do not import Next/React/providers/Gemini/Supabase", () => {
    for (const file of files) {
      const source = readRoot(file);
      for (const pattern of forbidden) {
        assert.equal(pattern.test(source), false, `${file} must not match ${pattern}`);
      }
    }
  });

  it("metrics, not market-data, own the analytics data contract", () => {
    const engine = readRoot("lib/analytics/engine.ts");
    assert.equal(engine.includes("market-data"), false);
    assert.ok(engine.includes("indicator"));
  });
});

describe("financial-data helpers", () => {
  it("classifyFreshness buckets by age and rejects invalid timestamps", () => {
    const observed = "2026-09-08T00:00:00Z";
    assert.equal(
      classifyFreshness(observed, "2026-09-08T12:00:00Z"),
      "fresh",
    );
    assert.equal(
      classifyFreshness(observed, "2026-09-10T00:00:00Z"),
      "delayed",
    );
    assert.equal(
      classifyFreshness(observed, "2026-09-12T00:00:00Z"),
      "stale",
    );
    assert.equal(classifyFreshness(null, null), "unavailable");
    assert.equal(classifyFreshness("garbage", "2026-09-12T00:00:00Z"), "unavailable");
    assert.equal(classifyFreshness("2026-09-12T00:00:00Z", "2026-09-10T00:00:00Z"), "unavailable");
    assert.equal(DEFAULT_FRESH_WITHIN_MS, 24 * 60 * 60 * 1000);
    assert.equal(DEFAULT_DELAYED_WITHIN_MS, 3 * 24 * 60 * 60 * 1000);
  });

  it("makeDataQuality clamps completeness and copies warnings", () => {
    const quality = makeDataQuality({
      freshness: "stale",
      sourceTier: "secondary",
      completeness: 1.5,
      warnings: ["late"],
    });
    assert.equal(quality.completeness, 1);
    assert.deepEqual(quality.warnings, ["late"]);
    assert.equal(clampCompleteness(-1), 0);
    assert.equal(clampCompleteness(0.5), 0.5);
    assert.equal(clampCompleteness(Number.NaN), 0);
  });

  it("provenance helpers validate source shapes", () => {
    const source = makeDataSource("test-provider", "test-original", "id-1");
    assert.deepEqual(source, {
      provider: "test-provider",
      originalSource: "test-original",
      identifier: "id-1",
    });
    assert.equal(isValidDataSource(source), true);
    assert.equal(isValidDataSource({ provider: "", originalSource: "x" }), false);
    assert.equal(isValidDataSource(null), false);
    assert.equal(
      isValidDataSource(makeDataSource("p", "o")),
      true,
    );
  });

  it("makeDataSourceReference builds provider-agnostic structured references", () => {
    const reference = makeDataSourceReference({
      provider: "test-provider",
      originalSource: "test-dataset",
      identifier: "series-9",
      observedAt: "2026-09-10T00:00:00Z",
      retrievedAt: "2026-09-10T12:00:00Z",
    });
    assert.deepEqual(reference, {
      provider: "test-provider",
      originalSource: "test-dataset",
      identifier: "series-9",
      observedAt: "2026-09-10T00:00:00Z",
      retrievedAt: "2026-09-10T12:00:00Z",
    });
    assert.deepEqual(makeDataSourceReference({ provider: "p", originalSource: "o" }), {
      provider: "p",
      originalSource: "o",
    });
  });
});

describe("Micro-hardening A: units can be null", () => {
  it("registers and calculates a unitless indicator", () => {
    const { registry } = buildRegistry();
    registry.register({
      id: "unitless",
      name: "Unitless Indicator",
      version: "1.0.0",
      category: "return",
      calculate: () => ({ value: 0.05, status: "ok" }),
      metadata: {
        description: "A ratio with no units",
        methodology: "numerator / denominator",
        units: null,
      },
    });
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({ indicators: ["unitless"], context: makeContext() })
      .get("unitless");
    assert.equal(result.status, "ok");
    assert.equal(result.value, 0.05);
  });
});

describe("Micro-hardening B: risk-adjusted-return is a valid category", () => {
  it("stores the category as metadata without engine behavior", () => {
    const { registry } = buildRegistry();
    registry.register({
      id: "sharpe-like",
      name: "Risk Adjusted Return Proxy",
      version: "1.0.0",
      category: "risk-adjusted-return",
      calculate: () => ({ value: 1, status: "ok" }),
      metadata: { description: "d", methodology: "m", units: null },
    });
    assert.equal(registry.get("sharpe-like").category, "risk-adjusted-return");
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({ indicators: ["sharpe-like"], context: makeContext() })
      .get("sharpe-like");
    assert.equal(result.status, "ok");
    assert.ok(registry.list().some((indicator) => indicator.id === "sharpe-like"));
  });
});

describe("Micro-hardening C: portfolio and fundamental are valid categories", () => {
  it("stores both categories as plain metadata", () => {
    const { registry } = buildRegistry();
    registry.register({
      id: "portfolio-metric",
      name: "Portfolio Metric",
      version: "1.0.0",
      category: "portfolio",
      calculate: () => ({ value: 2, status: "ok" }),
      metadata: { description: "d", methodology: "m", units: null },
    });
    registry.register({
      id: "fundamental-metric",
      name: "Fundamental Metric",
      version: "1.0.0",
      category: "fundamental",
      calculate: () => ({ value: 3, status: "ok" }),
      metadata: { description: "d", methodology: "m", units: null },
    });
    assert.equal(registry.get("portfolio-metric").category, "portfolio");
    assert.equal(registry.get("fundamental-metric").category, "fundamental");
  });
});

describe("Micro-hardening D: IndicatorResult uses structured source references", () => {
  it("sources entries are structured references, never plain strings", () => {
    const { registry } = buildRegistry();
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({ indicators: ["mean"], context: makeContext({ series: envelope([1, 2, 3]) }) })
      .get("mean");
    assert.ok(Array.isArray(result.sources));
    assert.ok(result.sources.length >= 1);
    for (const source of result.sources) {
      assert.equal(typeof source.provider, "string");
      assert.equal(typeof source.originalSource, "string");
      assert.ok(source.provider.length > 0);
      assert.ok(source.originalSource.length > 0);
    }
  });
});

describe("Micro-hardening E: provider/originalSource/identifier are preserved", () => {
  it("propagates the envelope source fields into the result", () => {
    const { registry } = buildRegistry();
    const engine = new AnalyticsEngine(registry);
    const series = envelope([4, 5, 6], {
      source: {
        provider: "alpha-source",
        originalSource: "daily-close",
        identifier: "AAPL-close-2026",
      },
    });
    const result = engine
      .calculate({ indicators: ["twice"], context: makeContext({ series }) })
      .get("twice");
    assert.deepEqual(result.sources, [
      {
        provider: "alpha-source",
        originalSource: "daily-close",
        identifier: "AAPL-close-2026",
        observedAt: series.observedAt,
        retrievedAt: series.retrievedAt,
      },
    ]);
  });
});

describe("Micro-hardening F: mean overflow => null", () => {
  it("Mean of finite-but-huge values never overflows to Infinity", () => {
    assert.equal(
      math.mean([Number.MAX_VALUE, Number.MAX_VALUE]),
      null,
    );
  });
});

describe("Micro-hardening G: variance overflow => null", () => {
  it("finite extremes cannot produce Infinity variance", () => {
    assert.equal(
      math.variance([Number.MAX_VALUE, -Number.MAX_VALUE]),
      null,
    );
  });
});

describe("Micro-hardening H: sampleVariance overflow => null", () => {
  it("sample variance of finite extremes stays null, never Infinity", () => {
    assert.equal(
      math.sampleVariance([Number.MAX_VALUE, -Number.MAX_VALUE]),
      null,
    );
  });
});

describe("Micro-hardening I: standardDeviation is never Infinity", () => {
  it("returns null instead of Infinity for overflowing inputs", () => {
    assert.equal(
      math.standardDeviation([Number.MAX_VALUE, -Number.MAX_VALUE]),
      null,
    );
    assert.equal(
      math.sampleStandardDeviation([Number.MAX_VALUE, -Number.MAX_VALUE]),
      null,
    );
  });
});

describe("Micro-hardening J: covariance overflow => null", () => {
  it("covariance of huge opposites returns null", () => {
    assert.equal(
      math.covariance(
        [Number.MAX_VALUE, -Number.MAX_VALUE],
        [Number.MAX_VALUE, -Number.MAX_VALUE],
      ),
      null,
    );
  });
});

describe("Micro-hardening K: sampleCovariance overflow => null", () => {
  it("sample covariance of huge opposites returns null", () => {
    assert.equal(
      math.sampleCovariance(
        [Number.MAX_VALUE, -Number.MAX_VALUE],
        [Number.MAX_VALUE, -Number.MAX_VALUE],
      ),
      null,
    );
  });
});

describe("Micro-hardening L: normal math cases keep exact results", () => {
  it("all standard cases still yield the exact previous numbers", () => {
    assert.equal(math.mean([1, 2, 3, 4]), 2.5);
    assert.equal(math.variance([2, 4, 4, 4, 5, 5, 7, 9]), 4);
    assert.equal(math.sampleVariance([1, 2, 3]), 1);
    assert.equal(math.standardDeviation([2, 4, 4, 4, 5, 5, 7, 9]), 2);
    assert.equal(math.covariance([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), 4);
    assert.equal(math.sampleCovariance([1, 2, 3], [1, 2, 3]), 1);
  });
});

describe("Micro-hardening M: previous behavior is stable", () => {
  it("the engine still computes the same values with the new types", () => {
    const { registry } = buildRegistry();
    const engine = new AnalyticsEngine(registry);
    const results = engine.calculate({
      indicators: ["quad"],
      context: makeContext({ series: envelope([5, 5, 5]) }),
    });
    assert.equal(results.get("mean").value, 5);
    assert.equal(results.get("twice").value, 10);
    assert.equal(results.get("quad").value, 20);
    assert.deepEqual(results.get("mean").sources, results.get("twice").sources);
  });
});

describe("Precomputed indicator reuse in AnalyticsEngine", () => {
  // Architectural test (Section 7)
  describe("Architectural test: deterministic spy/counter", () => {
    it("when a precomputed result exists, definition.calculate invocation count === 0", () => {
      let invocations = 0;
      const registry = new IndicatorRegistry();
      registry.register({
        id: "spy_indicator",
        name: "Spy",
        version: "1.0.0",
        category: "custom",
        dependencies: { data: ["non_existent_data"] },
        calculate: () => {
          invocations += 1;
          return { value: 123, status: "ok" };
        },
        metadata: { description: "d", methodology: "m", units: "u" },
      });
      const engine = new AnalyticsEngine(registry);
      const precomputed = {
        id: "spy_indicator",
        name: "Spy",
        version: "1.0.0",
        value: 999,
        status: "ok",
        asOf: AS_OF,
        methodology: { description: "m" },
        sources: [],
        warnings: [],
      };
      const context = {
        data: {},
        indicators: new Map([["spy_indicator", precomputed]]),
        asOf: AS_OF,
      };

      const results = engine.calculate({
        indicators: ["spy_indicator"],
        context,
      });

      assert.equal(invocations, 0, "calculate() must NOT be invoked when precomputed");
      assert.equal(results.get("spy_indicator").value, 999);
      assert.equal(results.get("spy_indicator"), precomputed);
    });

    it("dependency definition.calculate count === 0 while dependent indicator executes exactly once", () => {
      let depInvocations = 0;
      let dependentInvocations = 0;
      const registry = new IndicatorRegistry();
      registry.register({
        id: "dep",
        name: "Dependency",
        version: "1.0.0",
        category: "custom",
        dependencies: { data: ["missing_data"] },
        calculate: () => {
          depInvocations += 1;
          return { value: 10, status: "ok" };
        },
        metadata: { description: "d", methodology: "m", units: "u" },
      });
      registry.register({
        id: "consumer",
        name: "Consumer",
        version: "1.0.0",
        category: "custom",
        dependencies: { indicators: ["dep"] },
        calculate: (ctx) => {
          dependentInvocations += 1;
          const depResult = ctx.indicators.get("dep");
          return {
            value: depResult ? depResult.value * 3 : null,
            status: "ok",
            sources: depResult ? depResult.sources : [],
          };
        },
        metadata: { description: "d", methodology: "m", units: "u" },
      });
      const engine = new AnalyticsEngine(registry);
      const precomputedDep = {
        id: "dep",
        name: "Dependency",
        version: "1.0.0",
        value: 7,
        status: "ok",
        asOf: AS_OF,
        methodology: { description: "m" },
        sources: [{ provider: "mock-prov", originalSource: "orig", identifier: "id1" }],
        warnings: [],
      };
      const context = {
        data: {},
        indicators: new Map([["dep", precomputedDep]]),
        asOf: AS_OF,
      };

      const results = engine.calculate({
        indicators: ["consumer"],
        context,
      });

      assert.equal(depInvocations, 0, "dependency calculate must not be called");
      assert.equal(dependentInvocations, 1, "dependent calculate must be called exactly once");
      assert.equal(results.get("consumer").value, 21);
      assert.deepEqual(results.get("consumer").sources, precomputedDep.sources);
    });
  });

  // Section 6 Coverage Items A - N
  describe("A: Existing behavior unchanged when context.indicators is empty", () => {
    it("computes normal dependency chain when context.indicators is empty map", () => {
      const { registry } = buildRegistry();
      const engine = new AnalyticsEngine(registry);
      const results = engine.calculate({
        indicators: ["quad"],
        context: makeContext({ series: envelope([5, 5, 5]) }),
      });
      assert.equal(results.get("mean").value, 5);
      assert.equal(results.get("twice").value, 10);
      assert.equal(results.get("quad").value, 20);
    });
  });

  describe("B: A precomputed registered indicator is returned unchanged", () => {
    it("returns the exact precomputed object without modifying it", () => {
      const { registry } = buildRegistry();
      const engine = new AnalyticsEngine(registry);
      const precomputed = {
        id: "mean",
        name: "Mean",
        version: "1.0.0",
        value: 42,
        status: "ok",
        asOf: AS_OF,
        methodology: { description: "m" },
        sources: [{ provider: "p", originalSource: "o", identifier: "i" }],
        warnings: ["w1"],
        dataWindow: { startDate: "2026-01-01", endDate: "2026-02-01", observations: 20 },
      };
      const context = {
        data: {},
        indicators: new Map([["mean", precomputed]]),
        asOf: AS_OF,
      };
      const results = engine.calculate({ indicators: ["mean"], context });
      assert.equal(results.get("mean"), precomputed);
      assert.equal(results.get("mean").value, 42);
    });
  });

  describe("C: definition.calculate is NOT called for a precomputed indicator", () => {
    it("does not increment calculate counter when precomputed", () => {
      const { registry, counters } = buildRegistry();
      const engine = new AnalyticsEngine(registry);
      const precomputed = {
        id: "mean",
        name: "Mean",
        version: "1.0.0",
        value: 100,
        status: "ok",
        asOf: AS_OF,
        methodology: { description: "m" },
        sources: [],
        warnings: [],
      };
      const context = {
        data: {},
        indicators: new Map([["mean", precomputed]]),
        asOf: AS_OF,
      };
      engine.calculate({ indicators: ["mean"], context });
      assert.equal(counters.mean, 0);
    });
  });

  describe("D: Precomputed result wins even if raw data dependencies are present", () => {
    it("precomputed value takes precedence over data that would compute a different value", () => {
      const { registry, counters } = buildRegistry();
      const engine = new AnalyticsEngine(registry);
      const precomputed = {
        id: "mean",
        name: "Mean",
        version: "1.0.0",
        value: 999,
        status: "ok",
        asOf: AS_OF,
        methodology: { description: "m" },
        sources: [],
        warnings: [],
      };
      const context = {
        data: { series: envelope([5, 5, 5]) },
        indicators: new Map([["mean", precomputed]]),
        asOf: AS_OF,
      };
      const results = engine.calculate({ indicators: ["mean"], context });
      assert.equal(results.get("mean").value, 999);
      assert.equal(counters.mean, 0, "calculate was bypassed despite raw data being present");
    });
  });

  describe("E: A dependent indicator reuses the precomputed dependency", () => {
    it("twice indicator consumes precomputed mean value", () => {
      const { registry, counters } = buildRegistry();
      const engine = new AnalyticsEngine(registry);
      const precomputedMean = {
        id: "mean",
        name: "Mean",
        version: "1.0.0",
        value: 15,
        status: "ok",
        asOf: AS_OF,
        methodology: { description: "m" },
        sources: [{ provider: "p", originalSource: "o", identifier: "i" }],
        warnings: [],
      };
      const context = {
        data: {},
        indicators: new Map([["mean", precomputedMean]]),
        asOf: AS_OF,
      };
      const results = engine.calculate({ indicators: ["twice"], context });
      assert.equal(results.get("twice").value, 30);
      assert.equal(counters.mean, 0);
    });
  });

  describe("F: Beta-specific regression", () => {
    it("precomputed beta is reused by dependent indicator with zero beta calculations", () => {
      let betaExecutions = 0;
      let dependentExecutions = 0;

      const registry = new IndicatorRegistry();
      registry.register({
        ...betaIndicator,
        calculate: (ctx) => {
          betaExecutions += 1;
          return betaIndicator.calculate(ctx);
        },
      });

      registry.register({
        id: "beta_consumer",
        name: "Beta Consumer",
        version: "1.0.0",
        category: "risk",
        dependencies: { indicators: ["beta"] },
        calculate: (ctx) => {
          dependentExecutions += 1;
          const beta = ctx.indicators.get("beta");
          return {
            value: beta && beta.value !== null ? beta.value * 10 : null,
            status: beta ? beta.status : "error",
            sources: beta ? beta.sources : [],
          };
        },
        metadata: { description: "Consumes beta", methodology: "beta * 10", units: "x" },
      });

      const engine = new AnalyticsEngine(registry);

      const pSeries = {
        assetId: "PORTFOLIO",
        points: [
          { date: "2026-01-01", value: 0.02 },
          { date: "2026-01-02", value: 0.04 },
        ],
      };
      const bSeries = {
        assetId: "BENCHMARK",
        points: [
          { date: "2026-01-01", value: 0.01 },
          { date: "2026-01-02", value: 0.02 },
        ],
      };
      const run1Context = {
        data: {
          [PORTFOLIO_RETURNS_DATA_KEY]: envelope(pSeries),
          [BENCHMARK_RETURNS_DATA_KEY]: envelope(bSeries),
        },
        indicators: new Map(),
        asOf: AS_OF,
      };
      const run1Results = engine.calculate({
        indicators: ["beta"],
        context: run1Context,
      });
      const computedBeta = run1Results.get("beta");
      assert.equal(betaExecutions, 1);
      assert.equal(computedBeta.status, "ok");
      assert.equal(computedBeta.value, 2);

      const run2Context = {
        data: {},
        indicators: new Map([["beta", computedBeta]]),
        asOf: AS_OF,
      };
      const run2Results = engine.calculate({
        indicators: ["beta_consumer"],
        context: run2Context,
      });

      assert.equal(
        betaExecutions,
        1,
        "beta calculation count remains 1 (0 during second execution)",
      );
      assert.equal(dependentExecutions, 1);
      assert.equal(run2Results.get("beta_consumer").value, 20);
      assert.equal(run2Results.get("beta_consumer").status, "ok");
    });
  });

  describe("G: Precomputed status is preserved (ok, insufficient_data, error)", () => {
    it("preserves 'ok', 'insufficient_data', and 'error' statuses", () => {
      const { registry } = buildRegistry();
      const engine = new AnalyticsEngine(registry);

      for (const status of ["ok", "insufficient_data", "error"]) {
        const precomputed = {
          id: "mean",
          name: "Mean",
          version: "1.0.0",
          value: status === "ok" ? 50 : null,
          status,
          asOf: AS_OF,
          methodology: { description: "m" },
          sources: [],
          warnings: [`status is ${status}`],
        };
        const context = {
          data: {},
          indicators: new Map([["mean", precomputed]]),
          asOf: AS_OF,
        };
        const results = engine.calculate({ indicators: ["mean"], context });
        assert.equal(results.get("mean").status, status);
        assert.equal(results.get("mean").value, precomputed.value);
        assert.deepEqual(results.get("mean").warnings, precomputed.warnings);
      }
    });
  });

  describe("H: sources preserved exactly", () => {
    it("preserves sources array reference and entries", () => {
      const { registry } = buildRegistry();
      const engine = new AnalyticsEngine(registry);
      const sources = [
        { provider: "prov-a", originalSource: "orig-a", identifier: "id-a" },
        { provider: "prov-b", originalSource: "orig-b", identifier: "id-b" },
      ];
      const precomputed = {
        id: "mean",
        name: "Mean",
        version: "1.0.0",
        value: 10,
        status: "ok",
        asOf: AS_OF,
        methodology: { description: "m" },
        sources,
        warnings: [],
      };
      const context = {
        data: {},
        indicators: new Map([["mean", precomputed]]),
        asOf: AS_OF,
      };
      const results = engine.calculate({ indicators: ["mean"], context });
      assert.deepEqual(results.get("mean").sources, sources);
    });
  });

  describe("I: dataWindow preserved exactly", () => {
    it("preserves dataWindow exactly when provided", () => {
      const { registry } = buildRegistry();
      const engine = new AnalyticsEngine(registry);
      const dataWindow = {
        startDate: "2025-01-01",
        endDate: "2025-12-31",
        observations: 252,
      };
      const precomputed = {
        id: "mean",
        name: "Mean",
        version: "1.0.0",
        value: 10,
        status: "ok",
        asOf: AS_OF,
        methodology: { description: "m" },
        sources: [],
        warnings: [],
        dataWindow,
      };
      const context = {
        data: {},
        indicators: new Map([["mean", precomputed]]),
        asOf: AS_OF,
      };
      const results = engine.calculate({ indicators: ["mean"], context });
      assert.deepEqual(results.get("mean").dataWindow, dataWindow);
    });
  });

  describe("J: warnings preserved exactly", () => {
    it("preserves custom warnings exactly", () => {
      const { registry } = buildRegistry();
      const engine = new AnalyticsEngine(registry);
      const warnings = ["caution: high kurtosis", "caution: small sample size"];
      const precomputed = {
        id: "mean",
        name: "Mean",
        version: "1.0.0",
        value: 10,
        status: "ok",
        asOf: AS_OF,
        methodology: { description: "m" },
        sources: [],
        warnings,
      };
      const context = {
        data: {},
        indicators: new Map([["mean", precomputed]]),
        asOf: AS_OF,
      };
      const results = engine.calculate({ indicators: ["mean"], context });
      assert.deepEqual(results.get("mean").warnings, warnings);
    });
  });

  describe("K: context.indicators input Map is not mutated", () => {
    it("does not mutate the passed context.indicators map", () => {
      const { registry } = buildRegistry();
      const engine = new AnalyticsEngine(registry);
      const precomputed = {
        id: "mean",
        name: "Mean",
        version: "1.0.0",
        value: 10,
        status: "ok",
        asOf: AS_OF,
        methodology: { description: "m" },
        sources: [],
        warnings: [],
      };
      const inputMap = new Map([["mean", precomputed]]);
      const context = {
        data: {},
        indicators: inputMap,
        asOf: AS_OF,
      };
      engine.calculate({ indicators: ["twice"], context });

      assert.equal(inputMap.size, 1);
      assert.equal(inputMap.get("mean"), precomputed);
      assert.equal(inputMap.has("twice"), false);
    });
  });

  describe("L: local cache still prevents duplicate work during one engine run", () => {
    it("precomputed indicator requested multiple times or by multiple dependents is cached", () => {
      const { registry } = buildRegistry();
      const engine = new AnalyticsEngine(registry);
      const precomputed = {
        id: "mean",
        name: "Mean",
        version: "1.0.0",
        value: 10,
        status: "ok",
        asOf: AS_OF,
        methodology: { description: "m" },
        sources: [],
        warnings: [],
      };
      const context = {
        data: {},
        indicators: new Map([["mean", precomputed]]),
        asOf: AS_OF,
      };
      const results = engine.calculate({
        indicators: ["mean", "twice", "quad"],
        context,
      });

      assert.equal(results.get("mean").value, 10);
      assert.equal(results.get("twice").value, 20);
      assert.equal(results.get("quad").value, 40);
    });
  });

  describe("M: Unknown indicator behavior remains exactly as before", () => {
    it("throws UnknownIndicatorError for unknown indicator even if present in context.indicators", () => {
      const { registry } = buildRegistry();
      const engine = new AnalyticsEngine(registry);
      const fakeResult = {
        id: "unknown_id",
        name: "Unknown",
        version: "1.0.0",
        value: 123,
        status: "ok",
        asOf: AS_OF,
        methodology: { description: "m" },
        sources: [],
        warnings: [],
      };
      const context = {
        data: {},
        indicators: new Map([["unknown_id", fakeResult]]),
        asOf: AS_OF,
      };

      assert.throws(
        () => engine.calculate({ indicators: ["unknown_id"], context }),
        UnknownIndicatorError,
      );
    });
  });
});