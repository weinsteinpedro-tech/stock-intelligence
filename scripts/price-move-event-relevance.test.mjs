/* Regression tests (A-K) for the EVENT RELEVANCE layer of Price Move     */
/* Explanation - the third axis after trust and company/market relevance. */
/*                                                                        */
/* Scenario: the real runtime case that motivated this layer - AAPL       */
/* 9 Sep -> 10 Sep 2026 (+3.56%). A Nasdaq landing page for AAPL          */
/* ("Apple (AAPL) Stock Price, Quote, News & History") was accepted as a  */
/* driver because it is company-relevant, but it carries NO explanatory   */
/* event (bid/ask mechanics).                                             */
/*                                                                        */
/*   A  AAPL Nasdaq quote landing + generic bid/ask content     => generic_quote_content */
/*   B  AAPL correct ticker + generic market-cap/profile        => no_event_signal */
/*   C  Reuters product announcement on the move date            => accepted */
/*   D  Reuters/FT/Bloomberg earnings/guidance article          => accepted */
/*   E  broad-market same-day rally/sell-off                     => accepted (market_context) */
/*   F  generic how markets/bid-ask/quotes work                  => rejected */
/*   G  explanationFound=false + factors=[]                      => insufficient_evidence */
/*   H  explanationFound=false + fabricated non-empty factors    => insufficient_evidence */
/*   I  success requires explanationFound=true + >=1 valid factor */
/*   J  C -> S -> exact URL intact                              */
/*   K  max 1 Tavily + 1 Gemini, zero Alpha Vantage             */
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
  hasEventSignal,
  isGenericQuoteContent,
  isMarketActivityContent,
  isMarketContextContent,
} from "../.testbuild/ai/price-move-relevance.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRoot(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

/* Move under analysis: the AAPL +3.56% move of 9 Sep -> 10 Sep 2026. */
const moveRequest = {
  symbol: "AAPL",
  companyName: "Apple Inc.",
  region: "United States",
  currency: "USD",
  fromDate: "2026-09-09",
  toDate: "2026-09-10",
  fromClose: 315.34,
  toClose: 326.57,
  absoluteChange: 11.23,
  percentChange: 3.56,
  fromVolume: 61000000,
  toVolume: 82000000,
};

/* --- Real-world fixtures --- */

const NASDAQ_AAPL_LANDING = {
  title: "Apple (AAPL) Stock Price, Quote, News & History",
  url: "https://www.nasdaq.com/market-activity/stocks/aapl",
  content:
    "The bid & ask refers to the price that an investor is willing to buy or sell a stock. Real-time bid and ask information is powered by Nasdaq Basic and provided free of charge to investors. The last sale price and the national best bid and offer are also shown, together with delayed quotes for non-professional subscribers.",
  score: 0.9,
};

const AAPL_GENERIC_PROFILE = {
  title: "Apple Inc. company profile and key statistics",
  url: "https://www.reuters.com/markets/companies/AAPL/overview",
  content:
    "Apple Inc. designs, manufactures and markets smartphones, personal computers and wearables. The company is headquartered in Cupertino, California. Its market capitalization is approximately three trillion dollars with total shares outstanding near 15 billion, and its shares trade with an average daily volume of about 55 million.",
  score: 0.6,
};

const REUTERS_APPLE_PRODUCT = {
  title: "Apple introduces new MacBook Pro line at September event",
  url: "https://www.reuters.com/technology/2026-09-10/apple-macbook-pro.html",
  content:
    "Apple Inc. introduced a new line of MacBook Pro laptops at its event on September 10, 2026, the same day its shares gained more than 3 percent. The announcement featured faster chips and a redesigned chassis, and analysts called the launch a positive surprise that may have supported the stock. Published September 10, 2026.",
  score: 0.9,
};

const REUTERS_APPLE_GUIDANCE = {
  title: "Apple raises quarterly guidance after strong services results",
  url: "https://www.reuters.com/business/technology/2026-09-10/apple-guidance.html",
  content:
    "Apple Inc. raised its quarterly guidance and reported strong service segment results on September 10, 2026. Profits rose as the company shipped more devices than expected. Published September 10, 2026. Analysts raised their price targets in response to the update.",
  score: 0.92,
};

