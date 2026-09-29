/* Analytics Phase 2: Portfolio subsystem tests (no network).              */
/*                                                                          */
/* Run via `npm run test:static` (compiles lib/analytics +                 */
/* lib/financial-data to .testbuild, then node --test this file).           */
/*                                                                          */
/* Coverage map (A-AD):                                                     */
/*   A   canonical valid date                                               */
/*   B   impossible/noncanonical dates rejected                             */
/*   C   normalization sorts prices ascending                               */
/*   D   duplicate date rejected                                            */
/*   E   non-finite price rejected                                          */
/*   F   zero/negative price rejected                                       */
/*   G   normalization does not mutate input                                */
/*   H   simple return calculation                                          */
/*   I   return date uses ending date                                       */
/*   J   <2 prices => empty returns                                         */
/*   K   return overflow => NonFiniteReturnError                            */
/*   L   align two series uses intersection only                            */
/*   M   no interpolation / no forward-fill                                 */
/*   N   alignment sorted ascending                                         */
/*   O   align multiple series intersection                                 */
/*   P   zero series => empty; one series => its dates                      */
/*   Q   duplicate asset ids rejected                                       */
/*   R   valid portfolio weights                                            */
/*   S   weights not summing to 1 rejected                                  */
/*   T   negative weight rejected                                           */
/*   U   non-finite weight rejected                                         */
/*   V   duplicate portfolio asset rejected                                 */
/*   W   explicit weight normalization works                                */
/*   X   static weighted portfolio return calculation                       */
/*   Y   missing asset return series rejected                               */
/*   Z   missing date in one asset removes that date from whole portfolio   */
/*   AA  portfolio calculation does not mutate inputs                       */
/*   AB  benchmark remains a generic ReturnSeries                           */
/*   AC  portfolio code has no forbidden imports                            */
/*   AD  previous Analytics Engine tests still pass                         */
/* ------------------------------------------------------------------------ */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  alignMultipleReturnSeries,
  alignReturnSeries,
  AssetSeriesKeyMismatchError,
  calculatePortfolioReturns,
  calculateSimpleReturns,
  DuplicateAssetError,
  DuplicateDateError,
  InvalidPortfolioDefinitionError,
  InvalidPortfolioWeightsError,
  InvalidPriceSeriesError,
  InvalidReturnSeriesError,
  isCanonicalDate,
  MissingAssetReturnSeriesError,
  NonFiniteReturnError,
  normalizePortfolioWeights,
  normalizePriceSeries,
  normalizeReturnSeries,
  PORTFOLIO_WEIGHT_TOLERANCE,
  validatePortfolioWeights,
  AnalyticsEngine,
  IndicatorRegistry,
} from "../.testbuild/analytics/index.js";

import { historicalPricesToPriceSeries, InvalidMarketCloseError } from "../.testbuild/financial-data/adapters/market-prices.js";

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

function priceSeries(assetId, points) {
  return { assetId, points };
}

function returnSeries(assetId, points) {
  return { assetId, points };
}

describe("A: canonical valid date", () => {
  it("accepts real YYYY-MM-DD dates", () => {
    assert.equal(isCanonicalDate("2026-09-10"), true);
    assert.equal(isCanonicalDate("2026-12-31"), true);
    assert.equal(isCanonicalDate("2024-02-29"), true);
    assert.equal(isCanonicalDate("2000-02-29"), true);
    assert.equal(isCanonicalDate("1900-12-01"), true);
  });
});

describe("B: impossible/noncanonical dates rejected", () => {
  it("rejects non-existent and malformed dates", () => {
    assert.equal(isCanonicalDate("2026-02-30"), false);
    assert.equal(isCanonicalDate("2026-02-29"), false);
    assert.equal(isCanonicalDate("1900-02-29"), false);
    assert.equal(isCanonicalDate("2026-13-01"), false);
    assert.equal(isCanonicalDate("2026-00-01"), false);
    assert.equal(isCanonicalDate("2026-01-00"), false);
    assert.equal(isCanonicalDate("09/10/2026"), false);
    assert.equal(isCanonicalDate("2026-9-10"), false);
    assert.equal(isCanonicalDate("2026/09/10"), false);
    assert.equal(isCanonicalDate("2026-09-10T00:00:00Z"), false);
    assert.equal(isCanonicalDate(""), false);
  });
});

