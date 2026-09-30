/* Tests (A-J) for PER-SOURCE evidence rendering in Price Move Explanation. */
/*                                                                          */
/* Runtime bug being protected against: an Evidence item that resolves to   */
/* several sources showed ONE source's title/link with an attribution line  */
/* that concatenated publishers/dates of ALL sources in the factor          */
/* ("Bloomberg · 9 Sep 2026 CNBC · date unverified" under a CNBC title).    */
/* Each evidence row must belong to exactly one source.                     */
/*                                                                          */
/*   A  one source  => title/publisher/date all from that source            */
/*   B  two sources => both rendered independently                          */
/*   C  source A's date never appears as source B's metadata                */
/*   D  undated source => exact "date unverified"                           */
/*   E  dated source => only its own date                                   */
/*   F  Sources used remains deduplicated                                   */
/*   G  exact source URLs preserved                                         */
/*   H  links keep target="_blank" + noopener noreferrer                    */
/*   I  no dangerouslySetInnerHTML                                          */
/*   J  no Tavily/Gemini/Alpha/Supabase calls introduced                    */
/* ------------------------------------------------------------------------ */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  citedSources,
  evidenceSourceRows,
  sourceDateLabel,
} from "../.testbuild/ai/attribution.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRoot(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

/* --- Fixtures (mirror the runtime AAPL case) --- */

const CNBC = {
  id: "S1",
  title: "Apple stock jumps after September product event",
  url: "https://www.cnbc.com/2026/09/10/apple-stock-jumps.html",
  domain: "cnbc.com",
  quality: "high_quality_secondary",
  publisher: "CNBC",
  publishedDate: "2026-09-10",
};

const BLOOMBERG = {
  id: "S2",
  title: "Apple Unveils New Devices at Annual Event",
  url: "https://www.bloomberg.com/news/articles/2026-09-09/apple-unveils",
  domain: "bloomberg.com",
  quality: "high_quality_secondary",
  publisher: "Bloomberg",
  publishedDate: "2026-09-09",
};

const REUTERS_UNDATED = {
  id: "S3",
  title: "Apple raises its quarterly guidance",
  url: "https://www.reuters.com/business/apple-guidance",
  domain: "reuters.com",
  quality: "high_quality_secondary",
  publisher: "Reuters",
  publishedDate: null,
};

const SOURCES = new Map([
  [CNBC.id, CNBC],
  [BLOOMBERG.id, BLOOMBERG],
  [REUTERS_UNDATED.id, REUTERS_UNDATED],
]);

const singleEvidence = {
  type: "external_source",
  description: "The stock jumped after the company's September product event.",
  claimIds: ["C1"],
  sourceIds: ["S1"],
};

const multiEvidence = {
  type: "external_source",
  description: "Several outlets covered the product announcement.",
  claimIds: ["C1", "C2"],
  sourceIds: ["S2", "S1"],
};

const undatedEvidence = {
  type: "external_source",
  description: "The company updated its outlook for the quarter.",
  claimIds: ["C3"],
  sourceIds: ["S3"],
};

/* ---------------------------------------------------------------------- */

describe("A: one source => title/publisher/date correspond to that source", () => {
  it("returns exactly one row with that source's own metadata", () => {
    const rows = evidenceSourceRows(singleEvidence, SOURCES);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, CNBC);
    assert.equal(rows[0].attribution, "CNBC · 10 Sep 2026");
  });
});

describe("B: two sources => both rendered independently", () => {
  it("returns one row per source, in evidence order", () => {
    const rows = evidenceSourceRows(multiEvidence, SOURCES);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => row.source.id),
      ["S2", "S1"],
    );
    assert.equal(rows[0].source, BLOOMBERG);
    assert.equal(rows[1].source, CNBC);
  });
});

