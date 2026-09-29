/* ------------------------------------------------------------------ */
/* Price Move Explanation — deterministic SOURCE RELEVANCE layer.      */
/*                                                                     */
/* Trust is decided elsewhere (classifySource/toSource). This module   */
/* adds the "relevant to the selected move" requirement that is        */
/* specific to /api/explain-price-move:                                */
/*                                                                     */
/*   - quote/profile pages for OTHER tickers are rejected               */
/*   - company-specific sources need a clear company signal            */
/*   - macro sources are allowed only as market_context                */
/*   - navigation/sidebar/ticker-chrome content is rejected before     */
/*     it can ever become a claim                                      */
/*   - publishedDate (never invented) must fall inside a small window   */
/*     around the move, or the source needs strong company relevance    */
/*                                                                     */
/* Pure and deterministic: only title/url/content + the request data + */
/* the already-derived source metadata. No dictionaries of companies,  */
/* no fuzzy matching, no network, no randomness.                       */
/* ------------------------------------------------------------------ */

import type { Source } from "./types";

export const PRICE_MOVE_WINDOW_DAYS = 3;
export const PRICE_MOVE_MIN_CONTENT_LENGTH = 100;

export type PriceMoveRole = "company" | "market_context";
export type PriceMoveDiscardReason =
  | "untrusted_domain"
  | "low_value_secondary"
  | "invalid_content"
  | "too_short"
  | "unrelated_quote_page"
  | "company_mismatch"
  | "outside_move_window"
  | "navigation_or_boilerplate"
  | "insufficient_relevance"
  | "generic_quote_content"
  | "no_event_signal";

export interface PriceMoveSourceInput {
  title: string;
  url: string;
  content: string;
  domain: string;
  /** Natural classification of the domain (classifySource), before hygiene downgrades. */
  classification: Source["quality"];
  /** Final quality (after low-value-secondary downgrade). */
  quality: Source["quality"];
  publishedDate: string | null;
}

export interface PriceMoveContext {
  symbol: string;
  companyName: string | null;
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
}

export type PriceMoveRelevanceVerdict =
  | { status: "relevant"; role: PriceMoveRole; dateVerified: boolean }
  | { status: "discarded"; reason: PriceMoveDiscardReason };

/* ------------------------------------------------------------------ */
/* Date helpers (UTC, calendar-safe, never invented)                   */
/* ------------------------------------------------------------------ */

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function shiftIsoDate(iso: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const ms =
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) +
    days * 86_400_000;
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function isWithinMoveWindow(
  date: string,
  fromDate: string,
  toDate: string,
): boolean {
  const lower = shiftIsoDate(fromDate, -PRICE_MOVE_WINDOW_DAYS);
  const upper = shiftIsoDate(toDate, PRICE_MOVE_WINDOW_DAYS);
  if (lower === null || upper === null) return false;
  return date >= lower && date <= upper; // ISO strings sort chronologically
}

/* ------------------------------------------------------------------ */
/* Token helpers                                                       */
/* ------------------------------------------------------------------ */

function tokens(value: string): string[] {
  return value.match(/[a-z0-9]+/gi)?.map((token) => token.toLowerCase()) ?? [];
}

const COMPANY_STOPWORDS = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "ltd",
  "limited",
  "plc",
  "gmbh",
  "ag",
  "nv",
  "llc",
  "lp",
  "company",
  "companies",
  "group",
  "holdings",
  "intl",
  "international",
  "the",
  "of",
  "and",
  "for",
]);

export function companyNameTokens(companyName: string | null): string[] {
  if (!companyName) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens(companyName)) {
    if (token.length < 3) continue;
    if (COMPANY_STOPWORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    result.push(token);
  }
  return result;
}

export function hasSymbolToken(text: string, symbol: string): boolean {
  const sym = symbol.toLowerCase();
  if (!sym) return false;
  return tokens(text).includes(sym);
}

export function hasCompanyNameSignal(
  text: string,
  companyTokenList: string[],
): boolean {
  if (companyTokenList.length === 0) return false;
  const textTokens = tokens(text);
  return companyTokenList.some((token) => textTokens.includes(token));
}

