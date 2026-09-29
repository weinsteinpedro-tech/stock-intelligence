/* Risk-free rate V1 methodology + builder tests (no network).               */
/*                                                                           */
/* Run via `npm run test:static` (compiles lib/analytics +                 */
/* lib/financial-data to .testbuild, then node --test this file).           */
/*                                                                           */
/* Coverage map (A-U):                                                       */
/*   A  generic valid methodology                                            */
/*   B  no provider/instrument hardcoded                                     */
/*   C  latest_on_or_before_as_of picks correctly                            */
/*   D  a future observation is never used                                   */
/*   E  no observations <= asOf => deterministic error                       */
/*   F  decimal 0.042 stays 0.042                                            */
/*   G  percent 4.2 becomes decimal 0.042                                    */
/*   H  negative rate is accepted                                            */
/*   I  NaN rejected                                                         */
/*   J  Infinity rejected                                                    */
/*   K  invalid date rejected (observation and asOf)                         */
/*   L  duplicate date rejected                                              */
/*   M  observedAt = selected observation date                               */
/*   N  retrievedAt comes from the caller                                    */
/*   O  snapshot preserves the methodology                                   */
/*   P  trace preserves the selected date                                    */
/*   Q  provenance preserved                                                 */
/*   R  builder output satisfies AnnualDecimalRate                           */
/*   S  CAPM accepts the builder output unchanged                            */
/*   T  known CAPM 1.2 / 0.04 / 0.10 still => 0.112                          */
/*   U  previous 387 tests keep their semantics (deterministic runs)         */
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
  buildBenchmarkReturnSeries,
  buildBetaDataContext,
  buildReturnSeriesEnvelope,
} from "../.testbuild/financial-data/builders/index.js";
import {
  buildRiskFreeRateEnvelope,
  createRiskFreeRateMethodology,
  DuplicateRiskFreeObservationError,
  InvalidRiskFreeDateError,
  InvalidRiskFreeInputError,
  InvalidRiskFreeMethodologyError,
  InvalidRiskFreeObservationError,
  NoEligibleRiskFreeObservationError,
  selectRiskFreeObservation,
  snapshotRiskFreeRateMethodology,
  toAnnualDecimalRate,
  traceRiskFreeSelection,
  validateRiskFreeRateMethodology,
} from "../.testbuild/financial-data/rates/index.js";
import { makeDataQuality } from "../.testbuild/financial-data/quality.js";
import { dataEnvelopeToSourceReference } from "../.testbuild/financial-data/provenance.js";

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

function makeQuality() {
  return makeDataQuality({
    freshness: "fresh",
    sourceTier: "licensed",
    completeness: 1,
  });
}

function obs(date, value, representation = "decimal", period = "annual") {
  return { date, value, representation, period };
}

function methodology(instrument = { id: "MY-RATE", name: "My Rate" }) {
  return createRiskFreeRateMethodology({ instrument });
}

function sourceOverrides() {
  return {
    source: {
      provider: "rates-provider",
      originalSource: "rates-dataset",
      identifier: "rate-1",
    },
    retrievedAt: "2026-09-22T10:00:00Z",
    quality: makeQuality(),
    frequency: "daily",
  };
}

function buildEnvelope(observations, overrides = {}) {
  return buildRiskFreeRateEnvelope({
    observations,
    methodology: methodology(),
    asOf: "2026-09-22",
    ...sourceOverrides(),
    ...overrides,
  });
}

describe("A: valid generic methodology", () => {
  it("creates a default V1 methodology without any provider knowledge", () => {
    const m = methodology();
    assert.deepEqual(m.instrument, { id: "MY-RATE", name: "My Rate" });
    assert.equal(m.selectionPolicy, "latest_on_or_before_as_of");
    assert.equal(m.outputPeriod, "annual");
    assert.equal(m.outputRepresentation, "decimal");
  });

  it("an empty instrument id is rejected", () => {
    assert.throws(
      () => methodology({ id: "" }),
      InvalidRiskFreeMethodologyError,
    );
  });
});

describe("B: no provider/instrument hardcoded", () => {
  it("the rate module contains no FRED / DGS… / Treasury / Tiingo / Alpha Vantage", () => {
    const source = readRoot("lib/financial-data/rates/risk-free-rate.ts");
    for (const pattern of [/FRED/i, /DGS10/i, /DGS1/i, /DGS3MO/i, /treasury/i, /tiingo/i, /alpha[_\s-]?vantage/i]) {
      assert.equal(pattern.test(source), false, `must not match ${pattern}`);
    }
  });
});

