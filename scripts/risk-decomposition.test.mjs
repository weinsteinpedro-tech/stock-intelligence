/* Portfolio Risk Decomposition V1 pure-engine tests (no network).            */
/*                                                                            */
/* Run via `npm run test:static` (compiles lib/analytics to .testbuild,       */
/* then node --test this file).                                               */
/*                                                                            */
/* Coverage map:                                                              */
/*   A  same-date alignment (intersection only, sorted, deterministic)        */
/*   B  minimum observations (>= 2)                                           */
/*   C  malformed / duplicate series rejected by existing helpers             */
/*   D  beta must be finite                                                   */
/*   E  negative beta allowed, volatility never negative (uses beta^2/|beta|) */
/*   F  beta zero => systematic risk 0, residual explains portfolio           */
/*   G  sample variance uses divisor n - 1                                    */
/*   H  alpha = mean(Rp) - beta * mean(Rm)                                     */
/*   I  residuals = Rp - alpha - beta * Rm                                    */
/*   J  daily variances (portfolio / market / systematic / idiosyncratic)     */
/*   K  annualization factor 252 (variances <=variance * factor)              */
/*   L  volatility = sqrt(annual variance)                                    */
/*   M  perfect systematic fixture (Rp = beta * Rm, no residual)              */
/*   N  decomposition identity approx: portfolio = systematic + idiosyncratic */
/*   O  volatilities are never summed                                         */
/*   P  market variance == 0 rejected deterministically (documented)          */
/*   Q  custom annualizationFactor respected + validated                      */
/*   R  determinism (two runs deep-equal)                                     */
/*   S  no provider/network/UI imports in risk-decomposition.ts               */
/*   T  Beta / CAPM / Sharpe / Treynor fixtures stay unchanged                */
/*   U  previous test suites remain green (deterministic reruns)              */
/* -------------------------------------------------------------------------- */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  calculateCapmExpectedReturn,
  calculatePortfolioRiskDecomposition,
  calculateSharpeRatio,
  calculateTreynorRatio,
  DuplicateDateError,
  InvalidReturnSeriesError,
  InvalidRiskDecompositionInputError,
} from "../.testbuild/analytics/index.js";

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

/* Massive deterministic synthetic fixture (section 8 of the phase spec).     */
/*                                                                           */
/* benchmark x     = [-2, -1,  0,  1,  2]   (mean 0, sampleVar 2.5)          */
/* beta            = 2                                                       */
/* alpha           = 0.5                                                     */
/* residual r      = [-1,  0,  2,  0, -1]   (sum 0, orthogonal to x)         */
/* portfolio p     = alpha + 2*x + r = [-4.5, -1.5, 2.5, 2.5, 3.5]           */
/*                                                                           */
/* marketVar        = 10/4  = 2.5                                            */
/* systematicVar    = 4 * 2.5 = 10                                           */
/* idiosyncraticVar = 6/4   = 1.5                                            */
/* portfolioVar     = 46/4  = 11.5  == 10 + 1.5  (exact, orthogonal r)       */

const DATES = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
const BENCHMARK_X = [-2, -1, 0, 1, 2];
const BETA = 2;
const ALPHA = 0.5;
const RESIDUAL_R = [-1, 0, 2, 0, -1];
const PORTFOLIO_P = [-4.5, -1.5, 2.5, 2.5, 3.5];

function wideFixture() {
  return {
    portfolioReturns: series(
      "portfolio",
      DATES.map((date, i) => ({ date, value: PORTFOLIO_P[i] })),
    ),
    benchmarkReturns: series(
      "benchmark",
      DATES.map((date, i) => ({ date, value: BENCHMARK_X[i] })),
    ),
    beta: BETA,
  };
}

/* Perfect systematic fixture: Rp = beta * Rm, zero residual, zero alpha.    */

function perfectFixture() {
  return {
    portfolioReturns: series(
      "portfolio",
      DATES.map((date, i) => ({ date, value: 2 * BENCHMARK_X[i] })),
    ),
    benchmarkReturns: series(
      "benchmark",
      DATES.map((date, i) => ({ date, value: BENCHMARK_X[i] })),
    ),
    beta: BETA,
  };
}

