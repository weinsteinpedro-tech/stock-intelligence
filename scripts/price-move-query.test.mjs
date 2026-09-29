/* Tests (A-J) for the EVENT-FIRST price-move retrieval QUERY.          */
/*                                                                      */
/* Runtime symptom this addresses: for AAPL 9->10 Sep 2026 the query    */
/* over-retrieved quote/profile pages (nasdaq generic_quote_content,    */
/* investor.apple.com no_event_signal). The query must stop asking      */
/* Tavily for price/quote material and instead ask for material         */
/* company events around the move window.                               */
/*                                                                      */
/*   A  query has NO fromClose/toClose figures                          */
/*   B  query has NO percentChange                                      */
/*   C  query has NO "stock price move" phrase                          */
/*   D  query HAS company name + symbol                                 */
/*   E  query HAS fromDate + toDate (ISO and human)                     */
/*   F  query HAS event-oriented terms                                  */
/*   G  AAPL query includes apple.com + investor.apple.com preference   */
/*   H  unregistered symbol invents no official domains                 */
/*   I  query includes negative intent (exclude quote/profile/history)  */
/*   J  call count stays 1 Tavily + max 1 Gemini                        */
/* -------------------------------------------------------------------- */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildPriceMoveQuery,
  explainPriceMove,
  humanDate,
} from "../.testbuild/price-move.js";

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

const REUTERS_APPLE_EVENT = {
  title: "Apple introduces new MacBook Pro line at September event",
  url: "https://www.reuters.com/technology/2026-09-10/apple-macbook-pro.html",
  content:
    "Apple Inc. introduced a new line of MacBook Pro laptops at its event on September 10, 2026, the same day its shares gained more than 3 percent. The announcement featured faster chips and a redesigned chassis, and analysts called the launch a positive surprise that may have supported the stock. Published September 10, 2026.",
  score: 0.9,
};

function validAnswer() {
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
  });
}

/* ---------------------------------------------------------------------- */

describe("humanDate is deterministic and locale-independent", () => {
  it("maps ISO dates to English month names", () => {
    assert.equal(humanDate("2026-09-09"), "September 9 2026");
    assert.equal(humanDate("2026-09-10"), "September 10 2026");
  });

  it("falls back to the ISO string on malformed input", () => {
    assert.equal(humanDate("2026-13-09"), "2026-13-09");
    assert.equal(humanDate("nope"), "nope");
  });
});

describe("A: query has NO fromClose/toClose figures", () => {
  it("does not leak any closing price or change figures", () => {
    const query = buildPriceMoveQuery(moveRequest);
    assert.equal(query.includes("315.34"), false);
    assert.equal(query.includes("326.57"), false);
    assert.equal(query.includes("11.23"), false);
  });
});

describe("B: query has NO percentChange", () => {
  it("does not leak the 3.56% figure", () => {
    assert.equal(buildPriceMoveQuery(moveRequest).includes("3.56"), false);
  });
});

describe("C: query has NO price-move retrieval bait", () => {
  it("omits the 'stock price move' phrasing and price-change construct", () => {
    const query = buildPriceMoveQuery(moveRequest);
    assert.equal(query.includes("stock price move"), false);
    assert.equal(query.includes("close 315"), false);
  });
});

describe("D: query HAS company name + symbol", () => {
  it("names the issuer explicitly", () => {
    const query = buildPriceMoveQuery(moveRequest);
    assert.ok(query.includes("Apple Inc."));
    assert.ok(query.includes("(AAPL)"));
  });
});

describe("E: query HAS fromDate + toDate (ISO and human forms)", () => {
  it("contains both canonical and human date representations", () => {
    const query = buildPriceMoveQuery(moveRequest);
    assert.ok(query.includes("2026-09-09"));
    assert.ok(query.includes("2026-09-10"));
    assert.ok(query.includes("September 9 2026"));
    assert.ok(query.includes("September 10 2026"));
  });
});

describe("F: query HAS event-oriented terms", () => {
  it("steers retrieval toward material events", () => {
    const query = buildPriceMoveQuery(moveRequest);
    for (const term of [
      "earnings",
      "guidance",
      "product announcements",
      "analyst actions",
      "mergers and acquisitions",
      "supply chain",
      "filings",
    ]) {
      assert.ok(query.includes(term), `query must include "${term}"`);
    }
  });
});

describe("G: AAPL query includes apple.com preference", () => {
  it("prefers verified official sources as text", () => {
    const query = buildPriceMoveQuery(moveRequest);
    assert.ok(query.includes("verified official sources"));
    assert.ok(query.includes("apple.com"));
    assert.ok(query.includes("investor.apple.com"));
  });
});

describe("H: unregistered symbol invents no official domains", () => {
  it("omits the official-source preference when none exist", () => {
    const query = buildPriceMoveQuery({
      ...moveRequest,
      symbol: "TSLA",
      companyName: "Tesla Inc.",
    });
    assert.equal(query.includes("apple.com"), false);
    assert.equal(query.includes("investor.apple.com"), false);
    assert.equal(query.includes("verified official sources"), false);
  });
});

describe("I: query includes explicit negative intent", () => {
  it("asks Tavily to exclude quote/profile/history pages", () => {
    const query = buildPriceMoveQuery(moveRequest);
    assert.ok(query.includes("Exclude stock quote pages"));
    assert.ok(query.includes("price-history pages"));
    assert.ok(query.includes("company profile pages"));
    assert.ok(query.includes("evergreen company descriptions"));
  });
});

describe("J: call count stays 1 Tavily + max 1 Gemini", () => {
  it("the query refactor changes no call counts", async () => {
    let searchCalls = 0;
    let generateCalls = 0;
    let capturedQuery = null;
    const { sources } = await explainPriceMove(moveRequest, {
      search: async (query) => {
        searchCalls += 1;
        capturedQuery = query;
        return { query, results: [REUTERS_APPLE_EVENT] };
      },
      generate: async () => {
        generateCalls += 1;
        return validAnswer();
      },
    });

    assert.equal(searchCalls, 1);
    assert.equal(generateCalls, 1);
    assert.equal(capturedQuery, buildPriceMoveQuery(moveRequest));
    assert.equal(sources.length, 1);
    assert.equal(sources[0].domain, "reuters.com");
  });
});