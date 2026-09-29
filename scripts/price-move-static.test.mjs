/* Static + unit tests for the Price Move Explanation (V1) feature.   */
/*                                                                     */
/* Run via `npm run test:static` (compiles lib/ai to .testbuild, then  */
/* node --test this file). No network access is exercised: research    */
/* and generation are injected as spies.                               */
/*                                                                     */
/* Coverage map (A-K):                                                 */
/*   A  chart click selects previous-session -> selected-date move     */
/*   B  chart click alone => zero fetch (no network)                   */
/*   C  "Explain" => one request to POST /api/explain-price-move       */
/*   D  maximum ONE Tavily request per explanation                     */
/*   E  maximum ONE Gemini request per explanation                     */
/*   F  zero Alpha Vantage usage in the feature                        */
/*   G  unknown claim ids (and source ids) are rejected                */
/*   H  insufficient evidence => Gemini is never called                */
/*   I  explanation renders in the "Price Move Explanation" section    */
/*   J  same move is reused from the local session cache (no API call) */
/*   K  analysis_history is never updated                              */
/* -------------------------------------------------------------------- */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { derivePriceMove, priceMoveCacheKey } from "../.testbuild/price-move-selection.js";
import { explainPriceMove } from "../.testbuild/price-move.js";
import { GeminiAnalysisError } from "../.testbuild/gemini.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRoot(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

const series = [
  { date: "2026-05-01", close: 90, volume: 900000 },
  { date: "2026-05-04", close: 100, volume: 1100000 },
  { date: "2026-05-05", close: 100, volume: 1200000 },
  { date: "2026-05-06", close: 105, volume: 1400000 },
];

const moveRequest = {
  symbol: "AAPL",
  companyName: "Apple Inc.",
  region: "United States",
  currency: "USD",
  fromDate: "2026-05-05",
  toDate: "2026-05-06",
  fromClose: 100,
  toClose: 105,
  absoluteChange: 5,
  percentChange: 5,
  fromVolume: 1200000,
  toVolume: 1400000,
};

const TRUSTED_RETRIEVAL_RESULT = {
  title: "Apple move on May 6",
  url: "https://www.reuters.com/business/technology/apple-move-may.html",
  content:
    "Apple reported a quarterly earnings beat around May 5, 2026 and analysts noted strong demand; the positive guidance may have affected investor expectations during that trading session.",
  score: 0.9,
};

const VALID_SEARCH_PAYLOAD = {
  query: "ignored in tests",
  results: [TRUSTED_RETRIEVAL_RESULT],
};

function validAnswer(overrides = {}) {
  return JSON.stringify({
    explanationFound: true,
    summary:
      "The move coincided with the company's earnings announcement and may have been driven by stronger-than-expected results and guidance.",
    factors: [
      {
        title: "Earnings beat and guidance",
        explanation:
          "The company reported results that may have exceeded expectations and may have affected investor sentiment during the move window.",
        evidence: [
          { type: "external_source", claimIds: ["C1"] },
        ],
        evidenceQuality: "strong",
      },
    ],
    uncertainty:
      "Multiple simultaneous factors could coincide with the move; causation cannot be established from the available sources.",
    ...overrides,
  });
}

async function expectErrorCode(promise, code) {
  let thrown = null;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof GeminiAnalysisError, `expected GeminiAnalysisError, got ${thrown}`);
  assert.equal(thrown.code, code);
  return thrown;
}

describe("A: chart click selects previous-session -> selected-date move", () => {
  it("derives the move from the immediately previous element in the loaded series", () => {
    const move = derivePriceMove(series, "2026-05-06");
    assert.deepEqual(move, {
      fromDate: "2026-05-05",
      toDate: "2026-05-06",
      fromClose: 100,
      toClose: 105,
      absoluteChange: 5,
      percentChange: 5,
      fromVolume: 1200000,
      toVolume: 1400000,
    });
  });

  it("uses the previous element, not the calendar day before (holidays/weekends)", () => {
    // 2026-05-01 is the immediately previous element of 2026-05-04.
    const move = derivePriceMove([series[0], series[1]], "2026-05-04");
    assert.equal(move.fromDate, "2026-05-01");
    assert.equal(move.fromClose, 90);
    assert.equal(move.toClose, 100);
    assert.equal(move.percentChange, (100 - 90) / 90 * 100);
  });

  it("is null for a session with no previous element (not selectable)", () => {
    assert.equal(derivePriceMove(series, "2026-05-01"), null);
  });

  it("is null for unknown dates or null closes", () => {
    assert.equal(derivePriceMove(series, "1999-01-01"), null);
    const withNull = [{ date: "2026-05-05", close: 100, volume: 1 }, { date: "2026-05-06", close: null, volume: 1 }];
    assert.equal(derivePriceMove(withNull, "2026-05-06"), null);
  });

  it("supports falls (negative percentChange)", () => {
    const move = derivePriceMove(
      [{ date: "2026-05-05", close: 110, volume: 1 }, { date: "2026-05-06", close: 104.5, volume: 1 }],
      "2026-05-06",
    );
    assert.equal(move.absoluteChange, -5.5);
    assert.equal(move.percentChange, -5);
  });
});