describe("C: normalization sorts prices ascending", () => {
  it("reorders unsorted input by canonical date", () => {
    const series = priceSeries("A", [
      { date: "2026-09-10", value: 105 },
      { date: "2026-09-08", value: 100 },
      { date: "2026-09-09", value: 102 },
    ]);
    const normalized = normalizePriceSeries(series);
    assert.deepEqual(
      normalized.points.map((point) => point.date),
      ["2026-09-08", "2026-09-09", "2026-09-10"],
    );
    assert.deepEqual(
      normalized.points.map((point) => point.value),
      [100, 102, 105],
    );
  });

  it("rejects a missing or empty assetId", () => {
    assert.throws(
      () => normalizePriceSeries(priceSeries("", [{ date: "2026-09-08", value: 100 }])),
      InvalidPriceSeriesError,
    );
  });
});

describe("D: duplicate date rejected", () => {
  it("throws DuplicateDateError instead of resolving silently", () => {
    const series = priceSeries("A", [
      { date: "2026-09-08", value: 100 },
      { date: "2026-09-08", value: 101 },
    ]);
    assert.throws(() => normalizePriceSeries(series), DuplicateDateError);
  });
});

describe("E: non-finite price rejected", () => {
  it("rejects NaN and Infinity prices", () => {
    assert.throws(
      () =>
        normalizePriceSeries(
          priceSeries("A", [{ date: "2026-09-08", value: Number.NaN }]),
        ),
      InvalidPriceSeriesError,
    );
    assert.throws(
      () =>
        normalizePriceSeries(
          priceSeries("A", [{ date: "2026-09-08", value: Number.POSITIVE_INFINITY }]),
        ),
      InvalidPriceSeriesError,
    );
  });
});

describe("F: zero/negative price rejected", () => {
  it("rejects non-positive values", () => {
    assert.throws(
      () =>
        normalizePriceSeries(
          priceSeries("A", [{ date: "2026-09-08", value: 0 }]),
        ),
      InvalidPriceSeriesError,
    );
    assert.throws(
      () =>
        normalizePriceSeries(
          priceSeries("A", [{ date: "2026-09-08", value: -5 }]),
        ),
      InvalidPriceSeriesError,
    );
  });
});

describe("G: normalization does not mutate input", () => {
  it("leaves the input series untouched", () => {
    const series = priceSeries("A", [
      { date: "2026-09-10", value: 105 },
      { date: "2026-09-08", value: 100 },
    ]);
    const before = JSON.stringify(series);
    normalizePriceSeries(series);
    assert.equal(JSON.stringify(series), before);
  });
});

describe("H: simple return calculation", () => {
  it("computes R_t = P_t/P_(t-1) - 1", () => {
    const returns = calculateSimpleReturns(
      priceSeries("A", [
        { date: "2026-09-08", value: 100 },
        { date: "2026-09-09", value: 105 },
        { date: "2026-09-10", value: 110 },
      ]),
    );
    assert.equal(returns.assetId, "A");
    assert.equal(returns.points.length, 2);
    approx(returns.points[0].value, (105 / 100) - 1);
    approx(returns.points[1].value, (110 / 105) - 1);
  });
});

describe("I: return date uses ending date", () => {
  it("each return point is dated the final price of the period", () => {
    const returns = calculateSimpleReturns(
      priceSeries("A", [
        { date: "2026-09-08", value: 100 },
        { date: "2026-09-09", value: 105 },
      ]),
    );
    assert.equal(returns.points[0].date, "2026-09-09");
    assert.equal(returns.points.some((point) => point.date === "2026-09-08"), false);
    approx(returns.points[0].value, 0.05);
  });
});

describe("J: <2 prices => empty returns", () => {
  it("returns an empty series for zero and single prices", () => {
    assert.deepEqual(calculateSimpleReturns(priceSeries("A", [])).points, []);
    assert.deepEqual(
      calculateSimpleReturns(priceSeries("A", [{ date: "2026-09-08", value: 100 }])).points,
      [],
    );
  });
});

describe("K: return overflow => NonFiniteReturnError", () => {
  it("rejects non-finite computed returns", () => {
    const series = priceSeries("A", [
      { date: "2026-09-08", value: 5e-324 },
      { date: "2026-09-09", value: Number.MAX_VALUE },
    ]);
    assert.throws(() => calculateSimpleReturns(series), NonFiniteReturnError);
  });
});

describe("L: align two series uses intersection only", () => {
  it("keeps only dates present in both series", () => {
    const left = returnSeries("PF", [
      { date: "2026-09-08", value: 0.01 },
      { date: "2026-09-09", value: 0.02 },
      { date: "2026-09-10", value: 0.03 },
    ]);
    const right = returnSeries("BM", [
      { date: "2026-09-08", value: 0.1 },
      { date: "2026-09-10", value: 0.2 },
      { date: "2026-09-11", value: 0.3 },
    ]);
    const aligned = alignReturnSeries(left, right);
    assert.deepEqual(aligned.dates, ["2026-09-08", "2026-09-10"]);
    assert.deepEqual(aligned.left, [0.01, 0.03]);
    assert.deepEqual(aligned.right, [0.1, 0.2]);
  });
});

