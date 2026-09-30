/* Tests (A-K) for the SYMBOL-SCOPED OFFICIAL DOMAINS layer of Price      */
/* Move Explanation.                                                      */
/*                                                                        */
/* Apple's corporate/IR domains are primary ONLY for AAPL - never for     */
/* other symbols, never globally. Matching is exact-or-subdomain only.    */
/*                                                                        */
/*   A  AAPL + investor.apple.com             => contextual primary       */
/*   B  AAPL + apple.com                     => contextual primary       */
/*   C  MSFT + investor.apple.com            => other                     */
/*   D  AAPL + evilapple.com                 => other                     */
/*   E  AAPL + fake-investor.apple.com.evil  => other                     */
/*   F  AAPL + subdomain.investor.apple.com  => primary                   */
/*   G  AAPL retrieval = trusted globals + apple domains, no dups         */
/*   H  MSFT retrieval has NO Apple domains                               */
/*   I  AAPL official generic IR/profile page => no_event_signal          */
/*   J  AAPL official event page with material event => accepted          */
/*   K  still max 1 Tavily + 1 Gemini, zero Alpha Vantage                */
/* ---------------------------------------------------------------------- */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { explainPriceMove } from "../.testbuild/ai/price-move.js";
import {
  GeminiAnalysisError,
  TAVILY_RETRIEVAL_DOMAINS,
} from "../.testbuild/ai/gemini.js";
import {
  classifySourceForSymbol,
  getRetrievalDomainsForSymbol,
} from "../.testbuild/ai/official-issuer-domains.js";

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

/* --- Fixtures --- */

const INVESTOR_APPLE_GENERIC = {
  title: "Apple Investor Relations - Company Overview",
  url: "https://investor.apple.com/overview/default.aspx",
  content:
    "Apple Inc. designs, manufactures and sells smartphones, personal computers, wearables and services. The company is headquartered in Cupertino, California. Its market capitalization is about three trillion dollars and it pays a dividend to shareholders. Investor relations contact information and transfer agent details are available on this page.",
  score: 0.7,
};

