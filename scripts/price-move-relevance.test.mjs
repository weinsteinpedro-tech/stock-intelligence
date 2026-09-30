/* Regression tests (A-K) for the deterministic SOURCE RELEVANCE layer    */
/* of the Price Move Explanation feature.                                 */
/*                                                                        */
/* Run via `npm run test:static` after `tsc -p tsconfig.test.json`.       */
/* No network access: research/generation are injected spies.             */
/*                                                                        */
/* Scenario: AAPL, move 2026-09-08 -> 2026-09-09 (-0.28%). The runtime    */
/* failure that motivated this layer surfaced MarketWatch quote pages for */
/* OTHER tickers (ZHCLF / TCBS / SZZL) as the only trusted results.       */
/*                                                                        */
/*   A  AAPL + ZHCLF MarketWatch quote page        => rejected             */
/*   B  AAPL + TCBS quote                          => rejected             */
/*   C  AAPL + SZZL quote                          => rejected             */
/*   D  trusted Reuters Apple article               => accepted (company)  */
/*   E  broad-market article near the move          => market_context      */
/*   F  MarketWatch navigation / "Market Movers"    => rejected            */
/*   G  trusted but unrelated company article       => rejected            */
/*   H  far-outside-window article (date known)     => rejected            */
/*   I  zero relevant trusted claims                => insufficient + 0 AI */
/*   J  relevant trusted claim                      => C -> S -> exact URL */
/*   K  still max 1 Tavily + 1 Gemini, zero Alpha Vantage                 */
/* ---------------------------------------------------------------------- */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { explainPriceMove } from "../.testbuild/ai/price-move.js";
import { GeminiAnalysisError } from "../.testbuild/ai/gemini.js";
import {
  assessPriceMoveRelevance,
  classifyQuotePage,
  isNavigationOrBoilerplateContent,
  isWithinMoveWindow,
  shiftIsoDate,
} from "../.testbuild/ai/price-move-relevance.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRoot(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

/* Move under analysis: the AAPL dip of 8 Sep -> 9 Sep 2026. */
const moveRequest = {
  symbol: "AAPL",
  companyName: "Apple Inc.",
  region: "United States",
  currency: "USD",
  fromDate: "2026-09-08",
  toDate: "2026-09-09",
  fromClose: 316.22,
  toClose: 315.34,
  absoluteChange: -0.88,
  percentChange: -0.28,
  fromVolume: 52000000,
  toVolume: 61000000,
};

/* --- Real-world fixtures (care: content must survive toSource's >=80) --- */

function marketWatchQuote(ticker, name, code) {
  return {
    title: `${ticker} Stock Price | ${name} Stock Quote | MarketWatch`,
    url: `https://www.marketwatch.com/investing/stock/${ticker}?countrycode=${code}`,
    content:
      `${name} provides a corporate platform used by international clients. During the latest session the shares of ${name} traded around $4.08 with a market capitalization near $48 million and very light trading volume. The stock is mainly traded by retail investors with limited institutional sponsorship.`,
    score: 0.55,
  };
}

const ZHCLF = marketWatchQuote("ZHCLF", "Zenith Capital Corp.", "ca");
const TCBS = marketWatchQuote("TCBS", "Texas Community Bancshares Inc.", "us");
const SZZL = marketWatchQuote("SZZL", "Sizzle Acquisition Corp. II CI A", "us");

const REUTERS_APPLE = {
  title: "Apple shares dip in early trading as investors weigh October launch cycle",
  url: "https://www.reuters.com/business/technology/2026-09-08/apple-shares.html",
  content:
    "Apple Inc. shares slipped in early trading on September 8, 2026 as investors weighed demand across the company's product lineup ahead of its fall launch cycle. Published September 8, 2026. Analysts said the move coincided with a broad pullback in mega-cap technology stocks.",
  score: 0.85,
};

const REUTERS_MARKET_ROUNDUP = {
  title: "S&P 500 slips, Nasdaq sheds 2% as tech and mega-cap names slide",
  url: "https://www.reuters.com/markets/us/2026-09-08/tech-stocks-slide.html",
  content:
    "U.S. stocks fell on the first trading day of the week. The S&P 500 dropped 1.1% and the Nasdaq Composite lost 2.0% as technology stocks and semiconductor shares were sold down. Published September 8, 2026. Treasury yields rose as investors weighed the latest inflation data and the Federal Reserve's rate path. The broad sell-off reached across the tech sector.",
  score: 0.88,
};