describe("C: source A's date never appears as source B's metadata", () => {
  it("each row carries only that source's date", () => {
    const rows = evidenceSourceRows(multiEvidence, SOURCES);
    const bloomberg = rows[0].attribution; // "Bloomberg · 9 Sep 2026"
    const cnbc = rows[1].attribution; // "CNBC · 10 Sep 2026"
    assert.ok(bloomberg.includes("9 Sep 2026"));
    assert.equal(bloomberg.includes("10 Sep 2026"), false);
    assert.ok(cnbc.includes("10 Sep 2026"));
    assert.equal(cnbc.includes("9 Sep 2026"), false);
  });
});

describe("D: undated source => exact date unverified", () => {
  it("renders the exact label when publishedDate is null", () => {
    const rows = evidenceSourceRows(undatedEvidence, SOURCES);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].attribution, "Reuters · date unverified");
    assert.equal(sourceDateLabel(null), "date unverified");
  });
});

describe("E: dated source => only its own date", () => {
  it("formats the source's own published date", () => {
    const rows = evidenceSourceRows(singleEvidence, SOURCES);
    assert.equal(rows[0].attribution, "CNBC · 10 Sep 2026");
    assert.equal(sourceDateLabel("2026-09-10"), "10 Sep 2026");
  });
});

describe("F: Sources used remains deduplicated", () => {
  it("lists each cited source once across all factors", () => {
    const factors = [
      { evidence: [singleEvidence] },
      { evidence: [multiEvidence] },
      { evidence: [undatedEvidence] },
    ];
    const used = citedSources(factors, SOURCES);
    assert.equal(used.length, 3);
    assert.deepEqual(
      used.map((source) => source.id),
      ["S1", "S2", "S3"],
    );
  });

  it("elides a source already cited by a previous evidence item", () => {
    const used = citedSources(
      [{ evidence: [multiEvidence, singleEvidence] }],
      SOURCES,
    );
    assert.equal(used.length, 2);
    assert.deepEqual(used.map((source) => source.id), ["S2", "S1"]);
  });
});

describe("G: exact source URLs preserved", () => {
  it("rows keep the exact source url", () => {
    const rows = evidenceSourceRows(multiEvidence, SOURCES);
    assert.deepEqual(
      rows.map((row) => row.source.url),
      [BLOOMBERG.url, CNBC.url],
    );
  });

  it("the component links with href={source.url}", () => {
    const section = readRoot(
      "app/components/PriceMoveExplanationSection.tsx",
    );
    assert.ok(section.includes("href={source.url}"));
  });
});

describe("H: links keep target blank + noopener noreferrer", () => {
  it("every source anchor is safe-opened", () => {
    const section = readRoot(
      "app/components/PriceMoveExplanationSection.tsx",
    );
    assert.ok(section.includes('target="_blank"'));
    assert.ok(section.includes('rel="noopener noreferrer"'));
  });
});

describe("I: no dangerouslySetInnerHTML", () => {
  it("the section renders provider data only", () => {
    const section = readRoot(
      "app/components/PriceMoveExplanationSection.tsx",
    );
    assert.equal(section.includes("dangerouslySetInnerHTML"), false);
  });
});

describe("J: no network calls introduced", () => {
  it("attribution helpers and the section stay offline", () => {
    for (const file of [
      "lib/ai/attribution.ts",
      "app/components/PriceMoveExplanationSection.tsx",
    ]) {
      const source = readRoot(file);
      const leaks =
        /(fetch\s*\(|tavily|GeminiAnalysisError|generateContent|alphavantage|marketdataprovider|supabase|analysis-history)/i.test(
          source,
        );
      assert.equal(leaks, false, `${file} must stay offline`);
    }
  });

  it("the runtime mixed-attribution root cause is gone from the section", () => {
    const section = readRoot(
      "app/components/PriceMoveExplanationSection.tsx",
    );
    assert.equal(section.includes("formatEvidenceAttribution"), false);
    assert.ok(section.includes("evidenceSourceRows"));
    assert.ok(section.includes("Evidence basis"));
    assert.ok(section.includes("citedSources"));
  });
});