const APPLE_NEWSROOM_EVENT = {
  title: "Apple introduces new MacBook Air with faster M-series chips",
  url: "https://www.apple.com/newsroom/2026/09/apple-introduces-macbook-air.html",
  content:
    "Apple today introduced a new MacBook Air laptop with faster M-series chips at its September event, which the company announced ahead of the fall shopping season. The new device is expected to drive demand during the second half of the year. Published September 10, 2026.",
  score: 0.95,
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

/* ---------------------------------------------------------------------- */

describe("A: AAPL + investor.apple.com => contextual primary", () => {
  it("classifies investor.apple.com as primary for AAPL", () => {
    assert.equal(classifySourceForSymbol("investor.apple.com", "AAPL"), "primary");
  });

  it("the canonical domain is never promoted globally", () => {
    assert.equal(classifySourceForSymbol("investor.apple.com", "AAPL"), "primary");
    assert.equal(TAVILY_RETRIEVAL_DOMAINS.includes("investor.apple.com"), false);
  });
});

describe("B: AAPL + apple.com => contextual primary", () => {
  it("classifies www.apple.com as primary for AAPL", () => {
    assert.equal(classifySourceForSymbol("www.apple.com", "AAPL"), "primary");
  });

  it("normalizes case before classifying", () => {
    assert.equal(classifySourceForSymbol("APPLE.COM", "AAPL"), "primary");
  });

  it("apple.com is NOT in the global trusted allowlist", () => {
    assert.equal(TAVILY_RETRIEVAL_DOMAINS.includes("apple.com"), false);
  });
});

describe("C: MSFT + investor.apple.com => other", () => {
  it("never treats another symbol's official domain as primary", () => {
    assert.equal(classifySourceForSymbol("investor.apple.com", "MSFT"), "other");
  });

  it("an official domain only for another symbol is untrusted in the pipeline", async () => {
    const msftRequest = { ...moveRequest, symbol: "MSFT", companyName: "Microsoft Corporation" };
    let generateCalls = 0;
    const lines = await withLogs(() =>
      expectErrorCode(
        explainPriceMove(msftRequest, {
          search: async () => ({ query: "ignored", results: [APPLE_NEWSROOM_EVENT] }),
          generate: async () => {
            generateCalls += 1;
            return validAnswer();
          },
        }),
        "insufficient_evidence",
      ),
    );
    assert.equal(generateCalls, 0);
    assert.equal(researchLog(lines).discarded[0].reason, "untrusted_domain");
  });
});

describe("D: AAPL + evilapple.com => other", () => {
  it("lookalike domains never match", () => {
    assert.equal(classifySourceForSymbol("evilapple.com", "AAPL"), "other");
    assert.equal(classifySourceForSymbol("apple.com.evil.com", "AAPL"), "other");
  });
});

describe("E: AAPL + fake-investor.apple.com.evil.com => other", () => {
  it("suffix-only matching rejects attacker subdomains under another TLD", () => {
    assert.equal(classifySourceForSymbol("fake-investor.apple.com.evil.com", "AAPL"), "other");
    assert.equal(classifySourceForSymbol("investor.apple.com.ph", "AAPL"), "other");
  });
});

describe("F: AAPL + subdomain.investor.apple.com => primary", () => {
  it("allows trusted subdomains of a verified official domain", () => {
    assert.equal(classifySourceForSymbol("subdomain.investor.apple.com", "AAPL"), "primary");
    assert.equal(classifySourceForSymbol("ir.apple.com", "AAPL"), "primary");
  });
});

describe("G: AAPL retrieval = trusted globals + apple.com + investor.apple.com", () => {
  it("merges globals with verified official domains, deduplicated", () => {
    const merged = getRetrievalDomainsForSymbol("AAPL");
    assert.equal(merged.length, new Set(merged).size, "must not contain duplicates");
    for (const domain of TAVILY_RETRIEVAL_DOMAINS) {
      assert.ok(merged.includes(domain), `missing trusted global domain ${domain}`);
    }
    assert.ok(merged.includes("apple.com"));
    assert.ok(merged.includes("investor.apple.com"));
  });

  it("never mutates the global retrieval allowlist", () => {
    const before = Array.from(TAVILY_RETRIEVAL_DOMAINS);
    getRetrievalDomainsForSymbol("AAPL");
    assert.deepEqual(
      Array.from(TAVILY_RETRIEVAL_DOMAINS),
      before,
      "the global list must stay unchanged",
    );
    assert.equal(TAVILY_RETRIEVAL_DOMAINS.includes("apple.com"), false);
  });
});

describe("H: MSFT retrieval includes NO Apple domains", () => {
  it("returns exactly the global allowlist for unregistered symbols", () => {
    const merged = getRetrievalDomainsForSymbol("MSFT");
    assert.equal(merged.includes("apple.com"), false);
    assert.equal(merged.includes("investor.apple.com"), false);
    assert.equal(merged.length, TAVILY_RETRIEVAL_DOMAINS.length);
    for (const domain of TAVILY_RETRIEVAL_DOMAINS) {
      assert.ok(merged.includes(domain));
    }
  });
});

describe("I: AAPL official generic IR/profile page => no_event_signal", () => {
  it("explainPriceMove rejects it and never calls Gemini", async () => {
    let searchCalls = 0;
    let generateCalls = 0;
    let capturedOptions = null;
    const lines = await withLogs(() =>
      expectErrorCode(
        explainPriceMove(moveRequest, {
          search: async (query, options) => {
            searchCalls += 1;
            capturedOptions = options;
            return { query, results: [INVESTOR_APPLE_GENERIC] };
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
    assert.deepEqual(
      capturedOptions.domains,
      getRetrievalDomainsForSymbol("AAPL"),
    );
    const log = researchLog(lines);
    assert.equal(log.discarded[0].reason, "no_event_signal");
    assert.equal(log.discarded[0].classification, "primary");
    assert.equal(log.officialDomainMatches, 1);
  });
});

describe("J: AAPL official event page with material event => accepted", () => {
  it("accepts apple.com newsroom content as a primary source for AAPL", async () => {
    let searchCalls = 0;
    let generateCalls = 0;
    let capturedOptions = null;
    const { sources } = await explainPriceMove(moveRequest, {
      search: async (query, options) => {
        searchCalls += 1;
        capturedOptions = options;
        return { query, results: [APPLE_NEWSROOM_EVENT] };
      },
      generate: async () => {
        generateCalls += 1;
        return validAnswer();
      },
    });

    assert.equal(searchCalls, 1);
    assert.equal(generateCalls, 1);
    assert.deepEqual(
      capturedOptions.domains,
      getRetrievalDomainsForSymbol("AAPL"),
    );
    assert.equal(sources.length, 1);
    assert.equal(sources[0].domain, "apple.com");
    assert.equal(sources[0].quality, "primary");
    assert.equal(sources[0].url, APPLE_NEWSROOM_EVENT.url);
  });
});

describe("K: still max 1 Tavily + 1 Gemini and zero Alpha Vantage", () => {
  it("official-domain integration changes nothing about call counts", async () => {
    let searchCalls = 0;
    let generateCalls = 0;
    await explainPriceMove(moveRequest, {
      search: async () => {
        searchCalls += 1;
        return { query: "ignored", results: [APPLE_NEWSROOM_EVENT] };
      },
      generate: async () => {
        generateCalls += 1;
        return validAnswer();
      },
    });
    assert.equal(searchCalls, 1);
    assert.equal(generateCalls, 1);
  });

  it("no route, module or test references Alpha Vantage", () => {
    for (const file of [
      "lib/ai/official-issuer-domains.ts",
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