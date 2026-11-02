/**
 * Building blocks shared by the v1 rubrics. Generic weights (design §4.3.5): evidence 30, reasoning 25,
 * rebuttal 20, clarity 15, consistency 10 — each rubric adjusts them. Guidance text is shown to the judge
 * verbatim AND to users on /rules, so it is written in plain language.
 */
import type { RubricCriterion } from "@domain/db/json-types";

/** Rebuttal guidance is the same everywhere: it is about engaging the other side, not about topic. */
export const REBUTTAL_GUIDANCE =
  "How directly and effectively this side answers the other side's strongest points from their opening. " +
  "Reward identifying a specific flaw and explaining why it matters. Ignoring the other side's main points, " +
  "attacking the person instead of the argument, or only repeating the opening scores low. A side with no " +
  "rebuttal submission scores 0-2 here, based only on any anticipation of counterarguments in its opening.";

export const CLARITY_GUIDANCE =
  "How easy it is to follow what this side is claiming and why. Judge clarity of ideas and structure only. " +
  "Do NOT penalise spelling, grammar, slang, informal English, Nigerian Pidgin or any other dialect, " +
  "or non-native phrasing, as long as the meaning is understandable. Longer is not clearer.";

export const CONSISTENCY_GUIDANCE =
  "Whether this side's position holds together across its opening and rebuttal: no contradicting itself, " +
  "no quietly switching to a different claim than the proposition, and no relying on a standard it rejects " +
  "when the other side uses it.";

export function criterion(key: string, label: string, weight: number, guidance: string): RubricCriterion {
  return { key, label, weight, guidance };
}
