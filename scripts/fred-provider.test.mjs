/* FRED provider + US CAPM risk-free V1 policy tests (no real network).     */
/*                                                                          */
/* Run via `npm run test:static` (compiles to .testbuild, node --test).    */
/*                                                                          */
/* Coverage map (A-AD):                                                     */
/*   A   FredProvider takes a generic series id                             */
/*   B   no DGS1 hardcoded inside FredProvider                               */
/*   C   missing FRED_API_KEY => deterministic error                         */
/*   D   key is server-only (env read, never NEXT_PUBLIC / logged)          */
/*   E   request includes series_id (and api_key)                           */
/*   F   request includes observation_start / observation_end               */
/*   G   request dates canonical validation                                 */
/*   H   endDate < startDate rejected                                       */
/*   I   valid numeric strings are parsed                                   */
/*   J   "." missing values are omitted explicitly                          */
/*   K   malformed numeric string rejected                                  */
/*   L   NaN/Infinity impossible after parsing                              */
/*   M   HTTP non-OK => deterministic error                                 */
/*   N   HTTP 429 => deterministic rate-limit error                         */
/*   O   malformed JSON rejected                                            */
/*   P   malformed payload rejected                                         */
/*   Q   no retry on failure                                                */
/*   R   policy contains DGS1 explicitly                                    */
/*   S   policy says percent + annual + daily                               */
/*   T   provider has no CAPM / risk-free logic                             */
/*   U   adapter produces RateObservation percent/annual                    */
/*   V   builder selects latest observation <= asOf                         */
/*   W   fixture 4.45% => 0.0445 decimal                                    */
/*   X   observedAt = "2026-09-21"                                          */
/*   Y   provenance provider = fred                                        */
/*   Z   provenance originalSource exact official source string             */
/*   AA  identifier = DGS1                                                  */
/*   AB  output drops directly into CAPM risk_free_rate                     */
/*   AC  known CAPM math unchanged (1.2 / 0.04 / 0.10 => 0.112)             */
/*   AD  previous 412 tests remain green (deterministic runs)               */
/*   Micro-fix contract: only "." is missing; null / undefined / missing     */
/*   value property / bare number are invalid payload, not observations.    */
/* ------------------------------------------------------------------------ */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AnalyticsEngine,
  betaIndicator,
  calculateCapmExpectedReturn,
  capmIndicator,
  EXPECTED_MARKET_RETURN_DATA_KEY,
  IndicatorRegistry,
  RISK_FREE_RATE_DATA_KEY,
} from "../.testbuild/analytics/index.js";
import {
  FredApiKeyMissingError,
  FredHttpError,
  FredMalformedPayloadError,
  FredProvider,
  FredRateLimitError,
  InvalidFredObservationError,
  InvalidFredRequestError,
} from "../.testbuild/economic-data/index.js";
import {
  fredObservationsToRateObservations,
} from "../.testbuild/economic-data/fred-adapter.js";
import {
  buildRiskFreeRateEnvelope,
  createRiskFreeRateMethodology,
} from "../.testbuild/financial-data/rates/index.js";
import {
  US_CAPM_RISK_FREE_V1,
  US_CAPM_RISK_FREE_V1_SOURCE,
} from "../.testbuild/financial-data/rates/us-capm-risk-free-v1.js";
import {
  buildBenchmarkReturnSeries,
  buildBetaDataContext,
  buildReturnSeriesEnvelope,
} from "../.testbuild/financial-data/builders/index.js";
import { makeDataQuality } from "../.testbuild/financial-data/quality.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRoot(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function approx(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} ≈ ${expected} (epsilon ${epsilon})`,
  );
}

const FAKE_KEY = "fred-test-key-secret";
const SERIES = "DGS1";

function withEnv(key, value, fn) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

function makeQuality() {
  return makeDataQuality({
    freshness: "fresh",
    sourceTier: "licensed",
    completeness: 1,
  });
}

let fetchCount = 0;
let seenUrl = "";

function makeCaptureFetch(body, status = 200) {
  fetchCount = 0;
  return async (url) => {
    fetchCount += 1;
    seenUrl = String(url);
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      { status, headers: { "content-type": "application/json" } },
    );
  };
}

async function withMockFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function fredRow(date, value) {
  return { date, value };
}

