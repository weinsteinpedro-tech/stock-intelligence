/* ------------------------------------------------------------------ */
/* Display-only cleaning for external evidence excerpts.               */
/*                                                                     */
/* This never feeds back into ResearchClaim, the claim ledger, the     */
/* Stage-2 prompt, C->S resolution, or any authoritative type. It only */
/* shapes text for the UI. It is deterministic and performs NO         */
/* rewriting of editorial words: it removes recognized non-editorial   */
/* "chrome" (nav/filter bars, search fragments, ad/newsletter CTAs,    */
/* empty date labels), collapses whitespace, trims, and truncates      */
/* visually.                                                           */
/*                                                                     */
/* cleanEvidenceExcerpt(text, sourceTitle?, publisher?) may also use the   */
/* source title as an "anchor": when it appears unambiguously near the     */
/* start of the snippet, everything up to and including it is dropped (the */
/* card already shows the title as a link). The title may be matched as-is */
/* or with a strict trailing " - <publisher>" / " — <publisher>" /         */
/* " | <publisher>" suffix removed, using the supplied publisher exactly.  */
/* ------------------------------------------------------------------ */

export const EXCERPT_MAX_LENGTH = 400;
const EXCERPT_MIN_MEANINGFUL = 60;
export const EXCERPT_FALLBACK =
  "Source excerpt available at the linked article.";

// A source title only anchors the excerpt when it appears at/before this
// offset in the (already cleaned) snippet.
export const TITLE_ANCHOR_WINDOW = 350;

const COLLAPSE_RE = /[\s\u00A0\u2000-\u200A\u2028\u2029\u2192\u2794]+/g;

const LEADING_ELLIPSIS_RE = /^(?:\.{3,}|…|[\u00B7\u2022])[\s]*/;

const LEADING_LIST_MARKER_RE = /^[\u2022\u00B7»>*][\s]+/;

const HEADING_MARKER_RE = /#+\u0020/g;

// Non-editorial "chrome": navigation/filter bars, search-result fragments,
// pagination prompts, newsletter/advert CTAs. Removed only as whole
// phrases, so no editorial word is rewritten or reordered.
const NAV_NOISE_RES: RegExp[] = [
  /advanced\s+search/gi,
  /search\s+results/gi,
  /no\s+results?\s+found/gi,
  /(?:all\s+)?news\s+articles\s+video[s]?\s+podcasts?/gi,
  /top\s+stories/gi,
  /scroll\s+to\s+continue/gi,
  /get\s+a\s+daily\s+digest[^\w]*/gi,
  /sign\s+up\s+here[^\w]*/gi,
  /subscribe\s+now[^\w]*/gi,
  /continue\s+reading/gi,
  /read\s+more/gi,
  /(?:log\s+in|login)[^\w]*or\s+subscribe[^\w]*/gi,
  /already\s+a\s+subscriber[^\w]*/gi,
  /you\s+might\s+also\s+like[^\w]*/gi,
  /recommended\s+for\s+you[^\w]*/gi,
  /trending\s+now[^\w]*/gi,
  /advertisement[^\w]*/gi,
  /related:[^\w]*/gi,
  /last\s+updated\s*:\s*first\s+published\s*:\s*/gi,
];

// Short single-token nav fragments. Tolerated ONLY at the very start of a
// snippet: as a leading token they are nav chrome, never editorial copy.
const LEADING_NAV_TOKENS = [
  "symbols",
  "authors",
  "sections",
  "columns",
  "videos",
  "podcasts",
  "menu",
  "editions",
];

// Trailing ellipsis/separator runs left behind by removed CTAs.
const TRAILING_JUNK_RE = /(?:\.{3,}|…|[\u00B7/|])[\s\u00B7/|…]*$/;

function stripLeadingNavTokens(text: string): string {
  let t = text;
  let changed = true;
  while (changed) {
    changed = false;
    t = t.trimStart();
    for (const token of LEADING_NAV_TOKENS) {
      const re = new RegExp(`^${token}(?:[^\\w\\s]|\\s)+`, "i");
      if (re.test(t)) {
        t = t.replace(re, "\u0020").trimStart();
        changed = true;
        break;
      }
    }
  }
  return t.trimStart();
}