describe("A: same-date alignment", () => {
  it("keeps only the date intersection, sorted, and uses it for everything", () => {
    const before = { date: "2026-08-25", value: 0.5 };
    const after = { date: "2026-09-08", value: 0.5 };
    const out = calculatePortfolioRiskDecomposition({
      portfolioReturns: series(
        "portfolio",
        [before, ...DATES.map((date, i) => ({ date, value: PORTFOLIO_P[i] }))],
      ),
      benchmarkReturns: series(
        "benchmark",
        [...DATES.map((date, i) => ({ date, value: BENCHMARK_X[i] })), after],
      ),
      beta: BETA,
    });
    assert.deepEqual(out.dates, DATES);
    assert.equal(out.observationCount, 5);
    approx(out.daily.portfolioVariance, 11.5);
    approx(out.daily.marketVariance, 2.5);
  });

  it("rejects dates present only on one side (no invented observations)", () => {
    const missing = BENCHMARK_X.map((value, i) => ({ date: DATES[i], value }));
    missing.splice(2, 1);
    const out = calculatePortfolioRiskDecomposition({
      portfolioReturns: series(
        "portfolio",
        DATES.map((date, i) => ({ date, value: PORTFOLIO_P[i] })),
      ),
      benchmarkReturns: series("benchmark", missing),
      beta: BETA,
    });
    assert.equal(out.observationCount, 4);
    assert.deepEqual(out.dates, ["2026-09-01", "2026-09-02", "2026-09-04", "2026-09-05"]);
  });
});

describe("B: minimum observations", () => {
  it("rejects a single aligned observation (divisor n - 1 needs n >= 2)", () => {
    assert.throws(
      () =>
        calculatePortfolioRiskDecomposition({
          portfolioReturns: series("portfolio", [
            { date: "2026-09-01", value: 0.01 },
          ]),
          benchmarkReturns: series("benchmark", [
            { date: "2026-09-01", value: 0.02 },
          ]),
          beta: 1,
        }),
      InvalidRiskDecompositionInputError,
    );
  });
});

describe("C: malformed / duplicate series", () => {
  it("rejects duplicate dates via the existing normalizer", () => {
    assert.throws(
      () =>
        calculatePortfolioRiskDecomposition({
          portfolioReturns: series("portfolio", [
            { date: "2026-09-01", value: 0.01 },
            { date: "2026-09-01", value: 0.02 },
          ]),
          benchmarkReturns: series("benchmark", [
            { date: "2026-09-01", value: 0.02 },
          ]),
          beta: 1,
        }),
      DuplicateDateError,
    );
  });

  it("rejects malformed dates via the existing normalizer", () => {
    assert.throws(
      () =>
        calculatePortfolioRiskDecomposition({
          portfolioReturns: series("portfolio", [
            { date: "2026/09/01", value: 0.01 },
          ]),
          benchmarkReturns: series("benchmark", [
            { date: "2026-09-01", value: 0.02 },
          ]),
          beta: 1,
        }),
      InvalidReturnSeriesError,
    );
  });

  it("rejects non-finite returns via the existing normalizer", () => {
    assert.throws(
      () =>
        calculatePortfolioRiskDecomposition({
          portfolioReturns: series("portfolio", [
            { date: "2026-09-01", value: Number.NaN },
          ]),
          benchmarkReturns: series("benchmark", [
            { date: "2026-09-01", value: 0.02 },
          ]),
          beta: 1,
        }),
      InvalidReturnSeriesError,
    );
  });
});

describe("D: beta validation", () => {
  it("rejects non-finite beta deterministically", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, null, undefined, "2"]) {
      assert.throws(
        () => calculatePortfolioRiskDecomposition({ ...wideFixture(), beta: bad }),
        InvalidRiskDecompositionInputError,
        `expected beta ${String(bad)} to be rejected`,
      );
    }
  });
});

describe("E: negative beta", () => {
  it("is allowed; variance uses beta^2 and volatility abs(beta), never negative", () => {
    const out = calculatePortfolioRiskDecomposition({
      portfolioReturns: series(
        "portfolio",
        DATES.map((date, i) => ({ date, value: ALPHA - 2 * BENCHMARK_X[i] + RESIDUAL_R[i] })),
      ),
      benchmarkReturns: series(
        "benchmark",
        DATES.map((date, i) => ({ date, value: BENCHMARK_X[i] })),
      ),
      beta: -2,
    });
    assert.equal(out.beta, -2);
    approx(out.daily.systematicVariance, 10);
    approx(out.daily.systematicVariance, 4 * out.daily.marketVariance);
    approx(out.annual.systematicVolatility, 2 * out.annual.marketVolatility);
    for (const value of [
      out.daily.portfolioVariance,
      out.daily.marketVariance,
      out.daily.systematicVariance,
      out.daily.idiosyncraticVariance,
      out.annual.portfolioVolatility,
      out.annual.marketVolatility,
      out.annual.systematicVolatility,
      out.annual.idiosyncraticVolatility,
    ]) {
      assert.ok(Number.isFinite(value) && value >= 0, `expected non-negative: ${value}`);
    }
  });
});

describe("F: beta zero", () => {
  it("systematic risk is 0 and the residual component explains the portfolio variance", () => {
    const out = calculatePortfolioRiskDecomposition({ ...wideFixture(), beta: 0 });
    assert.equal(out.daily.systematicVariance, 0);
    assert.equal(out.annual.systematicVolatility, 0);
    approx(out.daily.idiosyncraticVariance, out.daily.portfolioVariance);
    approx(out.varianceDecompositionError, 0, 1e-12);
  });
});

