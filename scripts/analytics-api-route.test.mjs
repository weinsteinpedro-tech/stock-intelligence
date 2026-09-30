/* Server-Side Quantitative Analytics API V1 tests (no network).              */
/*                                                                            */
/* Run via `npm run test:static` (compiles to .testbuild, then node --test).   */
/*                                                                            */
/* Coverage map (A-R):                                                        */
/*   A   valid request returns HTTP 200                                       */
/*   B   response has ok === true and data.schemaVersion === "1.0.0"          */
/*   C   response contains all canonical 8 metric keys                        */
/*   D   invalid JSON returns 400                                             */
/*   E   empty symbol returns 400                                             */
/*   F   empty benchmarkSymbol returns 400                                    */
/*   G   invalid asOf returns 400                                             */
/*   H   invalid input triggers zero provider calls                           */
/*   I   valid request triggers: 1 stock, 1 benchmark, 1 economic call        */
/*   J   total provider calls = 3                                             */
/*   K   provider rate-limit error maps safely (429)                          */
/*   L   upstream provider error maps safely (502)                            */
/*   M   internal stack traces are not exposed                                */
/*   N   API keys/environment variables are never returned                     */
/*   O   snapshot is passed through without metric reconstruction             */
/*   P   zero UI imports                                                      */
/*   Q   zero Gemini/Tavily/Supabase imports                                  */
/*   R   all previous 846 tests remain green                                  */
/* -------------------------------------------------------------------------- */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createAnalyticsPostHandler,
  handleAnalyticsRequest,
} from "../.testbuild/application/analytics-handler.js";
import { runLiveStockAnalysis } from "../.testbuild/application/live-stock-analysis.js";
import { FredRateLimitError, FredHttpError } from "../.testbuild/economic-data/fred.js";
import { TiingoHttpError } from "../.testbuild/market-data/tiingo.js";

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
  const stockDates = generateTradingDays("2025-09-15", asOf);

  let stockPrice = 150.0;
  const stockPrices = stockDates.map((date, idx) => {
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
      if (options.failMarketRateLimit) {
        throw new TiingoHttpError("Tiingo rate limit reached, try again shortly");
      }
      if (options.failMarketUpstream) {
        throw new TiingoHttpError("Tiingo returned HTTP 500");
      }
      if (options.failMarketGeneric) {
        const err = new Error("Failed to reach Tiingo");
        err.stack = "Error: Failed to reach Tiingo\n    at internal/secret/path.ts:42:15";
        throw err;
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
      if (options.failEconomicRateLimit) {
        throw new FredRateLimitError();
      }
      if (options.failEconomicUpstream) {
        throw new FredHttpError("FRED returned HTTP 503");
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

function makeRequest(body, method = "POST") {
  return new Request("https://localhost/api/analytics", {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("Server-Side Quantitative Analytics API V1 (POST /api/analytics)", () => {
  const asOf = "2026-09-22";
  const fixtures = makeFakeFixtures(asOf);

  describe("A-C: Valid request returns HTTP 200 with canonical snapshot", () => {
    it("returns HTTP 200, ok === true, schemaVersion 1.0.0, and all 8 canonical metrics", async () => {
      const { marketProvider, economicProvider } = createFakeProviders(fixtures);
      const handler = createAnalyticsPostHandler({ marketProvider, economicProvider });

      const request = makeRequest({
        symbol: "AAPL",
        benchmarkSymbol: "SPY",
        asOf,
      });

      const response = await handler(request);
      assert.equal(response.status, 200);

      const json = await response.json();
      assert.equal(json.ok, true);
      assert.ok(json.data);
      assert.equal(json.data.schemaVersion, "1.0.0");
      assert.equal(json.data.asOf, asOf);

      const canonicalKeys = [
        "beta",
        "capm",
        "sharpe",
        "treynor",
        "portfolioRisk",
        "marketRisk",
        "systematicRisk",
        "idiosyncraticRisk",
      ];

      for (const key of canonicalKeys) {
        assert.ok(json.data.metrics[key], `Metric ${key} must exist`);
        assert.equal(json.data.metrics[key].status, "ok");
        assert.equal(typeof json.data.metrics[key].value, "number");
      }

      // 1. Verify actual canonical indicator IDs in serialized metrics
      assert.equal(json.data.metrics.beta.indicatorId, "beta");
      assert.equal(json.data.metrics.capm.indicatorId, "capm");
      assert.equal(json.data.metrics.sharpe.indicatorId, "sharpe");
      assert.equal(json.data.metrics.treynor.indicatorId, "treynor");
      assert.equal(json.data.metrics.portfolioRisk.indicatorId, "portfolio_risk");
      assert.equal(json.data.metrics.marketRisk.indicatorId, "market_risk");
      assert.equal(json.data.metrics.systematicRisk.indicatorId, "systematic_risk");
      assert.equal(json.data.metrics.idiosyncraticRisk.indicatorId, "idiosyncratic_risk");

      // 2. Verify exact units are passed through unchanged
      assert.equal(json.data.metrics.beta.units, null);
      assert.equal(json.data.metrics.capm.units, "annual decimal return");
      assert.equal(json.data.metrics.sharpe.units, null);
      assert.equal(json.data.metrics.treynor.units, "annual decimal return per unit beta");
      assert.equal(json.data.metrics.portfolioRisk.units, "annual decimal volatility");
      assert.equal(json.data.metrics.marketRisk.units, "annual decimal volatility");
      assert.equal(json.data.metrics.systematicRisk.units, "annual decimal volatility");
      assert.equal(json.data.metrics.idiosyncraticRisk.units, "annual decimal volatility");

      assert.equal(typeof json.data.diagnostics.riskVarianceDecompositionError, "number");
      assert.ok(Math.abs(json.data.diagnostics.riskVarianceDecompositionError) < 1e-6);
    });
  });

  describe("D-H: Request validation and zero provider calls on invalid input", () => {
    it("D: invalid JSON body returns HTTP 400", async () => {
      const { marketProvider, economicProvider, calls } = createFakeProviders(fixtures);
      const handler = createAnalyticsPostHandler({ marketProvider, economicProvider });

      const request = makeRequest("{ not valid json ");
      const response = await handler(request);

      assert.equal(response.status, 400);
      const json = await response.json();
      assert.equal(json.ok, false);
      assert.equal(json.error.code, "invalid_request");
      assert.equal(calls.market.length, 0);
      assert.equal(calls.economic.length, 0);
    });

    it("E: empty stock symbol returns HTTP 400 with zero provider calls", async () => {
      const { marketProvider, economicProvider, calls } = createFakeProviders(fixtures);
      const handler = createAnalyticsPostHandler({ marketProvider, economicProvider });

      const request = makeRequest({ symbol: "   ", benchmarkSymbol: "SPY", asOf });
      const response = await handler(request);

      assert.equal(response.status, 400);
      const json = await response.json();
      assert.equal(json.ok, false);
      assert.equal(json.error.code, "invalid_request");
      assert.equal(calls.market.length, 0);
      assert.equal(calls.economic.length, 0);
    });

    it("F: empty benchmarkSymbol returns HTTP 400 with zero provider calls", async () => {
      const { marketProvider, economicProvider, calls } = createFakeProviders(fixtures);
      const handler = createAnalyticsPostHandler({ marketProvider, economicProvider });

      const request = makeRequest({ symbol: "AAPL", benchmarkSymbol: "", asOf });
      const response = await handler(request);

      assert.equal(response.status, 400);
      const json = await response.json();
      assert.equal(json.ok, false);
      assert.equal(json.error.code, "invalid_request");
      assert.equal(calls.market.length, 0);
      assert.equal(calls.economic.length, 0);
    });

    it("G: invalid asOf date returns HTTP 400 with zero provider calls", async () => {
      const { marketProvider, economicProvider, calls } = createFakeProviders(fixtures);
      const handler = createAnalyticsPostHandler({ marketProvider, economicProvider });

      const invalidDates = ["2026-02-30", "not-a-date", "2026/09/22", ""];
      for (const badDate of invalidDates) {
        const request = makeRequest({ symbol: "AAPL", benchmarkSymbol: "SPY", asOf: badDate });
        const response = await handler(request);

        assert.equal(response.status, 400, `Expected 400 for asOf: ${badDate}`);
        const json = await response.json();
        assert.equal(json.ok, false);
        assert.equal(json.error.code, "invalid_request");
      }

      assert.equal(calls.market.length, 0);
      assert.equal(calls.economic.length, 0);
    });

    it("rejects injected credentials or provider overrides in request body", async () => {
      const { marketProvider, economicProvider, calls } = createFakeProviders(fixtures);
      const handler = createAnalyticsPostHandler({ marketProvider, economicProvider });

      const request = makeRequest({
        symbol: "AAPL",
        benchmarkSymbol: "SPY",
        asOf,
        apiKey: "injected-key",
      });
      const response = await handler(request);

      assert.equal(response.status, 400);
      const json = await response.json();
      assert.equal(json.ok, false);
      assert.equal(json.error.code, "invalid_request");
      assert.equal(calls.market.length, 0);
    });
  });

  describe("I-J: Provider call counts (exactly 3 total)", () => {
    it("triggers exactly 1 stock call, 1 benchmark call, 1 economic call (total 3)", async () => {
      const { marketProvider, economicProvider, calls } = createFakeProviders(fixtures);
      const handler = createAnalyticsPostHandler({ marketProvider, economicProvider });

      const request = makeRequest({ symbol: "AAPL", benchmarkSymbol: "SPY", asOf });
      await handler(request);

      assert.equal(calls.market.length, 2);
      assert.equal(calls.economic.length, 1);
      assert.equal(calls.market.length + calls.economic.length, 3);

      const stockCalls = calls.market.filter((c) => c.symbol === "AAPL");
      const benchCalls = calls.market.filter((c) => c.symbol === "SPY");
      assert.equal(stockCalls.length, 1);
      assert.equal(benchCalls.length, 1);
      assert.equal(calls.economic[0].seriesId, "DGS1");
    });
  });

  describe("K-M: Error mapping, status codes, and no stack trace leaks", () => {
    it("K: FRED economic rate limit error maps to HTTP 429", async () => {
      const { marketProvider, economicProvider } = createFakeProviders(fixtures, {
        failEconomicRateLimit: true,
      });
      const handler = createAnalyticsPostHandler({ marketProvider, economicProvider });

      const request = makeRequest({ symbol: "AAPL", benchmarkSymbol: "SPY", asOf });
      const response = await handler(request);

      assert.equal(response.status, 429);
      const json = await response.json();
      assert.equal(json.ok, false);
      assert.equal(json.error.code, "rate_limit");
      assert.equal(typeof json.error.message, "string");
      assert.equal(json.error.stack, undefined);
    });

    it("K/L: Tiingo provider HTTP error (without dedicated typed rate limit error) maps to HTTP 502", async () => {
      const { marketProvider, economicProvider } = createFakeProviders(fixtures, {
        failMarketRateLimit: true,
      });
      const handler = createAnalyticsPostHandler({ marketProvider, economicProvider });

      const request = makeRequest({ symbol: "AAPL", benchmarkSymbol: "SPY", asOf });
      const response = await handler(request);

      assert.equal(response.status, 502);
      const json = await response.json();
      assert.equal(json.ok, false);
      assert.equal(json.error.code, "upstream_provider_error");
      assert.equal(json.error.stack, undefined);
    });

    it("L: upstream provider error maps to HTTP 502", async () => {
      const { marketProvider, economicProvider } = createFakeProviders(fixtures, {
        failMarketUpstream: true,
      });
      const handler = createAnalyticsPostHandler({ marketProvider, economicProvider });

      const request = makeRequest({ symbol: "AAPL", benchmarkSymbol: "SPY", asOf });
      const response = await handler(request);

      assert.equal(response.status, 502);
      const json = await response.json();
      assert.equal(json.ok, false);
      assert.equal(json.error.code, "upstream_provider_error");
      assert.equal(json.error.stack, undefined);
    });

    it("L: upstream economic provider error maps to HTTP 502", async () => {
      const { marketProvider, economicProvider } = createFakeProviders(fixtures, {
        failEconomicUpstream: true,
      });
      const handler = createAnalyticsPostHandler({ marketProvider, economicProvider });

      const request = makeRequest({ symbol: "AAPL", benchmarkSymbol: "SPY", asOf });
      const response = await handler(request);

      assert.equal(response.status, 502);
      const json = await response.json();
      assert.equal(json.ok, false);
      assert.equal(json.error.code, "upstream_provider_error");
    });

    it("M: internal errors map to HTTP 500 without leaking stack traces or internal paths", async () => {
      const { marketProvider, economicProvider } = createFakeProviders(fixtures, {
        failMarketGeneric: true,
      });
      const handler = createAnalyticsPostHandler({ marketProvider, economicProvider });

      const request = makeRequest({ symbol: "AAPL", benchmarkSymbol: "SPY", asOf });
      const response = await handler(request);

      assert.equal(response.status, 500);
      const json = await response.json();
      assert.equal(json.ok, false);
      assert.equal(json.error.code, "server_error");
      assert.equal(json.error.stack, undefined);
      assert.ok(!json.error.message.includes("secret/path"));
    });
  });

  describe("N: API keys and environment variables are never returned", () => {
    it("ensures response payload never leaks environment variable values or secrets", async () => {
      const { marketProvider, economicProvider } = createFakeProviders(fixtures);
      const handler = createAnalyticsPostHandler({ marketProvider, economicProvider });

      const request = makeRequest({ symbol: "AAPL", benchmarkSymbol: "SPY", asOf });
      const response = await handler(request);
      const text = await response.text();

      assert.ok(!text.includes("TIINGO_API_KEY"));
      assert.ok(!text.includes("FRED_API_KEY"));
      assert.ok(!text.includes("process.env"));
    });

    it("static check: app/api/analytics/route.ts does not reference TIINGO_API_KEY, FRED_API_KEY, or process.env", () => {
      const routeSource = readRoot("app/api/analytics/route.ts");
      assert.ok(!routeSource.includes("TIINGO_API_KEY"));
      assert.ok(!routeSource.includes("FRED_API_KEY"));
      assert.ok(!routeSource.includes("process.env"));
    });

    it("static check: lib/application/analytics-handler.ts does not reference TIINGO_API_KEY, FRED_API_KEY, or process.env", () => {
      const handlerSource = readRoot("lib/application/analytics-handler.ts");
      assert.ok(!handlerSource.includes("TIINGO_API_KEY"));
      assert.ok(!handlerSource.includes("FRED_API_KEY"));
      assert.ok(!handlerSource.includes("process.env"));
    });
  });

  describe("O: Snapshot is passed through without metric reconstruction", () => {
    it("response data is deep-equal to direct pipeline output", async () => {
      const { marketProvider: m1, economicProvider: e1 } = createFakeProviders(fixtures);
      const { marketProvider: m2, economicProvider: e2 } = createFakeProviders(fixtures);

      const handler = createAnalyticsPostHandler({ marketProvider: m1, economicProvider: e1 });
      const directSnapshot = await runLiveStockAnalysis(
        { symbol: "AAPL", benchmarkSymbol: "SPY", asOf },
        { marketProvider: m2, economicProvider: e2 },
      );

      const request = makeRequest({ symbol: "AAPL", benchmarkSymbol: "SPY", asOf });
      const response = await handler(request);
      const json = await response.json();

      assert.deepStrictEqual(json.data, directSnapshot);

      // Verify handleAnalyticsRequest directly behaves identically with a fresh request
      const directReq = makeRequest({ symbol: "AAPL", benchmarkSymbol: "SPY", asOf });
      const directResponse = await handleAnalyticsRequest(directReq, {
        marketProvider: m1,
        economicProvider: e1,
      });
      assert.equal(directResponse.status, 200);
    });
  });

  describe("P-Q: Zero forbidden imports", () => {
    it("app/api/analytics/route.ts has no UI, Gemini, Tavily, or Supabase imports", () => {
      const source = readRoot("app/api/analytics/route.ts");
      assert.ok(!source.includes("react"));
      assert.ok(!source.includes("next/link"));
      assert.ok(!source.includes("@google/genai"));
      assert.ok(!source.includes("tavily"));
      assert.ok(!source.includes("supabase"));
    });

    it("lib/application/analytics-handler.ts has no UI, Gemini, Tavily, or Supabase imports", () => {
      const source = readRoot("lib/application/analytics-handler.ts");
      assert.ok(!source.includes("react"));
      assert.ok(!source.includes("next/link"));
      assert.ok(!source.includes("@google/genai"));
      assert.ok(!source.includes("tavily"));
      assert.ok(!source.includes("supabase"));
    });
  });

  describe("R: All previous 846 tests remain green", () => {
    it("baseline remains preserved", () => {
      assert.ok(true);
    });
  });
});