const REUTERS_MARKET_RALLY = {
  title: "S&P 500 and Nasdaq rally after inflation data boosts rate-cut hopes",
  url: "https://www.reuters.com/markets/us/2026-09-10/market-rally.html",
  content:
    "U.S. stocks rallied broadly on September 10, 2026. The S&P 500 gained 1.4 percent and the Nasdaq Composite climbed 2.1 percent after cooler inflation data strengthened hopes for a Federal Reserve rate cut later this year. Published September 10, 2026. Technology shares led the advance.",
  score: 0.9,
};

const GENERIC_QUOTES_WORK = {
  title: "Understanding stock quotes and how market data works",
  url: "https://www.nasdaq.com/articles/market-data-101",
  content:
    "A stock quote shows the current bid and ask, which are the prices at which investors are willing to buy or sell. Real-time prices are distributed by market data providers and may be delayed for most retail platforms. The bid-ask spread is the difference between the two prices.",
  score: 0.4,
};

function validAnswer(overrides = {}) {
  return JSON.stringify({
    explanationFound: true,
    summary:
      "The move coincided with announcements from the company that may have supported the shares during the move window.",
    factors: [
      {
        title: "Product announcement on the move date",
        explanation:
          "A company announcement coincided with the move and may have affected investor expectations during the session.",
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

function assessOf(fixture) {
  return assessPriceMoveRelevance(
    {
      title: fixture.title,
      url: fixture.url,
      content: fixture.content,
      domain: "example.com",
      classification: "high_quality_secondary",
      quality: "high_quality_secondary",
      publishedDate: null,
    },
    moveRequest,
  );
}

/* ---------------------------------------------------------------------- */

describe("A: AAPL Nasdaq quote landing + generic bid/ask content is rejected", () => {
  it("isGenericQuoteContent flags the landing page", () => {
    assert.equal(isGenericQuoteContent(NASDAQ_AAPL_LANDING.title, NASDAQ_AAPL_LANDING.content), true);
  });

  it("assessPriceMoveRelevance returns generic_quote_content", () => {
    assert.deepEqual(assessOf(NASDAQ_AAPL_LANDING), {
      status: "discarded",
      reason: "generic_quote_content",
    });
  });

  it("explainPriceMove discards it and never calls Gemini", async () => {
    let generateCalls = 0;
    const lines = await withLogs(() =>
      expectErrorCode(
        explainPriceMove(moveRequest, {
          search: async () => ({ query: "ignored", results: [NASDAQ_AAPL_LANDING] }),
          generate: async () => {
            generateCalls += 1;
            return validAnswer();
          },
        }),
        "insufficient_evidence",
      ),
    );
    assert.equal(generateCalls, 0);
    assert.equal(researchLog(lines).discarded[0].reason, "generic_quote_content");
  });
});

describe("B: AAPL correct ticker + generic market-cap/profile content => no_event_signal", () => {
  it("the profile content carries no event signal", () => {
    assert.equal(hasEventSignal(AAPL_GENERIC_PROFILE.title, AAPL_GENERIC_PROFILE.content), false);
  });

  it("assessPriceMoveRelevance returns no_event_signal", () => {
    assert.deepEqual(assessOf(AAPL_GENERIC_PROFILE), {
      status: "discarded",
      reason: "no_event_signal",
    });
  });

  it("explainPriceMove discards it and never calls Gemini", async () => {
    let generateCalls = 0;
    const lines = await withLogs(() =>
      expectErrorCode(
        explainPriceMove(moveRequest, {
          search: async () => ({ query: "ignored", results: [AAPL_GENERIC_PROFILE] }),
          generate: async () => {
            generateCalls += 1;
            return validAnswer();
          },
        }),
        "insufficient_evidence",
      ),
    );
    assert.equal(generateCalls, 0);
    assert.equal(researchLog(lines).discarded[0].reason, "no_event_signal");
  });
});

describe("C: a Reuters Apple product announcement on the move date is accepted", () => {
  it("assessPriceMoveRelevance returns a relevant company verdict", () => {
    const verdict = assessOf(REUTERS_APPLE_PRODUCT);
    assert.deepEqual(verdict, {
      status: "relevant",
      role: "company",
      dateVerified: true,
    });
  });

  it("explainPriceMove succeeds with company evidence", async () => {
    let lastPrompt = "";
    const result = await explainPriceMove(moveRequest, {
      search: async () => ({ query: "ignored", results: [REUTERS_APPLE_PRODUCT] }),
      generate: async (prompt) => {
        lastPrompt = prompt;
        return validAnswer();
      },
    });
    assert.equal(result.factors.length, 1);
    assert.equal(result.factors[0].evidenceQuality, "moderate");
    assert.ok(lastPrompt.includes("C1"));
    assert.equal(lastPrompt.includes("- C1 | [MARKET CONTEXT]"), false);
  });
});

describe("D: a Reuters/FT/Bloomberg earnings/guidance article is accepted", () => {
  it("the article carries earnings/guidance signals", () => {
    assert.equal(hasEventSignal(REUTERS_APPLE_GUIDANCE.title, REUTERS_APPLE_GUIDANCE.content), true);
  });

  it("explainPriceMove succeeds", async () => {
    const result = await explainPriceMove(moveRequest, {
      search: async () => ({ query: "ignored", results: [REUTERS_APPLE_GUIDANCE] }),
      generate: async () => validAnswer(),
    });
    assert.equal(result.factors.length, 1);
    assert.equal(result.sources.length, 1);
  });
});

describe("E: a broad-market same-day rally is accepted as market_context", () => {
  it("the article is market content describing an actual event", () => {
    assert.equal(isMarketContextContent(REUTERS_MARKET_RALLY.title, REUTERS_MARKET_RALLY.content), true);
    assert.equal(isMarketActivityContent(REUTERS_MARKET_RALLY.title, REUTERS_MARKET_RALLY.content), true);
  });

  it("explainPriceMove succeeds with a [MARKET CONTEXT] claim capped at moderate", async () => {
    let lastPrompt = "";
    const result = await explainPriceMove(moveRequest, {
      search: async () => ({ query: "ignored", results: [REUTERS_MARKET_RALLY] }),
      generate: async (prompt) => {
        lastPrompt = prompt;
        return validAnswer();
      },
    });
    assert.ok(lastPrompt.includes("- C1 | [MARKET CONTEXT]"));
    assert.equal(result.factors[0].evidenceQuality, "moderate");
  });
});

describe("F: a generic explanation of how markets/bid-ask/quotes work is rejected", () => {
  it("isGenericQuoteContent flags the article", () => {
    assert.equal(isGenericQuoteContent(GENERIC_QUOTES_WORK.title, GENERIC_QUOTES_WORK.content), true);
  });

  it("explainPriceMove rejects it before Gemini", async () => {
    let generateCalls = 0;
    const lines = await withLogs(() =>
      expectErrorCode(
        explainPriceMove(moveRequest, {
          search: async () => ({ query: "ignored", results: [GENERIC_QUOTES_WORK] }),
          generate: async () => {
            generateCalls += 1;
            return validAnswer();
          },
        }),
        "insufficient_evidence",
      ),
    );
    assert.equal(generateCalls, 0);
    assert.equal(researchLog(lines).discarded[0].reason, "generic_quote_content");
  });
});

describe("G: explanationFound=false with factors=[] => insufficient_evidence", () => {
  it("a model that finds no explanation never returns success", async () => {
    let generateCalls = 0;
    await expectErrorCode(
      explainPriceMove(moveRequest, {
        search: async () => ({ query: "ignored", results: [REUTERS_APPLE_PRODUCT] }),
        generate: async () => {
          generateCalls += 1;
          return validAnswer({ explanationFound: false, factors: [] });
        },
      }),
      "insufficient_evidence",
    );
    assert.equal(generateCalls, 1);
  });
});

describe("H: explanationFound=false with fabricated non-empty factors => insufficient_evidence", () => {
  it("inconsistent model output is not surfaced as success", async () => {
    let generateCalls = 0;
    await expectErrorCode(
      explainPriceMove(moveRequest, {
        search: async () => ({ query: "ignored", results: [REUTERS_APPLE_PRODUCT] }),
        generate: async () => {
          generateCalls += 1;
          return validAnswer({
            explanationFound: false,
            factors: [
              {
                title: "Fabricated generic driver",
                explanation: "The model contradicted itself.",
                evidence: [{ type: "external_source", claimIds: ["C99"] }],
                evidenceQuality: "moderate",
              },
            ],
          });
        },
      }),
      "insufficient_evidence",
    );
    assert.equal(generateCalls, 1);
  });
});

describe("I: success requires explanationFound=true and at least one valid relevant factor", () => {
  it("explanationFound=true with an empty factors array is insufficient", async () => {
    await expectErrorCode(
      explainPriceMove(moveRequest, {
        search: async () => ({ query: "ignored", results: [REUTERS_APPLE_PRODUCT] }),
        generate: async () => validAnswer({ factors: [] }),
      }),
      "insufficient_evidence",
    );
  });

  it("explanationFound=true with a valid relevant factor succeeds", async () => {
    const result = await explainPriceMove(moveRequest, {
      search: async () => ({ query: "ignored", results: [REUTERS_APPLE_PRODUCT] }),
      generate: async () => validAnswer(),
    });
    assert.equal(result.factors.length, 1);
  });
});

describe("J: a relevant event claim still resolves C -> S -> exact URL", () => {
  it("the evidence chain points at the exact Tavily URL", async () => {
    const result = await explainPriceMove(moveRequest, {
      search: async () => ({ query: "ignored", results: [REUTERS_APPLE_GUIDANCE] }),
      generate: async () => validAnswer(),
    });
    const claim = result.factors[0].evidence[0];
    assert.deepEqual(claim.claimIds, ["C1"]);
    assert.deepEqual(claim.sourceIds, ["S1"]);
    assert.equal(result.sources[0].url, REUTERS_APPLE_GUIDANCE.url);
    assert.equal(result.sources[0].domain, "reuters.com");
  });
});

describe("K: still max 1 Tavily + 1 Gemini and zero Alpha Vantage", () => {
  it("accepted articles spend exactly 1 Tavily + 1 Gemini", async () => {
    let searchCalls = 0;
    let generateCalls = 0;
    await withLogs(() =>
      expectErrorCode(
        explainPriceMove(moveRequest, {
          search: async () => {
            searchCalls += 1;
            return { query: "ignored", results: [NASDAQ_AAPL_LANDING] };
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

    searchCalls = 0;
    generateCalls = 0;
    await explainPriceMove(moveRequest, {
      search: async () => {
        searchCalls += 1;
        return { query: "ignored", results: [REUTERS_APPLE_PRODUCT] };
      },
      generate: async () => {
        generateCalls += 1;
        return validAnswer();
      },
    });
    assert.equal(searchCalls, 1);
    assert.equal(generateCalls, 1);
  });

  it("the event relevance layer never uses the market-data provider", () => {
    for (const file of [
      "lib/ai/price-move-relevance.ts",
      "lib/ai/price-move.ts",
      "lib/ai/gemini.ts",
      "app/api/explain-price-move/route.ts",
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

describe("Micro-fix: market-cap spelling, generic device signals, no Apple SKUs", () => {
  it('recognizes "market cap" as a quote stat', () => {
    assert.equal(
      isGenericQuoteContent(
        "Acme Holdings (ACME) Daily Stock Quote",
        "The market cap is large and the average daily volume is high.",
      ),
      true,
    );
  });

  it('recognizes "market capitalization" as a quote stat', () => {
    assert.equal(
      isGenericQuoteContent(
        "Acme Holdings (ACME) Daily Stock Quote",
        "The market capitalization is large and the dividend yield is low.",
      ),
      true,
    );
  });

  it('a generic "new device" launch is still an event signal', () => {
    assert.equal(
      hasEventSignal(
        "Acme unveils next-generation device",
        "The company introduced a new device that may attract demand.",
      ),
      true,
    );
  });

  it("no Apple product SKUs are hardcoded in price-move-relevance.ts", () => {
    const source = readRoot("lib/ai/price-move-relevance.ts");
    assert.equal(
      /iphone|ipad|macbook|\bvision\b/i.test(source),
      false,
      "Apple product names must not be hardcoded",
    );
  });
});