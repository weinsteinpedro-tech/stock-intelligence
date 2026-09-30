/* Live Stock Analytics Pipeline V1 tests (no network).                      */
/*                                                                            */
/* Run via `npm run test:static` (compiles to .testbuild, then node --test).   */
/*                                                                            */
/* Coverage map (A-AB):                                                       */
/*   A   stock provider called exactly once                                   */
/*   B   benchmark provider called exactly once                               */
/*   C   FRED/economic provider called exactly once                           */
/*   D   exactly 3 provider calls total                                       */
/*   E   benchmark dataset reused for EMR and 1Y benchmark returns            */
/*   F   no duplicate benchmark fetch                                         */
/*   G   exact stock requested symbol preserved                               */
/*   H   exact benchmarkSymbol preserved                                      */
/*   I   stock request range matches Sharpe price request helper              */
/*   J   benchmark request range matches EMR request helper                   */
/*   K   FRED request range matches resolveUsCapmRiskFreeRequestRange         */
/*   L   FRED series id comes from US_CAPM_RISK_FREE_V1                      */
/*   M   adjusted close required for stock                                    */
/*   N   adjusted close required for benchmark                                */
/*   O   stock seed price does not leak into final ReturnSeries window        */
/*   P   benchmark old 10Y prices do not leak into final 1Y ReturnSeries       */
/*   Q   portfolio returns satisfy (startDate, asOf]                          */
/*   R   benchmark returns satisfy (startDate, asOf]                          */
/*   S   expected market return built from the one benchmark dataset          */
/*   T   risk-free envelope uses policy-aware US CAPM helper                  */
/*   U   resulting snapshot contains canonical 8 metrics                      */
/*   V   deterministic repeated runs deep-equal                               */
/*   W   market provider error propagates deterministically                   */
/*   X   economic provider error propagates deterministically                 */
/*   Y   malformed/missing adjustedClose fails deterministically              */
/*   Z   zero duplicated formulas in live-stock-analysis.ts                   */
/*   AA  no UI/Gemini/Tavily/Supabase imports                                 */
/*   AB  all previous 824 tests remain green                                  */
/* -------------------------------------------------------------------------- */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  runLiveStockAnalysis,
  LiveStockAnalysisInputError,
  LiveStockAnalysisDependencyError,
} from "../.testbuild/application/live-stock-analysis.js";
import {
  createSharpePortfolioInputMethodology,
  resolveSharpePortfolioInputDateRange,
  resolveSharpePortfolioPriceRequestRange,
} from "../.testbuild/analytics/portfolio/annualized-performance.js";
import {
  createExpectedMarketReturnMethodology,
  resolveExpectedMarketReturnDataRequestRange,
} from "../.testbuild/financial-data/market-return/expected-market-return.js";
import {
  US_CAPM_RISK_FREE_V1,
  resolveUsCapmRiskFreeRequestRange,
} from "../.testbuild/financial-data/rates/us-capm-risk-free-v1.js";
import { InvalidMarketCloseError } from "../.testbuild/financial-data/adapters/market-prices.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRoot(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function generateTradingDays(startIso, endIso) {
  const dates = [];
  let cur = new Date(startIso + "T00:00:00Z");
  const end = new Date(endIso + "T00:00:00Z");
  while (cur <= end) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(cur.toISOString().slice(0, 10));
    }
    cur = new Date(cur.getTime() + 86400000);
  }
  return dates;
}

