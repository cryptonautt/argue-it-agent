/**
 * Independent blinding check (design §4.3.1). Owner: fairness. Pure.
 *
 * This deliberately does NOT reuse the judge's redaction code: it re-derives, from the raw participant
 * identities, what must never reach the model and searches the final case file for it. A bug in redaction
 * therefore shows up here as a leak instead of being trusted.
 *
 *   - leaks (gated):     an "@handle", a bare handle, or a full display name appears anywhere in the case file.
 *                        Exception, matching the documented design: a bare term that is part of the
 *                        proposition is the debate's subject, not a reference to a participant.
 *   - partial mentions (advisory): a single word of a display name (e.g. a first name) appears. Redaction is
 *                        not required to catch these, but a first name can still hint at identity or
 *                        ethnicity, so the report lists them for humans to judge.
 */
import type { CaseFile } from "@domain/judging";
import type { FairnessCase } from "./case-schema";

const WORD = "[\\p{L}\\p{N}_]";
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function containsTerm(haystack: string, term: string): boolean {
  const body = term
    .trim()
    .split(/\s+/u)
    .map(escapeRegExp)
    .join("\\s+");
  if (!body) return false;
  return new RegExp(`(?<!${WORD})${body}(?!${WORD})`, "iu").test(haystack);
}

/** Every string the judge will see, joined (proposition, texts, links). */
export function caseFileText(caseFile: CaseFile): string {
  const parts: string[] = [caseFile.proposition, caseFile.category.name];
  for (const side of [caseFile.sides.A, caseFile.sides.B]) {
    for (const sub of [side.opening, side.rebuttal]) {
      if (!sub) continue;
      parts.push(sub.text, ...sub.links);
    }
  }
  return parts.join("\n");
}

export interface IdentityCheck {
  /** Identity strings that reached the judge (must be empty). */
  leaks: string[];
  /** Single name words that reached the judge (advisory). */
  partialMentions: string[];
}

/** Common short words that happen to be name parts; never worth flagging on their own. */
const PARTIAL_STOPWORDS = new Set(["mrs", "mr", "dr", "the", "and"]);

export function checkIdentityLeaks(fairnessCase: FairnessCase, caseFile: CaseFile): IdentityCheck {
  const text = caseFileText(caseFile);
  const proposition = fairnessCase.proposition;
  const leaks = new Set<string>();
  const partial = new Set<string>();

  for (const label of ["A", "B"] as const) {
    const { handle, displayName } = fairnessCase.participants[label];
    if (text.toLocaleLowerCase().includes(`@${handle}`)) leaks.add(`@${handle}`);
    for (const term of [handle, displayName]) {
      if (containsTerm(proposition, term)) continue; // the debate's subject, not an identity reference
      if (containsTerm(text, term)) leaks.add(term);
    }
    const words = displayName.split(/\s+/u).filter((w) => w.length >= 3 && !PARTIAL_STOPWORDS.has(w.toLocaleLowerCase()));
    if (words.length > 1) {
      for (const word of words) {
        if (!containsTerm(proposition, word) && containsTerm(text, word) && !leaks.has(displayName)) partial.add(word);
      }
    }
  }
  return { leaks: [...leaks].sort(), partialMentions: [...partial].sort() };
}