describe("B: chart click alone => zero network calls", () => {
  it("the chart and selection UI contain no fetch call", () => {
    for (const file of [
      "app/components/HistoricalChart.tsx",
      "app/components/PriceMovePanel.tsx",
    ]) {
      assert.equal(readRoot(file).includes("fetch("), false, `${file} must not call fetch`);
    }
  });

  it("AnalysisSection only fetches inside the Explain handler, never on selection", () => {
    const source = readRoot("app/components/AnalysisSection.tsx");
    assert.equal((source.match(/fetch\(/g) ?? []).length, 1);
    const explainStart = source.indexOf("async function handleExplain");
    const explainEnd = source.indexOf("\n  function handleClear");
    const explainBody = source.slice(explainStart, explainEnd);
    assert.ok(explainBody.includes('fetch("/api/explain-price-move"'));
  });
});

describe("C: Explain => exactly one POST /api/explain-price-move request", () => {
  it("the client sends exactly one request per Explain click", () => {
    const source = readRoot("app/components/AnalysisSection.tsx");
    assert.equal(
      (source.match(/\/api\/explain-price-move"/g) ?? []).length,
      1,
    );
    assert.ok(source.includes('method: "POST"'));
    assert.ok(source.includes("body: JSON.stringify("));
  });

  it("the API route validates with the strict schema and mirrors analyze handling", () => {
    const route = readRoot("app/api/explain-price-move/route.ts");
    assert.ok(route.includes("priceMoveRequestSchema.safeParse"));
    assert.ok(route.includes(".strict()") || route.includes("explainPriceMove"));
  });
});

describe("D/E: one Tavily + one Gemini per explanation", () => {
  it("successful explanation spends exactly 1 Tavily and 1 Gemini", async () => {
    let searchCalls = 0;
    let generateCalls = 0;
    const result = await explainPriceMove(moveRequest, {
      search: async () => {
        searchCalls += 1;
        return VALID_SEARCH_PAYLOAD;
      },
      generate: async () => {
        generateCalls += 1;
        return validAnswer();
      },
    });
    assert.equal(searchCalls, 1);
    assert.equal(generateCalls, 1);
    assert.deepEqual(result.move, {
      fromDate: "2026-05-05",
      toDate: "2026-05-06",
      fromClose: 100,
      toClose: 105,
      absoluteChange: 5,
      percentChange: 5,
    });
    assert.equal(result.factors.length, 1);
    assert.deepEqual(result.factors[0].evidence[0].sourceIds, ["S1"]);
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].url, TRUSTED_RETRIEVAL_RESULT.url);
  });
});

describe("F: zero Alpha Vantage in the price-move feature", () => {
  it("no new code uses the market-data provider", () => {
    for (const file of [
      "lib/ai/price-move.ts",
      "lib/ai/price-move-selection.ts",
      "app/api/explain-price-move/route.ts",
      "app/components/AnalysisSection.tsx",
      "app/components/HistoricalChart.tsx",
      "app/components/PriceMovePanel.tsx",
      "app/components/PriceMoveExplanationSection.tsx",
    ]) {
      const source = readRoot(file);
      assert.equal(
        /(getdailyseries|getmarketdataprovider|marketdataprovider|createalphavantage|alphavantageprovider)/i.test(
          source,
        ),
        false,
        `${file} must not use the market-data provider`,
      );
    }
  });
});

describe("G: unknown claim ids are rejected", () => {
  it("throws invalid_response when Gemini cites a claim id outside the ledger", async () => {
    let generateCalls = 0;
    await expectErrorCode(
      explainPriceMove(moveRequest, {
        search: async () => VALID_SEARCH_PAYLOAD,
        generate: async () => {
          generateCalls += 1;
          return validAnswer({
            factors: [
              {
                title: "Fabricated trigger",
                explanation: "A claim that references a non-existent ledger entry.",
                evidence: [{ type: "external_source", claimIds: ["C9"] }],
                evidenceQuality: "moderate",
              },
            ],
          });
        },
      }),
      "invalid_response",
    );
    assert.equal(generateCalls, 1);
  });

  it("throws invalid_response when a source id is fabricated (never from prose)", async () => {
    await expectErrorCode(
      explainPriceMove(moveRequest, {
        search: async () => VALID_SEARCH_PAYLOAD,
        generate: async () =>
          validAnswer({
            factors: [
              {
                title: "Source fabrication",
                explanation: "Tries to smuggle an arbitrary source reference.",
                evidence: [{ type: "external_source", claimIds: ["S99"] }],
                evidenceQuality: "moderate",
              },
            ],
          }),
      }),
      "invalid_response",
    );
  });
});

describe("H: insufficient evidence => Gemini is never called", () => {
  it("no trusted claims from Tavily => insufficient_evidence with zero Gemini calls", async () => {
    let generateCalls = 0;
    const untrustedPayload = {
      query: "ignored",
      results: [
        {
          title: "Untrusted post",
          url: "https://example.com/random/stock-tip",
          content:
            "Random speculative stock tip page that claims the stock will move for unverifiable reasons without any reliable sourcing at all.",
          score: 0.1,
        },
      ],
    };
    await expectErrorCode(
      explainPriceMove(moveRequest, {
        search: async () => untrustedPayload,
        generate: async () => {
          generateCalls += 1;
          return validAnswer();
        },
      }),
      "insufficient_evidence",
    );
    assert.equal(generateCalls, 0);
  });

  it("trusted claims exist but Gemini finds no supportable factor => insufficient_evidence", async () => {
    let searchCalls = 0;
    let generateCalls = 0;
    await expectErrorCode(
      explainPriceMove(moveRequest, {
        search: async () => {
          searchCalls += 1;
          return VALID_SEARCH_PAYLOAD;
        },
        generate: async () => {
          generateCalls += 1;
          return validAnswer({ factors: [] });
        },
      }),
      "insufficient_evidence",
    );
    assert.equal(searchCalls, 1);
    assert.equal(generateCalls, 1);
  });
});

describe("I: explanation renders in the Price Move Explanation section", () => {
  it("AnalysisSection mounts the section when an explanation exists", () => {
    const source = readRoot("app/components/AnalysisSection.tsx");
    assert.ok(source.includes("<PriceMoveExplanationSection"));
    assert.ok(source.includes("priceMoveSection"));
  });

  it("FutureAnalysis injects the section between Technical Trend and Positive Factors", () => {
    const view = readRoot("app/components/AnalysisResultView.tsx");
    const slot = view.indexOf("{afterTechnicalTrend}");
    const technicalTrend = view.indexOf(">Technical Trend</h3>");
    const positiveFactors = view.indexOf(">Positive Factors</h3>");
    assert.ok(slot > technicalTrend && slot < positiveFactors);
    assert.ok(
      readRoot("app/components/FutureAnalysis.tsx").includes(
        "afterTechnicalTrend={priceMoveSection}",
      ),
      "FutureAnalysis passes the section into the current analysis result",
    );
    assert.ok(
      readRoot("app/components/FutureAnalysis.tsx").includes(
        "priceMoveSection && status !== \"success\"",
      ),
      "FutureAnalysis renders the section standalone before any analysis succeeds",
    );
  });

  it("the section always renders provider data, never raw HTML injection", () => {
    const section = readRoot("app/components/PriceMoveExplanationSection.tsx");
    assert.ok(section.includes("Price Move Explanation"));
    assert.equal(section.includes("dangerouslySetInnerHTML"), false);
    assert.ok(section.includes('rel="noopener noreferrer"'));
  });
});

describe("J: same move reused from the local session cache", () => {
  it("produces a stable, same-key cache key for the same move pair", () => {
    const moveA = derivePriceMove(series, "2026-05-06");
    const samePair = derivePriceMove(
      [
        { date: "2026-05-05", close: 100, volume: 1 },
        { date: "2026-05-06", close: 105, volume: 1 },
      ],
      "2026-05-06",
    );
    assert.equal(priceMoveCacheKey("AAPL", moveA), "AAPL:2026-05-05->2026-05-06");
    assert.equal(priceMoveCacheKey("AAPL", samePair), priceMoveCacheKey("AAPL", moveA));
    assert.notEqual(
      priceMoveCacheKey("AAPL", moveA),
      priceMoveCacheKey("MSFT", moveA),
    );
  });

  it("handleExplain consults the cache before any network call", () => {
    const source = readRoot("app/components/AnalysisSection.tsx");
    const explainStart = source.indexOf("async function handleExplain");
    const explainBody = source.slice(
      explainStart,
      source.indexOf("\n  function handleClear"),
    );
    const firstNetworkCall = explainBody.indexOf('fetch("');
    const firstCacheLookup = explainBody.indexOf("cacheRef.current.get(key)");
    assert.ok(firstCacheLookup >= 0);
    assert.ok(firstNetworkCall === -1 || firstCacheLookup < firstNetworkCall);
    assert.ok(source.includes("cacheRef.current.set(key, result)"));
  });
});

describe("K: analysis_history is never updated by the feature", () => {
  it("no new/modified code references history or Supabase persistence", () => {
    for (const file of [
      "lib/ai/price-move.ts",
      "lib/ai/price-move-selection.ts",
      "app/api/explain-price-move/route.ts",
      "app/components/AnalysisSection.tsx",
      "app/components/PriceMovePanel.tsx",
      "app/components/PriceMoveExplanationSection.tsx",
      "app/components/HistoricalChart.tsx",
    ]) {
      const source = readRoot(file);
      assert.equal(
        /(analysis-history|saveAnalysisHistory|supabase|clients\.supabase)/i.test(source),
        false,
        `${file} must not write to analysis history or Supabase`,
      );
    }
  });
});