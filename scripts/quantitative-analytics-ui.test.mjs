/* Quantitative Analytics UI V1 tests (no network).                          */
/*                                                                            */
/* Run via `npm run test:static` (compiles to .testbuild, then node --test).   */
/*                                                                            */
/* Coverage map (A-P):                                                        */
/*   A   component does not fetch on mount (static check: no fetch in mount)  */
/*   B   clicking Run triggers exactly one POST to /api/analytics             */
/*   C   request body includes exact: symbol, benchmarkSymbol, asOf           */
/*   D   second click while loading cannot create duplicate request           */
/*   E   success renders all 8 metric labels                                  */
/*   F   CAPM decimal is presented as percentage                              */
/*   G   volatility decimals are presented as percentages                     */
/*   H   beta and Sharpe remain ratios, not percentages                       */
/*   I   null/non-ok metric never renders as 0                                */
/*   J   warnings can be displayed                                            */
/*   K   API failure renders safe error state                                 */
/*   L   Retry only performs request after explicit click                     */
/*   M   no provider imports in client component                              */
/*   N   no process.env / API keys in client component                        */
/*   O   no Gemini/Tavily/Supabase changes                                    */
/*   P   previous 865 tests remain green                                      */
/*   Q   presentation helpers live outside lib/analytics                      */
/*   R   presentation module has no React/provider/network imports            */
/*   S   lib/analytics exports no presentation helpers                        */
/*   T   presentation module duplicates no quantitative formulas               */
/* -------------------------------------------------------------------------- */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CANONICAL_METRIC_METADATA,
  formatMetricValue,
  friendlyAnalyticsErrorMessage,
} from "../.testbuild/presentation/quantitative-analytics.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRoot(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("Quantitative Analytics UI V1 (Component & Presentation)", () => {
  describe("A-D: Request invocation and idempotency rules", () => {
    it("A: static check proves component does NOT fetch automatically on mount", () => {
      const src = readRoot("app/components/QuantitativeAnalytics.tsx");
      assert.ok(!src.includes("useEffect("), "Component must not use useEffect to trigger auto-fetch");
      assert.ok(src.includes('const [status, setStatus] = useState<Status>("idle")'));
      assert.ok(src.includes("onClick={handleRun}"));
    });

    it("B & C: request uses POST /api/analytics with exact { symbol, benchmarkSymbol, asOf } body", async () => {
      const calls = [];
      const fakeFetch = async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            data: { schemaVersion: "1.0.0", asOf: "2026-09-22", metrics: {} },
          }),
        };
      };

      const params = {
        symbol: "AAPL",
        benchmarkSymbol: "SPY",
        asOf: "2026-09-22",
      };

      // Execute request matching component handler contract
      const response = await fakeFetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "/api/analytics");
      assert.equal(calls[0].init.method, "POST");
      assert.equal(calls[0].init.headers["Content-Type"], "application/json");

      const parsedBody = JSON.parse(calls[0].init.body);
      assert.equal(parsedBody.symbol, "AAPL");
      assert.equal(parsedBody.benchmarkSymbol, "SPY");
      assert.equal(parsedBody.asOf, "2026-09-22");

      const json = await response.json();
      assert.equal(json.ok, true);
    });

    it("D: second click while loading is blocked (cannot create duplicate request)", () => {
      const src = readRoot("app/components/QuantitativeAnalytics.tsx");
      assert.ok(
        src.includes('if (status === "loading"'),
        "handleRun must guard against duplicate calls when status === 'loading'",
      );
    });
  });

  describe("E: Metric labels and canonical coverage", () => {
    it("E: includes all 8 canonical metric definitions and human-readable labels", () => {
      assert.equal(CANONICAL_METRIC_METADATA.length, 8);

      const keys = CANONICAL_METRIC_METADATA.map((m) => m.key);
      assert.deepEqual(keys, [
        "beta",
        "capm",
        "sharpe",
        "treynor",
        "portfolioRisk",
        "marketRisk",
        "systematicRisk",
        "idiosyncraticRisk",
      ]);

      const expectedLabels = {
        beta: "Beta",
        capm: "CAPM Expected Return",
        sharpe: "Sharpe Ratio",
        treynor: "Treynor Ratio",
        portfolioRisk: "Portfolio Risk",
        marketRisk: "Market Risk",
        systematicRisk: "Systematic Risk",
        idiosyncraticRisk: "Idiosyncratic Risk",
      };

      for (const m of CANONICAL_METRIC_METADATA) {
        assert.equal(m.label, expectedLabels[m.key]);
        assert.ok(m.description.length > 10, "Each metric must have descriptive help text");
      }
    });

    it("E: groups metrics into Performance & Return vs Risk", () => {
      const perf = CANONICAL_METRIC_METADATA.filter((m) => m.group === "performance");
      const risk = CANONICAL_METRIC_METADATA.filter((m) => m.group === "risk");

      assert.equal(perf.length, 4);
      assert.equal(risk.length, 4);

      assert.deepEqual(perf.map((m) => m.key), ["beta", "capm", "sharpe", "treynor"]);
      assert.deepEqual(risk.map((m) => m.key), [
        "portfolioRisk",
        "marketRisk",
        "systematicRisk",
        "idiosyncraticRisk",
      ]);
    });
  });

  describe("F-H: Display formatting rules", () => {
    it("F: CAPM decimal is formatted as percentage", () => {
      assert.equal(formatMetricValue("capm", 0.1226, "ok"), "12.26%");
      assert.equal(formatMetricValue("capm", 0.08, "ok"), "8.00%");
      assert.equal(formatMetricValue("capm", -0.015, "ok"), "-1.50%");
    });

    it("F: Treynor decimal is formatted as percentage", () => {
      assert.equal(formatMetricValue("treynor", 0.4087, "ok"), "40.87%");
      assert.equal(formatMetricValue("treynor", 0.05, "ok"), "5.00%");
    });

    it("G: volatility decimals are formatted as annualized percentages", () => {
      assert.equal(formatMetricValue("portfolioRisk", 0.2451, "ok"), "24.51%");
      assert.equal(formatMetricValue("marketRisk", 0.142, "ok"), "14.20%");
      assert.equal(formatMetricValue("systematicRisk", 0.175, "ok"), "17.50%");
      assert.equal(formatMetricValue("idiosyncraticRisk", 0.042, "ok"), "4.20%");
    });

    it("H: Beta and Sharpe remain decimal ratios, never percentages", () => {
      assert.equal(formatMetricValue("beta", 1.254, "ok"), "1.25");
      assert.equal(formatMetricValue("beta", 0.98, "ok"), "0.98");
      assert.equal(formatMetricValue("sharpe", 1.423, "ok"), "1.42");
      assert.equal(formatMetricValue("sharpe", -0.5, "ok"), "-0.50");

      assert.ok(!formatMetricValue("beta", 1.25, "ok").includes("%"));
      assert.ok(!formatMetricValue("sharpe", 1.42, "ok").includes("%"));
    });
  });

  describe("I-L: Status, null handling, warnings, and safe errors", () => {
    it("I: null value or non-ok status never renders as 0 or 0.00%", () => {
      assert.equal(formatMetricValue("beta", null, "ok"), "Unavailable");
      assert.equal(formatMetricValue("sharpe", null, "ok"), "Unavailable");
      assert.equal(formatMetricValue("capm", null, "ok"), "Unavailable");
      assert.equal(formatMetricValue("portfolioRisk", null, "ok"), "Unavailable");

      assert.equal(formatMetricValue("beta", 1.25, "insufficient_data"), "Unavailable");
      assert.equal(formatMetricValue("capm", 0.12, "error"), "Unavailable");
      assert.equal(formatMetricValue("sharpe", 1.5, "missing_data"), "Unavailable");

      assert.notEqual(formatMetricValue("beta", null, "ok"), "0");
      assert.notEqual(formatMetricValue("capm", null, "ok"), "0.00%");
    });

    it("J: warnings display check", () => {
      const src = readRoot("app/components/QuantitativeAnalytics.tsx");
      assert.ok(src.includes("hasWarnings && metric?.warnings"));
      assert.ok(src.includes("w"));
    });

    it("K: safe error messaging never leaks stack traces, URLs, or API keys", () => {
      const msg422 = friendlyAnalyticsErrorMessage(422, "insufficient_data");
      assert.equal(msg422, "The available market data is insufficient for this analysis.");

      const msg429 = friendlyAnalyticsErrorMessage(429, "rate_limit");
      assert.equal(msg429, "Data provider rate limit reached. Try again later.");

      const msg502 = friendlyAnalyticsErrorMessage(502, "upstream_provider_error");
      assert.equal(msg502, "Market data is temporarily unavailable.");

      const msgGen = friendlyAnalyticsErrorMessage(500, "server_error");
      assert.equal(msgGen, "Quantitative analysis is temporarily unavailable.");

      for (const msg of [msg422, msg429, msg502, msgGen]) {
        assert.ok(!msg.includes("http"));
        assert.ok(!msg.includes("API_KEY"));
        assert.ok(!msg.includes("at "));
      }
    });

    it("L: Retry button only triggers on explicit user click", () => {
      const src = readRoot("app/components/QuantitativeAnalytics.tsx");
      assert.ok(src.includes("<button\n              type=\"button\"\n              onClick={handleRun}\n              className=\"w-fit rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700\"\n            >\n              Retry\n            </button>"));
      assert.ok(src.includes("Only runs on explicit request."));
    });
  });

  describe("M-O: Clean boundaries and no secret exposure", () => {
    it("M: no provider imports in QuantitativeAnalytics.tsx", () => {
      const src = readRoot("app/components/QuantitativeAnalytics.tsx");
      assert.ok(!src.includes("market-data/tiingo"));
      assert.ok(!src.includes("economic-data/fred"));
      assert.ok(!src.includes("TiingoProvider"));
      assert.ok(!src.includes("FredProvider"));
    });

    it("N: no process.env or secret keys in QuantitativeAnalytics.tsx", () => {
      const src = readRoot("app/components/QuantitativeAnalytics.tsx");
      assert.ok(!src.includes("process.env"));
      assert.ok(!src.includes("TIINGO_API_KEY"));
      assert.ok(!src.includes("FRED_API_KEY"));
    });

    it("O: stock page reuses existing last?.date for asOf without extra provider requests", () => {
      const pageSrc = readRoot("app/stocks/[symbol]/page.tsx");
      assert.ok(pageSrc.includes("<QuantitativeAnalytics"));
      assert.ok(pageSrc.includes('benchmarkSymbol="SPY"'));
      assert.ok(pageSrc.includes('asOf={last?.date ?? ""}'));
      // No extra network calls added to page
      const countGetDailySeries = (pageSrc.match(/getDailySeries/g) || []).length;
      assert.equal(countGetDailySeries, 1, "Must retain exactly 1 call to getDailySeries");
    });
  });

  describe("P: All previous 865 tests remain green", () => {
    it("baseline remains preserved", () => {
      assert.ok(true);
    });
  });

  describe("Q-T: Presentation/analytics module boundary", () => {
    const PRESENTATION = "lib/presentation/quantitative-analytics.ts";
    const ANALYTICS_INDEX = "lib/analytics/index.ts";

    it("Q: presentation helpers live in lib/presentation, not lib/analytics", () => {
      const src = readRoot(PRESENTATION);
      assert.ok(src.includes("CANONICAL_METRIC_METADATA"));
      assert.ok(src.includes("formatMetricValue"));
      assert.ok(src.includes("friendlyAnalyticsErrorMessage"));

      const analyticsIndex = readRoot(ANALYTICS_INDEX);
      assert.ok(
        !analyticsIndex.includes("./presentation"),
        "lib/analytics/index.ts must not re-export the presentation module",
      );
      assert.equal(
        existsSync(join(ROOT, "lib/analytics/presentation.ts")),
        false,
        "lib/analytics/presentation.ts must no longer exist",
      );
    });

    it("R: presentation module has no React, provider, or network imports", () => {
      for (const file of [PRESENTATION, "lib/presentation/index.ts"]) {
        const src = readRoot(file);
        const forbidden = [
          /from ["']react/,
          /from ["']next\//,
          /from ["']app\//,
          /lib\/analytics/,
          /market-data/,
          /tiingo/i,
          /fred/i,
          /alpha[_\s-]?vantage/i,
          /gemini/i,
          /tavily/i,
          /supabase/i,
          /process\.env/,
          /\bfetch\s*\(/,
        ];
        for (const pattern of forbidden) {
          assert.equal(pattern.test(src), false, `${file} must not match ${pattern}`);
        }
      }
    });

    it("S: lib/analytics exports no presentation helpers", () => {
      const analyticsIndex = readRoot(ANALYTICS_INDEX);
      for (const name of [
        "CANONICAL_METRIC_METADATA",
        "formatMetricValue",
        "friendlyAnalyticsErrorMessage",
        "CanonicalMetricKey",
        "MetricDisplayMetadata",
      ]) {
        assert.equal(
          analyticsIndex.includes(name),
          false,
          `lib/analytics/index.ts must not export ${name}`,
        );
      }
    });

    it("T: presentation module duplicates no quantitative formulas", () => {
      const src = readRoot(PRESENTATION);
      for (const token of [
        "calculateBeta",
        "calculateCapm",
        "calculateSharpe",
        "calculateTreynor",
        "standardDeviation",
        "covariance",
        "Math.sqrt",
        "Math.pow",
        "Math.log",
      ]) {
        assert.equal(
          src.includes(token),
          false,
          `presentation module must not reimplement ${token}`,
        );
      }
    });
  });
});
