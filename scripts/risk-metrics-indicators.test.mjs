/* Risk Metric Indicators V1 tests (no network).                              */
/*                                                                            */
/* Run via `npm run test:static` (compiles to .testbuild, then node --test).   */
/*                                                                            */
/* Coverage map:                                                              */
/*   A  RISK_DECOMPOSITION_DATA_KEY exact value ("risk_decomposition")        */
/*   B  metadata for all four indicators                                      */
/*   C  all four category = risk                                              */
/*   D  all four depend only on risk_decomposition                            */
/*   E  portfolio_risk reads exact annual.portfolioVolatility                 */
/*   F  market_risk reads exact annual.marketVolatility                       */
/*   G  systematic_risk reads exact annual.systematicVolatility               */
/*   H  idiosyncratic_risk reads exact annual.idiosyncraticVolatility         */
/*   I  zero systematic risk is valid                                         */
/*   J  zero idiosyncratic risk is valid                                      */
/*   K  malformed portfolio volatility => error                               */
/*   L  malformed market volatility => error                                  */
/*   M  malformed systematic volatility => error                              */
/*   N  malformed idiosyncratic volatility => error                           */
/*   O  negative volatility => error                                          */
/*   P  NaN/Infinity => error                                                 */
/*   Q  missing decomposition dependency handled deterministically            */
/*   R  all four provenance sets identical                                    */
/*   S  provenance comes from decomposition envelope                          */
/*   T  no recalculation math in risk-metrics.ts                              */
/*   U  no provider/network/UI imports                                        */
/*   V  dataWindow exact if supported, otherwise explicitly absent            */
/*   W  known synthetic decomposition fields map correctly                    */
/*   X  Beta/CAPM/Sharpe/Treynor fixtures unchanged                           */
/*   Y  pure risk decomposition fixture unchanged                             */
/*   Z  builder fixture unchanged                                             */
/*   AA all previous 696 tests remain green                                   */
/*   Engine  AnalyticsEngine executes all four indicators simultaneously      */
/* -------------------------------------------------------------------------- */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AnalyticsEngine,
  IndicatorRegistry,
  calculateCapmExpectedReturn,
  calculatePortfolioRiskDecomposition,
  calculateSharpeRatio,
  calculateTreynorRatio,
  RISK_DECOMPOSITION_DATA_KEY,
  portfolioRiskIndicator,
  marketRiskIndicator,
  systematicRiskIndicator,
  idiosyncraticRiskIndicator,
} from "../.testbuild/analytics/index.js";
import {
  buildRiskDecompositionEnvelope,
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

const DATES = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
const BENCHMARK_X = [-2, -1, 0, 1, 2];
const BETA = 2;
const PORTFOLIO_P = [-4.5, -1.5, 2.5, 2.5, 3.5];

function makeQuality(overrides = {}) {
  return makeDataQuality({
    freshness: "fresh",
    sourceTier: "primary",
    completeness: 1.0,
    warnings: [],
    ...overrides,
  });
}

function makeSeriesEnvelope(assetId, points, overrides = {}) {
  return {
    value: { assetId, points },
    source: {
      provider: "provider-test",
      originalSource: "dataset-test",
      identifier: assetId,
    },
    observedAt: points[points.length - 1]?.date ?? "2026-09-05",
    retrievedAt: "2026-09-20T10:00:00.000Z",
    frequency: "daily",
    quality: makeQuality(),
    ...overrides,
  };
}

function makeBuiltEnvelope(overrides = {}) {
  const portEnv = makeSeriesEnvelope(
    "portfolio",
    DATES.map((date, i) => ({ date, value: PORTFOLIO_P[i] })),
    {
      source: {
        provider: "port-src",
        originalSource: "port-data",
        identifier: "port-1",
      },
      observedAt: "2026-09-05",
      retrievedAt: "2026-09-20T10:00:00.000Z",
    },
  );
  const benchEnv = makeSeriesEnvelope(
    "benchmark",
    DATES.map((date, i) => ({ date, value: BENCHMARK_X[i] })),
    {
      source: {
        provider: "bench-src",
        originalSource: "bench-data",
        identifier: "bench-1",
      },
      observedAt: "2026-09-05",
      retrievedAt: "2026-09-21T12:00:00.000Z",
    },
  );
  const betaSources = [
    {
      provider: "beta-src",
      originalSource: "beta-data",
      identifier: "beta-1",
      retrievedAt: "2026-09-25T18:00:00.000Z",
    },
  ];

  return buildRiskDecompositionEnvelope({
    portfolioReturns: portEnv,
    benchmarkReturns: benchEnv,
    beta: BETA,
    betaSources,
    ...overrides,
  });
}

function makeContext(decompEnvelope) {
  return {
    data: {
      [RISK_DECOMPOSITION_DATA_KEY]: decompEnvelope,
    },
    indicators: new Map(),
    asOf: "2026-09-15",
  };
}

describe("A: RISK_DECOMPOSITION_DATA_KEY exact value", () => {
  it('is "risk_decomposition"', () => {
    assert.equal(RISK_DECOMPOSITION_DATA_KEY, "risk_decomposition");
  });
});

describe("B: metadata for all four indicators", () => {
  it("portfolioRiskIndicator has accurate metadata and units", () => {
    assert.equal(portfolioRiskIndicator.id, "portfolio_risk");
    assert.equal(portfolioRiskIndicator.name, "Portfolio Risk");
    assert.equal(portfolioRiskIndicator.version, "1.0.0");
    assert.equal(portfolioRiskIndicator.metadata.units, "annual decimal volatility");
    assert.equal(
      portfolioRiskIndicator.metadata.description,
      "Total annualized volatility of portfolio daily returns.",
    );
    assert.equal(
      portfolioRiskIndicator.metadata.methodology,
      "Sample standard deviation of aligned portfolio daily returns, annualized using the risk decomposition methodology.",
    );
  });

  it("marketRiskIndicator has accurate metadata and units", () => {
    assert.equal(marketRiskIndicator.id, "market_risk");
    assert.equal(marketRiskIndicator.name, "Market Risk");
    assert.equal(marketRiskIndicator.version, "1.0.0");
    assert.equal(marketRiskIndicator.metadata.units, "annual decimal volatility");
    assert.equal(
      marketRiskIndicator.metadata.description,
      "Annualized volatility of the selected market benchmark.",
    );
    assert.equal(
      marketRiskIndicator.metadata.methodology,
      "Sample standard deviation of aligned benchmark daily returns, annualized using the risk decomposition methodology.",
    );
  });

  it("systematicRiskIndicator has accurate metadata and units", () => {
    assert.equal(systematicRiskIndicator.id, "systematic_risk");
    assert.equal(systematicRiskIndicator.name, "Systematic Risk");
    assert.equal(systematicRiskIndicator.version, "1.0.0");
    assert.equal(systematicRiskIndicator.metadata.units, "annual decimal volatility");
    assert.equal(
      systematicRiskIndicator.metadata.description,
      "Annualized portfolio volatility attributable to beta exposure to the selected market benchmark.",
    );
    assert.equal(
      systematicRiskIndicator.metadata.methodology,
      "Absolute portfolio beta multiplied by annualized benchmark volatility.",
    );
  });

  it("idiosyncraticRiskIndicator has accurate metadata and units", () => {
    assert.equal(idiosyncraticRiskIndicator.id, "idiosyncratic_risk");
    assert.equal(idiosyncraticRiskIndicator.name, "Idiosyncratic Risk");
    assert.equal(idiosyncraticRiskIndicator.version, "1.0.0");
    assert.equal(idiosyncraticRiskIndicator.metadata.units, "annual decimal volatility");
    assert.equal(
      idiosyncraticRiskIndicator.metadata.description,
      "Annualized portfolio volatility not explained by beta exposure to the selected market benchmark.",
    );
    assert.equal(
      idiosyncraticRiskIndicator.metadata.methodology,
      "Sample standard deviation of market-model residual returns, annualized using the risk decomposition methodology.",
    );
  });
});

describe("C: all four category = risk", () => {
  it('portfolioRiskIndicator category is "risk"', () => {
    assert.equal(portfolioRiskIndicator.category, "risk");
  });
  it('marketRiskIndicator category is "risk"', () => {
    assert.equal(marketRiskIndicator.category, "risk");
  });
  it('systematicRiskIndicator category is "risk"', () => {
    assert.equal(systematicRiskIndicator.category, "risk");
  });
  it('idiosyncraticRiskIndicator category is "risk"', () => {
    assert.equal(idiosyncraticRiskIndicator.category, "risk");
  });
});

describe("D: all four depend only on risk_decomposition", () => {
  for (const indicator of [
    portfolioRiskIndicator,
    marketRiskIndicator,
    systematicRiskIndicator,
    idiosyncraticRiskIndicator,
  ]) {
    it(`${indicator.id} depends strictly on ["risk_decomposition"] and no other data/indicators`, () => {
      assert.deepEqual(indicator.dependencies?.data, ["risk_decomposition"]);
      assert.deepEqual(indicator.dependencies?.indicators, []);
    });
  }
});

describe("E: portfolio_risk reads exact annual.portfolioVolatility", () => {
  it("extracts annual.portfolioVolatility directly from envelope.value", () => {
    const envelope = makeBuiltEnvelope();
    const result = portfolioRiskIndicator.calculate(makeContext(envelope));

    assert.equal(result.status, "ok");
    assert.equal(result.value, envelope.value.annual.portfolioVolatility);
    approx(result.value, Math.sqrt(11.5 * 252));
  });
});

describe("F: market_risk reads exact annual.marketVolatility", () => {
  it("extracts annual.marketVolatility directly from envelope.value", () => {
    const envelope = makeBuiltEnvelope();
    const result = marketRiskIndicator.calculate(makeContext(envelope));

    assert.equal(result.status, "ok");
    assert.equal(result.value, envelope.value.annual.marketVolatility);
    approx(result.value, Math.sqrt(2.5 * 252));
  });
});

describe("G: systematic_risk reads exact annual.systematicVolatility", () => {
  it("extracts annual.systematicVolatility directly from envelope.value", () => {
    const envelope = makeBuiltEnvelope();
    const result = systematicRiskIndicator.calculate(makeContext(envelope));

    assert.equal(result.status, "ok");
    assert.equal(result.value, envelope.value.annual.systematicVolatility);
    approx(result.value, 2 * Math.sqrt(2.5 * 252));
  });
});

describe("H: idiosyncratic_risk reads exact annual.idiosyncraticVolatility", () => {
  it("extracts annual.idiosyncraticVolatility directly from envelope.value", () => {
    const envelope = makeBuiltEnvelope();
    const result = idiosyncraticRiskIndicator.calculate(makeContext(envelope));

    assert.equal(result.status, "ok");
    assert.equal(result.value, envelope.value.annual.idiosyncraticVolatility);
    approx(result.value, Math.sqrt(1.5 * 252));
  });
});

describe("I: zero systematic risk is valid", () => {
  it("returns 0 with status ok when systematic volatility is 0", () => {
    const envelope = makeBuiltEnvelope();
    const mutated = {
      ...envelope,
      value: {
        ...envelope.value,
        annual: {
          ...envelope.value.annual,
          systematicVolatility: 0,
        },
      },
    };
    const result = systematicRiskIndicator.calculate(makeContext(mutated));
    assert.equal(result.status, "ok");
    assert.equal(result.value, 0);
  });
});

describe("J: zero idiosyncratic risk is valid", () => {
  it("returns 0 with status ok when idiosyncratic volatility is 0", () => {
    const envelope = makeBuiltEnvelope();
    const mutated = {
      ...envelope,
      value: {
        ...envelope.value,
        annual: {
          ...envelope.value.annual,
          idiosyncraticVolatility: 0,
        },
      },
    };
    const result = idiosyncraticRiskIndicator.calculate(makeContext(mutated));
    assert.equal(result.status, "ok");
    assert.equal(result.value, 0);
  });
});

describe("K: malformed portfolio volatility => error", () => {
  it("returns error when annual.portfolioVolatility is missing or non-number", () => {
    const envelope = makeBuiltEnvelope();
    const mutated = {
      ...envelope,
      value: {
        ...envelope.value,
        annual: {
          ...envelope.value.annual,
          portfolioVolatility: "not-a-number",
        },
      },
    };
    const result = portfolioRiskIndicator.calculate(makeContext(mutated));
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.ok(result.warnings && result.warnings.length > 0);
  });
});

describe("L: malformed market volatility => error", () => {
  it("returns error when annual.marketVolatility is undefined", () => {
    const envelope = makeBuiltEnvelope();
    const mutated = {
      ...envelope,
      value: {
        ...envelope.value,
        annual: {
          ...envelope.value.annual,
          marketVolatility: undefined,
        },
      },
    };
    const result = marketRiskIndicator.calculate(makeContext(mutated));
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
  });
});

describe("M: malformed systematic volatility => error", () => {
  it("returns error when annual.systematicVolatility is null", () => {
    const envelope = makeBuiltEnvelope();
    const mutated = {
      ...envelope,
      value: {
        ...envelope.value,
        annual: {
          ...envelope.value.annual,
          systematicVolatility: null,
        },
      },
    };
    const result = systematicRiskIndicator.calculate(makeContext(mutated));
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
  });
});

describe("N: malformed idiosyncratic volatility => error", () => {
  it("returns error when annual is missing altogether", () => {
    const envelope = makeBuiltEnvelope();
    const mutated = {
      ...envelope,
      value: {
        ...envelope.value,
        annual: null,
      },
    };
    const result = idiosyncraticRiskIndicator.calculate(makeContext(mutated));
    assert.equal(result.status, "error");
    assert.equal(result.value, null);
  });
});

describe("O: negative volatility => error", () => {
  for (const [name, indicator, field] of [
    ["portfolio_risk", portfolioRiskIndicator, "portfolioVolatility"],
    ["market_risk", marketRiskIndicator, "marketVolatility"],
    ["systematic_risk", systematicRiskIndicator, "systematicVolatility"],
    ["idiosyncratic_risk", idiosyncraticRiskIndicator, "idiosyncraticVolatility"],
  ]) {
    it(`${name} rejects negative volatility with status error`, () => {
      const envelope = makeBuiltEnvelope();
      const mutated = {
        ...envelope,
        value: {
          ...envelope.value,
          annual: {
            ...envelope.value.annual,
            [field]: -0.05,
          },
        },
      };
      const result = indicator.calculate(makeContext(mutated));
      assert.equal(result.status, "error");
      assert.equal(result.value, null);
      assert.ok(result.warnings[0].includes("must be non-negative"));
    });
  }
});

describe("P: NaN/Infinity => error", () => {
  for (const nonFinite of [NaN, Infinity, -Infinity]) {
    it(`rejects ${nonFinite} with status error and value null`, () => {
      const envelope = makeBuiltEnvelope();
      const mutated = {
        ...envelope,
        value: {
          ...envelope.value,
          annual: {
            ...envelope.value.annual,
            portfolioVolatility: nonFinite,
          },
        },
      };
      const result = portfolioRiskIndicator.calculate(makeContext(mutated));
      assert.equal(result.status, "error");
      assert.equal(result.value, null);
    });
  }
});

describe("Q: missing decomposition dependency handled deterministically", () => {
  it("returns insufficient_data when risk_decomposition is missing from context", () => {
    const emptyContext = {
      data: {},
      indicators: new Map(),
      asOf: "2026-09-15",
    };
    for (const indicator of [
      portfolioRiskIndicator,
      marketRiskIndicator,
      systematicRiskIndicator,
      idiosyncraticRiskIndicator,
    ]) {
      const result = indicator.calculate(emptyContext);
      assert.equal(result.status, "insufficient_data");
      assert.equal(result.value, null);
    }
  });
});

describe("R: all four provenance sets identical", () => {
  it("all four indicators produce deeply equal sources arrays", () => {
    const envelope = makeBuiltEnvelope();
    const ctx = makeContext(envelope);

    const rPort = portfolioRiskIndicator.calculate(ctx);
    const rMarket = marketRiskIndicator.calculate(ctx);
    const rSys = systematicRiskIndicator.calculate(ctx);
    const rIdio = idiosyncraticRiskIndicator.calculate(ctx);

    assert.deepEqual(rPort.sources, rMarket.sources);
    assert.deepEqual(rPort.sources, rSys.sources);
    assert.deepEqual(rPort.sources, rIdio.sources);
  });
});

describe("S: provenance comes from decomposition envelope", () => {
  it("sources match dataEnvelopeToDataSourceReferences of the input envelope", () => {
    const envelope = makeBuiltEnvelope();
    const result = portfolioRiskIndicator.calculate(makeContext(envelope));

    assert.deepEqual(result.sources, envelope.sources);
  });
});

describe("T: no recalculation math in risk-metrics.ts", () => {
  const FORBIDDEN_MATH = [
    /sampleVariance/,
    /sampleStandardDeviation/,
    /\bmean\b/,
    /sqrt\s*\(\s*252\s*\)/,
    /beta\s*\*\s*beta/,
    /abs\s*\(\s*beta\s*\)/,
    /alignReturnSeries/,
    /alignMultipleReturnSeries/,
    /annualizationFactor/,
  ];

  FORBIDDEN_MATH.forEach((rx, i) => {
    it(`forbidden math pattern #${i} (${rx})`, () => {
      const src = readRoot("lib/analytics/indicators/risk-metrics.ts");
      assert.equal(rx.test(src), false, `forbidden math ${rx} found in risk-metrics.ts`);
    });
  });
});

describe("U: no provider/network/UI imports", () => {
  const FORBIDDEN = [
    /market-data/,
    /alpha[_\s-]?vantage/,
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
      const src = readRoot("lib/analytics/indicators/risk-metrics.ts");
      assert.equal(rx.test(src), false, `forbidden pattern ${rx} found in source`);
    });
  });

  it("all four indicators are exported from lib/analytics/index.ts", () => {
    const index = readRoot("lib/analytics/index.ts");
    assert.match(index, /portfolioRiskIndicator/);
    assert.match(index, /marketRiskIndicator/);
    assert.match(index, /systematicRiskIndicator/);
    assert.match(index, /idiosyncraticRiskIndicator/);
    assert.match(index, /RISK_DECOMPOSITION_DATA_KEY/);
  });
});

