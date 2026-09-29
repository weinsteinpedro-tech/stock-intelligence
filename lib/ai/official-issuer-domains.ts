/* ------------------------------------------------------------------ */
/* SYMBOL-SCOPED OFFICIAL ISSUER DOMAINS (V1)                          */
/*                                                                     */
/* Explicit, auditable registry mapping a verified issuer identity to */
/* its corporate / Investor Relations domains. These domains are       */
/* treated as primary ONLY for that symbol, NEVER as global trusted    */
/* domains. The global trust allowlist in gemini.ts is untouched.      */
/*                                                                     */
/* Security:                                                        */
/* - No automatic domain discovery here. No guessing from company     */
/*   name, symbol, or first search result.                             */
/* - Matching is exact hostname equality or a full subdomain suffix   */
/*   (host.endsWith("." + allowed)); never substring matching.        */
/* - Domains are normalized (lowercase, www. stripped) before matches. */
/*                                                                     */
/* TODO: Automated issuer-domain verification can later use            */
/* authoritative issuer identity data (e.g. SEC ticker/CIK/name        */
/* mapping) plus a separate verification step, but must never          */
/* auto-trust a candidate from one search result.                      */
/* ------------------------------------------------------------------ */

import { classifySource, TAVILY_RETRIEVAL_DOMAINS } from "./gemini";
import type { Source } from "./types";

export interface VerifiedIssuerIdentity {
  symbol: string;
  companyName: string;
  cik?: string;
  officialDomains: string[];
}

// V1 registry: EXPLICIT and auditable. Only AAPL is present. Adding an
// issuer is a code-level review, never a runtime inference.
const OFFICIAL_ISSUER_REGISTRY: readonly VerifiedIssuerIdentity[] = [
  {
    symbol: "AAPL",
    companyName: "Apple Inc.",
    cik: "0000320193",
    officialDomains: ["apple.com", "investor.apple.com"],
  },
];

export function normalizeHostname(hostname: string): string {
  return hostname.trim().replace(/^www\./, "").toLowerCase();
}

export function getVerifiedIssuerIdentity(
  symbol: string,
): VerifiedIssuerIdentity | null {
  const role = symbol.trim().toUpperCase();
  return (
    OFFICIAL_ISSUER_REGISTRY.find((identity) => identity.symbol === role) ??
    null
  );
}

export function getVerifiedOfficialDomains(symbol: string): string[] {
  const identity = getVerifiedIssuerIdentity(symbol);
  return identity ? Array.from(identity.officialDomains) : [];
}

// Exact-or-subdomain matching only. Never substring matching.
export function isVerifiedOfficialDomain(
  symbol: string,
  hostname: string,
): boolean {
  const host = normalizeHostname(hostname);
  const identity = getVerifiedIssuerIdentity(symbol);
  if (!identity) return false;
  return identity.officialDomains.some(
    (allowedDomain) =>
      host === allowedDomain || host.endsWith(`.${allowedDomain}`),
  );
}

// Contextual classification for analysis. The GLOBAL classifySource is never
// changed: this is a symbol-scoped overlay used only where a symbol context
// exists (e.g. the price-move pipeline).
//
// Rules:
//   1. If classifySource(domain) already yields primary or
//      high_quality_secondary, keep it.
//   2. Else if the domain is a verified official domain of `symbol`,
//      return primary.
//   3. Otherwise return other.
//
// So investor.apple.com + AAPL => primary, but investor.apple.com + MSFT
// => other.
export function classifySourceForSymbol(
  domain: string,
  symbol: string,
): Source["quality"] {
  const normalized = normalizeHostname(domain);
  const global = classifySource(normalized);
  if (global === "primary" || global === "high_quality_secondary") {
    return global;
  }
  if (isVerifiedOfficialDomain(symbol, normalized)) return "primary";
  return "other";
}

// Retrieval domain list for a symbol: the current global trusted domains PLUS
// that symbol's verified official domains, deduplicated. Never mutates the
// global TAVILY_RETRIEVAL_DOMAINS.
export function getRetrievalDomainsForSymbol(symbol: string): string[] {
  const merged = new Set(TAVILY_RETRIEVAL_DOMAINS);
  for (const domain of getVerifiedOfficialDomains(symbol)) {
    merged.add(normalizeHostname(domain));
  }
  return Array.from(merged);
}