function normalizeForAnchor(value: string): string {
  return value.replace(COLLAPSE_RE, "\u0020").trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// If the title ends in exactly " - <publisher>" (also " — " or " | "),
// return the title without that suffix. No word is ever modified: only a
// strict, whitespace-normalized, case-insensitive suffix match qualifies.
function stripPublisherSuffix(
  title: string,
  publisher: string,
): string | null {
  const pub = normalizeForAnchor(publisher);
  if (!pub) return null;
  const suffix = new RegExp(
    `\u0020(?:-|—|\\|)\u0020${escapeRegExp(pub)}$`,
  );
  if (!suffix.test(title)) return null;
  return title.replace(suffix, "");
}

// Conservative anchor candidates, longest first:
//   A. the full source title
//   B. the title minus a strict " - <publisher>" suffix (when publisher is
//      supplied and matches exactly)
function buildAnchorCandidates(
  sourceTitle: string | undefined,
  publisher: string | undefined,
): string[] {
  const title = sourceTitle ? normalizeForAnchor(sourceTitle) : "";
  if (!title) return [];
  const candidates = [title];
  if (publisher) {
    const withoutPublisher = stripPublisherSuffix(title, publisher);
    if (withoutPublisher && withoutPublisher !== title) {
      candidates.push(withoutPublisher);
    }
  }
  return candidates;
}

// If a valid candidate appears unambiguously near the start of the snippet,
// cut everything before (and including) it. The card already shows the title
// as a link, so repeating it in the excerpt is pure chrome noise. Returns
// null when no anchor must be applied (no candidates, or none appear within
// TITLE_ANCHOR_WINDOW). The longest appearing candidate wins.
function applyTitleAnchor(
  text: string,
  candidates: string[],
): string | null {
  const textKey = text.toLowerCase();
  let bestText = "";
  let bestIndex = -1;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const index = textKey.indexOf(candidate);
    if (index < 0 || index > TITLE_ANCHOR_WINDOW) continue;
    if (candidate.length > bestText.length) {
      bestText = candidate;
      bestIndex = index;
    }
  }
  if (bestIndex < 0) return null;
  return text.slice(bestIndex + bestText.length).trim();
}

function truncateToMax(text: string): string {
  if (text.length <= EXCERPT_MAX_LENGTH) return text;
  const windowText = text.slice(0, EXCERPT_MAX_LENGTH);
  const minCut = Math.floor(EXCERPT_MAX_LENGTH * 0.5);
  const sentenceEnd = /[.!?](?:["')\]]*)(?=\s|$)/g;
  let cut = -1;
  let match: RegExpExecArray | null;
  while ((match = sentenceEnd.exec(windowText)) !== null) {
    const end = match.index + match[0].length;
    if (end >= minCut) cut = end;
  }
  if (cut > 0) return `${text.slice(0, cut).trim()}\u2026`;
  const lastSpace = windowText.lastIndexOf(" ");
  if (lastSpace >= minCut) return `${text.slice(0, lastSpace).trim()}\u2026`;
  return `${windowText.trim()}\u2026`;
}

export function cleanEvidenceExcerpt(
  text: string,
  sourceTitle?: string,
  publisher?: string,
): string {
  let t = text.replace(COLLAPSE_RE, "\u0020");
  for (const noise of NAV_NOISE_RES) t = t.replace(noise, "\u0020");
  t = stripLeadingNavTokens(t);
  t = t
    .replace(LEADING_ELLIPSIS_RE, "\u0020")
    .replace(LEADING_LIST_MARKER_RE, "\u0020");
  t = t.replace(HEADING_MARKER_RE, "");
  t = t.replace(COLLAPSE_RE, "\u0020").trim();

  const anchored = applyTitleAnchor(t, buildAnchorCandidates(sourceTitle, publisher));
  if (anchored !== null) t = anchored;

  t = t.replace(TRAILING_JUNK_RE, "");
  t = t.replace(COLLAPSE_RE, "\u0020").trim();
  if (t.length < EXCERPT_MIN_MEANINGFUL) return EXCERPT_FALLBACK;
  return truncateToMax(t);
}