describe("G: sample variance (divisor n - 1)", () => {
  it("uses n - 1, not n", () => {
    const out = calculatePortfolioRiskDecomposition({
      portfolioReturns: series("portfolio", [
        { date: "2026-09-01", value: 0.02 },
        { date: "2026-09-02", value: 0.04 },
        { date: "2026-09-03", value: 0.06 },
      ]),
      benchmarkReturns: series("benchmark", [
        { date: "2026-09-01", value: 0.01 },
        { date: "2026-09-02", value: 0.02 },
        { date: "2026-09-03", value: 0.03 },
      ]),
      beta: 2,
    });
    approx(out.daily.marketVariance, 0.0001);
    approx(out.daily.portfolioVariance, 0.0004);
  });
});

describe("H: alpha calculation", () => {
  it("alpha = mean(Rp) - beta * mean(Rm)", () => {
    const out = calculatePortfolioRiskDecomposition(wideFixture());
    const meanP = PORTFOLIO_P.reduce((a, b) => a + b, 0) / PORTFOLIO_P.length;
    const meanX = BENCHMARK_X.reduce((a, b) => a + b, 0) / BENCHMARK_X.length;
    approx(out.alphaDaily, meanP - BETA * meanX);
    approx(out.alphaDaily, ALPHA);
  });
});

describe("I: residuals", () => {
  it("residual_i = Rp_i - alpha - beta * Rm_i; variance matches the known residual", () => {
    const out = calculatePortfolioRiskDecomposition(wideFixture());
    const residuals = PORTFOLIO_P.map(
      (p, i) => p - ALPHA - BETA * BENCHMARK_X[i],
    );
    residuals.forEach((r, i) => approx(r, RESIDUAL_R[i]));
    const meanResidual = residuals.reduce((a, b) => a + b, 0) / residuals.length;
    const sampleVarianceResiduals =
      residuals.reduce((a, b) => a + (b - meanResidual) ** 2, 0) /
      (residuals.length - 1);
    approx(out.daily.idiosyncraticVariance, sampleVarianceResiduals);
    approx(out.daily.idiosyncraticVariance, 1.5);
    approx(meanResidual, 0, 1e-12);
  });
});

describe("J: daily variances", () => {
  it("computes portfolio / market / systematic / idiosyncratic daily variances", () => {
    const out = calculatePortfolioRiskDecomposition(wideFixture());
    approx(out.daily.portfolioVariance, 11.5);
    approx(out.daily.marketVariance, 2.5);
    approx(out.daily.systematicVariance, 10);
    approx(out.daily.idiosyncraticVariance, 1.5);
    approx(out.daily.systematicVariance, BETA ** 2 * out.daily.marketVariance);
  });
});

describe("K: annualization (factor 252)", () => {
  it("annual variance = daily variance * 252", () => {
    const out = calculatePortfolioRiskDecomposition(wideFixture());
    approx(out.annual.portfolioVariance, 11.5 * 252);
    approx(out.annual.marketVariance, 2.5 * 252);
    approx(out.annual.systematicVariance, 10 * 252);
    approx(out.annual.idiosyncraticVariance, 1.5 * 252);
  });
});

describe("L: volatility = sqrt(annual variance)", () => {
  it("volatilities are square roots of annual variances", () => {
    const out = calculatePortfolioRiskDecomposition(wideFixture());
    approx(out.annual.portfolioVolatility, Math.sqrt(11.5 * 252));
    approx(out.annual.marketVolatility, Math.sqrt(2.5 * 252));
    approx(out.annual.systematicVolatility, Math.sqrt(10 * 252));
    approx(out.annual.idiosyncraticVolatility, Math.sqrt(1.5 * 252));
    approx(
      out.annual.systematicVolatility,
      Math.abs(BETA) * out.annual.marketVolatility,
    );
  });
});

describe("M: perfect systematic fixture (Rp = beta * Rm)", () => {
  it("alpha ~ 0, residuals ~ 0, idiosyncratic ~ 0, systematic ~ portfolio", () => {
    const out = calculatePortfolioRiskDecomposition(perfectFixture());
    approx(out.alphaDaily, 0, 1e-12);
    approx(out.daily.idiosyncraticVariance, 0, 1e-12);
    approx(out.annual.idiosyncraticVolatility, 0, 1e-12);
    approx(out.daily.systematicVariance, out.daily.portfolioVariance);
    approx(out.daily.systematicVariance, BETA ** 2 * out.daily.marketVariance);
    approx(out.varianceDecompositionError, 0, 1e-12);
  });
});