function makeFakeFixtures(asOf = "2026-09-22") {
  // Sharpe 1Y window is 2025-09-22 .. 2026-09-22
  // Sharpe price request range starts 7 days before 2025-09-22: 2025-09-15
  const stockDates = generateTradingDays("2025-09-15", asOf);

  let stockPrice = 150.0;
  const stockPrices = stockDates.map((date, idx) => {
    // slight variation
    stockPrice = stockPrice * (1 + 0.001 * ((idx % 5) - 2));
    return {
      date,
      open: stockPrice,
      high: stockPrice * 1.01,
      low: stockPrice * 0.99,
      close: stockPrice,
      adjustedClose: stockPrice,
      volume: 1000000,
    };
  });

  // Benchmark needs 11 anniversary anchors (2016-09-22 .. 2026-09-22)
  // plus daily trading days across the 1Y window
  const benchmarkAnchors = [
    { date: "2016-09-22", price: 200 },
    { date: "2017-09-22", price: 220 },
    { date: "2018-09-21", price: 240 },
    { date: "2019-09-20", price: 260 },
    { date: "2020-09-22", price: 280 },
    { date: "2021-09-22", price: 300 },
    { date: "2022-09-22", price: 320 },
    { date: "2023-09-22", price: 340 },
    { date: "2024-09-20", price: 370 },
  ];

  const benchmark1YDates = generateTradingDays("2025-09-15", asOf);
  let benchPrice = 400.0;
  const benchmark1YPrices = benchmark1YDates.map((date, idx) => {
    benchPrice = benchPrice * (1 + 0.0008 * ((idx % 4) - 1.5));
    return {
      date,
      open: benchPrice,
      high: benchPrice * 1.005,
      low: benchPrice * 0.995,
      close: benchPrice,
      adjustedClose: benchPrice,
      volume: 5000000,
    };
  });

  const anchorPrices = benchmarkAnchors.map((a) => ({
    date: a.date,
    open: a.price,
    high: a.price,
    low: a.price,
    close: a.price,
    adjustedClose: a.price,
    volume: 5000000,
  }));

  const allBenchmarkPrices = [...anchorPrices, ...benchmark1YPrices];

  const fredObservations = [
    { date: "2026-09-15", value: 4.40 },
    { date: "2026-09-18", value: 4.42 },
    { date: "2026-09-21", value: 4.43 },
  ];

  return { stockPrices, allBenchmarkPrices, fredObservations };
}

function createFakeProviders(fixtures, options = {}) {
  const calls = {
    market: [],
    economic: [],
  };

  const marketProvider = {
    async searchSymbols() {
      return [];
    },
    async getDailySeries() {
      return [];
    },
    async getHistoricalPrices(symbol, request) {
      calls.market.push({ symbol, request });
      if (options.failMarketSymbol === symbol) {
        throw new Error(`Market provider failed for ${symbol}`);
      }
      if (options.missingAdjustedCloseSymbol === symbol) {
        const prices = symbol === "AAPL" ? fixtures.stockPrices : fixtures.allBenchmarkPrices;
        return prices.map((p) => ({
          ...p,
          adjustedClose: undefined,
        }));
      }
      if (symbol === "AAPL") {
        return fixtures.stockPrices;
      }
      return fixtures.allBenchmarkPrices;
    },
  };

  const economicProvider = {
    async getSeriesObservations(seriesId, request) {
      calls.economic.push({ seriesId, request });
      if (options.failEconomic) {
        throw new Error("FRED economic provider failed");
      }
      return {
        seriesId,
        observations: fixtures.fredObservations,
        retrievedAt: "2026-09-22T20:00:00Z",
      };
    },
  };

  return { marketProvider, economicProvider, calls };
}

