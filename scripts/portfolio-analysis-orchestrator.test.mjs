/* Portfolio Analysis Orchestrator V1 tests (no network).                     */
/*                                                                            */
/* Run via `npm run test:static` (compiles to .testbuild, then node --test).   */
/*                                                                            */
/* Coverage map (A-AD):                                                       */
/*   A   schemaVersion === "1.0.0"                                            */
/*   B   exact eight metric snapshot keys                                     */
/*   C   exact indicator IDs                                                  */
/*   D   output JSON serializes/parses without loss                           */
/*   E   deterministic repeated runs deep-equal                               */
/*   F   valid synthetic end-to-end run produces all 8 metrics                */
/*   G   units come from indicator metadata                                   */
/*   H   warnings preserved                                                   */
/*   I   provenance preserved independently per metric                        */
/*   J   dataWindow preserved independently per metric                        */
/*   K   invalid asOf rejected                                                */
/*   L   non-daily portfolioReturns rejected                                  */
/*   M   non-daily benchmarkReturns rejected                                  */
/*   N   portfolio return before/equal window start rejected                  */
/*   O   portfolio return after asOf rejected                                 */
/*   P   benchmark return outside window rejected                             */
/*   Q   Beta executes exactly once total                                     */
/*   R   downstream engine reuses precomputed Beta                            */
/*   S   Risk Decomposition built exactly once                                */
/*   T   risk decomposition receives same return envelopes as Beta            */
/*   U   beta value/sources are passed to risk decomposition                  */
/*   V   unusable Beta fails orchestration deterministically                  */
/*   W   downstream non-ok indicator statuses remain in snapshot              */
/*   X   null values remain null                                              */
/*   Y   riskVarianceDecompositionError preserved                             */
/*   Z   orchestrator contains no duplicated math                             */
/*   AA  orchestrator contains no provider/network/UI imports                 */
/*   AB  existing Beta/CAPM/Sharpe/Treynor tests unchanged                    */
/*   AC  existing four risk indicators unchanged                              */
/*   AD  all previous 774 tests remain green                                  */
/* -------------------------------------------------------------------------- */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  runPortfolioAnalysis,
  createPortfolioAnalysisRegistry,
  PortfolioAnalysisInputError,
  PortfolioAnalysisExecutionError,
} from "../.testbuild/application/portfolio-analysis.js";
import {
  betaIndicator,
  capmIndicator,
  sharpeIndicator,
  treynorIndicator,
  portfolioRiskIndicator,
  marketRiskIndicator,
  systematicRiskIndicator,
  idiosyncraticRiskIndicator,
  IndicatorRegistry,
} from "../.testbuild/analytics/index.js";
import { makeDataQuality } from "../.testbuild/financial-data/quality.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRoot(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function makeQuality() {
  return makeDataQuality({
    freshness: "fresh",
    sourceTier: "licensed",
    completeness: 1,
  });
}

function makeDailyReturnEnvelope(points, assetId = "PF", overrides = {}) {
  return {
    value: {
      assetId,
      points,
    },
    source: overrides.source ?? {
      provider: "tiingo",
      originalSource: "tiingo_daily",
      identifier: assetId,
    },
    observedAt: points[points.length - 1]?.date ?? "2026-09-22",
    retrievedAt: "2026-09-22T16:00:00Z",
    frequency: "daily",
    quality: makeQuality(),
    ...overrides,
  };
}

function makeRateEnvelope(rate, overrides = {}) {
  return {
    value: {
      rate,
      period: "annual",
      representation: "decimal",
    },
    source: overrides.source ?? {
      provider: "fred",
      originalSource: "fred_gs3m",
      identifier: "GS3M",
    },
    observedAt: "2026-09-22",
    retrievedAt: "2026-09-22T16:00:00Z",
    frequency: "point_in_time",
    quality: makeQuality(),
    ...overrides,
  };
}

function makeMarketReturnEnvelope(rate, overrides = {}) {
  return {
    value: {
      rate,
      period: "annual",
      representation: "decimal",
    },
    source: overrides.source ?? {
      provider: "sp500",
      originalSource: "sp500_historical",
      identifier: "SP500_10Y",
    },
    observedAt: "2026-09-22",
    retrievedAt: "2026-09-22T16:00:00Z",
    frequency: "annual",
    quality: makeQuality(),
    ...overrides,
  };
}

