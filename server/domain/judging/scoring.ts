/** Rubric arithmetic shared by pass finalisation, comparison and the verdict. Pure. */
import { MAX_CRITERION_SCORE, PASS_TIE_MARGIN_POINTS } from "./config";
import type { CriterionScore, PassWinner, RubricDef } from "./types";

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const round3 = (n: number) => Math.round(n * 1000) / 1000;
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Weighted total on a 0–100 scale: Σ (score / 10) × weight. A missing criterion counts as 0. */
export function weightedTotal(criteria: Readonly<Record<string, Pick<CriterionScore, "score">>>, rubric: RubricDef): number {
  let total = 0;
  for (const c of rubric.criteria) {
    const score = criteria[c.key]?.score ?? 0;
    total += (clamp(score, 0, MAX_CRITERION_SCORE) / MAX_CRITERION_SCORE) * c.weight;
  }
  return round2(total);
}

/** The winner implied by two totals (within the tie band → draw). */
export function winnerFromTotals(a: number, b: number, tieMargin = PASS_TIE_MARGIN_POINTS): PassWinner {
  const diff = a - b;
  if (Math.abs(diff) < tieMargin) return "draw";
  return diff > 0 ? "A" : "B";
}