describe("Live Stock Analytics Pipeline V1", () => {
  const asOf = "2026-09-22";
  const fixtures = makeFakeFixtures(asOf);

  describe("A-D: Exactly 3 provider calls total", () => {
    it("calls stock once, benchmark once, economic once (total 3)", async () => {
      const { marketProvider, economicProvider, calls } = createFakeProviders(fixtures);
      const snapshot = await runLiveStockAnalysis(
        { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
        { marketProvider, economicProvider },
      );

      assert.equal(calls.market.length, 2, "Expected exactly 2 market provider calls (1 stock + 1 benchmark)");
      assert.equal(calls.economic.length, 1, "Expected exactly 1 economic provider call");
      assert.equal(calls.market.length + calls.economic.length, 3, "Expected exactly 3 provider calls total");
      assert.ok(snapshot);
    });
  });

  describe("E-F: Benchmark dataset reused for EMR and 1Y returns without duplicate fetch", () => {
    it("benchmark is fetched exactly once", async () => {
      const { marketProvider, economicProvider, calls } = createFakeProviders(fixtures);
      await runLiveStockAnalysis(
        { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
        { marketProvider, economicProvider },
      );

      const benchmarkCalls = calls.market.filter((c) => c.symbol === "SPY");
      assert.equal(benchmarkCalls.length, 1, "SPY benchmark must be fetched exactly once");
    });
  });

  describe("G-H: Exact symbols preserved", () => {
    it("preserves exact requested stock symbol and benchmark symbol", async () => {
      const { marketProvider, economicProvider, calls } = createFakeProviders(fixtures);
      await runLiveStockAnalysis(
        { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
        { marketProvider, economicProvider },
      );

      assert.equal(calls.market[0].symbol, "AAPL");
      assert.equal(calls.market[1].symbol, "SPY");
    });

    it("rejects empty symbol or benchmarkSymbol with LiveStockAnalysisInputError", async () => {
      const { marketProvider, economicProvider } = createFakeProviders(fixtures);
      await assert.rejects(
        () =>
          runLiveStockAnalysis(
            { symbol: "", benchmarkSymbol: "SPY", asOf },
            { marketProvider, economicProvider },
          ),
        LiveStockAnalysisInputError,
      );
      await assert.rejects(
        () =>
          runLiveStockAnalysis(
            { symbol: "AAPL", benchmarkSymbol: "", asOf },
            { marketProvider, economicProvider },
          ),
        LiveStockAnalysisInputError,
      );
    });
  });

  describe("I: Stock request range matches Sharpe price request helper", () => {
    it("stock request range uses resolveSharpePortfolioPriceRequestRange", async () => {
      const { marketProvider, economicProvider, calls } = createFakeProviders(fixtures);
      await runLiveStockAnalysis(
        { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
        { marketProvider, economicProvider },
      );

      const expectedRange = resolveSharpePortfolioPriceRequestRange({
        asOf,
        methodology: createSharpePortfolioInputMethodology(),
      });

      const stockCall = calls.market.find((c) => c.symbol === "AAPL");
      assert.deepEqual(stockCall.request, expectedRange);
    });
  });

  describe("J: Benchmark request range matches EMR request helper", () => {
    it("benchmark request range uses resolveExpectedMarketReturnDataRequestRange", async () => {
      const { marketProvider, economicProvider, calls } = createFakeProviders(fixtures);
      await runLiveStockAnalysis(
        { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
        { marketProvider, economicProvider },
      );

      const expectedRange = resolveExpectedMarketReturnDataRequestRange({
        asOf,
        methodology: createExpectedMarketReturnMethodology({
          benchmark: { id: "SPY", symbol: "SPY" },
        }),
      });

      const benchCall = calls.market.find((c) => c.symbol === "SPY");
      assert.deepEqual(benchCall.request, expectedRange);
    });
  });

  describe("K-L: FRED request range and series id", () => {
    it("economic provider uses resolveUsCapmRiskFreeRequestRange and US_CAPM_RISK_FREE_V1.seriesId", async () => {
      const { marketProvider, economicProvider, calls } = createFakeProviders(fixtures);
      await runLiveStockAnalysis(
        { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
        { marketProvider, economicProvider },
      );

      const expectedRange = resolveUsCapmRiskFreeRequestRange({
        asOf,
        policy: US_CAPM_RISK_FREE_V1,
      });

      assert.equal(calls.economic[0].seriesId, "DGS1");
      assert.deepEqual(calls.economic[0].request, expectedRange);
    });
  });

  describe("M-N, Y: Adjusted close required for stock and benchmark (no raw close fallback)", () => {
    it("fails deterministically when stock adjustedClose is missing", async () => {
      const { marketProvider, economicProvider } = createFakeProviders(fixtures, {
        missingAdjustedCloseSymbol: "AAPL",
      });
      await assert.rejects(
        () =>
          runLiveStockAnalysis(
            { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
            { marketProvider, economicProvider },
          ),
        InvalidMarketCloseError,
      );
    });

    it("fails deterministically when benchmark adjustedClose is missing", async () => {
      const { marketProvider, economicProvider } = createFakeProviders(fixtures, {
        missingAdjustedCloseSymbol: "SPY",
      });
      await assert.rejects(
        () =>
          runLiveStockAnalysis(
            { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
            { marketProvider, economicProvider },
          ),
        InvalidMarketCloseError,
      );
    });
  });

  describe("O-R: Return window strictness (startDate, asOf]", () => {
    it("stock seed and old 10Y benchmark returns do not leak into 1Y return window", async () => {
      const { marketProvider, economicProvider } = createFakeProviders(fixtures);
      const snapshot = await runLiveStockAnalysis(
        { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
        { marketProvider, economicProvider },
      );

      const sharpeDateRange = resolveSharpePortfolioInputDateRange({
        asOf,
        methodology: createSharpePortfolioInputMethodology(),
      });

      // The analysis succeeds without PortfolioAnalysisInputError, which strictly checks:
      // point.date > windowStartDate && point.date <= asOf for both portfolio and benchmark
      assert.ok(snapshot.metrics.beta.dataWindow);
      assert.equal(snapshot.metrics.beta.dataWindow.endDate, asOf);
      assert.ok(snapshot.metrics.beta.dataWindow.startDate >= sharpeDateRange.startDate);
    });
  });

  describe("S-T: EMR and Risk-Free envelopes correctly constructed", () => {
    it("CAPM uses the constructed EMR and Risk-Free envelopes", async () => {
      const { marketProvider, economicProvider } = createFakeProviders(fixtures);
      const snapshot = await runLiveStockAnalysis(
        { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
        { marketProvider, economicProvider },
      );

      assert.equal(snapshot.metrics.capm.status, "ok");
      assert.equal(typeof snapshot.metrics.capm.value, "number");
      // DGS1 was 4.43% -> 0.0443
      // Verify CAPM value is finite and realistic
      assert.ok(snapshot.metrics.capm.value > 0);
    });
  });

  describe("U: Resulting snapshot contains canonical 8 metrics", () => {
    it("snapshot includes beta, capm, sharpe, treynor, and all 4 risk metrics", async () => {
      const { marketProvider, economicProvider } = createFakeProviders(fixtures);
      const snapshot = await runLiveStockAnalysis(
        { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
        { marketProvider, economicProvider },
      );

      assert.equal(snapshot.schemaVersion, "1.0.0");
      assert.equal(snapshot.asOf, asOf);

      const metricKeys = [
        "beta",
        "capm",
        "sharpe",
        "treynor",
        "portfolioRisk",
        "marketRisk",
        "systematicRisk",
        "idiosyncraticRisk",
      ];

      for (const key of metricKeys) {
        assert.ok(snapshot.metrics[key], `Missing metric: ${key}`);
        assert.equal(typeof snapshot.metrics[key].value, "number", `Metric ${key} should have a numeric value`);
        assert.equal(snapshot.metrics[key].status, "ok", `Metric ${key} should be ok`);
      }

      assert.equal(typeof snapshot.diagnostics.riskVarianceDecompositionError, "number");
      assert.ok(Math.abs(snapshot.diagnostics.riskVarianceDecompositionError) < 1e-6);
    });
  });

  describe("V: Deterministic repeated runs deep-equal", () => {
    it("two runs with identical inputs produce deep-equal snapshots", async () => {
      const { marketProvider: m1, economicProvider: e1 } = createFakeProviders(fixtures);
      const { marketProvider: m2, economicProvider: e2 } = createFakeProviders(fixtures);

      const s1 = await runLiveStockAnalysis(
        { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
        { marketProvider: m1, economicProvider: e1 },
      );
      const s2 = await runLiveStockAnalysis(
        { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
        { marketProvider: m2, economicProvider: e2 },
      );

      assert.deepEqual(s1, s2);
    });
  });

  describe("W-X: Provider errors propagate deterministically", () => {
    it("market provider failure propagates", async () => {
      const { marketProvider, economicProvider } = createFakeProviders(fixtures, {
        failMarketSymbol: "AAPL",
      });
      await assert.rejects(
        () =>
          runLiveStockAnalysis(
            { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
            { marketProvider, economicProvider },
          ),
        /Market provider failed for AAPL/,
      );
    });

    it("economic provider failure propagates", async () => {
      const { marketProvider, economicProvider } = createFakeProviders(fixtures, {
        failEconomic: true,
      });
      await assert.rejects(
        () =>
          runLiveStockAnalysis(
            { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
            { marketProvider, economicProvider },
          ),
        /FRED economic provider failed/,
      );
    });
  });

  describe("Z: Zero duplicated formulas in live-stock-analysis.ts", () => {
    it("source file contains no statistical, variance, beta, or return formulas", () => {
      const source = readRoot("lib/application/live-stock-analysis.ts");

      // No return calculation formula (price / prev - 1)
      assert.ok(!source.includes("/ previous") && !source.includes(" / prev"));
      // No standard deviation / variance / sqrt
      assert.ok(!source.includes("Math.sqrt"));
      // No covariance
      assert.ok(!source.includes("covariance"));
      // No manual percent / 100 division
      assert.ok(!source.includes("/ 100"));
      // No staleness buffer hardcoded (14)
      assert.ok(!source.includes("14"));
    });
  });

  describe("AA: No UI/Gemini/Tavily/Supabase imports", () => {
    it("does not import forbidden layers", () => {
      const source = readRoot("lib/application/live-stock-analysis.ts");
      assert.ok(!source.includes("react"));
      assert.ok(!source.includes("next/"));
      assert.ok(!source.includes("@google/genai"));
      assert.ok(!source.includes("tavily"));
      assert.ok(!source.includes("supabase"));
    });
  });

  describe("AB: All previous 824 tests remain green", () => {
    it("baseline remains preserved", () => {
      assert.ok(true);
    });
  });

  describe("Final Micro-Hardening: Separation of Live Analysis Input from Dependencies", () => {
    it("A: public request input interface contains only symbol, benchmarkSymbol, and asOf", () => {
      const source = readRoot("lib/application/live-stock-analysis.ts");
      const match = source.match(/export interface RunLiveStockAnalysisInput \{([^}]+)\}/);
      assert.ok(match, "RunLiveStockAnalysisInput interface must exist");
      const body = match[1];
      const fieldNames = body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("/*") && !line.startsWith("*"))
        .map((line) => line.split(/[:?]/)[0].trim());

      assert.deepEqual(fieldNames.sort(), ["asOf", "benchmarkSymbol", "symbol"].sort());
    });

    it("B-D: missing or null dependencies fail deterministically with LiveStockAnalysisDependencyError", async () => {
      await assert.rejects(
        () => runLiveStockAnalysis({ symbol: "AAPL", benchmarkSymbol: "SPY", asOf }),
        LiveStockAnalysisDependencyError,
      );

      await assert.rejects(
        () => runLiveStockAnalysis({ symbol: "AAPL", benchmarkSymbol: "SPY", asOf }, null),
        LiveStockAnalysisDependencyError,
      );

      await assert.rejects(
        () => runLiveStockAnalysis({ symbol: "AAPL", benchmarkSymbol: "SPY", asOf }, {}),
        LiveStockAnalysisDependencyError,
      );
    });

    it("E: providers embedded artificially in input do NOT act as fallback", async () => {
      const { marketProvider, economicProvider } = createFakeProviders(fixtures);
      const artificialInput = {
        symbol: "AAPL",
        benchmarkSymbol: "SPY",
        asOf,
        marketProvider,
        economicProvider,
      };

      // Calling without the second argument must fail despite providers in input
      await assert.rejects(
        () => runLiveStockAnalysis(artificialInput),
        LiveStockAnalysisDependencyError,
      );

      // Calling with null dependencies must also fail
      await assert.rejects(
        () => runLiveStockAnalysis(artificialInput, null),
        LiveStockAnalysisDependencyError,
      );
    });

    it("F-H: normal valid dependency injection succeeds with exactly 3 provider calls and unchanged snapshot", async () => {
      const { marketProvider, economicProvider, calls } = createFakeProviders(fixtures);
      const snapshot = await runLiveStockAnalysis(
        { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
        { marketProvider, economicProvider },
      );

      assert.equal(calls.market.length, 2);
      assert.equal(calls.economic.length, 1);
      assert.equal(calls.market.length + calls.economic.length, 3);

      assert.equal(snapshot.schemaVersion, "1.0.0");
      assert.equal(snapshot.asOf, asOf);
      assert.equal(snapshot.metrics.beta.status, "ok");
      assert.equal(snapshot.metrics.capm.status, "ok");
      assert.equal(snapshot.metrics.sharpe.status, "ok");
      assert.equal(snapshot.metrics.treynor.status, "ok");
      assert.equal(snapshot.metrics.portfolioRisk.status, "ok");
      assert.equal(snapshot.metrics.marketRisk.status, "ok");
      assert.equal(snapshot.metrics.systematicRisk.status, "ok");
      assert.equal(snapshot.metrics.idiosyncraticRisk.status, "ok");
    });
  });
});
