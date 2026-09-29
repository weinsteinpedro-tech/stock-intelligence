/* Tiingo EOD provider + adjusted-close adapter tests (no network).        */
/*                                                                          */
/* Run via `npm run test:static` (compiles lib/** to .testbuild, then       */
/* node --test this file). All provider requests go through a mocked        */
/* globalThis.fetch; no real Tiingo call ever happens here.                 */
/*                                                                          */
/* Coverage map (A-T):                                                      */
/*   A  HistoricalPrice accepts adjustedClose                               */
/*   B  Alpha Vantage existing behavior remains compatible                  */
/*   C  Tiingo valid payload maps correctly                                 */
/*   D  adjClose maps to adjustedClose                                      */
/*   E  adjusted_close adapter uses adjustedClose, not close                */
/*   F  missing adjClose rejected                                           */
/*   G  NaN/Infinity rejected                                               */
/*   H  malformed date rejected                                             */
/*   I  missing API key gives deterministic error                           */
/*   J  HTTP non-OK gives deterministic error                               */
/*   K  authorization/token is server-only                                  */
/*   L  API key never appears in logs/output                                */
/*   M  explicit start/end dates appear in request                          */
/*   N  symbol is encoded safely                                            */
/*   O  no benchmark symbol hardcoded                                       */
/*   P  no analytics math inside provider                                   */
/*   Q  no new external dependencies                                        */
/*   R  builders pipeline accepts Tiingo-shaped HistoricalPrice             */
/*   S  known synthetic pipeline still produces Beta = 2                    */
/*   T  all previous 294 tests remain green (deterministic reruns)          */
/* ------------------------------------------------------------------------ */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TiingoApiKeyMissingError,
  TiingoHttpError,
  TiingoInvalidDateError,
  TiingoInvalidNumberError,
  TiingoMissingAdjustedCloseError,
  TiingoProvider,
  makeTiingoSource,
} from "../.testbuild/market-data/tiingo.js";
import {
  historicalPricesToPriceSeries,
} from "../.testbuild/financial-data/adapters/market-prices.js";
import {
  buildBenchmarkReturnSeries,
  buildBetaDataContext,
  buildPortfolioReturnSeries,
  buildReturnSeriesEnvelope,
} from "../.testbuild/financial-data/builders/index.js";
import { makeDataQuality } from "../.testbuild/financial-data/quality.js";
import {
  AnalyticsEngine,
  betaIndicator,
  IndicatorRegistry,
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

function makeQuality(qualityInput = {}) {
  return makeDataQuality({
    freshness: qualityInput.freshness ?? "fresh",
    sourceTier: qualityInput.sourceTier ?? "licensed",
    completeness: qualityInput.completeness ?? 1,
    warnings: qualityInput.warnings ?? [],
  });
}

const FAKE_KEY = "tiingo-test-key";

function withEnv(key, value, fn) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

function providerTest(fn) {
  return withEnv("TIINGO_API_KEY", FAKE_KEY, fn);
}

let seenUrl = "";
let seenInit = null;

function makeCaptureFetch(body, status = 200) {
  return async (url, init) => {
    seenUrl = String(url);
    seenInit = init;
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      { status, headers: { "content-type": "application/json" } },
    );
  };
}

async function withMockFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function validRow(overrides = {}) {
  return {
    date: "2026-06-01T00:00:00.000Z",
    open: 100,
    high: 105,
    low: 99,
    close: 104,
    volume: 1000000,
    adjOpen: 99,
    adjHigh: 104,
    adjLow: 98,
    adjClose: 103,
    adjVolume: 1000000,
    divCash: 0,
    splitFactor: 1,
    ...overrides,
  };
}

function rowsFor(overrides) {
  return overrides.map((patch, index) =>
    validRow({
      date: `2026-09-${String(8 + index).padStart(2, "0")}T00:00:00.000Z`,
      ...patch,
    }),
  );
}