/* ------------------------------------------------------------------ */
/* Quote/profile page detection                                        */
/* ------------------------------------------------------------------ */

const QUOTE_PAGE_TITLE_PATTERNS = [
  /\bstock\s+price\b/i,
  /\bstock\s+quote\b/i,
  /\bcompany\s+(?:profile|overview)\b/i,
  /\bstock\s+(?:profile|facts|summary)\b/i,
  /\bticker\s+(?:page|quote)\b/i,
];

const QUOTE_PAGE_URL_PATTERNS = [
  /\/quote(?:s)?\//i,
  /\/investing\/stock\//i,
  /\/investing\/quote\//i,
  /\/stock\/quote\//i,
  /\/company-profile\//i,
  /\/quote\/print\//i,
];

export function isQuotePage(title: string, url: string): boolean {
  return (
    QUOTE_PAGE_TITLE_PATTERNS.some((pattern) => pattern.test(title)) ||
    QUOTE_PAGE_URL_PATTERNS.some((pattern) => pattern.test(url))
  );
}

// Words that look like all-caps ticks but are common non-ticker tokens in
// titles (uppercase formatting). Only title/url tokens go through this list,
// so the risk surface is small.
const NON_TICKER_CAPS = new Set([
  "stock",
  "stocks",
  "quote",
  "quotes",
  "price",
  "prices",
  "news",
  "market",
  "markets",
  "update",
  "updates",
  "report",
  "reports",
  "global",
  "live",
  "trading",
  "trade",
  "recap",
  "movers",
  "watchlist",
  "profile",
  "overview",
  "company",
  "companies",
  "inc",
  "corp",
  "ltd",
  "group",
  "trust",
  "fund",
  "funds",
  "etf",
  "etfs",
  "ceo",
  "cfo",
  "eps",
  "ipo",
  "sec",
  "fed",
  "gdp",
  "cpi",
  "ppi",
  "nyse",
  "nasdaq",
  "dow",
  "spx",
  "stoxx",
  "kospi",
  "nikkei",
  "analysis",
  "analyst",
  "analysts",
  "research",
  "daily",
  "today",
  "yesterday",
  "week",
  "month",
  "year",
  "asset",
  "assets",
  "capital",
  "equity",
  "debt",
  "income",
  "common",
  "series",
  "class",
  "unit",
  "units",
  "dep",
  "sector",
  "sectors",
]);

// Title/URL runs of 3-5 consecutive capitals that are not OUR symbol nor a
// known non-ticker word -> strong sign this page is about a DIFFERENT ticker.
// Runs shorter than 3 are ignored to avoid single-letter article artifacts
// (e.g. the "A" in "Apple").
export function foreignTickerInTitle(
  title: string,
  url: string,
  symbol: string,
): boolean {
  const sym = symbol.toLowerCase();
  const hay = `${title} ${url}`.replace(/[a-z]+/g, " ");
  for (const token of hay.match(/[A-Z]{3,5}/g) ?? []) {
    const lower = token.toLowerCase();
    if (lower === sym) continue;
    if (NON_TICKER_CAPS.has(lower)) continue;
    return true;
  }
  return false;
}

export interface QuotePageInfo {
  isQuotePage: boolean;
  otherTicker: boolean;
}

export function classifyQuotePage(
  title: string,
  url: string,
  symbol: string,
): QuotePageInfo {
  const detected = isQuotePage(title, url);
  if (!detected) return { isQuotePage: false, otherTicker: false };
  const other = foreignTickerInTitle(title, url, symbol);
  return { isQuotePage: true, otherTicker: other };
}

/* ------------------------------------------------------------------ */
/* Navigation / sidebar / boilerplate hygiene                          */
/* ------------------------------------------------------------------ */

