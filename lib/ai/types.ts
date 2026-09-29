import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Request snapshot (built server-side from app data, posted by UI)    */
/* ------------------------------------------------------------------ */

export const indicatorSnapshotSchema = z.object({
  return1D: z.number().nullable(),
  return1M: z.number().nullable(),
  sma20: z.number().nullable(),
  sma50: z.number().nullable(),
  volatility20D: z.number().nullable(),
  avgVolume20D: z.number().nullable(),
  volumeVsAvg: z.number().nullable(),
  periodHigh: z.number().nullable(),
  periodLow: z.number().nullable(),
});
export type IndicatorSnapshot = z.infer<typeof indicatorSnapshotSchema>;

export const marketSnapshotSchema = z.object({
  symbol: z.string().min(1).max(20),
  name: z.string().nullable(),
  region: z.string().nullable(),
  currency: z.string().nullable(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  latestPrice: z.number().nullable(),
  indicators: indicatorSnapshotSchema,
});
export type MarketSnapshot = z.infer<typeof marketSnapshotSchema>;

/* ------------------------------------------------------------------ */
/* Source ledger (built programmatically from Tavily results)          */
/* ------------------------------------------------------------------ */

export const sourceQualitySchema = z.enum([
  "primary",
  "high_quality_secondary",
  "other",
]);
export type SourceQuality = z.infer<typeof sourceQualitySchema>;

export function isTrustedQuality(quality: Source["quality"]): boolean {
  return quality === "primary" || quality === "high_quality_secondary";
}

export const sourceSchema = z.object({
  id: z.string().regex(/^S\d+$/),
  title: z.string(),
  url: z.url(),
  domain: z.string(),
  quality: sourceQualitySchema,
  publisher: z.string(),
  publishedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});
export type Source = z.infer<typeof sourceSchema>;

/* ------------------------------------------------------------------ */
/* Evidence quality                                                    */
/* ------------------------------------------------------------------ */

export const evidenceQualitySchema = z.enum(["strong", "moderate", "limited"]);
export type EvidenceQuality = z.infer<typeof evidenceQualitySchema>;

/* ------------------------------------------------------------------ */
/* Raw evidence (exactly what the model writes in stage 2)             */
/* - app_data: a claim derived exclusively from deterministic APP DATA */
/* - external_source: references one or more claim ids from the ledger */
/*   that the app produced in stage 1 (C-ids). The model NEVER writes  */
/*   source ids; the app resolves C-ids -> text -> S-ids.              */
/* ------------------------------------------------------------------ */

export const rawEvidenceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("app_data"),
    description: z.string().min(1),
  }),
  z.object({
    type: z.literal("external_source"),
    claimIds: z.array(z.string().regex(/^C\d+$/)).min(1),
  }),
]);
export type RawEvidence = z.infer<typeof rawEvidenceSchema>;

/* ------------------------------------------------------------------ */
/* Resolved evidence (returned by the API; app-resolved)               */
/* ------------------------------------------------------------------ */

export const evidenceSchema = z.object({
  type: z.enum(["app_data", "external_source"]),
  description: z.string(),
  claimIds: z.array(z.string().regex(/^C\d+$/)).default([]),
  sourceIds: z.array(z.string().regex(/^S\d+$/)).default([]),
});
export type Evidence = z.infer<typeof evidenceSchema>;

/* ------------------------------------------------------------------ */
/* Factors (positive / negative)                                       */
/* ------------------------------------------------------------------ */

export const rawFactorSchema = z.object({
  title: z.string(),
  conclusion: z.string(),
  evidence: z.array(rawEvidenceSchema).min(1),
  assumptions: z.array(z.string()),
  rationale: z.string(),
  evidenceQuality: evidenceQualitySchema,
  horizon: z.enum(["days", "weeks", "months"]),
});
export type RawFactor = z.infer<typeof rawFactorSchema>;

export const factorSchema = z.object({
  title: z.string(),
  conclusion: z.string(),
  evidence: z.array(evidenceSchema).min(1),
  assumptions: z.array(z.string()),
  rationale: z.string(),
  evidenceQuality: evidenceQualitySchema,
  horizon: z.enum(["days", "weeks", "months"]),
});
export type Factor = z.infer<typeof factorSchema>;