describe("M: no interpolation / no forward-fill", () => {
  it("never invents observations for gaps", () => {
    const left = returnSeries("A", [
      { date: "2026-09-08", value: 0.01 },
      { date: "2026-09-10", value: 0.02 },
    ]);
    const right = returnSeries("B", [
      { date: "2026-09-08", value: 0.1 },
      { date: "2026-09-09", value: 0.15 },
    ]);
    const aligned = alignReturnSeries(left, right);
    assert.deepEqual(aligned.dates, ["2026-09-08"]);
  });
});

describe("N: alignment sorted ascending", () => {
  it("emits dates in ascending order regardless of input order", () => {
    const left = returnSeries("A", [
      { date: "2026-09-10", value: 3 },
      { date: "2026-09-08", value: 1 },
      { date: "2026-09-09", value: 2 },
    ]);
    const right = returnSeries("B", [
      { date: "2026-09-09", value: 20 },
      { date: "2026-09-10", value: 30 },
      { date: "2026-09-08", value: 10 },
    ]);
    const aligned = alignReturnSeries(left, right);
    assert.deepEqual(aligned.dates, ["2026-09-08", "2026-09-09", "2026-09-10"]);
    assert.deepEqual(aligned.left, [1, 2, 3]);
    assert.deepEqual(aligned.right, [10, 20, 30]);
  });
});

describe("O: align multiple series intersection", () => {
  it("keeps dates present in ALL series", () => {
    const a = returnSeries("A", [
      { date: "2026-09-08", value: 1 },
      { date: "2026-09-09", value: 2 },
      { date: "2026-09-10", value: 3 },
    ]);
    const b = returnSeries("B", [
      { date: "2026-09-08", value: 10 },
      { date: "2026-09-10", value: 30 },
      { date: "2026-09-11", value: 40 },
    ]);
    const c = returnSeries("C", [
      { date: "2026-09-10", value: 100 },
      { date: "2026-09-11", value: 111 },
      { date: "2026-09-12", value: 122 },
    ]);
    const aligned = alignMultipleReturnSeries([a, b, c]);
    assert.deepEqual(aligned.dates, ["2026-09-10"]);
    assert.deepEqual(aligned.series.get("A"), [3]);
    assert.deepEqual(aligned.series.get("B"), [30]);
    assert.deepEqual(aligned.series.get("C"), [100]);
  });
});

describe("P: zero series => empty; one series => its dates", () => {
  it("returns an empty result for no series", () => {
    const aligned = alignMultipleReturnSeries([]);
    assert.deepEqual(aligned.dates, []);
    assert.equal(aligned.series.size, 0);
  });

  it("single series keeps its own dates", () => {
    const a = returnSeries("A", [
      { date: "2026-09-09", value: 2 },
      { date: "2026-09-08", value: 1 },
    ]);
    const aligned = alignMultipleReturnSeries([a]);
    assert.deepEqual(aligned.dates, ["2026-09-08", "2026-09-09"]);
    assert.deepEqual(aligned.series.get("A"), [1, 2]);
  });
});

describe("Q: duplicate asset ids rejected", () => {
  it("throws DuplicateAssetError in multi-series alignment", () => {
    const a = returnSeries("A", [{ date: "2026-09-08", value: 1 }]);
    const b = returnSeries("A", [{ date: "2026-09-08", value: 2 }]);
    assert.throws(() => alignMultipleReturnSeries([a, b]), DuplicateAssetError);
  });
});

describe("R: valid portfolio weights", () => {
  it("accepts weights summing to 1 within tolerance", () => {
    const result = validatePortfolioWeights([
      { assetId: "A", weight: 0.6 },
      { assetId: "B", weight: 0.4 },
    ]);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.equal(PORTFOLIO_WEIGHT_TOLERANCE, 1e-8);
  });

  it("allows a zero-weight position", () => {
    const result = validatePortfolioWeights([
      { assetId: "A", weight: 1 },
      { assetId: "B", weight: 0 },
    ]);
    assert.equal(result.valid, true);
  });
});

describe("S: weights not summing to 1 rejected", () => {
  it("reports the sum mismatch explicitly", () => {
    const result = validatePortfolioWeights([
      { assetId: "A", weight: 0.8 },
      { assetId: "B", weight: 0.5 },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("sum")));
    approx(result.sum, 1.3);
  });
});

