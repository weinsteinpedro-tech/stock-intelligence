import {
  isCanonicalDate,
  InvalidSharpePortfolioInputError,
  InvalidReturnSeriesError,
} from "../analytics";
import {
  LiveStockAnalysisDependencyError,
  LiveStockAnalysisInputError,
  type LiveStockAnalysisDependencies,
  runLiveStockAnalysis,
} from "./live-stock-analysis";
import {
  PortfolioAnalysisExecutionError,
  PortfolioAnalysisInputError,
  type PortfolioAnalysisSnapshot,
} from "./portfolio-analysis";
import {
  TiingoApiKeyMissingError,
  TiingoHttpError,
  TiingoMalformedPayloadError,
  TiingoMissingAdjustedCloseError,
  TiingoProvider,
} from "../market-data/tiingo";
import {
  FredApiKeyMissingError,
  FredHttpError,
  FredMalformedPayloadError,
  FredRateLimitError,
  FredProvider,
  InvalidFredObservationError,
} from "../economic-data/fred";
import { InvalidMarketCloseError } from "../financial-data/adapters/market-prices";
import {
  NoEligibleRiskFreeObservationError,
  RiskFreeObservationTooStaleError,
} from "../financial-data/rates";
import {
  AnchorTooStaleError,
  InvalidExpectedMarketReturnInputError,
  NoEligibleAnchorError,
} from "../financial-data/market-return";

export interface AnalyticsRouteSuccessResponse {
  ok: true;
  data: PortfolioAnalysisSnapshot;
}

export interface AnalyticsRouteErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type AnalyticsRouteResponse =
  | AnalyticsRouteSuccessResponse
  | AnalyticsRouteErrorResponse;

export interface AnalyticsRouteDependencies {
  marketProvider: LiveStockAnalysisDependencies["marketProvider"];
  economicProvider: LiveStockAnalysisDependencies["economicProvider"];
}

interface ErrorMapping {
  status: number;
  body: AnalyticsRouteErrorResponse;
}

/**
 * Sanitizes an error message to prevent URL, token, or secret exposure.
 */
function sanitizeMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s]+/g, "[upstream service]")
    .replace(/(?:api_key|token)=[^\s&]+/gi, "[redacted]")
    .replace(/[a-zA-Z0-9_-]{20,}/g, "[redacted]");
}

/**
 * Maps known domain, validation, and provider errors to deterministic HTTP responses.
 * Never leaks stack traces, API keys, or raw URLs.
 */