const MARKETWATCH_CHROME = {
  title: "Markets: movers and most active stocks, bond yields and market data",
  url: "https://www.marketwatch.com/markets",
  content:
    "Market Movers. Best new ideas in money, Market data and tools, Newsletter sign up, Watchlist, Recommended for you, Most popular. Top gainers, biggest losers and most active stocks. Privacy policy, cookie notice and search overlay.",
  score: 0.6,
};

const REUTERS_MICROSOFT = {
  title: "Microsoft cloud deal lifts expectations for December quarter",
  url: "https://www.reuters.com/technology/2026-09-09/microsoft-cloud.html",
  content:
    "MSFT investors pinned hopes on a large cloud contract signed by Microsoft as the company entered the final stretch of its fiscal year. Published September 9, 2026. The agreement concerns enterprise software and has no connection to the wider smartphone market.",
  score: 0.9,
};

const REUTERS_OLD_APPLE = {
  title: "Apple shares fall after decade-old supply question resurfaces",
  url: "https://www.reuters.com/business/technology/2025-03-12/apple-supply.html",
  content:
    "Apple Inc. shares declined during that week in 2025 as investors weighed a supply chain question that had resurfaced. Published March 12, 2025. The episode is unrelated to trading in September 2026.",
  score: 0.7,
};