describe("T: negative weight rejected", () => {
  it("flags negative weights (no shorts in V1)", () => {
    const result = validatePortfolioWeights([
      { assetId: "A", weight: 1.2 },
      { assetId: "B", weight: -0.2 },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("non-negative")));
  });
});

describe("U: non-finite weight rejected", () => {
  it("flags NaN and Infinity weights", () => {
    const nan = validatePortfolioWeights([{ assetId: "A", weight: Number.NaN }]);
    assert.equal(nan.valid, false);
    assert.ok(nan.errors.some((error) => error.includes("finite")));
    const inf = validatePortfolioWeights([
      { assetId: "A", weight: Number.POSITIVE_INFINITY },
    ]);
    assert.equal(inf.valid, false);
  });
});

describe("V: duplicate portfolio asset rejected", () => {
  it("validation reports the duplicate", () => {
    const result = validatePortfolioWeights([
      { assetId: "A", weight: 0.6 },
      { assetId: "A", weight: 0.4 },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("Duplicate")));
  });

  it("calculatePortfolioReturns throws InvalidPortfolioWeightsError", () => {
    const portfolio = {
      id: "PF",
      positions: [
        { assetId: "A", weight: 0.6 },
        { assetId: "A", weight: 0.4 },
      ],
    };
    const assetReturns = new Map([
      ["A", returnSeries("A", [{ date: "2026-09-08", value: 0.1 }])],
    ]);
    assert.throws(
      () => calculatePortfolioReturns({ portfolio, assetReturns }),
      InvalidPortfolioWeightsError,
    );
  });
});

describe("W: explicit weight normalization works", () => {
  it("scales weights to sum exactly 1", () => {
    const normalized = normalizePortfolioWeights([
      { assetId: "A", weight: 0.5 },
      { assetId: "B", weight: 0.25 },
    ]);
    assert.equal(normalized.length, 2);
    approx(normalized[0].weight, 0.5 / 0.75);
    approx(normalized[1].weight, 0.25 / 0.75);
    approx(normalized[0].weight + normalized[1].weight, 1);
  });

  it("does not mutate the input", () => {
    const positions = [
      { assetId: "A", weight: 0.5 },
      { assetId: "B", weight: 0.25 },
    ];
    const before = JSON.stringify(positions);
    normalizePortfolioWeights(positions);
    assert.equal(JSON.stringify(positions), before);
  });

  it("rejects zero-sum input", () => {
    assert.throws(
      () => normalizePortfolioWeights([{ assetId: "A", weight: 0 }]),
      InvalidPortfolioWeightsError,
    );
  });
});

describe("X: static weighted portfolio return calculation", () => {
  it("computes Rp = Σ wi * Ri,t", () => {
    const portfolio = {
      id: "PF",
      positions: [
        { assetId: "A", weight: 0.5 },
        { assetId: "B", weight: 0.5 },
      ],
    };
    const assetReturns = new Map([
      [
        "A",
        returnSeries("A", [
          { date: "2026-09-08", value: 0.1 },
          { date: "2026-09-09", value: 0.2 },
        ]),
      ],
      [
        "B",
        returnSeries("B", [
          { date: "2026-09-08", value: 0.02 },
          { date: "2026-09-09", value: -0.04 },
        ]),
      ],
    ]);
    const result = calculatePortfolioReturns({ portfolio, assetReturns });
    assert.equal(result.assetId, "PF");
    assert.deepEqual(result.points.map((point) => point.date), [
      "2026-09-08",
      "2026-09-09",
    ]);
    approx(result.points[0].value, 0.5 * 0.1 + 0.5 * 0.02);
    approx(result.points[1].value, 0.5 * 0.2 + 0.5 * -0.04);
  });
});

describe("Y: missing asset return series rejected", () => {
  it("throws MissingAssetReturnSeriesError", () => {
    const portfolio = {
      id: "PF",
      positions: [{ assetId: "A", weight: 1 }],
    };
    assert.throws(
      () =>
        calculatePortfolioReturns({ portfolio, assetReturns: new Map() }),
      MissingAssetReturnSeriesError,
    );
  });
});

describe("Z: missing date in one asset removes that date from whole portfolio", () => {
  it("intersection drops dates for the entire portfolio", () => {
    const portfolio = {
      id: "PF",
      positions: [
        { assetId: "A", weight: 0.6 },
        { assetId: "B", weight: 0.4 },
      ],
    };
    const assetReturns = new Map([
      [
        "A",
        returnSeries("A", [
          { date: "2026-09-08", value: 0.1 },
          { date: "2026-09-09", value: 0.2 },
          { date: "2026-09-10", value: 0.3 },
        ]),
      ],
      [
        "B",
        returnSeries("B", [
          { date: "2026-09-08", value: 0.05 },
          { date: "2026-09-10", value: 0.15 },
        ]),
      ],
    ]);
    const result = calculatePortfolioReturns({ portfolio, assetReturns });
    assert.deepEqual(result.points.map((point) => point.date), [
      "2026-09-08",
      "2026-09-10",
    ]);
  });
});