function mapErrorToResponse(error: unknown): ErrorMapping {
  // 400 Bad Request
  if (error instanceof LiveStockAnalysisInputError) {
    return {
      status: 400,
      body: {
        ok: false,
        error: {
          code: "invalid_request",
          message: sanitizeMessage(error.message),
        },
      },
    };
  }

  // 429 Rate Limit (FRED exposes dedicated FredRateLimitError)
  if (error instanceof FredRateLimitError) {
    return {
      status: 429,
      body: {
        ok: false,
        error: {
          code: "rate_limit",
          message:
            "Rate limit reached from economic data provider. Please try again shortly.",
        },
      },
    };
  }

  // 422 Unprocessable Content (valid request format, but financial data cannot produce analysis)
  if (
    error instanceof InvalidMarketCloseError ||
    error instanceof TiingoMissingAdjustedCloseError
  ) {
    return {
      status: 422,
      body: {
        ok: false,
        error: {
          code: "missing_adjusted_close",
          message:
            "Adjusted close prices are missing or invalid for one or more requested assets.",
        },
      },
    };
  }

  if (error instanceof RiskFreeObservationTooStaleError) {
    return {
      status: 422,
      body: {
        ok: false,
        error: {
          code: "risk_free_rate_stale",
          message: sanitizeMessage(error.message),
        },
      },
    };
  }

  if (error instanceof NoEligibleRiskFreeObservationError) {
    return {
      status: 422,
      body: {
        ok: false,
        error: {
          code: "risk_free_rate_unavailable",
          message: sanitizeMessage(error.message),
        },
      },
    };
  }

  if (error instanceof AnchorTooStaleError) {
    return {
      status: 422,
      body: {
        ok: false,
        error: {
          code: "market_return_anchor_stale",
          message: sanitizeMessage(error.message),
        },
      },
    };
  }

  if (error instanceof NoEligibleAnchorError) {
    return {
      status: 422,
      body: {
        ok: false,
        error: {
          code: "market_return_anchor_missing",
          message: sanitizeMessage(error.message),
        },
      },
    };
  }

  if (error instanceof InvalidExpectedMarketReturnInputError) {
    return {
      status: 422,
      body: {
        ok: false,
        error: {
          code: "expected_market_return_error",
          message: sanitizeMessage(error.message),
        },
      },
    };
  }

  if (
    error instanceof InvalidSharpePortfolioInputError ||
    error instanceof InvalidReturnSeriesError
  ) {
    return {
      status: 422,
      body: {
        ok: false,
        error: {
          code: "insufficient_data",
          message: sanitizeMessage(error.message),
        },
      },
    };
  }

  if (error instanceof PortfolioAnalysisInputError) {
    return {
      status: 422,
      body: {
        ok: false,
        error: {
          code: "analysis_input_error",
          message: sanitizeMessage(error.message),
        },
      },
    };
  }

  // 502 Bad Gateway (upstream network or payload errors)
  if (
    error instanceof TiingoHttpError ||
    error instanceof TiingoMalformedPayloadError ||
    error instanceof FredHttpError ||
    error instanceof FredMalformedPayloadError ||
    error instanceof InvalidFredObservationError
  ) {
    return {
      status: 502,
      body: {
        ok: false,
        error: {
          code: "upstream_provider_error",
          message:
            "Failed to retrieve required data from upstream market or economic provider.",
        },
      },
    };
  }

  // 500 Internal Server Error (unconfigured services - never leak API key names)
  if (error instanceof TiingoApiKeyMissingError) {
    return {
      status: 500,
      body: {
        ok: false,
        error: {
          code: "service_unconfigured",
          message: "Market data service is not configured.",
        },
      },
    };
  }

  if (error instanceof FredApiKeyMissingError) {
    return {
      status: 500,
      body: {
        ok: false,
        error: {
          code: "service_unconfigured",
          message: "Economic data service is not configured.",
        },
      },
    };
  }

  // 500 Internal Server Error (unexpected / internal)
  if (
    error instanceof LiveStockAnalysisDependencyError ||
    error instanceof PortfolioAnalysisExecutionError
  ) {
    return {
      status: 500,
      body: {
        ok: false,
        error: {
          code: "server_error",
          message:
            "An internal server error occurred while performing portfolio analysis.",
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: {
        code: "server_error",
        message:
          "An internal server error occurred while performing portfolio analysis.",
      },
    },
  };
}

/**
 * Handles incoming POST requests for live quantitative analytics.
 * Enforces validation, executes live stock analysis with server-side providers,
 * and returns safe, standardized JSON.
 */
export async function handleAnalyticsRequest(
  request: Request,
  dependencies?: LiveStockAnalysisDependencies,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        ok: false,
        error: {
          code: "invalid_request",
          message: "Request body must be valid JSON.",
        },
      },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "invalid_request",
          message: "Request body must be a JSON object.",
        },
      },
      { status: 400 },
    );
  }

  const record = body as Record<string, unknown>;

  // Reject explicit credential or provider override injection attempts
  if (
    "apiKey" in record ||
    "providers" in record ||
    "marketProvider" in record ||
    "economicProvider" in record
  ) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "invalid_request",
          message: "API keys or provider overrides are not accepted.",
        },
      },
      { status: 400 },
    );
  }

  const symbol =
    typeof record.symbol === "string" ? record.symbol.trim() : "";
  if (symbol.length === 0) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "invalid_request",
          message: "A non-empty stock symbol is required.",
        },
      },
      { status: 400 },
    );
  }

  const benchmarkSymbol =
    typeof record.benchmarkSymbol === "string"
      ? record.benchmarkSymbol.trim()
      : "";
  if (benchmarkSymbol.length === 0) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "invalid_request",
          message: "A non-empty benchmark symbol is required.",
        },
      },
      { status: 400 },
    );
  }

  const asOf = typeof record.asOf === "string" ? record.asOf.trim() : "";
  if (asOf.length === 0 || !isCanonicalDate(asOf)) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "invalid_request",
          message: "A valid canonical date (YYYY-MM-DD) is required for asOf.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const marketProvider =
      dependencies?.marketProvider ?? new TiingoProvider();
    const economicProvider =
      dependencies?.economicProvider ?? new FredProvider();

    const snapshot = await runLiveStockAnalysis(
      {
        symbol,
        benchmarkSymbol,
        asOf,
      },
      {
        marketProvider,
        economicProvider,
      },
    );

    return Response.json({
      ok: true,
      data: snapshot,
    });
  } catch (error) {
    const { status, body: errorBody } = mapErrorToResponse(error);
    return Response.json(errorBody, { status });
  }
}

/**
 * Factory for creating the route POST handler with optional dependency injection.
 * When called without arguments (production), real server-side providers are instantiated.
 */
export function createAnalyticsPostHandler(
  dependencies?: LiveStockAnalysisDependencies,
) {
  return function POST(request: Request): Promise<Response> {
    return handleAnalyticsRequest(request, dependencies);
  };
}
