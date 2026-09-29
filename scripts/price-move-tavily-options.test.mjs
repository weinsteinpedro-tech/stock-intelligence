/* Tests (A-K) for the PRICE-MOVE-SPECIFIC Tavily search options.        */
/*                                                                        */
/* Price Move asks Tavily for NEWS around a narrow published-date window  */
/* with "restrict" domain mode. /api/analyze keeps its exact default      */
/* request (topic finance, global trusted domains, no date filtering).    */
/*                                                                        */
/*   A  Price Move Tavily options => topic "news"                         */
/*   B  startDate = fromDate - 3 (2026-09-06)                             */
/*   C  endDate = toDate + 4 (2026-09-14, exclusive upper bound)          */
/*   D  filterByPublishedDate === true                                    */
/*   E  includePublishedDate === true                                     */
/*   F  includeDomainsMode === "restrict"                                 */
/*   G  valid published_date normalizes to YYYY-MM-DD                     */
/*   H  invalid published_date => fallback parser / null, never invented  */
/*   I  local isWithinMoveWindow defense stays active                     */
/*   J  /api/analyze default request body is unchanged                    */
/*   K  1 Tavily max + 1 Gemini max + 0 Alpha Vantage                     */
/* ---------------------------------------------------------------------- */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildPriceMoveQuery,
  buildPriceMoveTavilyOptions,
  explainPriceMove,
} from "../.testbuild/price-move.js";
import {
  buildTavilyRequest,
  normalizePublishedDate,
  TAVILY_RETRIEVAL_DOMAINS,
} from "../.testbuild/gemini.js";
import { isWithinMoveWindow } from "../.testbuild/price-move-relevance.js";
import { getRetrievalDomainsForSymbol } from "../.testbuild/official-issuer-domains.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRoot(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

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

/* Official AAPL page whose content carries NO parseable date: only Tavily's
   published_date can anchor it to the window. */