/* ------------------------------------------------------------------ */
/* Market context (assessment + auditable evidence + assumptions)      */
/* ------------------------------------------------------------------ */

export const rawMarketContextSchema = z.object({
  assessment: z.string(),
  evidence: z.array(rawEvidenceSchema).default([]),
  assumptions: z.array(z.string()).default([]),
});
export type RawMarketContext = z.infer<typeof rawMarketContextSchema>;

export const marketContextSchema = z.object({
  assessment: z.string(),
  evidence: z.array(evidenceSchema).default([]),
  assumptions: z.array(z.string()).default([]),
});
export type MarketContext = z.infer<typeof marketContextSchema>;

/* ------------------------------------------------------------------ */
/* Uncertainties                                                       */
/* ------------------------------------------------------------------ */

export const rawUncertaintySchema = z.object({
  title: z.string(),
  explanation: z.string(),
  evidence: z.array(rawEvidenceSchema).default([]),
  assumptions: z.array(z.string()).default([]),
});
export type RawUncertainty = z.infer<typeof rawUncertaintySchema>;

export const uncertaintySchema = z.object({
  title: z.string(),
  explanation: z.string(),
  evidence: z.array(evidenceSchema).default([]),
  assumptions: z.array(z.string()).default([]),
});
export type Uncertainty = z.infer<typeof uncertaintySchema>;

/* ------------------------------------------------------------------ */
/* Catalysts (upcoming)                                                */
/* ------------------------------------------------------------------ */

export const rawCatalystSchema = z.object({
  event: z.string(),
  timing: z.string(),
  possibleImpact: z.string(),
  evidence: z.array(rawEvidenceSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  evidenceQuality: evidenceQualitySchema,
});
export type RawCatalyst = z.infer<typeof rawCatalystSchema>;

export const catalystSchema = z.object({
  event: z.string(),
  timing: z.string(),
  possibleImpact: z.string(),
  evidence: z.array(evidenceSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  evidenceQuality: evidenceQualitySchema,
});
export type Catalyst = z.infer<typeof catalystSchema>;

/* ------------------------------------------------------------------ */
/* Technical trend (deterministic app metrics only)                    */
/* ------------------------------------------------------------------ */

export const technicalMetricSchema = z.object({
  metric: z.string(),
  value: z.number().nullable(),
  interpretation: z.string(),
});
export type TechnicalMetric = z.infer<typeof technicalMetricSchema>;

export const technicalTrendSchema = z.object({
  assessment: z.string(),
  evidence: z.array(technicalMetricSchema),
  assumptions: z.array(z.string()),
});
export type TechnicalTrend = z.infer<typeof technicalTrendSchema>;

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

export const rawScenarioSchema = z.object({
  conditions: z.array(z.string()),
  implications: z.string(),
  evidenceClaimIds: z.array(z.string().regex(/^C\d+$/)).default([]),
});
export type RawScenario = z.infer<typeof rawScenarioSchema>;

export const scenarioSchema = z.object({
  conditions: z.array(z.string()),
  implications: z.string(),
  evidence: z.array(evidenceSchema).default([]),
});
export type Scenario = z.infer<typeof scenarioSchema>;

export const rawScenariosSchema = z.object({
  bull: rawScenarioSchema,
  base: rawScenarioSchema,
  bear: rawScenarioSchema,
});
export type RawScenarios = z.infer<typeof rawScenariosSchema>;

export const scenariosSchema = z.object({
  bull: scenarioSchema,
  base: scenarioSchema,
  bear: scenarioSchema,
});
export type Scenarios = z.infer<typeof scenariosSchema>;

/* ------------------------------------------------------------------ */
/* Raw structured analysis (model output, stage 2)                     */
/* ------------------------------------------------------------------ */

export const rawStructuredAnalysisSchema = z.object({
  summary: z.string(),
  marketContext: rawMarketContextSchema,
  technicalTrend: technicalTrendSchema,
  positiveFactors: z.array(rawFactorSchema),
  negativeFactors: z.array(rawFactorSchema),
  uncertainties: z.array(rawUncertaintySchema),
  upcomingCatalysts: z.array(rawCatalystSchema),
  scenarios: rawScenariosSchema,
});
export type RawStructuredAnalysis = z.infer<typeof rawStructuredAnalysisSchema>;

/* ------------------------------------------------------------------ */
/* Resolved structured analysis (returned by the API)                  */
/* ------------------------------------------------------------------ */

export const structuredAnalysisSchema = z.object({
  summary: z.string(),
  marketContext: marketContextSchema,
  technicalTrend: technicalTrendSchema,
  positiveFactors: z.array(factorSchema),
  negativeFactors: z.array(factorSchema),
  uncertainties: z.array(uncertaintySchema),
  upcomingCatalysts: z.array(catalystSchema),
  scenarios: scenariosSchema,
});
export type StructuredAnalysis = z.infer<typeof structuredAnalysisSchema>;

export const analysisApiResponseSchema = z.object({
  analysis: structuredAnalysisSchema,
  sources: z.array(sourceSchema),
  generatedAt: z.string(),
  model: z.string(),
});
export type AnalysisApiResponse = z.infer<typeof analysisApiResponseSchema>;

/* ------------------------------------------------------------------ */
/* Research claims (internal, built from Tavily result content)        */
/* ------------------------------------------------------------------ */

export interface ResearchClaim {
  id: string;
  text: string;
  sourceIds: string[];
}

/* ------------------------------------------------------------------ */
/* Price Move Explanation (V1, current analysis only)                  */
/* ------------------------------------------------------------------ */

// Strict on purpose: unknown fields are rejected, nothing arbitrary is
// accepted into the price-move research pipeline.
export const priceMoveRequestSchema = z
  .object({
    symbol: z.string().min(1).max(20),
    companyName: z.string().nullable(),
    region: z.string().nullable(),
    currency: z.string().nullable(),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    fromClose: z.number().positive(),
    toClose: z.number().positive(),
    absoluteChange: z.number().finite(),
    percentChange: z.number().finite(),
    fromVolume: z.number().finite().nullable(),
    toVolume: z.number().finite().nullable(),
  })
  .strict();
export type PriceMoveRequest = z.infer<typeof priceMoveRequestSchema>;

export const priceMoveSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fromClose: z.number().positive(),
  toClose: z.number().positive(),
  absoluteChange: z.number().finite(),
  percentChange: z.number().finite(),
});
export type PriceMove = z.infer<typeof priceMoveSchema>;

