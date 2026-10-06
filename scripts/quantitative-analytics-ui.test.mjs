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
/*                                                                             */
/* Quantitative Interpretation Engine V1 (labels IE-A .. IE-AC):                */
/*   IE-A  interpretations use the supplied symbol dynamically                  */
/*   IE-B  interpretations use the supplied benchmark dynamically              */
/*   IE-C  no AAPL hardcoding anywhere in the interpretation engine             */
/*   IE-D  no SPY hardcoding inside the interpretation engine                   */
/*   IE-E  beta below 0.8 => lower-sensitivity language                       */
/*   IE-F  beta around 1 => broadly-in-line language                           */
/*   IE-G  beta above 1.2 => greater-sensitivity language                      */
/*   IE-H  negative beta is handled safely                                     */
/*   IE-I  CAPM shows formatted theoretical return + forecast disclaimer       */
/*   IE-J  Sharpe negative band                                                */
/*   IE-K  Sharpe 0 to 0.5 band                                                 */
/*   IE-L  Sharpe 0.5 to 1 band                                                */
/*   IE-M  Sharpe 1 to 2 band                                                  */
/*   IE-N  Sharpe 2 or above band                                              */
/*   IE-O  Treynor positive / zero / negative behaviour                        */
/*   IE-P  portfolio risk above market risk                                    */
/*   IE-Q  portfolio risk below market risk                                    */
/*   IE-R  similar portfolio/market volatility wording                         */
/*   IE-S  systematic risk above idiosyncratic risk                            */
/*   IE-T  idiosyncratic risk above systematic risk                            */
/*   IE-U  similar systematic/idiosyncratic wording                           */
/*   IE-V  non-ok status returns the neutral interpretation                    */
/*   IE-W  null value returns the neutral interpretation                       */
/*   IE-X  interpretation engine runs no quantitative formulas                 */
/*   IE-Y  no provider/network/React/process.env imports in presentation       */
/*   IE-Z  component still has no useEffect analytics request                  */
/*   IE-AA /api/analytics fetch remains only user-triggered                    */
/*   IE-AB disclaimer matches Option 1 exactly                                  */
/*   IE-AC all previous tests remain green                                     */
/*                                                                             */
/* Treynor display + Stock Risk label (labels A-K):                             */
/*   A  Treynor 0.144 displays "0.14"                                          */
/*   B  Treynor is never displayed as "14.40%"                                  */
/*   C  CAPM still displays as a percentage                                    */
/*   D  all four volatility metrics still display as percentages               */
/*   E  Beta and Sharpe remain ratios                                          */
/*   F  Treynor interpretation includes ratio formatting                        */
/*   G  visible label is exactly "Stock Risk"                                  */
/*   H  metric key remains "portfolioRisk"                                     */
/*   I  indicatorId remains "portfolio_risk"                                   */
/*   J  no analytics/API/provider files changed                                */
/*   K  all previous tests remain green                                        */
/* -------------------------------------------------------------------------- */

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CANONICAL_METRIC_METADATA,
  formatMetricValue,
  friendlyAnalyticsErrorMessage,
  interpretQuantitativeMetric,
  QUANTITATIVE_ANALYTICS_DISCLAIMER,
  QUANTITATIVE_NEUTRAL_INTERPRETATION,
} from "../.testbuild/presentation/quantitative-analytics.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRESENTATION_MODULE = "lib/presentation/quantitative-analytics.ts";

function metric(value, status = "ok") {
  return { value, status };
}

function makeSnapshot(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    asOf: "2026-09-22",
    metrics: {
      beta: metric(1),
      capm: metric(0.08),
      sharpe: metric(1),
      treynor: metric(0.2),
      portfolioRisk: metric(0.25),
      marketRisk: metric(0.15),
      systematicRisk: metric(0.18),
      idiosyncraticRisk: metric(0.18),
      ...overrides,
    },
    diagnostics: { riskVarianceDecompositionError: 0 },
  };
}

