/**
 * Quote validation (design §4.3.2). Pure.
 *
 * Every quote the judge cites must actually appear in that side's own submission text. Matching is a
 * substring test after normalising Unicode form, typographic quotes/dashes/ellipses, whitespace and case —
 * differences a reader would not call "misquoting". Anything else is dropped and lowers the pass's
 * confidence, so the judge cannot invent support for a score.
 */
import type { QuoteValidation } from "./types";

/** Quotes shorter than this (after normalisation) prove nothing and are rejected. */
export const MIN_QUOTE_LENGTH = 3;

/** Normalise text for quote comparison. Exported for tests and the mock provider. */
export function normaliseForQuoteMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛′`´]/gu, "'")
    .replace(/[“”„‟″«»]/gu, '"')
    .replace(/[‐-―−]/gu, "-")
    .replace(/…/gu, "...")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

/** Strip wrapping quote marks and leading/trailing ellipses the judge may add around an excerpt. */
function stripQuoteDecoration(normalised: string): string {
  let q = normalised;
  for (let i = 0; i < 3; i++) {
    const before = q;
    q = q
      .replace(/^["']+|["']+$/gu, "")
      .replace(/^(?:\.\.\.|\[\.\.\.\])\s*/u, "")
      .replace(/\s*(?:\.\.\.|\[\.\.\.\])$/u, "")
      .trim();
    if (q === before) break;
  }
  return q;
}

/** Keep only quotes that are substrings of `sourceText` (whitespace/typography-normalised), in input order. */
export function validateQuotes(quotes: readonly string[], sourceText: string): QuoteValidation {
  const source = normaliseForQuoteMatch(sourceText);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const quote of quotes) {
    const needle = stripQuoteDecoration(normaliseForQuoteMatch(quote));
    if (needle.length >= MIN_QUOTE_LENGTH && source.includes(needle)) valid.push(quote.trim());
    else invalid.push(quote);
  }
  return { valid, invalid };
}

/** Validate against several source texts (a side's opening and rebuttal separately — no cross-boundary quotes). */
export function validateQuotesAgainstAny(quotes: readonly string[], sources: readonly string[]): QuoteValidation {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const quote of quotes) {
    const ok = sources.some((source) => validateQuotes([quote], source).valid.length === 1);
    (ok ? valid : invalid).push(ok ? quote.trim() : quote);
  }
  return { valid, invalid };
}