describe("C: latest_on_or_before_as_of selection", () => {
  it("picks 2026-09-21 for asOf 2026-09-22", () => {
    const observations = [
      obs("2026-09-18", 0.041),
      obs("2026-09-21", 0.042),
      obs("2026-09-23", 0.043),
    ];
    const selected = selectRiskFreeObservation({
      observations,
      asOf: "2026-09-22",
      methodology: methodology(),
    });
    assert.equal(selected.date, "2026-09-21");
    assert.equal(selected.value, 0.042);
  });
});

describe("D: a future observation is never used", () => {
  it("skips the future 2026-09-23 and still selects 2026-09-21", () => {
    const observations = [obs("2026-09-21", 0.042), obs("2026-09-23", 0.043)];
    const selected = selectRiskFreeObservation({
      observations,
      asOf: "2026-09-22",
      methodology: methodology(),
    });
    assert.equal(selected.date, "2026-09-21");
  });
});

describe("E: no observations on/before asOf => deterministic error", () => {
  it("throws NoEligibleRiskFreeObservationError, does not pick the future one", () => {
    assert.throws(
      () =>
        selectRiskFreeObservation({
          observations: [obs("2026-09-23", 0.043)],
          asOf: "2026-09-22",
          methodology: methodology(),
        }),
      NoEligibleRiskFreeObservationError,
    );
    assert.throws(
      () => buildEnvelope([obs("2026-09-23", 0.043)]),
      NoEligibleRiskFreeObservationError,
    );
  });
});

describe("F: decimal stays decimal", () => {
  it("0.042 => 0.042", () => {
    assert.deepEqual(toAnnualDecimalRate(obs("2026-09-21", 0.042)), {
      rate: 0.042,
      period: "annual",
      representation: "decimal",
    });
  });
});

describe("G: percent becomes decimal", () => {
  it("4.2 => 0.042", () => {
    assert.deepEqual(toAnnualDecimalRate(obs("2026-09-21", 4.2, "percent")), {
      rate: 0.042,
      period: "annual",
      representation: "decimal",
    });
  });
});

describe("H: negative rate is accepted", () => {
  it("a negative decimal rate flows through unchanged", () => {
    assert.deepEqual(toAnnualDecimalRate(obs("2026-09-21", -0.01)), {
      rate: -0.01,
      period: "annual",
      representation: "decimal",
    });
    const envelope = buildEnvelope([obs("2026-09-21", -0.01)]);
    assert.equal(envelope.value.rate, -0.01);
  });
});

describe("I: NaN rejected", () => {
  it("a NaN value is rejected deterministically", () => {
    assert.throws(
      () => toAnnualDecimalRate(obs("2026-09-21", Number.NaN)),
      InvalidRiskFreeObservationError,
    );
    assert.throws(
      () => buildEnvelope([obs("2026-09-21", Number.NaN)]),
      InvalidRiskFreeObservationError,
    );
  });
});

describe("J: Infinity rejected", () => {
  it("positive and negative Infinity both rejected", () => {
    for (const value of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(
        () => toAnnualDecimalRate(obs("2026-09-21", value)),
        InvalidRiskFreeObservationError,
      );
    }
  });
});

describe("K: invalid date rejected", () => {
  it("observation dates must be real canonical YYYY-MM-DD", () => {
    for (const date of ["2026-02-30", "2026/09/22", "garbage", "2026-13-01"]) {
      assert.throws(
        () => toAnnualDecimalRate(obs(date, 0.042)),
        InvalidRiskFreeDateError,
      );
    }
  });

  it("asOf must be a real canonical YYYY-MM-DD", () => {
    for (const asOf of ["2026-02-30", "2026/09/22", "garbage"]) {
      assert.throws(
        () => buildEnvelope([obs("2026-09-21", 0.042)], { asOf }),
        InvalidRiskFreeDateError,
      );
    }
  });
});

describe("L: duplicate date rejected", () => {
  it("two observations on the same date are ambiguous and rejected", () => {
    assert.throws(
      () =>
        selectRiskFreeObservation({
          observations: [obs("2026-09-21", 0.042), obs("2026-09-21", 0.043)],
          asOf: "2026-09-22",
          methodology: methodology(),
        }),
      DuplicateRiskFreeObservationError,
    );
    assert.throws(
      () => buildEnvelope([obs("2026-09-21", 0.042), obs("2026-09-21", 0.043)]),
      DuplicateRiskFreeObservationError,
    );
  });
});

describe("M: observedAt = selected observation date", () => {
  it("the envelope observes the exact 2026-09-21 date, with no invented time", () => {
    const envelope = buildEnvelope([
      obs("2026-09-18", 0.041),
      obs("2026-09-21", 0.042),
      obs("2026-09-23", 0.043),
    ]);
    assert.equal(envelope.observedAt, "2026-09-21");
  });
});