describe("AA: portfolio calculation does not mutate inputs", () => {
  it("leaves the portfolio and return series untouched", () => {
    const portfolio = {
      id: "PF",
      positions: [
        { assetId: "A", weight: 0.6 },
        { assetId: "B", weight: 0.4 },
      ],
    };
    const a = returnSeries("A", [
      { date: "2026-09-08", value: 0.1 },
      { date: "2026-09-09", value: 0.2 },
    ]);
    const b = returnSeries("B", [
      { date: "2026-09-08", value: 0.05 },
      { date: "2026-09-09", value: 0.1 },
    ]);
    const assetReturns = new Map([
      ["A", a],
      ["B", b],
    ]);
    const portfolioBefore = JSON.stringify(portfolio);
    const seriesBefore = JSON.stringify({ a, b });
    calculatePortfolioReturns({ portfolio, assetReturns });
    assert.equal(JSON.stringify(portfolio), portfolioBefore);
    assert.equal(JSON.stringify({ a, b }), seriesBefore);
  });
});

describe("AB: benchmark remains a generic ReturnSeries", () => {
  it("portfolio and benchmark align through alignReturnSeries", () => {
    const portfolioReturns = returnSeries("PF", [
      { date: "2026-09-08", value: 0.01 },
      { date: "2026-09-09", value: 0.02 },
    ]);
    const benchmark = returnSeries("BENCH", [
      { date: "2026-09-08", value: 0.005 },
      { date: "2026-09-09", value: 0.006 },
    ]);
    const aligned = alignReturnSeries(portfolioReturns, benchmark);
    assert.deepEqual(aligned.dates, ["2026-09-08", "2026-09-09"]);
    assert.deepEqual(aligned.right, [0.005, 0.006]);
  });

  it("no hardcoded benchmark names appear in portfolio code", () => {
    for (const file of [
      "lib/analytics/portfolio/types.ts",
      "lib/analytics/portfolio/align-series.ts",
      "lib/analytics/portfolio/portfolio-returns.ts",
      "lib/analytics/portfolio/index.ts",
    ]) {
      const source = readRoot(file);
      assert.equal(/SPY|S&P|NASDQ|Nasdaq|S&amp;P/i.test(source), false, file);
    }
  });
});

describe("AC: portfolio code has no forbidden imports", () => {
  const files = [
    "lib/analytics/portfolio/types.ts",
    "lib/analytics/portfolio/dates.ts",
    "lib/analytics/portfolio/prices.ts",
    "lib/analytics/portfolio/returns.ts",
    "lib/analytics/portfolio/align-series.ts",
    "lib/analytics/portfolio/weights.ts",
    "lib/analytics/portfolio/portfolio-returns.ts",
    "lib/analytics/portfolio/index.ts",
    "lib/financial-data/adapters/market-prices.ts",
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
  ];
  it("portfolio/financial-data adapter do not import app/network layers", () => {
    for (const file of files) {
      const source = readRoot(file);
      for (const pattern of forbidden) {
        assert.equal(pattern.test(source), false, `${file} must not match ${pattern}`);
      }
    }
  });

  it("analytics core stays free of market-data imports", () => {
    const coreFiles = files.filter((file) => file !== "lib/financial-data/adapters/market-prices.ts");
    for (const file of coreFiles) {
      assert.equal(
        readRoot(file).includes("market-data"),
        false,
        `${file} must not import market-data`,
      );
    }
  });
});

describe("AD: previous Analytics Engine tests still pass", () => {
  it("the engine still computes indicator chains", () => {
    const registry = new IndicatorRegistry();
    const define = (definition) => registry.register(definition);
    define({
      id: "mean",
      name: "Mean",
      version: "1.0.0",
      category: "trend",
      dependencies: { data: ["series"] },
      calculate: (context) => {
        const values = context.data.series.value;
        const total = values.reduce((acc, value) => acc + value, 0);
        return { value: total / values.length, status: "ok" };
      },
      metadata: { description: "d", methodology: "m", units: "u" },
    });
    define({
      id: "quad",
      name: "Quad",
      version: "1.0.0",
      category: "custom",
      dependencies: { indicators: ["mean"] },
      calculate: (context) => ({
        value: context.indicators.get("mean").value * 4,
        status: "ok",
      }),
      metadata: { description: "d", methodology: "m", units: "u" },
    });
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({
        indicators: ["quad"],
        context: { data: { series: { value: [1, 2, 3] } }, indicators: new Map(), asOf: "2026-09-10" },
      })
      .get("quad");
    assert.equal(result.value, 8);
    assert.equal(result.status, "ok");
  });
});

