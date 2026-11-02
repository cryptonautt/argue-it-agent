/**
 * Comparing independent judging passes (design §4.3.3, revised 2026-10-31). Pure.
 *
 * Two passes (Pass 1 A-first, Pass 2 B-first):
 *   - both draw                                   → draw
 *   - averaged margin < 3% of max                 → draw (too close to call a winner honestly)
 *   - same winner, min(confidence) ≥ 0.6          → that winner
 *   - same winner, but a pass is unsure           → inconclusive (human review — never a forced winner)
 *   - different winners                           → run one more ORDER-BALANCED pair (Pass 3 A-first,
 *                                                   Pass 4 B-first), so no extra pass favours a reading order
 * Four passes: the summed weighted totals pick the leader (or a draw when the averaged margin is under 3% of
 * max). The leader stands only if at least 3 of the 4 passes agree with it AND those passes' average
 * confidence is ≥ 0.6; otherwise → inconclusive (human review).
 *
 * Why not a single A-first Pass 3: a judge with pure first-position bias would then resolve every split
 * debate for Side A (FOR) by 2–1. With a balanced pair such a judge splits 2–2 and goes to a human.
 *
 * Margins and totals come from each pass's weighted rubric scores — the numbers users see.
 */
import { DRAW_MARGIN_POINTS, MIN_DECISION_CONFIDENCE } from "./config";
import { round2, round3, weightedTotal } from "./scoring";
import type { ComparisonResult, PassOutput, PassTotals, PassWinner, RubricDef } from "./types";

/** Passes in a full evaluation when the first pair disagrees. */
export const MAX_PASSES = 4;
/** Passes (of four) that must agree with the summed-total leader for it to stand. */
export const MIN_AGREEING_OF_FOUR = 3;

export function passTotals(pass: PassOutput, rubric: RubricDef): PassTotals {
  return {
    passNo: pass.passNo,
    order: pass.order,
    A: weightedTotal(pass.sides.A.criteria, rubric),
    B: weightedTotal(pass.sides.B.criteria, rubric),
    winner: pass.winner,
    confidence: pass.confidence,
  };
}

const mean = (values: readonly number[]) => (values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length);
const averageMargin = (totals: readonly PassTotals[]) => mean(totals.map((t) => t.A - t.B));
const averageConfidence = (totals: readonly PassTotals[]) => round3(mean(totals.map((t) => t.confidence)));
const describe = (t: PassTotals) => `pass ${t.passNo} (${t.order}): ${t.winner} ${t.A}-${t.B} @${t.confidence}`;

/** Decide from the passes so far: winner/draw, ask for the extra pair (Passes 3+4), or inconclusive. */
export function comparePasses(passes: readonly PassOutput[], rubric: RubricDef): ComparisonResult {
  const ordered = [...passes].sort((a, b) => a.passNo - b.passNo).slice(0, MAX_PASSES);
  const totals = ordered.map((p) => passTotals(p, rubric));
  const summary = totals.map(describe).join("; ");

  if (totals.length < 2) {
    return { kind: "needs_another_pass", totals, reason: `need two passes in swapped order; have ${totals.length}` };
  }
  if (totals.length === 2) return compareTwo(totals, summary);
  if (totals.length < MAX_PASSES) {
    return { kind: "needs_another_pass", totals, reason: `the extra pair must be order-balanced; have ${totals.length} of ${MAX_PASSES} passes. ${summary}` };
  }
  return compareFour(totals, summary);
}

function compareTwo(totals: PassTotals[], summary: string): ComparisonResult {
  const [first, second] = totals as [PassTotals, PassTotals];
  const margin = round2(averageMargin(totals));
  const confidence = averageConfidence(totals);

  if (first.winner === "draw" && second.winner === "draw") {
    return { kind: "decided", outcome: "draw", confidence, totals, reason: `both passes scored a draw. ${summary}` };
  }
  if (first.winner !== second.winner && first.winner !== "draw" && second.winner !== "draw") {
    return { kind: "needs_another_pass", totals, reason: `passes disagree on the winner. ${summary}` };
  }
  if (Math.abs(margin) < DRAW_MARGIN_POINTS) {
    return {
      kind: "decided",
      outcome: "draw",
      confidence,
      totals,
      reason: `averaged margin ${margin} is below the draw threshold of ${DRAW_MARGIN_POINTS}. ${summary}`,
    };
  }
  if (first.winner !== second.winner) {
    // One draw + one side, with a clear averaged margin: the passes disagree on whether there is a winner.
    return { kind: "needs_another_pass", totals, reason: `one pass scored a draw, the other a winner. ${summary}` };
  }
  const minConfidence = Math.min(first.confidence, second.confidence);
  const winner = first.winner as Exclude<PassWinner, "draw">;
  if (minConfidence >= MIN_DECISION_CONFIDENCE) {
    return { kind: "decided", outcome: winner, confidence, totals, reason: `both passes chose ${winner}. ${summary}` };
  }
  return {
    kind: "inconclusive",
    confidence,
    totals,
    reason: `both passes leaned ${winner} but min confidence ${minConfidence} < ${MIN_DECISION_CONFIDENCE}. ${summary}`,
  };
}

/** The outcome the summed weighted totals point to across all passes. */
function summedLeader(totals: readonly PassTotals[]): PassWinner {
  const margin = averageMargin(totals);
  if (Math.abs(margin) < DRAW_MARGIN_POINTS) return "draw";
  return margin > 0 ? "A" : "B";
}

function compareFour(totals: PassTotals[], summary: string): ComparisonResult {
  const leader = summedLeader(totals);
  const margin = round2(averageMargin(totals));
  const agreeing = totals.filter((t) => t.winner === leader);
  if (agreeing.length < MIN_AGREEING_OF_FOUR) {
    return {
      kind: "inconclusive",
      confidence: averageConfidence(totals),
      totals,
      reason: `summed totals point to ${leader} (averaged margin ${margin}) but only ${agreeing.length} of ${totals.length} passes agree; ${MIN_AGREEING_OF_FOUR} are required. ${summary}`,
    };
  }
  const confidence = averageConfidence(agreeing);
  if (confidence < MIN_DECISION_CONFIDENCE) {
    return {
      kind: "inconclusive",
      confidence,
      totals,
      reason: `${agreeing.length} of ${totals.length} passes chose ${leader} but their average confidence ${confidence} < ${MIN_DECISION_CONFIDENCE}. ${summary}`,
    };
  }
  return {
    kind: "decided",
    outcome: leader,
    confidence,
    totals,
    reason: `${agreeing.length} of ${totals.length} order-balanced passes chose ${leader} (averaged margin ${margin}). ${summary}`,
  };
}

/** Passes whose totals formed the decision (the agreeing pair, or the agreeing passes of four). */
export function decidingPasses(passes: readonly PassOutput[], result: ComparisonResult): PassOutput[] {
  if (result.kind !== "decided" || passes.length < MAX_PASSES) return [...passes];
  const agreeing = passes.filter((p) => p.winner === result.outcome);
  return agreeing.length >= MIN_AGREEING_OF_FOUR ? agreeing : [...passes];
}