export const priceMoveFactorSchema = z.object({
  title: z.string(),
  explanation: z.string(),
  evidence: z.array(evidenceSchema).min(1),
  evidenceQuality: evidenceQualitySchema,
});
export type PriceMoveFactor = z.infer<typeof priceMoveFactorSchema>;

export const rawPriceMoveFactorSchema = z.object({
  title: z.string(),
  explanation: z.string(),
  evidence: z.array(rawEvidenceSchema).min(1),
  evidenceQuality: evidenceQualitySchema,
});
export type RawPriceMoveFactor = z.infer<typeof rawPriceMoveFactorSchema>;

export const rawPriceMoveExplanationSchema = z.object({
  explanationFound: z.boolean(),
  summary: z.string(),
  factors: z.array(rawPriceMoveFactorSchema),
  uncertainty: z.string(),
});
export type RawPriceMoveExplanation = z.infer<
  typeof rawPriceMoveExplanationSchema
>;

export const priceMoveExplanationSchema = z.object({
  generatedAt: z.string(),
  move: priceMoveSchema,
  summary: z.string(),
  factors: z.array(priceMoveFactorSchema),
  uncertainty: z.string(),
  sources: z.array(sourceSchema),
});
export type PriceMoveExplanation = z.infer<typeof priceMoveExplanationSchema>;
export type PriceMoveApiResponse = PriceMoveExplanation;

/* ------------------------------------------------------------------ */
/* Error codes                                                         */
/* ------------------------------------------------------------------ */

export const analysisErrorCodeSchema = z.enum([
  "invalid_request",
  "gemini_unavailable",
  "service_unavailable",
  "rate_limit",
  "network_error",
  "invalid_response",
  "insufficient_evidence",
  "server_error",
]);
export type AnalysisErrorCode = z.infer<typeof analysisErrorCodeSchema>;