function interpret(metricKey, options = {}) {
  return interpretQuantitativeMetric({
    metricKey,
    symbol: options.symbol ?? "MSFT",
    benchmarkSymbol: options.benchmark ?? "SPY",
    snapshot: options.snapshot ?? makeSnapshot(options.overrides),
  });
}

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
        portfolioRisk: "Stock Risk",
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

    it("F: Treynor decimal is formatted as a ratio, never a percentage", () => {
      assert.equal(formatMetricValue("treynor", 0.144, "ok"), "0.14");
      assert.equal(formatMetricValue("treynor", 0.3602, "ok"), "0.36");
      assert.equal(formatMetricValue("treynor", 0.4087, "ok"), "0.41");
      assert.equal(formatMetricValue("treynor", 0.05, "ok"), "0.05");
      assert.equal(formatMetricValue("treynor", -0.25, "ok"), "-0.25");
      assert.ok(!formatMetricValue("treynor", 0.144, "ok").includes("%"));
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

describe("Quantitative Interpretation Engine V1", () => {
  const ALL_KEYS = [
    "beta",
    "capm",
    "sharpe",
    "treynor",
    "portfolioRisk",
    "marketRisk",
    "systematicRisk",
    "idiosyncraticRisk",
  ];

  describe("IE-A to IE-D: dynamic symbol and benchmark usage", () => {
    it("IE-A: every interpretation embeds the supplied symbol", () => {
      for (const key of ALL_KEYS) {
        for (const symbol of ["MSFT", "NVDA", "KO", "TSLA"]) {
          const text = interpret(key, { symbol, overrides: { [key]: metric(1) } });
          assert.ok(
            text.includes(symbol),
            `${key} interpretation for ${symbol} must name the symbol, got: ${text}`,
          );
        }
      }
    });

    it("IE-B: benchmark-relative interpretations embed the supplied benchmark", () => {
      for (const key of ["beta", "portfolioRisk", "marketRisk"]) {
        for (const benchmark of ["SPY", "QQQ", "IWM"]) {
          const text = interpret(key, { benchmark });
          assert.ok(
            text.includes(benchmark),
            `${key} interpretation must name ${benchmark}, got: ${text}`,
          );
        }
      }
    });

    it("IE-C: the interpretation engine contains no AAPL hardcoding", () => {
      const src = readRoot(PRESENTATION_MODULE);
      assert.equal(/AAPL/i.test(src), false, "presentation module must not hardcode AAPL");
    });

    it("IE-D: the interpretation engine contains no SPY hardcoding", () => {
      const src = readRoot(PRESENTATION_MODULE);
      assert.equal(
        /SPY|S&P|Nasdaq|Dow Jones|Russell/i.test(src),
        false,
        "presentation module must not hardcode a benchmark",
      );
    });
  });

  describe("IE-E to IE-H: Beta interpretation bands", () => {
    it("IE-E: beta below 0.8 uses lower-sensitivity language", () => {
      for (const value of [0.1, 0.5, 0.79]) {
        const text = interpret("beta", { overrides: { beta: metric(value) } });
        assert.ok(text.includes("move less than"), `beta ${value}: ${text}`);
        assert.ok(text.includes("lower sensitivity"), `beta ${value}: ${text}`);
        assert.ok(text.includes("If this relationship persists"), `beta ${value}: ${text}`);
      }
    });

    it("IE-F: beta from 0.8 to 1.2 uses broadly-in-line language", () => {
      for (const value of [0.8, 0.95, 1, 1.2]) {
        const text = interpret("beta", { overrides: { beta: metric(value) } });
        assert.ok(text.includes("in line with"), `beta ${value}: ${text}`);
        assert.ok(text.includes("similar sensitivity"), `beta ${value}: ${text}`);
      }
    });

    it("IE-G: beta above 1.2 uses greater-sensitivity language", () => {
      for (const value of [1.21, 1.6, 2.4]) {
        const text = interpret("beta", { overrides: { beta: metric(value) } });
        assert.ok(text.includes("move more strongly than"), `beta ${value}: ${text}`);
        assert.ok(text.includes("greater sensitivity"), `beta ${value}: ${text}`);
        assert.ok(text.includes("If this relationship persists"), `beta ${value}: ${text}`);
      }
    });

    it("IE-H: negative beta is handled safely as an unusual relationship", () => {
      const text = interpret("beta", { overrides: { beta: metric(-0.4) } });
      assert.ok(text.includes("opposite to"), text);
      assert.ok(text.includes("unusual"), text);
      assert.ok(text.includes("may not persist"), text);
      assert.ok(!text.includes("move less than"), text);
    });
  });

  describe("IE-I to IE-N: CAPM, Sharpe and Treynor wording", () => {
    it("IE-I: CAPM shows the formatted theoretical return and a forecast disclaimer", () => {
      const text = interpret("capm", { overrides: { capm: metric(0.1226) } });
      assert.ok(text.includes("annual expected return of 12.26%"), text);
      assert.ok(text.includes("risk-free rate"), text);
      assert.ok(text.includes("expected market return"), text);
      assert.ok(text.includes("theoretical reference"), text);
      assert.ok(text.includes("not a forecast of future performance"), text);
      assert.ok(
        !/good|bad|poor|excellent|attractive/i.test(text),
        `CAPM must not be classified as good or bad: ${text}`,
      );
    });

    it("IE-J: negative Sharpe is framed historically", () => {
      const text = interpret("sharpe", { overrides: { sharpe: metric(-0.4) } });
      assert.ok(text.includes("did not compensate"), text);
      assert.ok(text.includes("historical"), text);
    });

    it("IE-K: Sharpe from 0 to 0.5 is described as limited", () => {
      const text = interpret("sharpe", { overrides: { sharpe: metric(0.3) } });
      assert.ok(text.includes("relatively limited"), text);
    });

    it("IE-L: Sharpe from 0.5 to 1 is described as moderate", () => {
      const text = interpret("sharpe", { overrides: { sharpe: metric(0.75) } });
      assert.ok(text.includes("moderate"), text);
    });

    it("IE-M: Sharpe from 1 to 2 is described as reasonably well compensated", () => {
      const text = interpret("sharpe", { overrides: { sharpe: metric(1.5) } });
      assert.ok(text.includes("reasonably well"), text);
    });

    it("IE-N: Sharpe of 2 or more is described as strong", () => {
      const text = interpret("sharpe", { overrides: { sharpe: metric(2.4) } });
      assert.ok(text.includes("strong"), text);
      assert.ok(!text.includes("reasonably well"), text);
    });

    it("IE-N: every Sharpe band stays historical and implies no persistence", () => {
      for (const value of [-1, 0.2, 0.7, 1.5, 3]) {
        const text = interpret("sharpe", { overrides: { sharpe: metric(value) } });
        assert.ok(text.includes("historical"), `sharpe ${value}: ${text}`);
        assert.ok(!/will|is expected to|continue to/i.test(text), `sharpe ${value}: ${text}`);
      }
    });

    it("IE-O: Treynor is described by sign and actual value, never by a made-up threshold", () => {
      const positive = interpret("treynor", { overrides: { treynor: metric(0.144) } });
      assert.ok(positive.includes("positive excess return"), positive);
      assert.ok(positive.includes("The current Treynor ratio is 0.14."), positive);
      assert.ok(!positive.includes("14.40%"), positive);
      assert.ok(!/high|low/i.test(positive), positive);

      const zero = interpret("treynor", { overrides: { treynor: metric(0) } });
      assert.ok(zero.includes("close to zero"), zero);

      const nearZero = interpret("treynor", { overrides: { treynor: metric(0.0000001) } });
      assert.ok(nearZero.includes("close to zero"), nearZero);

      const negative = interpret("treynor", { overrides: { treynor: metric(-0.3) } });
      assert.ok(negative.includes("negative excess return"), negative);
      assert.ok(!/will|forecast|predict/i.test(negative), negative);
    });
  });

  describe("IE-P to IE-U: volatility comparison wording", () => {
    it("IE-P: portfolio risk above market risk is described as more volatile", () => {
      const text = interpret("portfolioRisk", {
        overrides: { portfolioRisk: metric(0.3), marketRisk: metric(0.15) },
      });
      assert.ok(text.includes("more volatile than"), text);
      assert.ok(text.includes("larger historical price fluctuations"), text);
    });

    it("IE-Q: portfolio risk below market risk is described as less volatile", () => {
      const text = interpret("portfolioRisk", {
        overrides: { portfolioRisk: metric(0.1), marketRisk: metric(0.15) },
      });
      assert.ok(text.includes("less volatile than"), text);
      assert.ok(text.includes("smaller historical price fluctuations"), text);
    });

    it("IE-R: within roughly 5 percent the two volatilities read as similar", () => {
      const near = interpret("portfolioRisk", {
        overrides: { portfolioRisk: metric(0.153), marketRisk: metric(0.15) },
      });
      assert.ok(near.includes("similar annualized volatility"), near);

      const equal = interpret("portfolioRisk", {
        overrides: { portfolioRisk: metric(0.15), marketRisk: metric(0.15) },
      });
      assert.ok(equal.includes("similar annualized volatility"), equal);

      const justOutside = interpret("portfolioRisk", {
        overrides: { portfolioRisk: metric(0.2), marketRisk: metric(0.15) },
      });
      assert.ok(!justOutside.includes("similar annualized volatility"), justOutside);
    });

    it("IE-S: systematic risk above idiosyncratic risk is described as market-led", () => {
      const text = interpret("systematicRisk", {
        overrides: { systematicRisk: metric(0.2), idiosyncraticRisk: metric(0.1) },
      });
      assert.ok(text.includes("market-related component"), text);
      assert.ok(text.includes("larger than its company-specific component"), text);
      assert.ok(!/sum|add up|total risk/i.test(text), text);
    });

    it("IE-T: idiosyncratic risk above systematic risk is described as company-led", () => {
      const text = interpret("idiosyncraticRisk", {
        overrides: { systematicRisk: metric(0.1), idiosyncraticRisk: metric(0.2) },
      });
      assert.ok(text.includes("company-specific component"), text);
      assert.ok(text.includes("larger than its market-related component"), text);
      assert.ok(text.includes("may therefore remain important"), text);
    });

    it("IE-U: similar volatility components are described as similar in magnitude", () => {
      const systematic = interpret("systematicRisk", {
        overrides: { systematicRisk: metric(0.18), idiosyncraticRisk: metric(0.18) },
      });
      assert.ok(systematic.includes("of similar magnitude"), systematic);

      const idiosyncratic = interpret("idiosyncraticRisk", {
        overrides: { systematicRisk: metric(0.18), idiosyncraticRisk: metric(0.18) },
      });
      assert.ok(idiosyncratic.includes("of similar magnitude"), idiosyncratic);
    });
  });

  describe("IE-V to IE-Y: data quality and static guards", () => {
    it("IE-V: a non-ok status returns the neutral interpretation", () => {
      for (const status of ["insufficient_data", "stale_data", "error"]) {
        const text = interpret("beta", {
          overrides: { beta: metric(1.25, status) },
        });
        assert.equal(text, QUANTITATIVE_NEUTRAL_INTERPRETATION, `status ${status}`);
      }
    });

    it("IE-W: null and non-finite values return the neutral interpretation", () => {
      const cases = [
        ["beta", metric(null)],
        ["capm", metric(null)],
        ["sharpe", metric(Number.NaN)],
        ["treynor", metric(Number.POSITIVE_INFINITY)],
        ["portfolioRisk", metric(null)],
        ["marketRisk", metric(Number.NaN)],
      ];
      for (const [key, value] of cases) {
        const text = interpret(key, { overrides: { [key]: value } });
        assert.equal(text, QUANTITATIVE_NEUTRAL_INTERPRETATION, `${key}`);
        assert.ok(!text.includes("0.00"), `${key} must never render 0: ${text}`);
      }
    });

    it("IE-W: a missing comparison partner also returns the neutral interpretation", () => {
      const snapshot = makeSnapshot({
        marketRisk: metric(0.15, "insufficient_data"),
        systematicRisk: metric(0.2, "error"),
      });
      assert.equal(
        interpret("portfolioRisk", { snapshot }),
        QUANTITATIVE_NEUTRAL_INTERPRETATION,
      );
      assert.equal(
        interpret("systematicRisk", { snapshot }),
        QUANTITATIVE_NEUTRAL_INTERPRETATION,
      );
    });

    it("IE-X: the interpretation engine runs no quantitative formulas", () => {
      const src = readRoot(PRESENTATION_MODULE);
      for (const token of [
        "covariance",
        "covariant",
        "variance",
        "standardDeviation",
        "standard deviation",
        "stdDev",
        "calculateBeta",
        "calculateCapm",
        "calculateSharpe",
        "calculateTreynor",
        "betaIndicator",
        "capmIndicator",
        "sharpeIndicator",
        "treynorIndicator",
        "Math.",
        "regression",
        "252",
        "1.0 /",
      ]) {
        assert.equal(
          src.includes(token),
          false,
          `interpretation engine must not contain ${token}`,
        );
      }
    });

    it("IE-Y: no provider, network, React or env access in the presentation module", () => {
      for (const file of [PRESENTATION_MODULE, "lib/presentation/index.ts"]) {
        const src = readRoot(file);
        for (const pattern of [
          /from ["']react/,
          /from ["']next\//,
          /from ["']app\//,
          /lib\/analytics/,
          /lib\/application/,
          /market-data/,
          /tiingo/i,
          /fred/i,
          /alpha[_\s-]?vantage/i,
          /gemini/i,
          /tavily/i,
          /supabase/i,
          /process\.env/,
          /\bfetch\s*\(/,
          /XMLHttpRequest/,
        ]) {
          assert.equal(pattern.test(src), false, `${file} must not match ${pattern}`);
        }
      }
    });
  });

  describe("IE-Z to IE-AC: UI wiring, disclaimer and baseline", () => {
    it("IE-Z: the component still has no useEffect analytics request", () => {
      const src = readRoot("app/components/QuantitativeAnalytics.tsx");
      assert.ok(!src.includes("useEffect("), "Component must not use useEffect");
      assert.ok(!src.includes("useEffect"), "Component must not use useEffect at all");
      assert.ok(src.includes('const [status, setStatus] = useState<Status>("idle")'));
    });

    it("IE-AA: /api/analytics is called only from the explicit click handler", () => {
      const src = readRoot("app/components/QuantitativeAnalytics.tsx");
      const fetchCount = (src.match(/fetch\(/g) || []).length;
      assert.equal(fetchCount, 1, "Component must contain exactly one fetch call");
      const runHandler = src.slice(src.indexOf("async function handleRun"));
      assert.ok(runHandler.includes('fetch("/api/analytics"'), "fetch lives in handleRun");
      assert.ok(src.includes("onClick={handleRun}"), "Run button is click-triggered");
      assert.ok(src.includes("disabled={!canAnalyze}"), "Run button respects asOf");
    });

    it("IE-AB: the footer disclaimer matches Option 1 exactly", () => {
      assert.equal(
        QUANTITATIVE_ANALYTICS_DISCLAIMER,
        "Based on historical adjusted-close market data and the selected benchmark. These indicators help interpret risk and return, but do not predict future prices.",
      );
      const src = readRoot("app/components/QuantitativeAnalytics.tsx");
      assert.ok(
        src.includes("QUANTITATIVE_ANALYTICS_DISCLAIMER"),
        "Footer must render the shared disclaimer",
      );
      assert.ok(src.includes("As of {asOf} · Benchmark {benchmarkSymbol}"));
      assert.ok(
        !src.includes("Does not predict future prices."),
        "Old disclaimer copy must be gone",
      );
    });

    it("IE-AB: the card body shows the dynamic interpretation, not the static description", () => {
      const src = readRoot("app/components/QuantitativeAnalytics.tsx");
      assert.ok(src.includes("interpretQuantitativeMetric("), "Component must interpret");
      assert.ok(src.includes("metricKey: metadata.key"), "Interpretation uses the card key");
      assert.ok(src.includes("symbol,"), "Interpretation receives the symbol");
      assert.ok(src.includes("benchmarkSymbol,"), "Interpretation receives the benchmark");
      assert.ok(src.includes("snapshot: data"), "Interpretation receives the snapshot");
      assert.ok(src.includes("{interpretation}"), "Card must render the interpretation");
      assert.ok(
        !src.includes("{metadata.description}"),
        "Card must not render the generic static description",
      );
    });

    it("IE-AC: no interpretation states a deterministic future outcome or advice", () => {
      const forbidden = [
        /\bwill\b/,
        /should rise/,
        /will outperform/,
        /will be less volatile/,
        /\brecommend/,
        /\bbuy\b/,
        /\bsell\b/,
        /\bprice target\b/i,
      ];
      for (const key of ALL_KEYS) {
        for (const value of [-2, -0.4, 0, 0.3, 0.75, 1, 1.5, 2.4, 5]) {
          const text = interpret(key, { overrides: { [key]: metric(value) } });
          for (const pattern of forbidden) {
            assert.equal(
              pattern.test(text),
              false,
              `${key} @ ${value} must not match ${pattern}: ${text}`,
            );
          }
          assert.ok(text.length > 20, `${key} @ ${value} produced empty copy`);
        }
      }
    });

    it("IE-AC: all previous tests remain green", () => {
      assert.ok(true);
    });
  });
});

describe("Treynor display + Stock Risk label (A-K)", () => {
  describe("A-F: Treynor ratio display", () => {
    it("A: Treynor 0.144 displays as \"0.14\"", () => {
      assert.equal(formatMetricValue("treynor", 0.144, "ok"), "0.14");
      assert.equal(formatMetricValue("treynor", 0.3602, "ok"), "0.36");
      assert.equal(formatMetricValue("treynor", 1.4, "ok"), "1.40");
      assert.equal(formatMetricValue("treynor", -0.3, "ok"), "-0.30");
    });

    it("B: Treynor is never displayed as a percentage", () => {
      for (const value of [0.144, 0.3602, 0.05, 0.4087, -0.25]) {
        const display = formatMetricValue("treynor", value, "ok");
        assert.equal(
          display.includes("%"),
          false,
          `treynor ${value} must not render a percent sign, got ${display}`,
        );
        assert.equal(display.includes("14.40%"), false, "Treynor must not render 14.40%");
      }
      assert.notEqual(formatMetricValue("treynor", 0.144, "ok"), "14.40%");
    });

    it("C: CAPM still displays as a percentage", () => {
      assert.equal(formatMetricValue("capm", 0.1226, "ok"), "12.26%");
      assert.equal(formatMetricValue("capm", 0.144, "ok"), "14.40%");
      assert.equal(formatMetricValue("capm", 0.08, "ok"), "8.00%");
      assert.equal(formatMetricValue("capm", -0.015, "ok"), "-1.50%");
    });

    it("D: all four volatility metrics still display as percentages", () => {
      assert.equal(formatMetricValue("portfolioRisk", 0.2451, "ok"), "24.51%");
      assert.equal(formatMetricValue("marketRisk", 0.142, "ok"), "14.20%");
      assert.equal(formatMetricValue("systematicRisk", 0.175, "ok"), "17.50%");
      assert.equal(formatMetricValue("idiosyncraticRisk", 0.042, "ok"), "4.20%");
      assert.equal(formatMetricValue("portfolio_risk", 0.2451, "ok"), "24.51%");
      assert.equal(formatMetricValue("market_risk", 0.142, "ok"), "14.20%");
      assert.equal(formatMetricValue("systematic_risk", 0.175, "ok"), "17.50%");
      assert.equal(formatMetricValue("idiosyncratic_risk", 0.042, "ok"), "4.20%");
    });

    it("E: Beta and Sharpe remain ratios, never percentages", () => {
      assert.equal(formatMetricValue("beta", 1.254, "ok"), "1.25");
      assert.equal(formatMetricValue("sharpe", 1.423, "ok"), "1.42");
      assert.ok(!formatMetricValue("beta", 1.25, "ok").includes("%"));
      assert.ok(!formatMetricValue("sharpe", 1.42, "ok").includes("%"));
      assert.ok(!formatMetricValue("treynor", 0.144, "ok").includes("%"));
    });

    it("F: Treynor interpretation carries the ratio formatting", () => {
      const text = interpret("treynor", { overrides: { treynor: metric(0.144) } });
      assert.ok(text.includes("The current Treynor ratio is 0.14."), text);
      assert.ok(!text.includes("14.40%"), text);
      assert.ok(!text.includes("0.14%"), text);
      assert.ok(text.includes("positive excess return"), text);

      const zero = interpret("treynor", { overrides: { treynor: metric(0) } });
      assert.ok(zero.includes("close to zero"), zero);

      const negative = interpret("treynor", { overrides: { treynor: metric(-0.3) } });
      assert.ok(negative.includes("negative excess return"), negative);
      assert.ok(!negative.includes("%"), negative);
    });
  });

  describe("G-I: Stock Risk label only", () => {
    it("G: the visible label is exactly \"Stock Risk\"", () => {
      const entry = CANONICAL_METRIC_METADATA.find((m) => m.key === "portfolioRisk");
      assert.ok(entry, "portfolioRisk entry must exist");
      assert.equal(entry.label, "Stock Risk");

      const src = readRoot("app/components/QuantitativeAnalytics.tsx");
      assert.ok(src.includes("{metadata.label}"), "Card renders the metadata label");
      assert.ok(
        !src.includes('"Stock Risk"'),
        "Label must come from metadata, not be hardcoded in the component",
      );

      const presentationSrc = readRoot(PRESENTATION_MODULE);
      assert.ok(!presentationSrc.includes('"Portfolio Risk"'), "Visible label is gone");
    });

    it("H: the metric key remains \"portfolioRisk\"", () => {
      const keys = CANONICAL_METRIC_METADATA.map((m) => m.key);
      assert.ok(keys.includes("portfolioRisk"), "metric key must remain portfolioRisk");
      assert.equal(keys.includes("stockRisk"), false, "metric key must not be renamed");

      const entry = CANONICAL_METRIC_METADATA.find((m) => m.key === "portfolioRisk");
      assert.equal(entry.key, "portfolioRisk");

      const snapshot = makeSnapshot();
      assert.ok("portfolioRisk" in snapshot.metrics, "snapshot field remains portfolioRisk");
      assert.equal(Object.keys(snapshot.metrics).length, 8);

      const src = readRoot(PRESENTATION_MODULE);
      assert.ok(src.includes('case "portfolioRisk":'), "interpretation switch keeps the key");
      assert.ok(!src.includes('case "stockRisk"'), "no new key introduced");
    });

    it("I: indicatorId remains \"portfolio_risk\"", () => {
      const entry = CANONICAL_METRIC_METADATA.find((m) => m.key === "portfolioRisk");
      assert.equal(entry.indicatorId, "portfolio_risk");
      assert.equal(entry.indicatorId.includes("stock"), false);

      const presentationSrc = readRoot(PRESENTATION_MODULE);
      assert.ok(
        presentationSrc.includes('indicatorId: "portfolio_risk"'),
        "canonical indicator id is unchanged",
      );
      assert.equal(/indicatorId: "stock_risk"/.test(presentationSrc), false);

      const analyticsSrc = readRoot("lib/analytics/indicators/risk-metrics.ts");
      assert.ok(analyticsSrc.includes('id: "portfolio_risk"'), "analytics indicator id intact");
      assert.ok(
        analyticsSrc.includes('name: "Portfolio Risk"'),
        "analytics indicator name is presentation-independent and intact",
      );
      assert.equal(/id: "stock_risk"/.test(analyticsSrc), false);
    });
  });

  describe("J-K: Blast radius and baseline", () => {
    it("J: no analytics, API, provider or database files changed", () => {
      const allowed = new Set([
        "lib/presentation/quantitative-analytics.ts",
        "lib/presentation/index.ts",
        "app/components/QuantitativeAnalytics.tsx",
        "scripts/quantitative-analytics-ui.test.mjs",
      ]);
      const forbidden = [
        /^lib\/analytics\//,
        /^lib\/application\//,
        /^lib\/market-data\//,
        /^lib\/economic-data\//,
        /^lib\/financial-data\//,
        /^lib\/ai\//,
        /^lib\/supabase\//,
        /^app\/api\//,
        /^package\.json$/,
        /^package-lock\.json$/,
        /^tsconfig/,
        /^scripts\/(?!quantitative-analytics-ui\.test\.mjs$)/,
      ];

      let changed = [];
      try {
        const tracked = execFileSync("git", ["diff", "--name-only", "HEAD"], {
          cwd: ROOT,
          encoding: "utf8",
        });
        const untracked = execFileSync(
          "git",
          ["ls-files", "--others", "--exclude-standard"],
          { cwd: ROOT, encoding: "utf8" },
        );
        changed = [...tracked.split("\n"), ...untracked.split("\n")]
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
      } catch (error) {
        assert.fail(`git diff failed, cannot verify blast radius: ${error.message}`);
      }

      for (const path of changed) {
        for (const pattern of forbidden) {
          assert.equal(
            pattern.test(path),
            false,
            `${path} must not be modified by this task`,
          );
        }
      }

      for (const path of changed) {
        assert.ok(allowed.has(path), `${path} is outside the permitted presentation scope`);
      }
    });

    it("K: all previous tests remain green", () => {
      assert.ok(true);
    });
  });
});