describe("Important numeric case (section 18)", () => {
  it("computes the weighted portfolio return within floating tolerance", () => {
    const portfolio = {
      id: "PF",
      positions: [
        { assetId: "A", weight: 0.6 },
        { assetId: "B", weight: 0.4 },
      ],
    };
    const assetReturns = new Map([
      [
        "A",
        returnSeries("A", [
          { date: "2026-09-08", value: 0.1 },
          { date: "2026-09-09", value: -0.05 },
        ]),
      ],
      [
        "B",
        returnSeries("B", [
          { date: "2026-09-08", value: 0.05 },
          { date: "2026-09-09", value: 0.1 },
        ]),
      ],
    ]);
    const result = calculatePortfolioReturns({ portfolio, assetReturns });
    assert.deepEqual(result.points.map((point) => point.date), [
      "2026-09-08",
      "2026-09-09",
    ]);
    approx(result.points[0].value, 0.6 * 0.1 + 0.4 * 0.05, 1e-12);
    approx(result.points[1].value, 0.6 * -0.05 + 0.4 * 0.1, 1e-12);
    approx(result.points[0].value, 0.08, 1e-12);
    approx(result.points[1].value, 0.01, 1e-12);
  });
});

describe("Market-data adapter boundary", () => {
  it("converts HistoricalPrice[] close values into sorted price points", () => {
    const historical = [
      { date: "2026-09-09", open: 1, high: 1, low: 1, close: 102, volume: 1 },
      { date: "2026-09-08", open: 1, high: 1, low: 1, close: 100, volume: 1 },
    ];
    const series = historicalPricesToPriceSeries(historical, "AAPL");
    assert.deepEqual(series, {
      assetId: "AAPL",
      points: [
        { date: "2026-09-08", value: 100 },
        { date: "2026-09-09", value: 102 },
      ],
    });
  });

  it("throws InvalidMarketCloseError for invalid closes instead of dropping them", () => {
    const historical = [
      { date: "2026-09-08", open: 1, high: 1, low: 1, close: null, volume: 1 },
      { date: "2026-09-09", open: 1, high: 1, low: 1, close: 105, volume: 1 },
    ];
    assert.throws(
      () => historicalPricesToPriceSeries(historical, "AAPL"),
      InvalidMarketCloseError,
    );
  });

  it("throws for non-finite and non-positive closes too", () => {
    assert.throws(
      () =>
        historicalPricesToPriceSeries(
          [{ date: "2026-09-08", open: 1, high: 1, low: 1, close: 0, volume: 1 }],
          "AAPL",
        ),
      InvalidMarketCloseError,
    );
    assert.throws(
      () =>
        historicalPricesToPriceSeries(
          [{ date: "2026-09-08", open: 1, high: 1, low: 1, close: Number.NaN, volume: 1 }],
          "AAPL",
        ),
      InvalidMarketCloseError,
    );
  });

  it("a single trailing invalid close is still never silently dropped", () => {
    const historical = [
      { date: "2026-09-08", open: 1, high: 1, low: 1, close: 100, volume: 1 },
      { date: "2026-09-09", open: 1, high: 1, low: 1, close: -1, volume: 1 },
    ];
    assert.throws(
      () => historicalPricesToPriceSeries(historical, "AAPL"),
      InvalidMarketCloseError,
    );
  });
});

describe("Micro-hardening A: zero-weight position needs no series", () => {
  it("calculates successfully with only the positive asset present", () => {
    const portfolio = {
      id: "PF",
      positions: [
        { assetId: "A", weight: 1 },
        { assetId: "B", weight: 0 },
      ],
    };
    const assetReturns = new Map([
      [
        "A",
        returnSeries("A", [
          { date: "2026-09-08", value: 0.1 },
          { date: "2026-09-09", value: 0.2 },
        ]),
      ],
    ]);
    const result = calculatePortfolioReturns({ portfolio, assetReturns });
    assert.equal(result.assetId, "PF");
    assert.deepEqual(result.points.map((point) => point.date), [
      "2026-09-08",
      "2026-09-09",
    ]);
    approx(result.points[0].value, 0.1);
    approx(result.points[1].value, 0.2);
  });
});