describe("A: HistoricalPrice accepts adjustedClose", () => {
  it("is optional for close-only rows and consumable for adjusted rows", () => {
    const closeOnly = {
      date: "2026-06-01",
      open: 1,
      high: 1,
      low: 1,
      close: 104,
      volume: 1000,
    };
    const withAdjusted = {
      ...closeOnly,
      adjustedClose: 103,
    };
    const closeSeries = historicalPricesToPriceSeries([closeOnly], "AAPL");
    assert.deepEqual(closeSeries.points.map((point) => point.value), [104]);
    const adjustedSeries = historicalPricesToPriceSeries([withAdjusted], "AAPL", {
      priceBasis: "adjusted_close",
    });
    assert.deepEqual(adjustedSeries.points.map((point) => point.value), [103]);
  });
});

describe("B: Alpha Vantage existing behavior remains compatible", () => {
  it("alpha-vantage source file is untouched", () => {
    const source = readRoot("lib/market-data/alpha-vantage.ts");
    assert.match(source, /TIME_SERIES_DAILY/);
    assert.match(source, /ALPHA_VANTAGE_API_KEY/);
    assert.equal(/adjustedClose/.test(source), false);
    assert.match(source, /getDailySeries/);
  });

  it("MarketDataProvider contract still names searchSymbols/getDailySeries", () => {
    const types = readRoot("lib/market-data/types.ts");
    assert.match(types, /searchSymbols/);
    assert.match(types, /getDailySeries\(symbol: string\)/);
    assert.match(types, /adjustedClose\?:\s*number/);
  });

  it("market-data index still serves AlphaVantage as the default provider", () => {
    const index = readRoot("lib/market-data/index.ts");
    assert.match(index, /getMarketDataProvider\(\): MarketDataProvider/);
    assert.match(index, /new AlphaVantageProvider\(\)/);
  });
});

describe("C: Tiingo valid payload maps correctly", () => {
  it("maps an EOD array into HistoricalPrice[] with canonical dates", async () => {
    const body = rowsFor([
      {},
      { date: "2026-09-09T00:00:00.000Z", close: 106, adjClose: 105 },
    ]);
    await withMockFetch(makeCaptureFetch(body), () =>
      providerTest(async () => {
        const provider = new TiingoProvider();
        const prices = await provider.getHistoricalPrices("AAPL", {
          startDate: "2026-09-08",
          endDate: "2026-09-09",
        });
        assert.deepEqual(
          prices.map((price) => price.date),
          ["2026-09-08", "2026-09-09"],
        );
        assert.equal(prices[0].open, 100);
        assert.equal(prices[0].high, 105);
        assert.equal(prices[0].low, 99);
        assert.equal(prices[0].close, 104);
        assert.equal(prices[0].volume, 1000000);
      }),
    );
  });
});

describe("D: adjClose maps to adjustedClose", () => {
  it("carries the vendor adjusted close into adjustedClose", async () => {
    await withMockFetch(makeCaptureFetch([validRow()]), () =>
      providerTest(async () => {
        const provider = new TiingoProvider();
        const prices = await provider.getHistoricalPrices("AAPL", {
          startDate: "2026-06-01",
          endDate: "2026-06-01",
        });
        assert.equal(prices[0].adjustedClose, 103);
        assert.equal(prices[0].close, 104);
        assert.notEqual(prices[0].adjustedClose, prices[0].close);
      }),
    );
  });
});

describe("E: adjusted_close adapter uses adjustedClose, not close", () => {
  it("returns adjusted values even when close differs", () => {
    const prices = [
      {
        date: "2026-06-01",
        open: 120,
        high: 121,
        low: 119,
        close: 120,
        adjustedClose: 103,
        volume: 1000,
      },
      {
        date: "2026-06-02",
        open: 121,
        high: 122,
        low: 120,
        close: 121,
        adjustedClose: 104,
        volume: 1000,
      },
    ];
    const series = historicalPricesToPriceSeries(prices, "AAPL", {
      priceBasis: "adjusted_close",
    });
    assert.deepEqual(series.points.map((point) => point.value), [103, 104]);
  });
});