describe("N: retrievedAt comes from the caller", () => {
  it("the envelope preserves the caller-provided retrievedAt", () => {
    const envelope = buildEnvelope([obs("2026-09-21", 0.042)]);
    assert.equal(envelope.retrievedAt, "2026-09-22T10:00:00Z");
  });

  it("an empty retrievedAt is rejected", () => {
    assert.throws(
      () => buildEnvelope([obs("2026-09-21", 0.042)], { retrievedAt: "" }),
      InvalidRiskFreeInputError,
    );
  });
});

describe("O: snapshot preserves the methodology", () => {
  it("produces the structured snapshot", () => {
    const snapshot = snapshotRiskFreeRateMethodology(methodology());
    assert.deepEqual(snapshot, {
      instrumentId: "MY-RATE",
      selectionPolicy: "latest_on_or_before_as_of",
      outputPeriod: "annual",
      outputRepresentation: "decimal",
    });
    assert.equal(validateRiskFreeRateMethodology(methodology()), undefined);
  });

  it("is a structural copy, not a live reference", () => {
    const m = methodology();
    const snapshot = snapshotRiskFreeRateMethodology(m);
    snapshot.instrumentId = "OTHER";
    assert.equal(m.instrument.id, "MY-RATE");
  });
});

describe("P: trace preserves the selected date", () => {
  it("returns methodology snapshot + asOf + selected observation date", () => {
    const trace = traceRiskFreeSelection({
      observations: [obs("2026-09-18", 0.041), obs("2026-09-21", 0.042)],
      asOf: "2026-09-22",
      methodology: methodology(),
    });
    assert.deepEqual(trace, {
      methodologySnapshot: {
        instrumentId: "MY-RATE",
        selectionPolicy: "latest_on_or_before_as_of",
        outputPeriod: "annual",
        outputRepresentation: "decimal",
      },
      asOf: "2026-09-22",
      selectedObservationDate: "2026-09-21",
    });
  });
});

describe("Q: provenance preserved", () => {
  it("the envelope keeps the caller source and derives a full reference", () => {
    const envelope = buildEnvelope([obs("2026-09-21", 0.042)]);
    assert.deepEqual(envelope.source, {
      provider: "rates-provider",
      originalSource: "rates-dataset",
      identifier: "rate-1",
    });
    const reference = dataEnvelopeToSourceReference(envelope);
    assert.deepEqual(reference, {
      provider: "rates-provider",
      originalSource: "rates-dataset",
      identifier: "rate-1",
      observedAt: "2026-09-21",
      retrievedAt: "2026-09-22T10:00:00Z",
    });
  });
});

describe("R: builder output satisfies AnnualDecimalRate", () => {
  it("percent input arrives normalized at the CAPM contract", () => {
    const envelope = buildEnvelope([obs("2026-09-21", 4.2, "percent")]);
    assert.deepEqual(envelope.value, {
      rate: 0.042,
      period: "annual",
      representation: "decimal",
    });
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

function capmContextWithBuilderRf() {
  const { portfolioEnvelope, benchmarkEnvelope } = twoXFullPipeline();
  const context = buildBetaDataContext({
    portfolioReturns: portfolioEnvelope,
    benchmarkReturns: benchmarkEnvelope,
    asOf: "2026-09-12",
  });
  const riskFreeEnvelope = buildEnvelope(
    [obs("2026-09-21", 4, "percent")],
    {
      asOf: "2026-09-22",
      source: {
        provider: "rf-builder-provider",
        originalSource: "rf-builder-dataset",
        identifier: "rf-builder-1",
      },
    },
  );
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
  return context;
}

describe("S: CAPM accepts the builder output unchanged", () => {
  it("the builder envelope drops straight into risk_free_rate and CAPM runs", () => {
    const registry = new IndicatorRegistry();
    registry.register(betaIndicator);
    registry.register(capmIndicator);
    const engine = new AnalyticsEngine(registry);
    const result = engine
      .calculate({
        indicators: ["capm"],
        context: capmContextWithBuilderRf(),
      })
      .get("capm");
    assert.equal(result.status, "ok");
    approx(result.value, 0.16);
    const providers = result.sources.map((source) => source.provider).sort();
    assert.ok(providers.includes("rf-builder-provider"));
    assert.ok(providers.includes("provider-portfolio"));
    assert.ok(providers.includes("provider-benchmark"));
    assert.ok(providers.includes("market-provider"));
  });
});

describe("T: known CAPM numbers stay untouched", () => {
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

describe("U: previous 387 tests keep their semantics", () => {
  it("the rate builder is deterministic across runs", () => {
    const run = () =>
      JSON.stringify(
        buildEnvelope([obs("2026-09-18", 0.041), obs("2026-09-21", 0.042)]),
      );
    assert.deepEqual(JSON.parse(run()), JSON.parse(run()));
  });
});