describe("Micro-hardening B: zero-weight position does not affect dates", () => {
  it("a zero-weight asset with different dates never restricts the portfolio", () => {
    const portfolio = {
      id: "PF",
      positions: [
        { assetId: "A", weight: 1 },
        { assetId: "B", weight: 0 },
      ],
    };
    const assetReturns = new Map([
      [
        "A",
        returnSeries("A", [
          { date: "2026-09-08", value: 0.1 },
          { date: "2026-09-09", value: 0.2 },
          { date: "2026-09-10", value: 0.3 },
        ]),
      ],
      // B has wildly different dates but weight 0 => ignored entirely
      [
        "B",
        returnSeries("B", [
          { date: "2027-01-01", value: 0.5 },
          { date: "2027-02-02", value: 0.6 },
        ]),
      ],
    ]);
    const result = calculatePortfolioReturns({ portfolio, assetReturns });
    assert.deepEqual(result.points.map((point) => point.date), [
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
    ]);
  });
});

describe("Micro-hardening C: positive missing asset still errors", () => {
  it("throws MissingAssetReturnSeriesError when a positive position lacks a series", () => {
    const portfolio = {
      id: "PF",
      positions: [
        { assetId: "A", weight: 0.5 },
        { assetId: "B", weight: 0.5 },
      ],
    };
    const assetReturns = new Map([
      [
        "A",
        returnSeries("A", [{ date: "2026-09-08", value: 0.1 }]),
      ],
    ]);
    assert.throws(
      () => calculatePortfolioReturns({ portfolio, assetReturns }),
      MissingAssetReturnSeriesError,
    );
  });
});

describe("Micro-hardening D: normalizeReturnSeries sorts", () => {
  it("reorders unsorted returns by canonical date", () => {
    const series = returnSeries("A", [
      { date: "2026-09-10", value: 0.3 },
      { date: "2026-09-08", value: 0.1 },
      { date: "2026-09-09", value: 0.2 },
    ]);
    const normalized = normalizeReturnSeries(series);
    assert.deepEqual(
      normalized.points.map((point) => point.date),
      ["2026-09-08", "2026-09-09", "2026-09-10"],
    );
    assert.deepEqual(
      normalized.points.map((point) => point.value),
      [0.1, 0.2, 0.3],
    );
  });
});

describe("Micro-hardening E: duplicate return date rejected", () => {
  it("throws DuplicateDateError instead of overwriting by Map", () => {
    const series = returnSeries("A", [
      { date: "2026-09-08", value: 0.1 },
      { date: "2026-09-08", value: 0.2 },
    ]);
    assert.throws(() => normalizeReturnSeries(series), DuplicateDateError);
  });
});

describe("Micro-hardening F: invalid return date rejected", () => {
  it("rejects non-canonical return dates", () => {
    assert.throws(
      () =>
        normalizeReturnSeries(
          returnSeries("A", [{ date: "2026-02-30", value: 0.1 }]),
        ),
      InvalidReturnSeriesError,
    );
    assert.throws(
      () =>
        normalizeReturnSeries(
          returnSeries("A", [{ date: "09/10/2026", value: 0.1 }]),
        ),
      InvalidReturnSeriesError,
    );
  });
});

describe("Micro-hardening G: NaN/Infinity return rejected", () => {
  it("rejects non-finite return values while allowing negatives", () => {
    assert.throws(
      () =>
        normalizeReturnSeries(
          returnSeries("A", [{ date: "2026-09-08", value: Number.NaN }]),
        ),
      InvalidReturnSeriesError,
    );
    assert.throws(
      () =>
        normalizeReturnSeries(
          returnSeries("A", [{ date: "2026-09-08", value: Number.NEGATIVE_INFINITY }]),
        ),
      InvalidReturnSeriesError,
    );
    assert.deepEqual(
      normalizeReturnSeries(
        returnSeries("A", [{ date: "2026-09-08", value: -0.5 }]),
      ).points[0].value,
      -0.5,
    );
  });
});

describe("Micro-hardening H: normalizeReturnSeries does not mutate", () => {
  it("leaves the input series untouched", () => {
    const series = returnSeries("A", [
      { date: "2026-09-10", value: 0.3 },
      { date: "2026-09-08", value: 0.1 },
    ]);
    const before = JSON.stringify(series);
    normalizeReturnSeries(series);
    assert.equal(JSON.stringify(series), before);
  });
});

describe("Micro-hardening I: alignReturnSeries rejects duplicate dates", () => {
  it("throws DuplicateDateError via internal normalization", () => {
    const left = returnSeries("A", [
      { date: "2026-09-08", value: 0.1 },
      { date: "2026-09-08", value: 0.2 },
    ]);
    const right = returnSeries("B", [{ date: "2026-09-08", value: 0.01 }]);
    assert.throws(() => alignReturnSeries(left, right), DuplicateDateError);
  });
});