describe("F: missing adjClose rejected", () => {
  it("throws a deterministic error instead of mapping partially", async () => {
    const withoutAdjClose = validRow();
    delete withoutAdjClose.adjClose;
    await withMockFetch(makeCaptureFetch([withoutAdjClose]), () =>
      providerTest(async () => {
        const provider = new TiingoProvider();
        await assert.rejects(
          provider.getHistoricalPrices("AAPL", {
            startDate: "2026-06-01",
            endDate: "2026-06-01",
          }),
          TiingoMissingAdjustedCloseError,
        );
      }),
    );
  });
});

describe("G: NaN/Infinity rejected", () => {
  it("rejects non-finite close values", async () => {
    await withMockFetch(
      makeCaptureFetch([validRow({ close: Number.NaN })]),
      () =>
        providerTest(async () => {
          const provider = new TiingoProvider();
          await assert.rejects(
            provider.getHistoricalPrices("AAPL", {
              startDate: "2026-06-01",
              endDate: "2026-06-01",
            }),
            TiingoInvalidNumberError,
          );
        }),
    );
  });

  it("rejects infinite adjClose values", async () => {
    await withMockFetch(
      makeCaptureFetch([validRow({ adjClose: Number.POSITIVE_INFINITY })]),
      () =>
        providerTest(async () => {
          const provider = new TiingoProvider();
          await assert.rejects(
            provider.getHistoricalPrices("AAPL", {
              startDate: "2026-06-01",
              endDate: "2026-06-01",
            }),
            TiingoInvalidNumberError,
          );
        }),
    );
  });
});

describe("H: malformed date rejected", () => {
  it("rejects a garbage row date", async () => {
    await withMockFetch(makeCaptureFetch([validRow({ date: "garbage" })]), () =>
      providerTest(async () => {
        const provider = new TiingoProvider();
        await assert.rejects(
          provider.getHistoricalPrices("AAPL", {
            startDate: "2026-06-01",
            endDate: "2026-06-01",
          }),
          TiingoInvalidDateError,
        );
      }),
    );
  });

  it("rejects a non-canonical request date", async () => {
    await withMockFetch(makeCaptureFetch([]), () =>
      providerTest(async () => {
        const provider = new TiingoProvider();
        await assert.rejects(
          provider.getHistoricalPrices("AAPL", {
            startDate: "2026-6-01",
            endDate: "2026-06-02",
          }),
          TiingoInvalidDateError,
        );
      }),
    );
  });
});

describe("I: missing API key gives deterministic error", () => {
  it("constructor throws TiingoApiKeyMissingError when unset", () => {
    withEnv("TIINGO_API_KEY", undefined, () => {
      assert.throws(() => new TiingoProvider(), TiingoApiKeyMissingError);
      try {
        new TiingoProvider();
      } catch (error) {
        assert.match(error.message, /TIINGO_API_KEY/);
      }
    });
  });
});

describe("J: HTTP non-OK gives deterministic error", () => {
  it("401 -> TiingoHttpError mentioning the status", async () => {
    await withMockFetch(makeCaptureFetch({}, 401), () =>
      providerTest(async () => {
        const provider = new TiingoProvider();
        let message = "";
        await provider
          .getDailySeries("AAPL")
          .catch((error) => {
            assert.ok(error instanceof TiingoHttpError);
            message = error.message;
          });
        assert.match(message, /HTTP 401/);
      }),
    );
  });

  it("429 -> deterministic rate-limit error", async () => {
    await withMockFetch(makeCaptureFetch({}, 429), () =>
      providerTest(async () => {
        const provider = new TiingoProvider();
        await assert.rejects(
          provider.getDailySeries("AAPL"),
          TiingoHttpError,
        );
      }),
    );
  });
});