const APPLE_EVENT_UNDATED_CONTENT = {
  title: "Apple introduces new device at September event",
  url: "https://www.apple.com/newsroom/item.html",
  content:
    "Apple introduced a new device at its September event and announced the launch ahead of the fall shopping season. The new device is expected to drive demand in the second half of the year, and the company said it is ramping shipments of the new product now.",
  score: 0.95,
  published_date: "2026-09-10T12:00:00Z",
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

const options = buildPriceMoveTavilyOptions(moveRequest);

/* ---------------------------------------------------------------------- */

describe("A: Price Move Tavily options => topic news", () => {
  it("uses the news topic", () => {
    assert.equal(options.topic, "news");
  });
});

describe("B: startDate = fromDate - 3", () => {
  it("is 2026-09-06 for the 2026-09-09 move", () => {
    assert.equal(options.startDate, "2026-09-06");
  });
});

describe("C: endDate = toDate + 4 (exclusive upper bound)", () => {
  it("is 2026-09-14, covering an inclusive Sep 6 ... Sep 13 window", () => {
    assert.equal(options.endDate, "2026-09-14");
  });
});

describe("D: filterByPublishedDate === true", () => {
  it("asks Tavily to drop undated / out-of-window results", () => {
    assert.equal(options.filterByPublishedDate, true);
  });
});

describe("E: includePublishedDate === true", () => {
  it("asks Tavily to return published_date per result", () => {
    assert.equal(options.includePublishedDate, true);
  });
});

describe("F: includeDomainsMode === restrict", () => {
  it("restricts retrieval without replacing downstream trust", () => {
    assert.equal(options.includeDomainsMode, "restrict");
    assert.deepEqual(options.domains, getRetrievalDomainsForSymbol("AAPL"));
  });
});

describe("G: valid published_date normalizes to YYYY-MM-DD", () => {
  it("handles RFC3339 timestamps and plain dates", () => {
    assert.equal(normalizePublishedDate("2026-09-10T15:04:05Z"), "2026-09-10");
    assert.equal(normalizePublishedDate("2026-09-10"), "2026-09-10");
  });
});

describe("H: invalid published_date => fallback / null, never invented", () => {
  it("returns null for unparseable or impossible dates", () => {
    assert.equal(normalizePublishedDate("not-a-date"), null);
    assert.equal(normalizePublishedDate(""), null);
    assert.equal(normalizePublishedDate("   "), null);
    assert.equal(normalizePublishedDate("2026-13-01"), null);
    assert.equal(normalizePublishedDate("2026-09-32"), null);
    assert.equal(normalizePublishedDate("20260910"), null);
    assert.equal(normalizePublishedDate(null), null);
    assert.equal(normalizePublishedDate(undefined), null);
  });
});

describe("I: local isWithinMoveWindow defense stays active", () => {
  it("enforces the ±3 day window even when Tavily also filters", () => {
    assert.equal(isWithinMoveWindow("2026-09-05", "2026-09-09", "2026-09-10"), false);
    assert.equal(isWithinMoveWindow("2026-09-06", "2026-09-09", "2026-09-10"), true);
    assert.equal(isWithinMoveWindow("2026-09-13", "2026-09-09", "2026-09-10"), true);
    assert.equal(isWithinMoveWindow("2026-09-14", "2026-09-09", "2026-09-10"), false);
  });

  it("uses Tavily published_date when valid and applies the local window", async () => {
    const { sources } = await explainPriceMove(moveRequest, {
      search: async () => ({ query: "ignored", results: [APPLE_EVENT_UNDATED_CONTENT] }),
      generate: async () => validAnswer(),
    });
    assert.equal(sources.length, 1);
    assert.equal(sources[0].domain, "apple.com");
    assert.equal(sources[0].publishedDate, "2026-09-10");
  });

  it("discards official content with an out-of-window published_date", async () => {
    const { ...outOfWindow } = APPLE_EVENT_UNDATED_CONTENT;
    outOfWindow.published_date = "2026-08-01T00:00:00Z";
    const lines = await withLogs(async () => {
      let thrown = null;
      try {
        await explainPriceMove(moveRequest, {
          search: async () => ({ query: "ignored", results: [outOfWindow] }),
          generate: async () => validAnswer(),
        });
      } catch (error) {
        thrown = error;
      }
      assert.ok(thrown);
    });
    const log = researchLog(lines);
    assert.equal(log.discarded[0].reason, "outside_move_window");
  });
});

describe("J: /api/analyze default request body is unchanged", () => {
  it("empty options produces the historical analyze request", () => {
    const body = buildTavilyRequest("Some query");
    assert.equal(body.topic, "finance");
    assert.deepEqual(body.include_domains, TAVILY_RETRIEVAL_DOMAINS);
    assert.equal(body.search_depth, "advanced");
    assert.equal(body.max_results, 12);
    for (const key of [
      "start_date",
      "end_date",
      "filter_by_published_date",
      "include_published_date",
      "include_domains_mode",
    ]) {
      assert.equal(key in body, false, `default request must not include ${key}`);
    }
  });

  it("price-move options produce the structured request", () => {
    const body = buildTavilyRequest(buildPriceMoveQuery(moveRequest), options);
    assert.equal(body.topic, "news");
    assert.equal(body.start_date, "2026-09-06");
    assert.equal(body.end_date, "2026-09-14");
    assert.equal(body.filter_by_published_date, true);
    assert.equal(body.include_published_date, true);
    assert.equal(body.include_domains_mode, "restrict");
  });
});

describe("K: 1 Tavily max + 1 Gemini max + 0 Alpha Vantage", () => {
  it("one search call with options, one Gemini call", async () => {
    let searchCalls = 0;
    let generateCalls = 0;
    let capturedOptions = null;
    await explainPriceMove(moveRequest, {
      search: async (query, opts) => {
        searchCalls += 1;
        capturedOptions = opts;
        return { query, results: [APPLE_EVENT_UNDATED_CONTENT] };
      },
      generate: async () => {
        generateCalls += 1;
        return validAnswer();
      },
    });
    assert.equal(searchCalls, 1);
    assert.equal(generateCalls, 1);
    assert.deepEqual(capturedOptions, options);
  });

  it("dated/undated diagnostics report only counts", async () => {
    const lines = await withLogs(() =>
      explainPriceMove(moveRequest, {
        search: async () => ({ query: "ignored", results: [APPLE_EVENT_UNDATED_CONTENT] }),
        generate: async () => validAnswer(),
      }),
    );
    const log = researchLog(lines);
    assert.equal(log.datedResults, 1);
    assert.equal(log.undatedResults, 0);
  });

  it("no changed route, module or test references Alpha Vantage", () => {
    for (const file of [
      "lib/ai/gemini.ts",
      "lib/ai/price-move.ts",
      "app/api/explain-price-move/route.ts",
      "app/api/analyze/route.ts",
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

describe("Micro-fix: single topic definition in buildTavilyRequest", () => {
  it("topic news is set exactly once with no string-spread residue", () => {
    const body = buildTavilyRequest("test", { topic: "news" });
    assert.equal(body.topic, "news");
    const keys = Object.keys(body);
    for (const numericKey of ["0", "1", "2", "3"]) {
      assert.equal(keys.includes(numericKey), false, `spread string leaked key ${numericKey}`);
    }
    for (const prototypeKey of ["length", "toUpperCase", "charAt", "valueOf", "toString"]) {
      assert.equal(keys.includes(prototypeKey), false, `spread string leaked key ${prototypeKey}`);
    }
  });

  it("default topic stays finance", () => {
    assert.equal(buildTavilyRequest("test").topic, "finance");
  });
});