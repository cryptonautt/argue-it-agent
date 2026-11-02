/**
 * Identity redaction for the blind case file (design §4.3.1). Pure.
 *
 * Participant handles (bare and @-prefixed) and display names inside submission text are replaced with
 * blind labels. Matching is case-insensitive and word-boundary aware (Unicode letters/marks/digits/underscore
 * count as word characters), longest term first so "Ada Lovelace" wins over "Ada".
 *
 * Both the text and the terms are Unicode-normalised first (NFKC, invisible characters removed), so a name
 * typed with decomposed accents, fullwidth letters or a zero-width space inside it is still redacted. The
 * returned text is the normalised text — that is what the judge sees and what quotes are checked against.
 */
import { normaliseUntrustedText } from "./text-normalise";
import type { RedactionLabel, RedactionResult, RedactionTarget } from "./types";

/** Terms shorter than this are never redacted on their own (too likely to hit ordinary words). */
export const MIN_REDACTION_TERM_LENGTH = 2;

const WORD_CHAR = "[\\p{L}\\p{M}\\p{N}_]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "Ada  Lovelace" → /Ada\s+Lovelace/ so line breaks or double spaces inside a name still match. */
function termPattern(term: string): string {
  return term
    .trim()
    .split(/\s+/u)
    .map(escapeRegExp)
    .join("\\s+");
}

interface NormalisedTarget {
  term: string;
  replacement: RedactionLabel;
}

/**
 * Merge targets: the same term (case-insensitively) mapped to two different labels — e.g. both
 * participants are called "Chris" — becomes the neutral "[participant]".
 */
function normaliseTargets(names: readonly RedactionTarget[]): NormalisedTarget[] {
  const byTerm = new Map<string, NormalisedTarget>();
  for (const { term, replacement } of names) {
    const clean = normaliseUntrustedText(term).trim().replace(/\s+/gu, " ");
    if (clean.replace(/^@/u, "").length < MIN_REDACTION_TERM_LENGTH) continue;
    const k = clean.toLocaleLowerCase();
    const existing = byTerm.get(k);
    if (!existing) byTerm.set(k, { term: clean, replacement });
    else if (existing.replacement !== replacement) existing.replacement = "[participant]";
  }
  return [...byTerm.values()].sort((a, b) => b.term.length - a.term.length);
}

/** Replace participant identities inside `text` with blind labels. */
export function redactIdentities(rawText: string, names: readonly RedactionTarget[]): RedactionResult {
  const text = normaliseUntrustedText(rawText);
  const targets = normaliseTargets(names);
  if (targets.length === 0 || text.length === 0) return { text, redactions: 0 };

  const lookup = new Map(targets.map((t) => [t.term.toLocaleLowerCase(), t.replacement]));
  const alternation = targets.map((t) => termPattern(t.term)).join("|");
  // `@` is not a word character, so "@ada" needs no special casing: the look-behind stops "x@ada" (emails)
  // and "bada" matching, the look-ahead stops "ada_fan" / "adaeze" matching.
  const pattern = new RegExp(`(?<!${WORD_CHAR}|@)(?:${alternation})(?!${WORD_CHAR})`, "giu");

  let redactions = 0;
  const redacted = text.replace(pattern, (match) => {
    const replacement = lookup.get(match.replace(/\s+/gu, " ").toLocaleLowerCase()) ?? "[participant]";
    redactions += 1;
    return replacement;
  });
  return { text: redacted, redactions };
}

export interface ParticipantIdentity {
  side: "FOR" | "AGAINST";
  handle: string | null;
  displayName: string | null;
  /** Better Auth `users.name` (often equal to the display name). */
  accountName: string | null;
}

/**
 * Build redaction targets for the participants of a competition.
 *
 * Topic exemption: a bare name/handle that also appears in the proposition is the debate's SUBJECT, not
 * an identity reference (a user with handle "davido" in "Davido is better than Wizkid"). Redacting it would
 * destroy the argument, so the bare form is exempt — the "@handle" form is always redacted.
 */
export function buildRedactionTargets(
  participants: readonly ParticipantIdentity[],
  proposition: string,
): { targets: RedactionTarget[]; exemptTerms: string[] } {
  const targets: RedactionTarget[] = [];
  const exemptTerms: string[] = [];
  const propositionHas = (term: string) =>
    redactIdentities(proposition, [{ term, replacement: "[participant]" }]).redactions > 0;

  for (const p of participants) {
    const replacement: RedactionLabel = p.side === "FOR" ? "[Side A]" : "[Side B]";
    const handle = p.handle?.replace(/^@/u, "") ?? null;
    if (handle) targets.push({ term: `@${handle}`, replacement });
    const bareTerms = [handle, p.displayName, p.accountName].filter(
      (t): t is string => typeof t === "string" && t.trim().length > 0,
    );
    for (const term of bareTerms) {
      if (propositionHas(term)) exemptTerms.push(term);
      else targets.push({ term, replacement });
    }
  }
  return { targets, exemptTerms: [...new Set(exemptTerms)] };
}