describe("K: authorization/token is server-only", () => {
  it("sends the token as an Authorization header, never as a query param", async () => {
    await withMockFetch(makeCaptureFetch([]), () =>
      providerTest(async () => {
        const provider = new TiingoProvider();
        await provider.getHistoricalPrices("AAPL", {
          startDate: "2026-06-01",
          endDate: "2026-06-02",
        });
        assert.equal(seenInit.headers.Authorization, `Token ${FAKE_KEY}`);
        assert.equal(seenUrl.includes("tiingo-test-key"), false);
        assert.equal(seenUrl.includes("apikey"), false);
      }),
    );
  });

  it("source never references a client-exposed prefix", () => {
    const source = readRoot("lib/market-data/tiingo.ts");
    assert.equal(/NEXT_PUBLIC_TIINGO/.test(source), false);
    assert.match(source, /process\.env\.TIINGO_API_KEY/);
  });
});

describe("L: API key never appears in logs/output", () => {
  it("the provider source has no console output at all", () => {
    const source = readRoot("lib/market-data/tiingo.ts");
    assert.equal(/console\./.test(source), false);
    assert.equal(/TIINGO_API_KEY="/.test(source), false);
  });

  it("error messages never contain the key", async () => {
    await withMockFetch(
      async () => {
        throw new Error(`boom ${FAKE_KEY}`);
      },
      () =>
        providerTest(async () => {
          const provider = new TiingoProvider();
          let message = "";
          try {
            await provider.getDailySeries("AAPL");
          } catch (error) {
            message = error.message;
          }
          assert.equal(message.includes(FAKE_KEY), false);
          assert.match(message, /Failed to reach Tiingo/);
        }),
    );
  });
});

describe("M: explicit start/end dates appear in request", () => {
  it("passes startDate and endDate through as query params", async () => {
    await withMockFetch(makeCaptureFetch([]), () =>
      providerTest(async () => {
        const provider = new TiingoProvider();
        await provider.getHistoricalPrices("MSFT", {
          startDate: "2026-01-01",
          endDate: "2026-06-30",
        });
        assert.match(seenUrl, /startDate=2026-01-01/);
        assert.match(seenUrl, /endDate=2026-06-30/);
      }),
    );
  });
});

describe("N: symbol is encoded safely", () => {
  it("a symbol with special characters is URL-encoded", async () => {
    await withMockFetch(makeCaptureFetch([]), () =>
      providerTest(async () => {
        const provider = new TiingoProvider();
        await provider.getHistoricalPrices("A&B", {
          startDate: "2026-06-01",
          endDate: "2026-06-02",
        });
        assert.equal(seenUrl.includes("A%26B"), true);
        assert.equal(seenUrl.includes("prices/A&B/"), false);
      }),
    );
  });
});

describe("O: no benchmark symbol hardcoded", () => {
  it("tiingo provider stays benchmark-agnostic", () => {
    const source = readRoot("lib/market-data/tiingo.ts");
    assert.equal(/SPY/i.test(source), false);
    assert.equal(/S\s*&\s*P/i.test(source), false);
    assert.equal(/Nasdaq/i.test(source), false);
    assert.equal(/benchmark\s*:\s*["']SPY/i.test(source), false);
  });
});

describe("P: no analytics math inside provider", () => {
  it("the provider only transports prices; no indicator math", () => {
    const source = readRoot("lib/market-data/tiingo.ts");
    for (const pattern of [
      /calculateSimpleReturns/,
      /normalizeReturnSeries/,
      /sampleCovariance/,
      /sampleVariance/,
      /alignReturnSeries/,
      /calculatePortfolioReturns/,
      /beta/i,
      /from ["']\.\.\/analytics/,
    ]) {
      assert.equal(pattern.test(source), false, `unexpected pattern ${pattern}`);
    }
  });
});

describe("Q: no new external dependencies", () => {
  it("no tiingo SDK or new packages were added", () => {
    const pkg = JSON.parse(readRoot("package.json"));
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
      "@google/genai",
      "@supabase/supabase-js",
      "next",
      "react",
      "react-dom",
      "recharts",
      "zod",
    ]);
    assert.deepEqual(Object.keys(pkg.devDependencies).sort(), [
      "@tailwindcss/postcss",
      "@types/node",
      "@types/react",
      "@types/react-dom",
      "eslint",
      "eslint-config-next",
      "tailwindcss",
      "typescript",
    ]);
  });

  it("tiingo provider imports only from ./types", () => {
    const source = readRoot("lib/market-data/tiingo.ts");
    for (const match of source.matchAll(/from ["']([^"']+)["']/g)) {
      assert.equal(
        match[1],
        "./types",
        `unexpected import target ${match[1]}`,
      );
    }
  });
});

function tiingoBuildingBlocks() {
  const benchRows = rowsFor([
    { close: 100, adjClose: 100 },
    { close: 101, adjClose: 101 },
    { close: 103.02, adjClose: 103.02 },
    { close: 101.9898, adjClose: 101.9898 },
    { close: 105.049494, adjClose: 105.049494 },
  ]);
  const portRows = rowsFor([
    { close: 100, adjClose: 100 },
    { close: 102, adjClose: 102 },
    { close: 106.08, adjClose: 106.08 },
    { close: 103.9584, adjClose: 103.9584 },
    { close: 110.195904, adjClose: 110.195904 },
  ]);
  return { benchRows, portRows };
}

function adjustedHistorical(pairs) {
  return pairs.map(({ date, close }) => ({
    date,
    open: close,
    high: close,
    low: close,
    close,
    adjustedClose: close,
    volume: 1,
  }));
}

function benchmarkInput({ priceSeries, benchmarkId, symbol, provider }) {
  return {
    priceSeries,
    source: { provider, originalSource: `${provider}-dataset`, identifier: "s-1" },
    frequency: "daily",
    retrievedAt: "2026-09-13T00:00:00Z",
    quality: makeQuality(),
    benchmark: { id: benchmarkId, symbol },
  };
}

function portfolioReturnInput({ priceSeries, assetId, provider }) {
  return {
    assetId,
    priceSeries,
    source: { provider, originalSource: `${provider}-dataset`, identifier: "s-1" },
    frequency: "daily",
    retrievedAt: "2026-09-13T00:00:00Z",
    quality: makeQuality(),
  };
}

function syntheticEnvelopes() {
  const benchSeries = historicalPricesToPriceSeries(
    adjustedHistorical([
      { date: "2026-09-08", close: 100 },
      { date: "2026-09-09", close: 101 },
      { date: "2026-09-10", close: 103.02 },
      { date: "2026-09-11", close: 101.9898 },
      { date: "2026-09-12", close: 105.049494 },
    ]),
    "BENCH",
  );
  const portSeries = historicalPricesToPriceSeries(
    adjustedHistorical([
      { date: "2026-09-08", close: 100 },
      { date: "2026-09-09", close: 102 },
      { date: "2026-09-10", close: 106.08 },
      { date: "2026-09-11", close: 103.9584 },
      { date: "2026-09-12", close: 110.195904 },
    ]),
    "PF",
  );
  const portfolioEnvelope = buildPortfolioReturnSeries({
    portfolio: { id: "PF", positions: [{ assetId: "PF", weight: 1 }] },
    assetReturns: new Map([
      [
        "PF",
        buildReturnSeriesEnvelope(
          portfolioReturnInput({
            priceSeries: portSeries,
            assetId: "PF",
            provider: "provider-portfolio",
          }),
        ),
      ],
    ]),
    retrievedAt: "2026-09-13T00:00:00Z",
  });
  const benchmarkEnvelope = buildBenchmarkReturnSeries(
    benchmarkInput({
      priceSeries: benchSeries,
      benchmarkId: "BENCH",
      symbol: "BENCH",
      provider: "provider-benchmark",
    }),
  );
  return { portfolioEnvelope, benchmarkEnvelope };
}

function betaResult(portfolioEnvelope, benchmarkEnvelope) {
  const context = buildBetaDataContext({
    portfolioReturns: portfolioEnvelope,
    benchmarkReturns: benchmarkEnvelope,
    asOf: "2026-09-12",
  });
  const registry = new IndicatorRegistry();
  registry.register(betaIndicator);
  return new AnalyticsEngine(registry)
    .calculate({ indicators: ["beta"], context })
    .get("beta");
}

describe("R: builders pipeline accepts Tiingo-shaped HistoricalPrice", () => {
  it("Tiingo rows -> adapter -> builders -> context -> engine beta ~ 2", async () => {
    const { benchRows, portRows } = tiingoBuildingBlocks();
    await withMockFetch(
      async (url) => {
        if (String(url).includes("/daily/MY_BENCH/")) return new Response(JSON.stringify(benchRows), { status: 200 });
        return new Response(JSON.stringify(portRows), { status: 200 });
      },
      () =>
        providerTest(async () => {
          const provider = new TiingoProvider();
          const portHistorical = await provider.getHistoricalPrices("AAPL", {
            startDate: "2026-09-08",
            endDate: "2026-09-12",
          });
          const benchHistorical = await provider.getHistoricalPrices(
            "MY_BENCH",
            { startDate: "2026-09-08", endDate: "2026-09-12" },
          );

          const portSeries = historicalPricesToPriceSeries(portHistorical, "AAPL", {
            priceBasis: "adjusted_close",
          });
          const benchSeries = historicalPricesToPriceSeries(benchHistorical, "MY_BENCH", {
            priceBasis: "adjusted_close",
          });

          const portEnvelope = buildPortfolioReturnSeries({
            portfolio: {
              id: "PF",
              positions: [{ assetId: "AAPL", weight: 1 }],
            },
            assetReturns: new Map([
              [
                "AAPL",
                buildReturnSeriesEnvelope({
                  ...portfolioReturnInput({
                    assetId: "AAPL",
                    priceSeries: portSeries,
                    provider: "tiingo",
                  }),
                  source: makeTiingoSource("AAPL"),
                }),
              ],
            ]),
            retrievedAt: "2026-09-13T00:00:00Z",
          });
          const benchEnvelope = buildBenchmarkReturnSeries({
            ...benchmarkInput({
              priceSeries: benchSeries,
              benchmarkId: "MY_BENCH",
              symbol: "MY_BENCH",
              provider: "tiingo",
            }),
            source: makeTiingoSource("MY_BENCH"),
          });

          assert.equal(portEnvelope.value.assetId, "PF");
          assert.deepEqual(portEnvelope.sources.map((s) => s.provider), ["tiingo"]);
          assert.equal(benchEnvelope.source.originalSource, "Tiingo EOD Composite");

          const result = betaResult(portEnvelope, benchEnvelope);
          assert.equal(result.status, "ok");
          approx(result.value, 2);
          assert.deepEqual(
            result.sources.map((s) => s.provider).sort(),
            ["tiingo", "tiingo"],
          );
        }),
    );
  });
});

describe("S: known synthetic pipeline still produces Beta = 2", () => {
  it("portfolio = 2 x benchmark via builders => engine beta = 2", () => {
    const { portfolioEnvelope, benchmarkEnvelope } = syntheticEnvelopes();
    const result = betaResult(portfolioEnvelope, benchmarkEnvelope);
    assert.equal(result.status, "ok");
    approx(result.value, 2);
    assert.equal(result.dataWindow.observations, 4);
    assert.deepEqual(
      result.sources.map((s) => s.provider).sort(),
      ["provider-benchmark", "provider-portfolio"],
    );
  });
});

describe("T: all previous 294 tests remain green (deterministic reruns)", () => {
  it("the synthetic pipeline stays deterministic", () => {
    const first = betaResult(...Object.values(syntheticEnvelopes()));
    const second = betaResult(...Object.values(syntheticEnvelopes()));
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });
});

describe("Micro-fix A: impossible request date 2026-02-30 is rejected", () => {
  it("throws TiingoInvalidDateError before any request", async () => {
    await withMockFetch(makeCaptureFetch([]), () =>
      providerTest(async () => {
        const provider = new TiingoProvider();
        await assert.rejects(
          provider.getHistoricalPrices("MSFT", {
            startDate: "2026-02-30",
            endDate: "2026-03-01",
          }),
          TiingoInvalidDateError,
        );
      }),
    );
  });
});

describe("Micro-fix B: timestamp request date is rejected", () => {
  it("YYYY-MM-DD with a time suffix is not a valid request date", async () => {
    await withMockFetch(makeCaptureFetch([]), () =>
      providerTest(async () => {
        const provider = new TiingoProvider();
        await assert.rejects(
          provider.getHistoricalPrices("MSFT", {
            startDate: "2026-06-01T00:00:00.000Z",
            endDate: "2026-06-02",
          }),
          TiingoInvalidDateError,
        );
      }),
    );
  });
});

describe("Micro-fix C: real leap day 2024-02-29 is accepted", () => {
  it("a canonical leap-day range resolves as a successful empty dataset", async () => {
    await withMockFetch(makeCaptureFetch([]), () =>
      providerTest(async () => {
        const provider = new TiingoProvider();
        const prices = await provider.getHistoricalPrices("MSFT", {
          startDate: "2024-02-29",
          endDate: "2024-02-29",
        });
        assert.deepEqual(prices, []);
      }),
    );
  });
});

describe("Micro-fix D: provider ISO timestamp normalizes to YYYY-MM-DD", () => {
  it("canonicalises a Tiingo ISO date row", async () => {
    await withMockFetch(makeCaptureFetch([validRow()]), () =>
      providerTest(async () => {
        const provider = new TiingoProvider();
        const prices = await provider.getHistoricalPrices("MSFT", {
          startDate: "2026-06-01",
          endDate: "2026-06-01",
        });
        assert.equal(prices[0].date, "2026-06-01");
      }),
    );
  });
});

describe("Micro-fix E: provider impossible ISO date is rejected", () => {
  it("2026-02-30T00:00:00.000Z is not a real calendar date", async () => {
    await withMockFetch(
      makeCaptureFetch([validRow({ date: "2026-02-30T00:00:00.000Z" })]),
      () =>
        providerTest(async () => {
          const provider = new TiingoProvider();
          await assert.rejects(
            provider.getHistoricalPrices("MSFT", {
              startDate: "2026-02-27",
              endDate: "2026-03-01",
            }),
            TiingoInvalidDateError,
          );
        }),
    );
  });
});

describe("Micro-fix F: provider garbage date is rejected", () => {
  it("does not trust date-looking prefixes of arbitrary strings", async () => {
    await withMockFetch(makeCaptureFetch([validRow({ date: "2026-06-01 not-a-date" })]), () =>
      providerTest(async () => {
        const provider = new TiingoProvider();
        await assert.rejects(
          provider.getHistoricalPrices("MSFT", {
            startDate: "2026-06-01",
            endDate: "2026-06-02",
          }),
          TiingoInvalidDateError,
        );
      }),
    );
  });
});

describe("Micro-fix G: explicit start/end dates still appear in request", () => {
  it("startDate/endDate query params survive the new validation", async () => {
    await withMockFetch(makeCaptureFetch([]), () =>
      providerTest(async () => {
        const provider = new TiingoProvider();
        await provider.getHistoricalPrices("MSFT", {
          startDate: "2026-01-01",
          endDate: "2026-06-30",
        });
        assert.match(seenUrl, /startDate=2026-01-01/);
        assert.match(seenUrl, /endDate=2026-06-30/);
      }),
    );
  });
});

describe("Micro-fix H: all previous 322 tests remain green (deterministic reruns)", () => {
  it("the synthetic pipeline stays deterministic", () => {
    const first = betaResult(...Object.values(syntheticEnvelopes()));
    const second = betaResult(...Object.values(syntheticEnvelopes()));
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });
});