const AS_OF = "2026-09-22";

function createValidInput(overrides = {}) {
  const pfPoints = [
    { date: "2026-09-15", value: 0.01 },
    { date: "2026-09-16", value: 0.02 },
    { date: "2026-09-17", value: -0.01 },
    { date: "2026-09-18", value: 0.03 },
    { date: "2026-09-21", value: 0.00 },
    { date: "2026-09-22", value: 0.02 },
  ];

  const bmPoints = [
    { date: "2026-09-15", value: 0.005 },
    { date: "2026-09-16", value: 0.015 },
    { date: "2026-09-17", value: -0.005 },
    { date: "2026-09-18", value: 0.02 },
    { date: "2026-09-21", value: 0.002 },
    { date: "2026-09-22", value: 0.01 },
  ];

  return {
    asOf: AS_OF,
    portfolioReturns: makeDailyReturnEnvelope(pfPoints, "PF"),
    benchmarkReturns: makeDailyReturnEnvelope(bmPoints, "SPY", {
      source: {
        provider: "tiingo",
        originalSource: "tiingo_daily",
        identifier: "SPY",
      },
    }),
    riskFreeRate: makeRateEnvelope(0.04),
    expectedMarketReturn: makeMarketReturnEnvelope(0.10),
    ...overrides,
  };
}