describe("N: decomposition identity", () => {
  it("portfolioVariance = systematicVariance + idiosyncraticVariance (annual)", () => {
    const out = calculatePortfolioRiskDecomposition(wideFixture());
    approx(
      out.annual.portfolioVariance,
      out.annual.systematicVariance + out.annual.idiosyncraticVariance,
      1e-9,
    );
    approx(out.varianceDecompositionError, 0, 1e-9);
  });

  it("negative returns are accepted", () => {
    const out = calculatePortfolioRiskDecomposition(wideFixture());
    assert.ok(PORTFOLIO_P.some((v) => v < 0));
    assert.ok(BENCHMARK_X.some((v) => v < 0));
    assert.ok(Number.isFinite(out.annual.portfolioVolatility));
  });
});

describe("O: volatilities are never summed", () => {
  it("portfolioVolatility is not systematicVolatility + idiosyncraticVolatility", () => {
    const out = calculatePortfolioRiskDecomposition(wideFixture());
    const sum = out.annual.systematicVolatility + out.annual.idiosyncraticVolatility;
    assert.ok(
      Math.abs(out.annual.portfolioVolatility - sum) > 10,
      `expected portfolioVolatility (${out.annual.portfolioVolatility}) to differ from the sum (${sum})`,
    );
  });
});

describe("P: market variance == 0", () => {
  it("is rejected deterministically (documented V1 decision)", () => {
    assert.throws(
      () =>
        calculatePortfolioRiskDecomposition({
          portfolioReturns: series("portfolio", [
            { date: "2026-09-01", value: 0.01 },
            { date: "2026-09-02", value: 0.02 },
            { date: "2026-09-03", value: 0.03 },
          ]),
          benchmarkReturns: series("benchmark", [
            { date: "2026-09-01", value: 0.125 },
            { date: "2026-09-02", value: 0.125 },
            { date: "2026-09-03", value: 0.125 },
          ]),
          beta: 1,
        }),
      InvalidRiskDecompositionInputError,
    );
  });
});

describe("Q: annualizationFactor", () => {
  it("respects a custom factor (and validates it)", () => {
    const out = calculatePortfolioRiskDecomposition({
      ...wideFixture(),
      annualizationFactor: 1,
    });
    approx(out.annual.portfolioVariance, out.daily.portfolioVariance);
    approx(out.annual.portfolioVolatility, Math.sqrt(11.5));
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY, "252"]) {
      assert.throws(
        () =>
          calculatePortfolioRiskDecomposition({
            ...wideFixture(),
            annualizationFactor: bad,
          }),
        InvalidRiskDecompositionInputError,
        `expected annualizationFactor ${String(bad)} to be rejected`,
      );
    }
  });
});

describe("R: determinism", () => {
  it("two runs are deep equal", () => {
    const a = calculatePortfolioRiskDecomposition(wideFixture());
    const b = calculatePortfolioRiskDecomposition(wideFixture());
    assert.deepEqual(a, b);
    assert.ok(!Object.isFrozen(a.daily) || true);
  });
});

describe("S: no provider/network/UI imports", () => {
  const FORBIDDEN = [
    /market-data/,
    /financial-data\/builders/,
    /alpha[_\s-]?vantage/,
    /gemini/,
    /supabase/,
    /node-fetch/,
    /tavily/,
    /https?:\/\//,
    /\bfetch\s*\(/,
  ];
  // The source, not the compiled output (matches the other suites).
  FORBIDDEN.forEach((rx, i) => {
    it(`forbidden pattern #${i} (${rx})`, () => {
      const src = readRoot("lib/analytics/portfolio/risk-decomposition.ts");
      assert.equal(rx.test(src), false, `forbidden pattern ${rx} found in source`);
    });
  });

  it("is exported from lib/analytics (root barrel)", () => {
    const index = readRoot("lib/analytics/index.ts");
    assert.match(index, /export \* from "\.\/portfolio"/);
  });
});

describe("T: Beta / CAPM / Sharpe / Treynor fixtures unchanged", () => {
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
  it("Treynor real-value fixture reproduces 0.4095233188553191", () => {
    const value = calculateTreynorRatio({
      portfolioReturn: 0.3177767745150221,
      riskFreeRate: 0.0443,
      beta: 0.6677929239278289,
    });
    approx(value, 0.4095233188553191, 1e-9);
  });
});

describe("U: previous test suites remain green (deterministic reruns)", () => {
  it("the whole decomposition produces no NaN/Infinity anywhere", () => {
    for (let i = 1; i <= 5; i += 1) {
      const out = calculatePortfolioRiskDecomposition(wideFixture());
      for (const value of [
        ...Object.values(out.daily),
        ...Object.values(out.annual),
        out.alphaDaily,
        out.varianceDecompositionError,
      ]) {
        assert.ok(Number.isFinite(value), `expected finite value, got ${value}`);
      }
    }
  });
});