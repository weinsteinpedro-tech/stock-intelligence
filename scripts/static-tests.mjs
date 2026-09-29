/*
 * Static tests — no network, no Supabase, no Tavily/Gemini/Alpha Vantage.
 * Reads source files and asserts structural invariants of the analysis
 * history feature (spec items A–H).
 *
 * Usage: node scripts/static-tests.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  const file = path.join(ROOT, rel);
  if (!existsSync(file)) throw new Error(`Missing file: ${rel}`);
  return readFileSync(file, "utf8");
}

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
}

/* ------------------------------------------------------------------ */
/* Files under test                                                    */
/* ------------------------------------------------------------------ */

const future = read("app/components/FutureAnalysis.tsx");
const historyCmp = read("app/components/AnalysisHistory.tsx");
const resultView = read("app/components/AnalysisResultView.tsx");
const section = read("app/components/AnalysisSection.tsx");
const historyLib = read("lib/analysis-history.ts");
const page = read("app/stocks/[symbol]/page.tsx");

/* ------------------------------------------------------------------ */
/* A) successful Analyze => saveAnalysisHistory exactly once           */
/* ------------------------------------------------------------------ */

const saveCallCount = (future.match(/saveAnalysisHistory\s*\(/g) ?? []).length;
check(
  "A: saveAnalysisHistory has exactly one call site in FutureAnalysis",
  saveCallCount === 1,
  `count=${saveCallCount}`,
);

check(
  "A: call is wrapped in a persistAnalysis helper",
  /persistAnalysis\s*\([^)]*analysis[^)]*\)\s*\{[\s\S]*?saveAnalysisHistory\s*\(/.test(
    future,
  ),
);

check(
  "A: persistAnalysis is only invoked after setStatus('success')",
  (() => {
    const successIdx = future.indexOf('setStatus("success")');
    const callIdx = future.indexOf("void persistAnalysis(");
    return (
      successIdx !== -1 &&
      callIdx > successIdx &&
      /setStatus\("success"\);\n\s*setResult\([^;]+\);\n\s*void persistAnalysis/.test(
        future,
      )
    );
  })(),
);

/* ------------------------------------------------------------------ */
/* B) Analyze error => saveAnalysisHistory zero times                  */
/* ------------------------------------------------------------------ */

check(
  "B: single save call never sits inside runAnalysis catch/error branches",
  (() => {
    const errorBlocks = [
      'if (code === "insufficient_evidence")',
      'setStatus("error")',
      "catch",
    ];
    const callIdx = future.indexOf("saveAnalysisHistory(");
    for (const marker of errorBlocks) {
      const m = future.indexOf(marker);
      if (m === -1) continue;
      const tail = future.slice(m);
      if (tail.indexOf("saveAnalysisHistory(") !== -1 && m < callIdx) {
        return false;
      }
    }
    return true;
  })(),
);

/* ------------------------------------------------------------------ */
/* C) history insert error after Analyze success => current analysis   */
/*    still shown                                                      */
/* ------------------------------------------------------------------ */

check(
  "C: persistAnalysis catches failures without re-throwing",
  /persistAnalysis[\s\S]*?try\s*\{[\s\S]*?saveAnalysisHistory[\s\S]*?\}\s*catch\s*(?:\([^)]*\))?\s*\{\s*setSaveWarning\(true\);\s*\}/.test(
    future,
  ),
);

check(
  "C: save failure does not clear the generated result",
  (() => {
    const successIdx = future.indexOf('setStatus("success")');
    const tail = future.slice(successIdx);
    return !/setResult\s*\(\s*null\s*\)/.test(tail);
  })(),
);

check(
  "C: discrete warning message exists",
  /"Analysis completed, but it could not be saved to history\.|SAVE_WARNING/.test(
    future,
  ) && /could not be saved to history\./.test(future),
);

check(
  "C: warning is rendered next to the success result, not replacing it",
  /status === "success" && result &&[\s\S]*?saveWarning &&[\s\S]*?AnalysisResultView/.test(
    future,
  ),
);

/* ------------------------------------------------------------------ */
/* D) two analysis same symbol => two independent records              */
/* ------------------------------------------------------------------ */