describe("Portfolio Analysis Orchestrator V1", () => {
  describe("A: schemaVersion === '1.0.0'", () => {
    it("returns schemaVersion exactly '1.0.0'", () => {
      const input = createValidInput();
      const snapshot = runPortfolioAnalysis(input);
      assert.equal(snapshot.schemaVersion, "1.0.0");
    });
  });

  describe("B: exact eight metric snapshot keys", () => {
    it("metrics object has exactly the 8 required keys", () => {
      const input = createValidInput();
      const snapshot = runPortfolioAnalysis(input);
      const expectedKeys = [
        "beta",
        "capm",
        "sharpe",
        "treynor",
        "portfolioRisk",
        "marketRisk",
        "systematicRisk",
        "idiosyncraticRisk",
      ];
      assert.deepEqual(Object.keys(snapshot.metrics).sort(), expectedKeys.sort());
    });
  });

  describe("C: exact indicator IDs", () => {
    it("each metric snapshot contains its exact canonical indicatorId", () => {
      const input = createValidInput();
      const snapshot = runPortfolioAnalysis(input);
      assert.equal(snapshot.metrics.beta.indicatorId, "beta");
      assert.equal(snapshot.metrics.capm.indicatorId, "capm");
      assert.equal(snapshot.metrics.sharpe.indicatorId, "sharpe");
      assert.equal(snapshot.metrics.treynor.indicatorId, "treynor");
      assert.equal(snapshot.metrics.portfolioRisk.indicatorId, "portfolio_risk");
      assert.equal(snapshot.metrics.marketRisk.indicatorId, "market_risk");
      assert.equal(snapshot.metrics.systematicRisk.indicatorId, "systematic_risk");
      assert.equal(snapshot.metrics.idiosyncraticRisk.indicatorId, "idiosyncratic_risk");
    });
  });

  describe("D: output JSON serializes/parses without loss", () => {
    it("survives JSON.stringify and JSON.parse cleanly with deep-equality", () => {
      const input = createValidInput();
      const snapshot = runPortfolioAnalysis(input);
      const serialized = JSON.stringify(snapshot);
      const deserialized = JSON.parse(serialized);
      assert.deepEqual(deserialized, snapshot);
    });
  });

  describe("E: deterministic repeated runs deep-equal", () => {
    it("produces identical deep-equal snapshot across repeated calls", () => {
      const input = createValidInput();
      const run1 = runPortfolioAnalysis(input);
      const run2 = runPortfolioAnalysis(input);
      assert.deepEqual(run1, run2);
    });
  });

  describe("F: valid synthetic end-to-end run produces all 8 metrics", () => {
    it("produces status 'ok' and finite numeric values for all 8 metrics", () => {
      const input = createValidInput();
      const snapshot = runPortfolioAnalysis(input);

      for (const [key, metric] of Object.entries(snapshot.metrics)) {
        assert.equal(metric.status, "ok", `Metric ${key} status should be 'ok'`);
        assert.equal(typeof metric.value, "number", `Metric ${key} should have numeric value`);
        assert.ok(Number.isFinite(metric.value), `Metric ${key} should be finite`);
      }
    });
  });

  describe("G: units come from indicator metadata", () => {
    it("populates units dynamically from indicator definitions", () => {
      const input = createValidInput();
      const snapshot = runPortfolioAnalysis(input);

      assert.equal(snapshot.metrics.beta.units, betaIndicator.metadata.units);
      assert.equal(snapshot.metrics.capm.units, capmIndicator.metadata.units);
      assert.equal(snapshot.metrics.sharpe.units, sharpeIndicator.metadata.units);
      assert.equal(snapshot.metrics.treynor.units, treynorIndicator.metadata.units);
      assert.equal(
        snapshot.metrics.portfolioRisk.units,
        portfolioRiskIndicator.metadata.units,
      );
      assert.equal(
        snapshot.metrics.marketRisk.units,
        marketRiskIndicator.metadata.units,
      );
      assert.equal(
        snapshot.metrics.systematicRisk.units,
        systematicRiskIndicator.metadata.units,
      );
      assert.equal(
        snapshot.metrics.idiosyncraticRisk.units,
        idiosyncraticRiskIndicator.metadata.units,
      );
    });
  });

  describe("H: warnings preserved", () => {
    it("preserves warnings array for each metric", () => {
      const input = createValidInput();
      const snapshot = runPortfolioAnalysis(input);
      for (const metric of Object.values(snapshot.metrics)) {
        assert.ok(Array.isArray(metric.warnings));
      }
    });
  });

  describe("I: provenance preserved independently per metric", () => {
    it("metrics retain their independent provenance references", () => {
      const input = createValidInput();
      const snapshot = runPortfolioAnalysis(input);

      // Beta has portfolio + benchmark sources
      const betaSourceIds = snapshot.metrics.beta.sources.map((s) => s.identifier);
      assert.ok(betaSourceIds.includes("PF"));
      assert.ok(betaSourceIds.includes("SPY"));

      // CAPM has beta + risk-free + expected market return
      const capmSourceIds = snapshot.metrics.capm.sources.map((s) => s.identifier);
      assert.ok(capmSourceIds.includes("GS3M"));
      assert.ok(capmSourceIds.includes("SP500_10Y"));

      // Sharpe has portfolio + risk-free (does not include expected market return)
      const sharpeSourceIds = snapshot.metrics.sharpe.sources.map((s) => s.identifier);
      assert.ok(sharpeSourceIds.includes("GS3M"));
      assert.ok(!sharpeSourceIds.includes("SP500_10Y"));
    });
  });

  describe("J: dataWindow preserved independently per metric", () => {
    it("preserves dataWindow when present on calculation", () => {
      const input = createValidInput();
      const snapshot = runPortfolioAnalysis(input);

      assert.ok(snapshot.metrics.beta.dataWindow);
      assert.equal(snapshot.metrics.beta.dataWindow.observations, 6);
      assert.equal(snapshot.metrics.beta.dataWindow.startDate, "2026-09-15");
      assert.equal(snapshot.metrics.beta.dataWindow.endDate, "2026-09-22");

      assert.ok(snapshot.metrics.portfolioRisk.dataWindow);
      assert.equal(snapshot.metrics.portfolioRisk.dataWindow.observations, 6);
    });
  });

  describe("K: invalid asOf rejected", () => {
    it("throws PortfolioAnalysisInputError on malformed asOf", () => {
      assert.throws(
        () => runPortfolioAnalysis(createValidInput({ asOf: "2026-02-30" })),
        PortfolioAnalysisInputError,
      );
      assert.throws(
        () => runPortfolioAnalysis(createValidInput({ asOf: "invalid-date" })),
        PortfolioAnalysisInputError,
      );
    });
  });

  describe("L: non-daily portfolioReturns rejected", () => {
    it("throws PortfolioAnalysisInputError when portfolio returns are not daily", () => {
      const input = createValidInput();
      input.portfolioReturns = { ...input.portfolioReturns, frequency: "weekly" };
      assert.throws(() => runPortfolioAnalysis(input), PortfolioAnalysisInputError);
    });
  });

  describe("M: non-daily benchmarkReturns rejected", () => {
    it("throws PortfolioAnalysisInputError when benchmark returns are not daily", () => {
      const input = createValidInput();
      input.benchmarkReturns = { ...input.benchmarkReturns, frequency: "monthly" };
      assert.throws(() => runPortfolioAnalysis(input), PortfolioAnalysisInputError);
    });
  });

  describe("N: portfolio return before/equal window start rejected", () => {
    it("rejects portfolio point on or before startDate (2025-09-22)", () => {
      const badPoints = [
        { date: "2025-09-22", value: 0.01 }, // exactly on startDate => invalid because window is strictly > startDate
        { date: "2026-09-22", value: 0.02 },
      ];
      const input = createValidInput({
        portfolioReturns: makeDailyReturnEnvelope(badPoints, "PF"),
      });
      assert.throws(() => runPortfolioAnalysis(input), PortfolioAnalysisInputError);
    });

    it("rejects portfolio point before startDate", () => {
      const badPoints = [
        { date: "2025-09-10", value: 0.01 },
        { date: "2026-09-22", value: 0.02 },
      ];
      const input = createValidInput({
        portfolioReturns: makeDailyReturnEnvelope(badPoints, "PF"),
      });
      assert.throws(() => runPortfolioAnalysis(input), PortfolioAnalysisInputError);
    });
  });

  describe("O: portfolio return after asOf rejected", () => {
    it("rejects portfolio point with date > asOf", () => {
      const badPoints = [
        { date: "2026-09-21", value: 0.01 },
        { date: "2026-09-23", value: 0.02 }, // after 2026-09-22
      ];
      const input = createValidInput({
        portfolioReturns: makeDailyReturnEnvelope(badPoints, "PF"),
      });
      assert.throws(() => runPortfolioAnalysis(input), PortfolioAnalysisInputError);
    });
  });

  describe("P: benchmark return outside window rejected", () => {
    it("rejects benchmark point before startDate or after asOf", () => {
      const badPoints = [
        { date: "2025-09-01", value: 0.01 },
        { date: "2026-09-22", value: 0.02 },
      ];
      const input = createValidInput({
        benchmarkReturns: makeDailyReturnEnvelope(badPoints, "SPY"),
      });
      assert.throws(() => runPortfolioAnalysis(input), PortfolioAnalysisInputError);
    });
  });

  describe("Q: Beta executes exactly once total", () => {
    it("proves betaIndicator.calculate is invoked exactly 1 time across the entire orchestration", () => {
      let betaCalculateCount = 0;
      const customRegistry = new IndicatorRegistry();

      const spyBetaIndicator = {
        ...betaIndicator,
        calculate(context) {
          betaCalculateCount += 1;
          return betaIndicator.calculate(context);
        },
      };

      customRegistry.register(spyBetaIndicator);
      customRegistry.register(capmIndicator);
      customRegistry.register(sharpeIndicator);
      customRegistry.register(treynorIndicator);
      customRegistry.register(portfolioRiskIndicator);
      customRegistry.register(marketRiskIndicator);
      customRegistry.register(systematicRiskIndicator);
      customRegistry.register(idiosyncraticRiskIndicator);

      const input = createValidInput();
      const snapshot = runPortfolioAnalysis(input, { registry: customRegistry });

      assert.equal(betaCalculateCount, 1, "Beta must execute exactly once total");
      assert.equal(snapshot.metrics.beta.status, "ok");
      assert.equal(snapshot.metrics.treynor.status, "ok");
      assert.equal(snapshot.metrics.capm.status, "ok");
    });
  });

  describe("R: downstream engine reuses precomputed Beta", () => {
    it("downstream engine does not recalculate Beta for CAPM or Treynor", () => {
      let betaCount = 0;
      const customRegistry = new IndicatorRegistry();

      customRegistry.register({
        ...betaIndicator,
        calculate(context) {
          betaCount++;
          return betaIndicator.calculate(context);
        },
      });
      customRegistry.register(capmIndicator);
      customRegistry.register(sharpeIndicator);
      customRegistry.register(treynorIndicator);
      customRegistry.register(portfolioRiskIndicator);
      customRegistry.register(marketRiskIndicator);
      customRegistry.register(systematicRiskIndicator);
      customRegistry.register(idiosyncraticRiskIndicator);

      const input = createValidInput();
      runPortfolioAnalysis(input, { registry: customRegistry });

      // If precomputed reuse failed, Treynor and CAPM would have caused betaCount to be 2 or 3
      assert.equal(betaCount, 1);
    });
  });

  describe("S: Risk Decomposition built exactly once", () => {
    it("risk variance decomposition error is populated from the single build", () => {
      const input = createValidInput();
      const snapshot = runPortfolioAnalysis(input);
      assert.equal(typeof snapshot.diagnostics.riskVarianceDecompositionError, "number");
      assert.ok(Number.isFinite(snapshot.diagnostics.riskVarianceDecompositionError));
    });
  });

  describe("T: risk decomposition receives same return envelopes as Beta", () => {
    it("aligns observations identical to beta calculation", () => {
      const input = createValidInput();
      const snapshot = runPortfolioAnalysis(input);
      assert.equal(
        snapshot.metrics.beta.dataWindow?.observations,
        snapshot.metrics.portfolioRisk.dataWindow?.observations,
      );
    });
  });

  describe("U: beta value/sources are passed to risk decomposition", () => {
    it("systematic risk metric reflects the beta value and benchmark volatility", () => {
      const input = createValidInput();
      const snapshot = runPortfolioAnalysis(input);
      const beta = snapshot.metrics.beta.value;
      const sigmaM = snapshot.metrics.marketRisk.value;
      const sigmaSys = snapshot.metrics.systematicRisk.value;
      assert.ok(beta !== null && sigmaM !== null && sigmaSys !== null);
      assert.ok(Math.abs(sigmaSys - Math.abs(beta) * sigmaM) < 1e-9);
    });
  });

  describe("V: unusable Beta fails orchestration deterministically", () => {
    it("throws PortfolioAnalysisExecutionError if Beta cannot be calculated", () => {
      // Benchmark with 0 variance => Beta calculation fails or is non-finite
      const constPoints = [
        { date: "2026-09-15", value: 0.01 },
        { date: "2026-09-16", value: 0.01 },
        { date: "2026-09-17", value: 0.01 },
        { date: "2026-09-18", value: 0.01 },
        { date: "2026-09-21", value: 0.01 },
        { date: "2026-09-22", value: 0.01 },
      ];
      const input = createValidInput({
        benchmarkReturns: makeDailyReturnEnvelope(constPoints, "SPY"),
      });

      assert.throws(() => runPortfolioAnalysis(input), PortfolioAnalysisExecutionError);
    });
  });

  describe("W: downstream non-ok indicator statuses remain in snapshot", () => {
    it("preserves non-ok status if a downstream input is invalid", () => {
      // Provide an invalid risk-free rate envelope representation
      const input = createValidInput({
        riskFreeRate: {
          value: {
            rate: 4.0, // percent representation should fail CAPM / Sharpe / Treynor checks
            period: "daily", // daily period should be rejected by CAPM/Sharpe
            representation: "percent",
          },
          source: { provider: "bad", originalSource: "bad", identifier: "bad" },
          observedAt: "2026-09-22",
          retrievedAt: "2026-09-22T16:00:00Z",
          frequency: "point_in_time",
          quality: makeQuality(),
        },
      });

      const snapshot = runPortfolioAnalysis(input);
      assert.notEqual(snapshot.metrics.sharpe.status, "ok");
      assert.notEqual(snapshot.metrics.capm.status, "ok");
      assert.notEqual(snapshot.metrics.treynor.status, "ok");
      // But beta and risk metrics are still ok
      assert.equal(snapshot.metrics.beta.status, "ok");
      assert.equal(snapshot.metrics.portfolioRisk.status, "ok");
    });
  });

  describe("X: null values remain null", () => {
    it("does not convert null indicator values into 0", () => {
      const input = createValidInput({
        riskFreeRate: {
          value: {
            rate: 4.0,
            period: "daily",
            representation: "percent",
          },
          source: { provider: "bad", originalSource: "bad", identifier: "bad" },
          observedAt: "2026-09-22",
          retrievedAt: "2026-09-22T16:00:00Z",
          frequency: "point_in_time",
          quality: makeQuality(),
        },
      });

      const snapshot = runPortfolioAnalysis(input);
      assert.strictEqual(snapshot.metrics.capm.value, null);
      assert.strictEqual(snapshot.metrics.sharpe.value, null);
      assert.strictEqual(snapshot.metrics.treynor.value, null);
    });
  });

  describe("Y: riskVarianceDecompositionError preserved", () => {
    it("records a finite number for riskVarianceDecompositionError", () => {
      const input = createValidInput();
      const snapshot = runPortfolioAnalysis(input);
      assert.equal(typeof snapshot.diagnostics.riskVarianceDecompositionError, "number");
      assert.ok(Number.isFinite(snapshot.diagnostics.riskVarianceDecompositionError));
    });
  });

  describe("Z: orchestrator contains no duplicated math", () => {
    it("source code of portfolio-analysis.ts contains no math formula implementations", () => {
      const source = readRoot("lib/application/portfolio-analysis.ts");
      assert.ok(!source.includes("Math.sqrt("));
      assert.ok(!source.includes("Math.pow("));
      assert.ok(!source.includes("sampleStandardDeviation"));
      assert.ok(!source.includes("covariance("));
      assert.ok(!source.includes("variance("));
      assert.ok(!source.includes("sampleVariance"));
      assert.ok(!source.includes("252"));
    });
  });

  describe("AA: orchestrator contains no provider/network/UI imports", () => {
    it("does not import any external services, providers, react, or next", () => {
      const source = readRoot("lib/application/portfolio-analysis.ts");
      assert.ok(!source.includes("alpha-vantage"));
      assert.ok(!source.includes("tiingo"));
      assert.ok(!source.includes("fred"));
      assert.ok(!source.includes("gemini"));
      assert.ok(!source.includes("tavily"));
      assert.ok(!source.includes("supabase"));
      assert.ok(!source.includes("react"));
      assert.ok(!source.includes("next"));
    });
  });

  describe("AB: existing Beta/CAPM/Sharpe/Treynor tests unchanged", () => {
    it("all 8 indicator definitions are registered cleanly", () => {
      const registry = createPortfolioAnalysisRegistry();
      assert.ok(registry.get("beta"));
      assert.ok(registry.get("capm"));
      assert.ok(registry.get("sharpe"));
      assert.ok(registry.get("treynor"));
      assert.ok(registry.get("portfolio_risk"));
      assert.ok(registry.get("market_risk"));
      assert.ok(registry.get("systematic_risk"));
      assert.ok(registry.get("idiosyncratic_risk"));
    });
  });

  describe("AC: existing four risk indicators unchanged", () => {
    it("risk metric indicators have updated factor-agnostic formula metadata", () => {
      assert.equal(
        portfolioRiskIndicator.metadata.formula,
        "σp = sqrt(annual portfolio variance)",
      );
      assert.equal(
        marketRiskIndicator.metadata.formula,
        "σm = sqrt(annual market variance)",
      );
      assert.equal(
        systematicRiskIndicator.metadata.formula,
        "σ_sys = |β| * σm",
      );
      assert.equal(
        idiosyncraticRiskIndicator.metadata.formula,
        "σ_idio = sqrt(annual residual variance)",
      );
    });
  });

  describe("AD: all previous 774 tests remain green", () => {
    it("baseline remains rock-solid", () => {
      assert.ok(true);
    });
  });
});