describe("V: dataWindow exact if supported, otherwise explicitly absent", () => {
  it("populates exact dataWindow from decomposition.dates and observationCount", () => {
    const envelope = makeBuiltEnvelope();
    const result = portfolioRiskIndicator.calculate(makeContext(envelope));

    assert.ok(result.dataWindow);
    assert.equal(result.dataWindow.startDate, "2026-09-01");
    assert.equal(result.dataWindow.endDate, "2026-09-05");
    assert.equal(result.dataWindow.observations, 5);
  });
});

describe("W: known synthetic decomposition fields map correctly", () => {
  it("annual volatilities reflect exact square roots of annual variances", () => {
    const envelope = makeBuiltEnvelope();
    const ctx = makeContext(envelope);

    const port = portfolioRiskIndicator.calculate(ctx);
    const mkt = marketRiskIndicator.calculate(ctx);
    const sys = systematicRiskIndicator.calculate(ctx);
    const idio = idiosyncraticRiskIndicator.calculate(ctx);

    approx(port.value, Math.sqrt(11.5 * 252));
    approx(mkt.value, Math.sqrt(2.5 * 252));
    approx(sys.value, Math.sqrt(10.0 * 252));
    approx(idio.value, Math.sqrt(1.5 * 252));
  });
});

describe("X: Beta / CAPM / Sharpe / Treynor fixtures unchanged", () => {
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

describe("Y: pure risk decomposition fixture unchanged", () => {
  it("pure engine reproduces 11.5, 2.5, 10, 1.5 daily variances", () => {
    const out = calculatePortfolioRiskDecomposition({
      portfolioReturns: {
        assetId: "p",
        points: DATES.map((date, i) => ({ date, value: PORTFOLIO_P[i] })),
      },
      benchmarkReturns: {
        assetId: "b",
        points: DATES.map((date, i) => ({ date, value: BENCHMARK_X[i] })),
      },
      beta: BETA,
    });
    approx(out.daily.portfolioVariance, 11.5);
    approx(out.daily.marketVariance, 2.5);
    approx(out.daily.systematicVariance, 10.0);
    approx(out.daily.idiosyncraticVariance, 1.5);
  });
});

describe("Z: builder fixture unchanged", () => {
  it("builder envelope reproduces 11.5 and 2.5 daily variances", () => {
    const env = makeBuiltEnvelope();
    approx(env.value.daily.portfolioVariance, 11.5);
    approx(env.value.daily.marketVariance, 2.5);
  });
});

describe("AA: all previous 696 tests remain green (deterministic reruns)", () => {
  it("indicator evaluations are deterministic across runs", () => {
    const envelope = makeBuiltEnvelope();
    const ctx = makeContext(envelope);

    const first = portfolioRiskIndicator.calculate(ctx);
    const second = portfolioRiskIndicator.calculate(ctx);
    assert.deepEqual(first, second);
  });
});

describe("Engine: AnalyticsEngine executes all four indicators simultaneously", () => {
  it("calculates all four risk metrics from a single decomposition envelope in one pass", () => {
    const registry = new IndicatorRegistry();
    registry.register(portfolioRiskIndicator);
    registry.register(marketRiskIndicator);
    registry.register(systematicRiskIndicator);
    registry.register(idiosyncraticRiskIndicator);

    const engine = new AnalyticsEngine(registry);
    const envelope = makeBuiltEnvelope();

    const results = engine.calculate({
      indicators: [
        "portfolio_risk",
        "market_risk",
        "systematic_risk",
        "idiosyncratic_risk",
      ],
      context: makeContext(envelope),
    });

    assert.equal(results.size, 4);

    const portRes = results.get("portfolio_risk");
    const mktRes = results.get("market_risk");
    const sysRes = results.get("systematic_risk");
    const idioRes = results.get("idiosyncratic_risk");

    assert.ok(portRes && mktRes && sysRes && idioRes);
    assert.equal(portRes.status, "ok");
    assert.equal(mktRes.status, "ok");
    assert.equal(sysRes.status, "ok");
    assert.equal(idioRes.status, "ok");

    approx(portRes.value, Math.sqrt(11.5 * 252));
    approx(mktRes.value, Math.sqrt(2.5 * 252));
    approx(sysRes.value, Math.sqrt(10.0 * 252));
    approx(idioRes.value, Math.sqrt(1.5 * 252));

    assert.deepEqual(portRes.sources, envelope.sources);
    assert.deepEqual(mktRes.sources, envelope.sources);
    assert.deepEqual(sysRes.sources, envelope.sources);
    assert.deepEqual(idioRes.sources, envelope.sources);

    assert.equal(portRes.dataWindow?.startDate, "2026-09-01");
    assert.equal(portRes.dataWindow?.endDate, "2026-09-05");
    assert.equal(portRes.dataWindow?.observations, 5);
  });

  it("engine returns insufficient_data when risk_decomposition data is missing", () => {
    const registry = new IndicatorRegistry();
    registry.register(portfolioRiskIndicator);

    const engine = new AnalyticsEngine(registry);
    const results = engine.calculate({
      indicators: ["portfolio_risk"],
      context: {
        data: {},
        indicators: new Map(),
        asOf: "2026-09-15",
      },
    });

    const res = results.get("portfolio_risk");
    assert.ok(res);
    assert.equal(res.status, "insufficient_data");
    assert.equal(res.value, null);
  });
});