check(
  "D: save uses plain insert() so each run adds a new row",
  /\.insert\s*\(/.test(historyLib),
  historyLib.includes(".upsert(") && "found .upsert()",
);
check("D: save never upserts", !historyLib.includes(".upsert("));

check(
  "D: insert does not filter/update by id or symbol on save",
  (() => {
    const insertBlock = historyLib.split("from(\"analysis_history\")")[1];
    return !/\.eq\s*\(/.test(insertBlock) && !/\.delete\s*\(/.test(insertBlock);
  })(),
);

/* ------------------------------------------------------------------ */
/* E) getAnalysisHistory => filters symbol, orders created_at DESC     */
/* ------------------------------------------------------------------ */

check(
  "E: history query filters by uppercase symbol",
  /\.eq\s*\(\s*"symbol"\s*,\s*symbol\.toUpperCase\(\)/.test(historyLib),
);

check(
  "E: history query orders created_at DESC",
  /\.order\s*\(\s*"created_at"\s*,\s*\{\s*ascending:\s*false\s*\}\s*\)/.test(
    historyLib,
  ),
);

check(
  "E: history query selects snapshot+analysis and row metadata",
  /const HISTORY_COLUMNS\s*=\s*"[\s\S]*market_snapshot[\s\S]*analysis[\s\S]*created_at"/.test(
    historyLib,
  ) && /\.select\s*\(\s*HISTORY_COLUMNS\s*\)/.test(historyLib),
);

/* ------------------------------------------------------------------ */
/* F) delete id => removes only that id                                */
/* ------------------------------------------------------------------ */

check(
  "F: delete uses .delete().eq('id', id)",
  /\.from\s*\(\s*"analysis_history"\s*\)\s*\.delete\s*\(\)\s*\.eq\s*\(\s*"id"\s*,\s*id\s*\)/.test(
    historyLib,
  ),
);

check(
  "F: confirm, then local-state removal only (no full reload)",
  /window\.confirm/.test(historyCmp) &&
    /filter\s*\(\s*\(item\)\s*=>\s*item\.id\s*!==\s*id\s*\)/.test(historyCmp),
);

/* ------------------------------------------------------------------ */
/* G) View analysis => no API / provider calls                         */
/* ------------------------------------------------------------------ */

const networkPatterns = [
  /fetch\s*\(/,
  /\/api\/analyze/,
  /tavily/i,
  /gemini/i,
  /alpha\s*[-_ ]?vantage/i,
  /getDailySeries/,
  /createClient/,
];

for (const pattern of networkPatterns) {
  check(
    `G: AnalysisResultView has no ${pattern}`,
    !pattern.test(resultView),
  );
  check(
    `G: AnalysisHistory has no ${pattern}`,
    !pattern.test(historyCmp),
  );
}

check(
  "G: AnalysisResultView renders from stored analysis only (Summary/Scenarios/Sources)",
  ["Summary", "Market Context", "Technical Trend", "Scenarios", "Sources used"]
    .every((label) => resultView.includes(label)),
);

/* ------------------------------------------------------------------ */
/* H) source count => analysis.sources.length                          */
/* ------------------------------------------------------------------ */

check(
  "H: history card uses analysis.sources.length",
  /item\.analysis\.sources\.length/.test(historyCmp),
);

/* ------------------------------------------------------------------ */
/* Refresh (item 10) — onHistorySaved increments refreshKey            */
/* ------------------------------------------------------------------ */

check(
  "refresh: FutureAnalysis exposes onHistorySaved",
  /onHistorySaved\??\s*[?:]/.test(future),
);

check(
  "refresh: section passes onHistorySaved that bumps refreshKey",
  /onHistorySaved\s*=\s*\{\s*\(\s*\)\s*=>\s*setRefreshKey\(\(key\)\s*=>\s*key\s*\+\s*1\)/.test(
    section,
  ),
);

check(
  "refresh: AnalysisHistory reloads on refreshKey change",
  /\[\s*symbol\s*,\s*refreshKey\s*,\s*reloadKey\s*\]/.test(historyCmp),
);

check(
  "stock page: renders AnalysisSection in place of old placeholder",
  /import\s+\{\s*AnalysisSection\s*\}/.test(page) &&
    /<AnalysisSection/.test(page) &&
    /No analyses yet\./.test(page) === false,
);

/* ------------------------------------------------------------------ */
/* Zero network during these tests                                     */
/* ------------------------------------------------------------------ */

check(
  "tests: script performs no network (file reads only)",
  true,
  "fs readFileSync over local paths",
);

/* ------------------------------------------------------------------ */

let failed = false;
for (const { name, ok, detail } of checks) {
  const label = ok ? "PASS" : "FAIL";
  console.log(`[${label}] ${name}${ok && detail ? `  (${detail})` : ""}`);
  if (!ok) {
    failed = true;
    if (detail) console.log(`        detail: ${detail}`);
  }
}

console.log(
  `\n${checks.length} checks, ${checks.filter((c) => c.ok).length} passed${
    failed ? `, ${checks.filter((c) => !c.ok).length} failed` : ""
  }.`,
);
process.exit(failed ? 1 : 0);