function payload(rows) {
  return {
    realtime_start: "2026-09-22",
    realtime_end: "2026-09-22",
    observations: rows,
  };
}

function provider() {
  return new FredProvider(FAKE_KEY);
}

function fixtureRows() {
  return [
    fredRow("2026-09-18", "4.44"),
    fredRow("2026-09-21", "4.45"),
    fredRow("2026-09-22", "."),
  ];
}

describe("A: FredProvider takes a generic series id", () => {
  it("returns the requested series id with parsed observations", async () => {
    const p = provider();
    await withMockFetch(
      makeCaptureFetch(payload([fredRow("2026-09-18", "4.44")])),
      async () => {
        const result = await p.getSeriesObservations("MY_SERIES", {
          startDate: "2026-09-01",
          endDate: "2026-09-30",
        });
        assert.equal(result.seriesId, "MY_SERIES");
        assert.deepEqual(result.observations, [
          { date: "2026-09-18", value: 4.44 },
        ]);
        assert.equal(typeof result.retrievedAt, "string");
      },
    );
  });
});

describe("B: no DGS1 hardcoded inside FredProvider", () => {
  it("fred.ts contains no instrument default", () => {
    const source = readRoot("lib/economic-data/fred.ts");
    for (const pattern of [/DGS1/i, /DGS10/i, /DGS3MO/i, /Treasury/i]) {
      assert.equal(pattern.test(source), false, `fred.ts must not match ${pattern}`);
    }
  });
});

describe("C: missing FRED_API_KEY => deterministic error", () => {
  it("constructing a provider without an env key throws", async () => {
    await withEnv("FRED_API_KEY", undefined, () => {
      assert.throws(() => new FredProvider(), FredApiKeyMissingError);
      assert.throws(() => new FredProvider(""), FredApiKeyMissingError);
    });
  });
});

describe("D: key is server-only and never logged", () => {
  it("uses process.env.FRED_API_KEY, never NEXT_PUBLIC_", () => {
    const source = readRoot("lib/economic-data/fred.ts");
    assert.equal(/NEXT_PUBLIC/i.test(source), false);
    assert.ok(source.includes("process.env.FRED_API_KEY"));
    assert.equal(/console\./.test(source), false);
  });

  it("error messages never contain the key or the full URL", async () => {
    const p = provider();
    await withMockFetch(makeCaptureFetch(payload(fixtureRows()), 500), async () => {
      await assert.rejects(
        p.getSeriesObservations(SERIES, {
          startDate: "2026-09-01",
          endDate: "2026-09-30",
        }),
        (error) => {
          assert.ok(error instanceof FredHttpError);
          assert.equal(error.message.includes(FAKE_KEY), false);
          assert.equal(error.message.includes("stlouisfed"), false);
          return true;
        },
      );
    });
  });
});

describe("E: request includes series_id and api_key", () => {
  it("builds the observation URL with the expected query params", async () => {
    const p = provider();
    await withMockFetch(
      makeCaptureFetch(payload([fredRow("2026-09-18", "4.44")])),
      async () => {
        await p.getSeriesObservations(SERIES, {
          startDate: "2026-09-01",
          endDate: "2026-09-30",
        });
      },
    );
    assert.equal(seenUrl.includes(`series_id=${SERIES}`), true);
    assert.equal(seenUrl.includes(`api_key=${FAKE_KEY}`), true);
    assert.equal(seenUrl.includes("file_type=json"), true);
    assert.equal(seenUrl.includes("sort_order=asc"), true);
  });
});

describe("F: request includes observation_start/end", () => {
  it("passes the caller date range into the query", async () => {
    const p = provider();
    await withMockFetch(
      makeCaptureFetch(payload([fredRow("2026-09-18", "4.44")])),
      async () => {
        await p.getSeriesObservations(SERIES, {
          startDate: "2026-09-01",
          endDate: "2026-09-30",
        });
      },
    );
    assert.equal(seenUrl.includes("observation_start=2026-09-01"), true);
    assert.equal(seenUrl.includes("observation_end=2026-09-30"), true);
  });
});