describe("Micro-hardening J: alignMultipleReturnSeries rejects malformed series", () => {
  it("throws for invalid dates and NaN values", () => {
    const good = returnSeries("A", [{ date: "2026-09-08", value: 0.1 }]);
    const badDate = returnSeries("B", [{ date: "2026-13-01", value: 0.1 }]);
    assert.throws(
      () => alignMultipleReturnSeries([good, badDate]),
      InvalidReturnSeriesError,
    );
    const badValue = returnSeries("C", [{ date: "2026-09-08", value: Number.NaN }]);
    assert.throws(
      () => alignMultipleReturnSeries([good, badValue]),
      InvalidReturnSeriesError,
    );
  });
});

describe("Micro-hardening K: calculateSimpleReturns handles unsorted prices", () => {
  it("produces chronological returns for unsorted input", () => {
    const returns = calculateSimpleReturns(
      priceSeries("A", [
        { date: "2026-09-10", value: 110 },
        { date: "2026-09-08", value: 100 },
        { date: "2026-09-09", value: 105 },
      ]),
    );
    assert.deepEqual(returns.points.map((point) => point.date), [
      "2026-09-09",
      "2026-09-10",
    ]);
    approx(returns.points[0].value, 0.05);
    approx(returns.points[1].value, 110 / 105 - 1);
  });
});

describe("Micro-hardening L: empty portfolio id rejected", () => {
  it("throws InvalidPortfolioDefinitionError for empty id", () => {
    const portfolio = {
      id: "",
      positions: [{ assetId: "A", weight: 1 }],
    };
    const assetReturns = new Map([
      ["A", returnSeries("A", [{ date: "2026-09-08", value: 0.1 }])],
    ]);
    assert.throws(
      () => calculatePortfolioReturns({ portfolio, assetReturns }),
      InvalidPortfolioDefinitionError,
    );
  });

  it("never returns a series with an empty assetId", () => {
    const portfolio = {
      id: "PF",
      positions: [{ assetId: "A", weight: 1 }],
    };
    const assetReturns = new Map([
      ["A", returnSeries("A", [{ date: "2026-09-08", value: 0.1 }])],
    ]);
    const result = calculatePortfolioReturns({ portfolio, assetReturns });
    assert.equal(result.assetId, "PF");
  });
});

describe("Micro-hardening M: Map key / ReturnSeries.assetId mismatch rejected", () => {
  it("throws AssetSeriesKeyMismatchError instead of producing undefined/NaN", () => {
    const portfolio = {
      id: "PF",
      positions: [{ assetId: "AAPL", weight: 1 }],
    };
    const assetReturns = new Map([
      ["AAPL", returnSeries("MSFT", [{ date: "2026-09-08", value: 0.1 }])],
    ]);
    assert.throws(
      () => calculatePortfolioReturns({ portfolio, assetReturns }),
      AssetSeriesKeyMismatchError,
    );
  });
});

describe("Micro-hardening N: adapter invalid close throws", () => {
  it("never silently drops an observation", () => {
    const historical = [
      { date: "2026-09-08", open: 1, high: 1, low: 1, close: 100, volume: 1 },
      { date: "2026-09-09", open: 1, high: 1, low: 1, close: null, volume: 1 },
    ];
    assert.throws(
      () => historicalPricesToPriceSeries(historical, "AAPL"),
      InvalidMarketCloseError,
    );
  });
});

describe("Micro-hardening O: previous 219 tests remain green", () => {
  it("the 60/40 weighted case still matches exactly", () => {
    const portfolio = {
      id: "PF",
      positions: [
        { assetId: "A", weight: 0.6 },
        { assetId: "B", weight: 0.4 },
      ],
    };
    const assetReturns = new Map([
      [
        "A",
        returnSeries("A", [
          { date: "2026-09-08", value: 0.1 },
          { date: "2026-09-09", value: -0.05 },
        ]),
      ],
      [
        "B",
        returnSeries("B", [
          { date: "2026-09-08", value: 0.05 },
          { date: "2026-09-09", value: 0.1 },
        ]),
      ],
    ]);
    const result = calculatePortfolioReturns({ portfolio, assetReturns });
    approx(result.points[0].value, 0.08, 1e-12);
    approx(result.points[1].value, 0.01, 1e-12);
  });

  it("date validation and canonical helpers are unchanged", () => {
    assert.equal(isCanonicalDate("2024-02-29"), true);
    assert.equal(isCanonicalDate("2026-02-30"), false);
    approx(alignReturnSeries(
      returnSeries("A", [{ date: "2026-09-08", value: 0.1 }]),
      returnSeries("B", [{ date: "2026-09-08", value: 0.2 }]),
    ).left[0], 0.1);
  });
});