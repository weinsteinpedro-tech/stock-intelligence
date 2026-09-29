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
  DuplicateIndicatorError,
  IndicatorCycleError,
  IndicatorRegistry,
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