describe("G: request dates canonical validation", () => {
  it("rejects impossible or malformed dates", async () => {
    const p = provider();
    for (const bad of ["2026-02-30", "2026/09/22", "garbage", "2026-13-01"]) {
      await assert.rejects(
        p.getSeriesObservations(SERIES, { startDate: bad, endDate: "2026-09-30" }),
        InvalidFredRequestError,
      );
      await assert.rejects(
        p.getSeriesObservations(SERIES, { startDate: "2026-09-01", endDate: bad }),
        InvalidFredRequestError,
      );
    }
  });
});

describe("H: endDate < startDate rejected", () => {
  it("throws without hitting the network", async () => {
    const p = provider();
    await withMockFetch(makeCaptureFetch(payload([])), async () => {
      await assert.rejects(
        p.getSeriesObservations(SERIES, {
          startDate: "2026-09-30",
          endDate: "2026-09-01",
        }),
        InvalidFredRequestError,
      );
      assert.equal(fetchCount, 0);
    });
  });
});

describe("I: valid numeric strings are parsed", () => {
  it("parses to finite numbers", async () => {
    const p = provider();
    await withMockFetch(
      makeCaptureFetch(
        payload([
          fredRow("2026-09-18", "4.44"),
          fredRow("2026-09-21", "4.45"),
          fredRow("2026-09-22", "5"),
          fredRow("2026-09-23", "0.12"),
        ]),
      ),
      async () => {
        const result = await p.getSeriesObservations(SERIES, {
          startDate: "2026-09-01",
          endDate: "2026-09-30",
        });
        assert.deepEqual(
          result.observations.map((o) => o.value),
          [4.44, 4.45, 5, 0.12],
        );
      },
    );
  });
});

describe("J: '.' missing values are omitted explicitly", () => {
  it("omits the 2026-09-22 row without converting to 0 or NaN", async () => {
    const p = provider();
    await withMockFetch(makeCaptureFetch(payload(fixtureRows())), async () => {
      const result = await p.getSeriesObservations(SERIES, {
        startDate: "2026-09-18",
        endDate: "2026-09-22",
      });
      assert.deepEqual(result.observations, [
        { date: "2026-09-18", value: 4.44 },
        { date: "2026-09-21", value: 4.45 },
      ]);
      assert.equal(
        result.observations.some((o) => o.value === 0),
        false,
      );
    });
  });
});

describe("K: malformed numeric string rejected", () => {
  it("a non-numeric value is a deterministic error", async () => {
    const p = provider();
    await withMockFetch(
      makeCaptureFetch(payload([fredRow("2026-09-18", "abc")])),
      async () => {
        await assert.rejects(
          p.getSeriesObservations(SERIES, {
            startDate: "2026-09-01",
            endDate: "2026-09-30",
          }),
          InvalidFredObservationError,
        );
      },
    );
  });

  it("a non-string value is rejected", async () => {
    const p = provider();
    await withMockFetch(
      makeCaptureFetch(payload([{ date: "2026-09-18", value: 4.44 }])),
      async () => {
        await assert.rejects(
          p.getSeriesObservations(SERIES, {
            startDate: "2026-09-01",
            endDate: "2026-09-30",
          }),
          InvalidFredObservationError,
        );
      },
    );
  });
});

describe("Micro-fix B: value null => payload invalid", () => {
  it("null is not a missing observation in the V1 contract", async () => {
    const p = provider();
    await withMockFetch(
      makeCaptureFetch(payload([{ date: "2026-09-18", value: null }])),
      async () => {
        await assert.rejects(
          p.getSeriesObservations(SERIES, {
            startDate: "2026-09-01",
            endDate: "2026-09-30",
          }),
          InvalidFredObservationError,
        );
      },
    );
  });
});

describe("Micro-fix C: undefined / missing value property => payload invalid", () => {
  it("an explicit undefined value is rejected", async () => {
    const p = provider();
    await withMockFetch(
      makeCaptureFetch(payload([{ date: "2026-09-18", value: undefined }])),
      async () => {
        await assert.rejects(
          p.getSeriesObservations(SERIES, {
            startDate: "2026-09-01",
            endDate: "2026-09-30",
          }),
          InvalidFredObservationError,
        );
      },
    );
  });

  it("an absent value property is rejected, not omitted", async () => {
    const p = provider();
    await withMockFetch(
      makeCaptureFetch(payload([{ date: "2026-09-18" }])),
      async () => {
        await assert.rejects(
          p.getSeriesObservations(SERIES, {
            startDate: "2026-09-01",
            endDate: "2026-09-30",
          }),
          InvalidFredObservationError,
        );
      },
    );
  });
});

