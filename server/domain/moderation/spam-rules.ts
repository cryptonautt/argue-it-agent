/**
 * Owner: moderation. Pure spam heuristics (PRD §8.9, §16 "spam patterns"). No DB access here — `spam.ts`
 * gathers the user's recent activity and calls `evaluateSpam()`. Every rule is deliberately conservative:
 * a heated football argument, a crypto price take or a repeated "Facts 💯" must never be blocked.
 *
 * Scoring: each signal carries a weight in (0, 1); signals combine as a noisy-OR
 * (score = 1 − Π(1 − wᵢ)), so one weak signal stays below review but several weak ones add up.
 *   score ≥ REVIEW_THRESHOLD → "review" (content is posted, an automatic report is opened)
 *   score ≥ BLOCK_THRESHOLD  → "block"  (the caller rejects the write with `message`)
 */

export const REVIEW_THRESHOLD = 0.5;
export const BLOCK_THRESHOLD = 0.9;

/** Texts shorter than this (after normalising) are never treated as duplicates ("lol", "Facts"). */
export const MIN_DUPLICATE_LENGTH = 20;
/** Cross-user duplicates need more text: short slogans are legitimately repeated by fans. */
export const MIN_CROSS_USER_DUPLICATE_LENGTH = 40;
export const NEAR_DUPLICATE_SIMILARITY = 0.85;

export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DOUBLE_POST_WINDOW_MS = 10 * 60 * 1000;
export const BURST_SHORT_WINDOW_MS = 60 * 1000;
export const BURST_LONG_WINDOW_MS = 10 * 60 * 1000;

export type SpamSignalCode =
  | "duplicate_self"
  | "near_duplicate_self"
  | "duplicate_cross_user"
  | "link_heavy"
  | "link_shortener"
  | "repeated_link"
  | "burst"
  | "contact_solicitation"
  | "money_scheme";

export interface SpamSignal {
  code: SpamSignalCode;
  /** 0–1 contribution before noisy-OR combination. */
  weight: number;
  /** Short moderator-facing explanation (never shown to the poster). */
  detail: string;
}

export type ContentDecision = "allow" | "review" | "block";

export interface ContentAssessment {
  decision: ContentDecision;
  /** Combined 0–1 score. */
  score: number;
  signals: SpamSignal[];
  /** User-facing reason when decision = "block"; null otherwise. */
  message: string | null;
}

export interface RecentItem {
  text: string;
  links: readonly string[];
  createdAt: Date;
  /** Other texts of the same post to match duplicates against (e.g. an argument's body alone). */
  altTexts?: readonly string[];
}

const textsOf = (item: RecentItem): string[] => [item.text, ...(item.altTexts ?? [])];

export interface SpamInput {
  text: string;
  /** Explicit evidence/argument links (URLs inside `text` are found automatically). */
  links: readonly string[];
  /** The same user's arguments/comments from the last 24h, newest first. */
  recentOwn: readonly RecentItem[];
  /** Distinct OTHER users who posted the exact same (normalised) text in the last 24h. */
  crossUserDuplicateAuthors: number;
  now: Date;
}

// ---------------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------------

/**
 * Normalise for exact-duplicate comparison: lowercase, collapse whitespace, trim.
 * Mirrors the SQL `lower(btrim(regexp_replace(body, '\s+', ' ', 'g')))` used for cross-user matching.
 */