const CHROME_PATTERNS = [
  /\bmarket\s+movers\b/i,
  /\bbest\s+new\s+ideas\s+in\s+money\b/i,
  /\bmarket\s+data(?:\s+(?:and|&)\s+tools)?\b/i,
  /\bsite\s+search\b/i,
  /open\s+site\s+search\b/i,
  /close\s+search\s+overlay\b/i,
  /search\s+overlay\b/i,
  /\bwatchlist\b/i,
  /\bnewsletter\b/i,
  /\bsign\s+up\b/i,
  /\bsubscribe\b/i,
  /already\s+a\s+subscriber\b/i,
  /\badvertisement\b/i,
  /\brecommended\s+for\s+you\b/i,
  /\bmost\s+popular\b/i,
  /\btrending\b/i,
  /\byou\s+may\s+also\s+like\b/i,
  /\bprivacy\s+(?:policy|preferences)\b/i,
  /\bcookie\s+(?:policy|notice)\b/i,
];

const TICKER_LIST_PATTERNS = [
  /\b(?:top|biggest)\s+(?:gainers?|losers?|movers?)\b/i,
  /\bmost\s+active\b/i,
  /\bbefore\s+the\s+bell\b/i,
  /\bafter\s+the\s+bell\b/i,
];

// Deterministic heuristic: content dominated by navigation/search/ticker
// chrome is rejected BEFORE it can produce a claim. Requires at least two
// distinct chrome markers AND little remaining substantive text.
export function isNavigationOrBoilerplateContent(content: string): boolean {
  const collapsed = content.replace(/\s+/g, " ").trim();
  const chromeMatches = CHROME_PATTERNS.filter((pattern) =>
    pattern.test(collapsed),
  );
  const tickerList = TICKER_LIST_PATTERNS.filter((pattern) =>
    pattern.test(collapsed),
  );
  if (chromeMatches.length < 2 && tickerList.length === 0) return false;

  let stripped = collapsed;
  for (const pattern of CHROME_PATTERNS) {
    stripped = stripped.replace(new RegExp(pattern.source, "gi"), " ");
  }
  for (const pattern of TICKER_LIST_PATTERNS) {
    stripped = stripped.replace(new RegExp(pattern.source, "gi"), " ");
  }
  const remaining = stripped.replace(/\s+/g, "").trim();
  if (chromeMatches.length >= 2 && remaining.length < 160) return true;
  if (tickerList.length >= 2) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Market-context eligibility                                          */
/* ------------------------------------------------------------------ */

const MARKET_CONTEXT_MARKERS = [
  /\bs&p\s*500\b/i,
  /\bnasdaq(?:\s+(?:composite|100))?/i,
  /\bdow\s+jones\b/i,
  /\brussell\b/i,
  /\bvix\b/i,
  /\btreasury\s+yields?/i,
  /\bbond\s+yields?/i,
  /\b(?:federal\s+reserve|fed\s+raises?)\b/i,
  /\binflation\b/i,
  /\bcpi\b|\bppi\b/i,
  /\binterest\s+rates?/i,
  /\brate\s+decision\b/i,
  /\b(?:jobs|nonfarm|unemployment)\s+(?:report|data|rate)/i,
  /\bgdp\b/i,
  /\brecession\b/i,
  /\b(?:stock|equity)\s+market\b/i,
  /\b(?:semiconductor|chipmaker)s?\b/i,
  /\b(?:tech|technology)\s+(?:sector|stocks)\b/i,
  /\b(?:oil|crude)\s+prices?/i,
  /\bus\s+dollar\b/i,
  /\bsell-?off\b/i,
  /\bmarket\s+rally\b/i,
];

export function isMarketContextContent(title: string, content: string): boolean {
  const hay = `${title} ${content}`;
  return MARKET_CONTEXT_MARKERS.some((marker) => marker.test(hay));
}

/* ------------------------------------------------------------------ */
/* EVENT RELEVANCE layer. Trust != company relevance != relevance to   */
/* THIS move. A source for the right company (or a real market event)  */
/* still must contain a material, time-specific signal to be a claim.  */
/*                                                                     */
/* Generic quote/market-mechanics pages are rejected as                */
/* generic_quote_content; relevant pages without any material catalyst */
/* signal are rejected as no_event_signal. Everything here is          */
/* intentionally conservative: when unclear, the result is discarded.  */
/* ------------------------------------------------------------------ */

const QUOTE_LANDING_TITLE_PATTERNS = [
  /\bstock\s+price,?\s+quote\b/i,
  /\bquote,\s+news\s*(?:&|and)\s*history\b/i,
  /\b(?:in-depth|real-?time)\s+quote\b/i,
  /\bdaily\s+stock\s+quote\b/i,
];

const QUOTE_MECHANICS_PATTERNS = [
  /\bbid\s+(?:and\s+)?ask\b|\bbid-ask\b/i,
  /\b(?:national\s+best\s+bid|[^a-z]nbbo)\b/i,
  /\breal-?time\s+(?:quote|bid|ask|trade|prices?|market\s+data)\b/i,
  /\bpowered\s+by\b/i,
  /\bdelayed\s+(?:quote|data|prices?)\b/i,
  /\bmarket\s+data\s+provider\b/i,
  /\bhow\s+stock\s+quotes\s+work\b/i,
  /\bhow\s+(?:the\s+)?markets?\s+work\b/i,
  /\blasts?\s+sale\b/i,
  /\bquote\s+and\s+trade\b/i,
  /\bsubscriber\s+data\b/i,
];

const QUOTE_STAT_PATTERNS = [
  /\bmarket\s+cap(?:italization)?\b/i, // "market cap" / "market capitalization"
  /\btotal\s+shares\s+outstanding\b/i,
  /\bprice\s+to\s+earnings\b|\bpe\s+ratio\b/i,
  /\b52-?week\s+(?:high|low|range)\b/i,
  /\b(?:average|daily)\s+volume\b/i,
  /\bdividend\s+yield\b/i,
  /\bprior\s+closing\s+price\b/i,
];

function countPatternMatches(patterns: RegExp[], hay: string): number {
  return patterns.reduce(
    (count, pattern) => (pattern.test(hay) ? count + 1 : count),
    0,
  );
}

// A page that is ONLY quote machinery provides no explanatory evidence for
// a move: bid/ask definitions, real-time quote mechanics, market data
// provider blurbs, delayed-quote disclaimers, chart/history landing pages,
// price/statistics listings. Applies regardless of which ticker is correct.
export function isGenericQuoteContent(title: string, content: string): boolean {
  const mechanics = countPatternMatches(QUOTE_MECHANICS_PATTERNS, content);
  if (mechanics >= 2) return true;
  const landing = QUOTE_LANDING_TITLE_PATTERNS.some((pattern) =>
    pattern.test(title),
  );
  if (landing) {
    const stats = countPatternMatches(QUOTE_STAT_PATTERNS, content);
    return mechanics >= 1 || stats >= 2;
  }
  return false;
}

// Material, event/catalyst signals. Conservative by design: a page that
// mentions the right company but only evergreens its business does not get a
// price-move claim. Categories mirror the spec (earnings, guidance, product,
// pricing/demand, analyst action, regulatory/legal, M&A, executive moves,
// supply chain/production, partnerships, macro/sector events linked to the
// company, other clearly time-specific developments).
const EVENT_CATALYST_PATTERNS = [
  // earnings / financial results
  /\b(?:quarterly|annual|fiscal)\s+(?:earnings|results?|profit|revenue)\b/i,
  /\bearnings\s+(?:report|beat|miss|results?|call|surprise|season)\b/i,
  /\bnet\s+income\b/i,
  /\b(?:gross|operating)\s+margin\b/i,
  /\bprofits?\s+(?:rose|fell|beat|missed|surged|plunged|jumped|dropped|increased|grew|shrank)\b/i,
  /\brevenue\s+(?:grew|fell|rose|topped|beat|missed|increased|dropped|jumped|soared)\b/i,
  /\brecords?\s+(?:quarterly|quarter|annual)\b/i,
  // guidance / outlook
  /\b(?:guidance|outlook)\b/i,
  /\b(?:raised|cut|lowered|boosted|trimmed)\s+(?:its\s+)?(?:guidance|outlook|forecast|target)\b/i,
  // product launch / announcement
  /\b(?:launch(?:e[ds])?|unveil(?:ed)?|introduc(?:ed)?|debuted|premier(?:ed)?)\b/i,
  /\b(?:new|updated)\s+(?:product|model|device|version|feature|operating\s+system)\b/i,
  /\bannounc(?:ed|ement)?\b/i,
  /\b(?:shipments?|shipping)\s+(?:began|begins|start|ramp)\b/i,
  // pricing / sales / demand
  /\bprice\s+(?:cut|cuts|hike|hikes|increase|reduction)\b/i,
  /\b(?:raised|lowered|cut)\s+(?:prices?|the\s+price\s+of)\b/i,
  /\b(?:strong|weak|soft|robust|sluggish)\s+(?:demand|sales|orders)\b/i,
  // analyst action
  /\banalysts?\s+(?:cut|raised|lowered|upgraded|downgraded|initiated|reiterated|maintained)\b/i,
  /\b(?:price\s+target|target\s+price)\b/i,
  // regulatory action / filing
  /\b(?:sec\s+filing|10-k\b|10-q\b|8-k\b|proxy\s+(?:statement|filing)|regulatory\s+(?:filing|review|scrutiny|action|approval))\b/i,
  /\b(?:lawsuit|litigation|investigation|probe|sued?|charges?\s+filed|indictment)\b/i,
  // acquisition / merger
  /\b(?:acquir(?:es?|ed|ing)|merger|merges?\s+with|takeover|buyout|tender\s+offer|to\s+(?:buy|acquire))\b/i,
  // executive / company announcement
  /\b(?:the\s+company\s+(?:said|announced|reported))\b/i,
  /\b(?:resign(?:ed)?|appoint(?:ed)?|appointment|steps\s+down|stepping\s+down|departure)\b/i,
  // supply chain / production
  /\b(?:supply\s+chain|supplier|component\s+shortage|chip\s+shortage|parts\s+shortage)\b/i,
  /\b(?:production\s+(?:cut|cuts|delay|halts?|pause|ramp))\b/i,
  // partnership / contract
  /\b(?:partnership|partner(?:ing)?\s+with|signed\s+(?:a\s+)?(?:deal|contract)|contract\s+(?:award|win|wins)|agreement\s+with|strategic\s+(?:partnership|alliance|investment))\b/i,
  // macro/sector event materially linked to the company
  /\b(?:broad|technology|tech|mega-?cap|large-?cap)\s+(?:pullback|sell-?off|selloff|rally|slump|retreat|correction)\b/i,
  /\b(?:amid|hit\s+by|following)\s+(?:the|this|a\s+)?(?:sell-?off|inflation|rate\s+(?:hike|cut|decision)|recession|chip|semiconductor|downturn)\b/i,
];

// Whether a source carries at least one material, time-specific development
// that could plausibly move a stock (in the move window). Evergreen,
// profile-only, and market-mechanics content does not count.
export function hasEventSignal(title: string, content: string): boolean {
  return EVENT_CATALYST_PATTERNS.some((pattern) =>
    pattern.test(`${title} ${content}`),
  );
}

// Market-context claims are only explanatory when they describe an ACTUAL
// market/sector event of that window (falls, rallies, moves after reports),
// never when they merely explain how markets/quotes work or list instruments.
const MARKET_ACTIVITY_PATTERNS = [
  /\b(?:stocks?|indexes?|indu|markets?|benchmarks?|tech(?:nology)?\s+shares?|shares?)\s+(?:fell|dropped|rose|rallied|lost|gained|slipped|tumbled|slid|surged|soared|plunged|advanced|climbed|rebounded|recovered|retreated)\b/i,
  /\b(?:broad|stock|equity|tech(?:nology)?)\s+(?:sell-?off|selloff|rall(?:y|ies)|slump|retreat|downturn|advance)\b/i,
  /\b(?:fell|dropped|rose|rallied|slipped|tumbled|surged|soared|plunged|gained|lost|climbed)\b[^.]{0,40}\b(?:percent|%|points|billion)\b/i,
];

export function isMarketActivityContent(
  title: string,
  content: string,
): boolean {
  return MARKET_ACTIVITY_PATTERNS.some((pattern) =>
    pattern.test(`${title} ${content}`),
  );
}

/* ------------------------------------------------------------------ */
/* The verdict                                                         */
/* ------------------------------------------------------------------ */

function discard(reason: PriceMoveDiscardReason): PriceMoveRelevanceVerdict {
  return { status: "discarded", reason };
}

function relevant(
  role: PriceMoveRole,
  dateVerified: boolean,
): PriceMoveRelevanceVerdict {
  return { status: "relevant", role, dateVerified };
}

export function assessPriceMoveRelevance(
  input: PriceMoveSourceInput,
  ctx: PriceMoveContext,
): PriceMoveRelevanceVerdict {
  const title = input.title.trim();
  const url = input.url.trim();
  const content = input.content.trim();
  if (!title || !url || !content) return discard("invalid_content");

  // 1. TRUST (never relaxed): an untrusted source can never be relevant.
  if (input.quality === "other") {
    return discard(
      input.classification === "high_quality_secondary"
        ? "low_value_secondary"
        : "untrusted_domain",
    );
  }

  // 2. Quote/profile pages clearly belonging to ANOTHER ticker.
  const quote = classifyQuotePage(title, url, ctx.symbol);
  if (quote.isQuotePage && quote.otherTicker) {
    return discard("unrelated_quote_page");
  }

  // 3. Content that cannot possibly be substantive.
  if (content.length < PRICE_MOVE_MIN_CONTENT_LENGTH) {
    return discard("too_short");
  }

  // 4. Navigation / sidebar / ticker-chrome contamination.
  if (isNavigationOrBoilerplateContent(content)) {
    return discard("navigation_or_boilerplate");
  }

  // 5. EVENT gate A - generic quote/market-mechanics pages. Even for the
  // CORRECT ticker (or a market page), bid/ask definitions, quote mechanics,
  // market data provider blurbs, chart/history landing pages and stat
  // listings carry no explanatory event and are never claims.
  if (isGenericQuoteContent(title, content)) {
    return discard("generic_quote_content");
  }

  const companyTokens = companyNameTokens(ctx.companyName);
  const strongCompany =
    hasSymbolToken(`${title} ${url}`, ctx.symbol) ||
    hasCompanyNameSignal(`${title} ${url}`, companyTokens);
  const weakCompany =
    hasSymbolToken(content, ctx.symbol) ||
    hasCompanyNameSignal(content, companyTokens);
  const foreignTicker = foreignTickerInTitle(title, url, ctx.symbol);
  const marketContent = isMarketContextContent(title, content);

  const dateKnown = input.publishedDate !== null;
  const inWindow =
    dateKnown &&
    isWithinMoveWindow(input.publishedDate as string, ctx.fromDate, ctx.toDate);

  // 6. EVENT gate B - a relevant source must carry a material, time-specific
  // signal; evergreen/profile-only content explains nothing on any date.
  const eventSignal = hasEventSignal(title, content);
  const marketActivity = isMarketActivityContent(title, content);

  if (strongCompany) {
    if (dateKnown && !inWindow) return discard("outside_move_window");
    if (!eventSignal) return discard("no_event_signal");
    return relevant("company", !dateKnown || inWindow);
  }

  if (marketContent && !foreignTicker) {
    // Market context must be temporally anchored: an undated macro article
    // could be about any day, so it cannot explain a specific move. It must
    // also describe an ACTUAL market event, not how markets/quotes work.
    if (dateKnown && !inWindow) return discard("outside_move_window");
    if (!dateKnown) return discard("insufficient_relevance");
    if (!marketActivity) return discard("no_event_signal");
    return relevant("market_context", true);
  }

  if (weakCompany) {
    if (dateKnown && !inWindow) return discard("outside_move_window");
    // A passing mention with no verifiable date is too weak an anchor.
    if (!dateKnown) return discard("insufficient_relevance");
    if (!eventSignal) return discard("no_event_signal");
    return relevant("company", true);
  }

  return discard(
    foreignTicker ? "company_mismatch" : "insufficient_relevance",
  );
}