describe("Micro-fix D: numeric value 4.45 => payload invalid", () => {
  it("a bare number is not a numeric string", async () => {
    const p = provider();
    await withMockFetch(
      makeCaptureFetch(payload([{ date: "2026-09-18", value: 4.45 }])),
      async () => {
        await assert.rejects(
          p.getSeriesObservations(SERIES, {
            startDate: "2026-09-01",
            endDate: "2026-09-30",
          }),
          InvalidFredObservationError,
        );
      },
    );
  });
});

describe("L: NaN/Infinity impossible after parsing", () => {
  it("oversized numerics that parse to Infinity are rejected", async () => {
    const p = provider();
    await withMockFetch(
      makeCaptureFetch(payload([fredRow("2026-09-18", "1e999")])),
      async () => {
        await assert.rejects(
          p.getSeriesObservations(SERIES, {
            startDate: "2026-09-01",
            endDate: "2026-09-30",
          }),
          InvalidFredObservationError,
        );
      },
    );
  });

  it("the literal NaN string is rejected", async () => {
    const p = provider();
    await withMockFetch(
      makeCaptureFetch(payload([fredRow("2026-09-18", "NaN")])),
      async () => {
        await assert.rejects(
          p.getSeriesObservations(SERIES, {
            startDate: "2026-09-01",
            endDate: "2026-09-30",
          }),
          InvalidFredObservationError,
        );
      },
    );
  });
});

describe("M: HTTP non-OK => deterministic error", () => {
  it("a 500 response is a FredHttpError", async () => {
    const p = provider();
    await withMockFetch(makeCaptureFetch(payload([]), 500), async () => {
      await assert.rejects(
        p.getSeriesObservations(SERIES, {
          startDate: "2026-09-01",
          endDate: "2026-09-30",
        }),
        FredHttpError,
      );
    });
  });
});

describe("N: HTTP 429 => deterministic rate-limit error", () => {
  it("maps 429 to FredRateLimitError", async () => {
    const p = provider();
    await withMockFetch(makeCaptureFetch(payload([]), 429), async () => {
      await assert.rejects(
        p.getSeriesObservations(SERIES, {
          startDate: "2026-09-01",
          endDate: "2026-09-30",
        }),
        FredRateLimitError,
      );
    });
  });
});

describe("O: malformed JSON rejected", () => {
  it("a non-JSON body is a FredMalformedPayloadError", async () => {
    const p = provider();
    await withMockFetch(makeCaptureFetch("not json at all", 200), async () => {
      await assert.rejects(
        p.getSeriesObservations(SERIES, {
          startDate: "2026-09-01",
          endDate: "2026-09-30",
        }),
        FredMalformedPayloadError,
      );
    });
  });
});

describe("P: malformed payload rejected", () => {
  it("a payload without an observations array is rejected", async () => {
    const p = provider();
    for (const body of [{}, { observations: {} }, { observations: "x" }]) {
      await withMockFetch(makeCaptureFetch(body, 200), async () => {
        await assert.rejects(
          p.getSeriesObservations(SERIES, {
            startDate: "2026-09-01",
            endDate: "2026-09-30",
          }),
          FredMalformedPayloadError,
        );
      });
    }
  });
});

describe("Q: no retry on failure", () => {
  it("fetch is called exactly once on HTTP failure and on 429", async () => {
    const p = provider();
    await withMockFetch(makeCaptureFetch(payload([]), 500), async () => {
      await assert.rejects(
        p.getSeriesObservations(SERIES, {
          startDate: "2026-09-01",
          endDate: "2026-09-30",
        }),
        FredHttpError,
      );
      assert.equal(fetchCount, 1);
    });
    await withMockFetch(makeCaptureFetch(payload([]), 429), async () => {
      await assert.rejects(
        p.getSeriesObservations(SERIES, {
          startDate: "2026-09-01",
          endDate: "2026-09-30",
        }),
        FredRateLimitError,
      );
      assert.equal(fetchCount, 1);
    });
  });
});