export function normalizeForDuplicate(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Word set without punctuation, for near-duplicate similarity. */
function tokens(text: string): string[] {
  return normalizeForDuplicate(text)
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(" ")
    .filter((w) => w.length > 0);
}

/**
 * Jaccard similarity of the two texts' word sets (0–1). Word sets (not n-grams) so a spammer swapping a
 * word or two still matches, while different takes on the same topic stay well apart.
 */
export function similarity(a: string, b: string): number {
  const sa = new Set(tokens(a));
  const sb = new Set(tokens(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersection = 0;
  for (const word of sa) if (sb.has(word)) intersection++;
  return intersection / (sa.size + sb.size - intersection);
}

const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)[^\s<>"'()]+/gi;

/** URLs written inside the text body. */
export function extractUrls(text: string): string[] {
  return text.match(URL_IN_TEXT) ?? [];
}

function hostOf(raw: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function canonicalLink(raw: string): string {
  return raw.trim().replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/i, "").toLowerCase();
}

export const LINK_SHORTENERS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "is.gd",
  "cutt.ly",
  "rb.gy",
  "shorturl.at",
  "tiny.cc",
  "ow.ly",
  "buff.ly",
  "rebrand.ly",
  "s.id",
  "t.ly",
]);

// Contact solicitation: Nigerian mobile numbers (+234 / 0 7x,8x,9x) and "WhatsApp/Telegram me" asks.
const PHONE_PATTERN = /(?:\+?234[\s-]?|\b0)[789][01]\d(?:[\s-]?\d){7}\b/;
const CONTACT_PATTERN =
  /\b(?:whats\s?app|telegram|text|call|dm|inbox)\s+(?:me|us|now)\b|\bchat\s+(?:me|us)\s+(?:on|via)\b|\bwa\.me\/|\bt\.me\//i;

// Money schemes: the classic "double your money" / signal-group pitches (not ordinary crypto opinions).
const MONEY_PATTERN =
  /\b(?:double\s+your\s+(?:money|investment|btc|crypto)|guaranteed\s+(?:profit|returns?|income)|investment\s+opportunity|forex\s+signals?|earn\s+[$₦£€]?\s?\d[\d,]*k?\s+(?:daily|weekly|per\s+day)|send\s+(?:\d+\s+)?(?:btc|usdt|eth)\s+(?:and|to)\s+(?:get|receive)|recovery\s+(?:expert|hacker)|flip\s+your\s+(?:money|cash))\b/i;

// ---------------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------------

function duplicateSignals(input: SpamInput): SpamSignal[] {
  const normalized = normalizeForDuplicate(input.text);
  if (normalized.length < MIN_DUPLICATE_LENGTH) return [];
  const nowMs = input.now.getTime();
  const recent = input.recentOwn.filter((r) => nowMs - r.createdAt.getTime() <= DUPLICATE_WINDOW_MS);

  const exact = recent.filter((r) => textsOf(r).some((t) => normalizeForDuplicate(t) === normalized));
  const signals: SpamSignal[] = [];
  if (exact.length > 0) {
    const doublePost = exact.some((r) => nowMs - r.createdAt.getTime() <= DOUBLE_POST_WINDOW_MS);
    const weight = exact.length >= 2 || doublePost ? 0.9 : 0.6;
    signals.push({
      code: "duplicate_self",
      weight,
      detail: `Same text already posted ${exact.length}× in the last 24h${doublePost ? " (within 10 minutes)" : ""}.`,
    });
  } else {
    const near = recent.filter((r) => textsOf(r).some((t) => similarity(t, input.text) >= NEAR_DUPLICATE_SIMILARITY));
    if (near.length > 0) {
      signals.push({
        code: "near_duplicate_self",
        weight: near.length >= 2 ? 0.6 : 0.4,
        detail: `Nearly identical to ${near.length} of their posts in the last 24h.`,
      });
    }
  }

  if (normalized.length >= MIN_CROSS_USER_DUPLICATE_LENGTH && input.crossUserDuplicateAuthors >= 2) {
    signals.push({
      code: "duplicate_cross_user",
      weight: input.crossUserDuplicateAuthors >= 4 ? 0.8 : 0.5,
      detail: `${input.crossUserDuplicateAuthors} other accounts posted the same text in the last 24h (possible coordination).`,
    });
  }
  return signals;
}

function linkSignals(input: SpamInput): SpamSignal[] {
  const all = [...input.links, ...extractUrls(input.text)];
  const unique = [...new Set(all.map(canonicalLink))];
  const signals: SpamSignal[] = [];

  const words = tokens(input.text).length;
  if (unique.length >= 5) {
    signals.push({ code: "link_heavy", weight: 0.6, detail: `${unique.length} links in one post.` });
  } else if (unique.length >= 3 && words / unique.length < 15) {
    signals.push({ code: "link_heavy", weight: 0.4, detail: `${unique.length} links with only ${words} words of text.` });
  }

  const shorteners = [...new Set(all.map(hostOf).filter((h): h is string => h !== null && LINK_SHORTENERS.has(h)))];
  if (shorteners.length > 0) {
    signals.push({ code: "link_shortener", weight: 0.25, detail: `Hides the destination behind ${shorteners.join(", ")}.` });
  }

  if (unique.length > 0) {
    const recentLinks = input.recentOwn.map(
      (r) => new Set([...r.links, ...extractUrls(r.text)].map(canonicalLink)),
    );
    const repeated = unique.filter((link) => recentLinks.filter((set) => set.has(link)).length >= 2);
    if (repeated.length > 0) {
      signals.push({
        code: "repeated_link",
        weight: 0.45,
        detail: `Same link posted in 3+ posts within 24h: ${repeated.slice(0, 2).join(", ")}.`,
      });
    }
  }
  return signals;
}

function burstSignals(input: SpamInput): SpamSignal[] {
  const nowMs = input.now.getTime();
  const within = (ms: number) => input.recentOwn.filter((r) => nowMs - r.createdAt.getTime() <= ms).length;
  const lastMinute = within(BURST_SHORT_WINDOW_MS);
  const lastTen = within(BURST_LONG_WINDOW_MS);
  // Counts exclude the post being assessed, so "5 in the last minute" means this is the 6th.
  if (lastMinute >= 5) return [{ code: "burst", weight: 0.9, detail: `${lastMinute} posts in the last minute.` }];
  if (lastTen >= 20) return [{ code: "burst", weight: 0.9, detail: `${lastTen} posts in the last 10 minutes.` }];
  if (lastTen >= 10) return [{ code: "burst", weight: 0.5, detail: `${lastTen} posts in the last 10 minutes.` }];
  return [];
}

function textPatternSignals(input: SpamInput): SpamSignal[] {
  const signals: SpamSignal[] = [];
  if (PHONE_PATTERN.test(input.text) || CONTACT_PATTERN.test(input.text)) {
    signals.push({ code: "contact_solicitation", weight: 0.3, detail: "Asks people to contact them off-platform." });
  }
  if (MONEY_PATTERN.test(input.text)) {
    signals.push({ code: "money_scheme", weight: 0.35, detail: "Uses money-scheme language (guaranteed returns, signals, doubling)." });
  }
  return signals;
}

/** Combine independent signal weights (noisy-OR), rounded to 3 dp. */
export function combineWeights(weights: readonly number[]): number {
  const keep = weights.reduce((acc, w) => acc * (1 - Math.min(Math.max(w, 0), 1)), 1);
  return Math.round((1 - keep) * 1000) / 1000;
}

function blockMessage(signals: readonly SpamSignal[]): string {
  if (signals.some((s) => s.code === "burst" && s.weight >= BLOCK_THRESHOLD)) {
    return "You're posting very fast. Take a short break and try again in a few minutes.";
  }
  if (signals.some((s) => s.code === "duplicate_self" && s.weight >= BLOCK_THRESHOLD)) {
    return "You've already posted this. Add something new instead of repeating it.";
  }
  return "This looks like spam, so we didn't post it. Remove extra links or repeated text and try again.";
}

/** Run every heuristic. Pure and deterministic given its input. */
export function evaluateSpam(input: SpamInput): ContentAssessment {
  const signals = [...duplicateSignals(input), ...linkSignals(input), ...burstSignals(input), ...textPatternSignals(input)];
  const score = combineWeights(signals.map((s) => s.weight));
  const decision: ContentDecision = score >= BLOCK_THRESHOLD ? "block" : score >= REVIEW_THRESHOLD ? "review" : "allow";
  return { decision, score, signals, message: decision === "block" ? blockMessage(signals) : null };
}

/** One-line moderator summary of an assessment (used as automatic report details). */
export function summarizeAssessment(assessment: ContentAssessment): string {
  const parts = assessment.signals.map((s) => s.detail);
  return `Automatic spam check (score ${assessment.score.toFixed(2)}): ${parts.join(" ")}`.slice(0, 1000);
}