function validAnswer(overrides = {}) {
  return JSON.stringify({
    explanationFound: true,
    summary:
      "The move coincided with a broad pullback in technology and mega-cap stocks, and may have been amplified by company-specific news.",
    factors: [
      {
        title: "Tech pullback and company news",
        explanation:
          "The decline may have contributed to and coincided with a broad technology sector sell-off during the move window.",
        evidence: [{ type: "external_source", claimIds: ["C1"] }],
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

async function withLogs(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

function researchLog(lines) {
  const line = lines.find((entry) => entry.startsWith("[price-move-research]"));
  assert.ok(line, `expected a [price-move-research] diagnostic line, got ${lines.join(" | ")}`);
  return JSON.parse(line.slice("[price-move-research] ".length));
}

/* ---------------------------------------------------------------------- */

describe("A: AAPL + ZHCLF MarketWatch quote page is rejected", () => {
  it("classifyQuotePage flags an other-ticker quote page", () => {
    assert.deepEqual(classifyQuotePage(ZHCLF.title, ZHCLF.url, "AAPL"), {
      isQuotePage: true,
      otherTicker: true,
    });
  });

  it("explainPriceMove discards the quote and raises insufficient_evidence without calling Gemini", async () => {
    let generateCalls = 0;
    let searchCalls = 0;
    const lines = await withLogs(() =>
      expectErrorCode(
        explainPriceMove(moveRequest, {
          search: async () => {
            searchCalls += 1;
            return { query: "ignored", results: [ZHCLF] };
          },
          generate: async () => {
            generateCalls += 1;
            return validAnswer();
          },
        }),
        "insufficient_evidence",
      ),
    );
    assert.equal(searchCalls, 1);
    assert.equal(generateCalls, 0);
    const diag = researchLog(lines);
    assert.equal(diag.totalResults, 1);
    assert.equal(diag.trustedResults, 1);
    assert.equal(diag.relevantResults, 0);
    assert.equal(diag.trustedClaimCount, 0);
    assert.deepEqual(diag.discarded, [
      {
        domain: "marketwatch.com",
        classification: "high_quality_secondary",
        reason: "unrelated_quote_page",
      },
    ]);
  });
});

describe("B: AAPL + TCBS quote is rejected", () => {
  it("classifyQuotePage flags an other-ticker quote page", () => {
    assert.deepEqual(classifyQuotePage(TCBS.title, TCBS.url, "AAPL"), {
      isQuotePage: true,
      otherTicker: true,
    });
  });

  it("explainPriceMove discards the TCBS quote (zero Gemini calls)", async () => {
    let generateCalls = 0;
    await withLogs(() =>
      expectErrorCode(
        explainPriceMove(moveRequest, {
          search: async () => ({ query: "ignored", results: [TCBS] }),
          generate: async () => {
            generateCalls += 1;
            return validAnswer();
          },
        }),
        "insufficient_evidence",
      ),
    );
    assert.equal(generateCalls, 0);
  });
});

describe("C: AAPL + SZZL quote is rejected", () => {
  it("classifyQuotePage flags an other-ticker quote page", () => {
    assert.deepEqual(classifyQuotePage(SZZL.title, SZZL.url, "AAPL"), {
      isQuotePage: true,
      otherTicker: true,
    });
  });

  it("explainPriceMove discards the SZZL quote (zero Gemini calls)", async () => {
    let generateCalls = 0;
    await withLogs(() =>
      expectErrorCode(
        explainPriceMove(moveRequest, {
          search: async () => ({ query: "ignored", results: [SZZL] }),
          generate: async () => {
            generateCalls += 1;
            return validAnswer();
          },
        }),
        "insufficient_evidence",
      ),
    );
    assert.equal(generateCalls, 0);
  });
});

describe("D: a trusted Reuters Apple article is accepted", () => {
  it("assessPriceMoveRelevance returns a relevant, dated company verdict", () => {
    const verdict = assessPriceMoveRelevance(
      {
        title: REUTERS_APPLE.title,
        url: REUTERS_APPLE.url,
        content: REUTERS_APPLE.content,
        domain: "reuters.com",
        classification: "high_quality_secondary",
        quality: "high_quality_secondary",
        publishedDate: "2026-09-08",
      },
      moveRequest,
    );
    assert.deepEqual(verdict, { status: "relevant", role: "company", dateVerified: true });
  });

  it("the explanation succeeds and grounds a company factor", async () => {
    let lastPrompt = "";
    const result = await explainPriceMove(moveRequest, {
      search: async () => ({ query: "ignored", results: [REUTERS_APPLE] }),
      generate: async (prompt) => {
        lastPrompt = prompt;
        return validAnswer();
      },
    });
    assert.equal(result.factors.length, 1);
    assert.equal(result.factors[0].evidenceQuality, "moderate");
    assert.ok(lastPrompt.includes("C1"));
    // The company claim is NOT labeled [MARKET CONTEXT] (no context claims here).
    assert.equal(lastPrompt.includes("[MARKET CONTEXT] "), false);
  });
});

describe("E: a substantive broad-market article near the move is accepted as market_context", () => {
  it("assessPriceMoveRelevance returns a market_context verdict for in-window macro coverage", () => {
    const verdict = assessPriceMoveRelevance(
      {
        title: REUTERS_MARKET_ROUNDUP.title,
        url: REUTERS_MARKET_ROUNDUP.url,
        content: REUTERS_MARKET_ROUNDUP.content,
        domain: "reuters.com",
        classification: "high_quality_secondary",
        quality: "high_quality_secondary",
        publishedDate: "2026-09-08",
      },
      moveRequest,
    );
    assert.deepEqual(verdict, { status: "relevant", role: "market_context", dateVerified: true });
  });

  it("the claim is labeled [MARKET CONTEXT] and never reaches strong quality", async () => {
    let lastPrompt = "";
    const result = await explainPriceMove(moveRequest, {
      search: async () => ({ query: "ignored", results: [REUTERS_MARKET_ROUNDUP] }),
      generate: async (prompt) => {
        lastPrompt = prompt;
        return validAnswer();
      },
    });
    assert.ok(lastPrompt.includes("- C1 | [MARKET CONTEXT]"));
    assert.equal(result.factors[0].evidenceQuality, "moderate");
  });
});

describe("F: MarketWatch navigation / 'Market Movers' chrome is rejected", () => {
  it("isNavigationOrBoilerplateContent detects chrome-dominated content", () => {
    assert.equal(isNavigationOrBoilerplateContent(MARKETWATCH_CHROME.content), true);
  });

  it("explainPriceMove discards chrome content before Gemini", async () => {
    let generateCalls = 0;
    const lines = await withLogs(() =>
      expectErrorCode(
        explainPriceMove(moveRequest, {
          search: async () => ({ query: "ignored", results: [MARKETWATCH_CHROME] }),
          generate: async () => {
            generateCalls += 1;
            return validAnswer();
          },
        }),
        "insufficient_evidence",
      ),
    );
    assert.equal(generateCalls, 0);
    assert.equal(researchLog(lines).discarded[0].reason, "navigation_or_boilerplate");
  });

  it("an AAPL quote page for the SAME ticker is still chrome-heavy boilerplate and is discarded", async () => {
    // Real MarketWatch quote pages carry Market Movers / market data / watchlist
    // chrome around the quote; the token in the title is not evidence of news.
    const ownQuote = {
      title: "AAPL Stock Price | Apple Inc. Stock Quote | MarketWatch",
      url: "https://www.marketwatch.com/investing/stock/aapl?countrycode=us",
      content:
        `Market Movers. Market data and tools, Watchlist, Newsletter sign up, Recommended for you, Most popular. AAPL trading at $315.34, best new ideas in money, open site search, privacy policy and cookie notice.`,
      score: 0.5,
    };
    let generateCalls = 0;
    const lines = await withLogs(() =>
      expectErrorCode(
        explainPriceMove(moveRequest, {
          search: async () => ({ query: "ignored", results: [ownQuote] }),
          generate: async () => {
            generateCalls += 1;
            return validAnswer();
          },
        }),
        "insufficient_evidence",
      ),
    );
    assert.equal(generateCalls, 0);
    assert.equal(researchLog(lines).discarded[0].reason, "navigation_or_boilerplate");
  });
});

describe("G: a trusted but unrelated company article is rejected", () => {
  it("assessPriceMoveRelevance returns insufficient_relevance for foreign-ticker content", () => {
    const verdict = assessPriceMoveRelevance(
      {
        title: REUTERS_MICROSOFT.title,
        url: REUTERS_MICROSOFT.url,
        content: REUTERS_MICROSOFT.content,
        domain: "reuters.com",
        classification: "high_quality_secondary",
        quality: "high_quality_secondary",
        publishedDate: "2026-09-09",
      },
      moveRequest,
    );
    assert.equal(verdict.status, "discarded");
    assert.equal(verdict.reason, "insufficient_relevance");
  });

  it("explainPriceMove raises insufficient_evidence (zero Gemini calls)", async () => {
    let generateCalls = 0;
    await withLogs(() =>
      expectErrorCode(
        explainPriceMove(moveRequest, {
          search: async () => ({ query: "ignored", results: [REUTERS_MICROSOFT] }),
          generate: async () => {
            generateCalls += 1;
            return validAnswer();
          },
        }),
        "insufficient_evidence",
      ),
    );
    assert.equal(generateCalls, 0);
  });
});

describe("H: a far-outside-window article (date known) is rejected", () => {
  it("the date window is fromDate-3 calendar days to toDate+3 calendar days", () => {
    assert.equal(shiftIsoDate("2026-09-08", -3), "2026-09-05");
    assert.equal(shiftIsoDate("2026-09-09", 3), "2026-09-12");
    assert.equal(isWithinMoveWindow("2026-09-05", "2026-09-08", "2026-09-09"), true);
    assert.equal(isWithinMoveWindow("2026-09-12", "2026-09-08", "2026-09-09"), true);
    assert.equal(isWithinMoveWindow("2026-09-04", "2026-09-08", "2026-09-09"), false);
    assert.equal(isWithinMoveWindow("2026-09-13", "2026-09-08", "2026-09-09"), false);
  });

  it("assessPriceMoveRelevance rejects a strong-company article outside the window", () => {
    const verdict = assessPriceMoveRelevance(
      {
        title: REUTERS_OLD_APPLE.title,
        url: REUTERS_OLD_APPLE.url,
        content: REUTERS_OLD_APPLE.content,
        domain: "reuters.com",
        classification: "high_quality_secondary",
        quality: "high_quality_secondary",
        publishedDate: "2025-03-12",
      },
      moveRequest,
    );
    assert.equal(verdict.status, "discarded");
    assert.equal(verdict.reason, "outside_move_window");
  });

  it("explainPriceMove rejects the stale article (zero Gemini calls)", async () => {
    let generateCalls = 0;
    const lines = await withLogs(() =>
      expectErrorCode(
        explainPriceMove(moveRequest, {
          search: async () => ({ query: "ignored", results: [REUTERS_OLD_APPLE] }),
          generate: async () => {
            generateCalls += 1;
            return validAnswer();
          },
        }),
        "insufficient_evidence",
      ),
    );
    assert.equal(generateCalls, 0);
    assert.equal(researchLog(lines).discarded[0].reason, "outside_move_window");
  });
});

describe("I: zero relevant trusted results => insufficient_evidence and zero Gemini", () => {
  it("twelve trusted-but-irrelevant results never reach the model", async () => {
    const results = [
      ZHCLF,
      TCBS,
      SZZL,
      REUTERS_MICROSOFT,
      MARKETWATCH_CHROME,
      marketWatchQuote("NVDA", "Nvidia Corp.", "us"),
      marketWatchQuote("MSFT", "Microsoft Corp.", "us"),
      marketWatchQuote("GOOG", "Alphabet Inc. Cl C", "us"),
      marketWatchQuote("AMZN", "Amazon.com Inc.", "us"),
      marketWatchQuote("META", "Meta Platforms Inc.", "us"),
      marketWatchQuote("TSLA", "Tesla Inc.", "us"),
      marketWatchQuote("NFLX", "Netflix Inc.", "us"),
    ];
    let generateCalls = 0;
    const lines = await withLogs(() =>
      expectErrorCode(
        explainPriceMove(moveRequest, {
          search: async () => ({ query: "ignored", results }),
          generate: async () => {
            generateCalls += 1;
            return validAnswer();
          },
        }),
        "insufficient_evidence",
      ),
    );
    assert.equal(generateCalls, 0);
    const diag = researchLog(lines);
    assert.equal(diag.totalResults, 12);
    assert.equal(diag.trustedResults, 12);
    assert.equal(diag.relevantResults, 0);
    assert.equal(diag.trustedClaimCount, 0);
    assert.equal(diag.discarded.length, 12);
  });
});

describe("J: a relevant trusted claim still resolves C -> S -> exact URL", () => {
  it("the evidence chain points at the exact Tavily URL", async () => {
    const result = await explainPriceMove(moveRequest, {
      search: async () => ({ query: "ignored", results: [REUTERS_APPLE] }),
      generate: async () => validAnswer(),
    });
    const claim = result.factors[0].evidence[0];
    assert.deepEqual(claim.claimIds, ["C1"]);
    assert.deepEqual(claim.sourceIds, ["S1"]);
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].url, REUTERS_APPLE.url);
    assert.equal(result.sources[0].domain, "reuters.com");
  });
});

describe("K: still max 1 Tavily + 1 Gemini and zero Alpha Vantage", () => {
  it("a trusted unrelated-company article never triggers the model (1 Tavily, 0 Gemini)", async () => {
    let searchCalls = 0;
    let generateCalls = 0;
    await withLogs(() =>
      expectErrorCode(
        explainPriceMove(moveRequest, {
          search: async () => {
            searchCalls += 1;
            return { query: "ignored", results: [REUTERS_MICROSOFT] };
          },
          generate: async () => {
            generateCalls += 1;
            return validAnswer();
          },
        }),
        "insufficient_evidence",
      ),
    );
    assert.equal(searchCalls, 1);
    assert.equal(generateCalls, 0);
  });

  it("a successful explanation still spends exactly 1 Tavily + 1 Gemini", async () => {
    let searchCalls = 0;
    let generateCalls = 0;
    await explainPriceMove(moveRequest, {
      search: async () => {
        searchCalls += 1;
        return { query: "ignored", results: [REUTERS_MARKET_ROUNDUP] };
      },
      generate: async () => {
        generateCalls += 1;
        return validAnswer();
      },
    });
    assert.equal(searchCalls, 1);
    assert.equal(generateCalls, 1);
  });

  it("the relevance layer never uses the market-data provider", () => {
    for (const file of [
      "lib/ai/price-move-relevance.ts",
      "lib/ai/price-move.ts",
      "lib/ai/gemini.ts",
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