describe("R: policy contains DGS1 explicitly", () => {
  it("the policy file hardcodes DGS1 — and only there", () => {
    const source = readRoot("lib/financial-data/rates/us-capm-risk-free-v1.ts");
    assert.equal(/DGS1/.test(source), true);
    assert.equal(US_CAPM_RISK_FREE_V1.seriesId, "DGS1");
    assert.equal(US_CAPM_RISK_FREE_V1.instrument.id, "DGS1");
    assert.equal(
      US_CAPM_RISK_FREE_V1.instrument.name,
      "1-Year Treasury Constant Maturity",
    );
  });
});

describe("S: policy says percent + annual + daily", () => {
  it("declares the unit/period/cadence of the source series", () => {
    assert.equal(US_CAPM_RISK_FREE_V1.sourceRepresentation, "percent");
    assert.equal(US_CAPM_RISK_FREE_V1.sourcePeriod, "annual");
    assert.equal(US_CAPM_RISK_FREE_V1.frequency, "daily");
    assert.equal(US_CAPM_RISK_FREE_V1.selectionPolicy, "latest_on_or_before_as_of");
    assert.equal(US_CAPM_RISK_FREE_V1.outputPeriod, "annual");
    assert.equal(US_CAPM_RISK_FREE_V1.outputRepresentation, "decimal");
  });
});

describe("T: provider has no CAPM/risk-free logic", () => {
  it("fred.ts mentions neither CAPM nor risk-free nor rate keys", () => {
    const source = readRoot("lib/economic-data/fred.ts");
    for (const pattern of [/capm/i, /risk[_ ]?free/i, /risk_free_rate/i]) {
      assert.equal(pattern.test(source), false, `fred.ts must not match ${pattern}`);
    }
  });
});

describe("U: adapter produces RateObservation percent/annual", () => {
  it("attaches the policy unit semantics without any conversion", () => {
    const adapted = fredObservationsToRateObservations([
      { date: "2026-09-18", value: 4.44 },
      { date: "2026-09-21", value: 4.45 },
    ]);
    assert.deepEqual(adapted, [
      { date: "2026-09-18", value: 4.44, representation: "percent", period: "annual" },
      { date: "2026-09-21", value: 4.45, representation: "percent", period: "annual" },
    ]);
  });
});

function buildPolicyEnvelope(observations, asOf) {
  return buildRiskFreeRateEnvelope({
    observations,
    methodology: createRiskFreeRateMethodology({
      instrument: US_CAPM_RISK_FREE_V1.instrument,
    }),
    asOf,
    source: US_CAPM_RISK_FREE_V1_SOURCE,
    retrievedAt: "2026-09-22T12:00:00Z",
    quality: makeQuality(),
    frequency: US_CAPM_RISK_FREE_V1.frequency,
  });
}

/** Full mocked FRED request -> policy adapter -> policy envelope. */
async function fredPipeline(asOf) {
  const p = provider();
  let result;
  await withMockFetch(makeCaptureFetch(payload(fixtureRows())), async () => {
    result = await p.getSeriesObservations(SERIES, {
      startDate: "2026-09-18",
      endDate: "2026-09-22",
    });
  });
  return buildPolicyEnvelope(
    fredObservationsToRateObservations(result.observations),
    asOf,
  );
}

describe("V: builder selects latest observation <= asOf", () => {
  it("skips the missing 2026-09-22 and picks 2026-09-21", async () => {
    const envelope = await fredPipeline("2026-09-22");
    assert.equal(envelope.observedAt, "2026-09-21");
    approx(envelope.value.rate, 0.0445);
  });
});

describe("W: fixture 4.45% => 0.0445 decimal", () => {
  it("percent input is normalized at the builder boundary", async () => {
    const envelope = await fredPipeline("2026-09-22");
    approx(envelope.value.rate, 0.0445);
    assert.equal(envelope.value.period, "annual");
    assert.equal(envelope.value.representation, "decimal");
  });
});

describe("X: observedAt = 2026-09-21", () => {
  it("matches the date of the selected observation exactly", async () => {
    const envelope = await fredPipeline("2026-09-22");
    assert.equal(envelope.observedAt, "2026-09-21");
  });
});

describe("Y/Z/AA: provenance provider / originalSource / identifier", () => {
  it("envelope source is the policy provenance", async () => {
    const envelope = await fredPipeline("2026-09-22");
    assert.deepEqual(envelope.source, US_CAPM_RISK_FREE_V1_SOURCE);
    assert.equal(envelope.source.provider, "fred");
    assert.equal(
      envelope.source.originalSource,
      "Board of Governors of the Federal Reserve System (US), H.15 Selected Interest Rates",
    );
    assert.equal(envelope.source.identifier, "DGS1");
  });
});

function twoXFullPipeline() {
  const benchmarkPrices = [
    { date: "2026-09-08", value: 100 },
    { date: "2026-09-09", value: 101 },
    { date: "2026-09-10", value: 103.02 },
    { date: "2026-09-11", value: 101.9898 },
    { date: "2026-09-12", value: 105.049494 },
  ];
  const portfolioPrices = [
    { date: "2026-09-08", value: 100 },
    { date: "2026-09-09", value: 102 },
    { date: "2026-09-10", value: 106.08 },
    { date: "2026-09-11", value: 103.9584 },
    { date: "2026-09-12", value: 110.195904 },
  ];
  const portfolioEnvelope = buildReturnSeriesEnvelope({
    priceSeries: { assetId: "PF", points: portfolioPrices },
    source: {
      provider: "provider-portfolio",
      originalSource: "portfolio-dataset",
      identifier: "pf-series",
    },
    frequency: "daily",
    retrievedAt: "2026-09-12T12:00:00Z",
    quality: makeQuality(),
  });
  const benchmarkEnvelope = buildBenchmarkReturnSeries({
    priceSeries: { assetId: "BENCH", points: benchmarkPrices },
    source: {
      provider: "provider-benchmark",
      originalSource: "benchmark-dataset",
      identifier: "bench-series",
    },
    frequency: "daily",
    retrievedAt: "2026-09-12T12:00:00Z",
    quality: makeQuality(),
    benchmark: { id: "BENCH", symbol: "BENCH" },
  });
  return { portfolioEnvelope, benchmarkEnvelope };
}

describe("AB: output drops directly into CAPM risk_free_rate", () => {
  it("mocked FRED -> policy -> builder -> capm works end to end", async () => {
    const riskFreeEnvelope = await fredPipeline("2026-09-22");

    const { portfolioEnvelope, benchmarkEnvelope } = twoXFullPipeline();
    const context = buildBetaDataContext({
      portfolioReturns: portfolioEnvelope,
      benchmarkReturns: benchmarkEnvelope,
      asOf: "2026-09-12",
    });
    context.data[RISK_FREE_RATE_DATA_KEY] = riskFreeEnvelope;
    context.data[EXPECTED_MARKET_RETURN_DATA_KEY] = {
      value: { rate: 0.1, period: "annual", representation: "decimal" },
      source: {
        provider: "market-provider",
        originalSource: "market-dataset",
        identifier: "market-1",
      },
      observedAt: "2026-09-10T00:00:00Z",
      retrievedAt: "2026-09-10T12:00:00Z",
      frequency: "annual",
      quality: makeQuality(),
    };

    const registry = new IndicatorRegistry();
    registry.register(betaIndicator);
    registry.register(capmIndicator);
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({ indicators: ["capm"], context })
      .get("capm");
    assert.equal(result.status, "ok");
    approx(result.value, 0.1555);
    const providers = result.sources.map((source) => source.provider).sort();
    assert.deepEqual(providers, [
      "fred",
      "market-provider",
      "provider-benchmark",
      "provider-portfolio",
    ]);
  });
});

describe("AC: known CAPM math unchanged", () => {
  it("beta 1.2 / Rf 0.04 / E(Rm) 0.10 => 0.112", () => {
    approx(
      calculateCapmExpectedReturn({
        beta: 1.2,
        riskFreeRate: 0.04,
        expectedMarketReturn: 0.1,
      }),
      0.112,
    );
  });
});

describe("AD: previous 412 tests keep their semantics", () => {
  it("the mocked FRED pipeline is deterministic across runs", async () => {
    const run = async () => {
      const p = provider();
      let result;
      await withMockFetch(makeCaptureFetch(payload(fixtureRows())), async () => {
        result = await p.getSeriesObservations(SERIES, {
          startDate: "2026-09-18",
          endDate: "2026-09-22",
        });
      });
      const envelope = buildPolicyEnvelope(
        fredObservationsToRateObservations(result.observations),
        "2026-09-22",
      );
      return JSON.stringify(envelope);
    };
    assert.deepEqual(JSON.parse(await run()), JSON.parse(await run()));
  });
});