/**
 * Turning compared passes into the verdict users see (design §4.3.8). Pure.
 *
 * Scores are the average of the passes that formed the decision; the totals are recomputed from those
 * averaged criterion scores, so the headline number always matches the bars. Reasons and strengths come
 * from the most confident deciding pass (one coherent voice); quotes are pooled across deciding passes
 * (all already validated as verbatim).
 */
import { HIGH_CONFIDENCE_MIN, MAX_QUOTES_PER_CRITERION, MEDIUM_CONFIDENCE_MIN } from "./config";
import { decidingPasses } from "./compare";
import { normaliseForQuoteMatch } from "./quotes";
import { round2, weightedTotal } from "./scoring";
import type {
  ComparisonResult,
  PassOutput,
  RubricDef,
  SideLabel,
  VerdictDraft,
  VerdictExplanation,
  VerdictScores,
} from "./types";
import type { ConfidenceLabel } from "@domain/db/json-types";

export function confidenceLabel(confidence: number): ConfidenceLabel {
  if (confidence >= HIGH_CONFIDENCE_MIN) return "high";
  if (confidence >= MEDIUM_CONFIDENCE_MIN) return "medium";
  return "low";
}

export interface VerdictMeta {
  model: string;
  promptVersion: string;
  injectionDetected: boolean;
}

const SIDES: readonly SideLabel[] = ["A", "B"];
const round1 = (n: number) => Math.round(n * 10) / 10;

function representative(passes: readonly PassOutput[]): PassOutput {
  const sorted = [...passes].sort((a, b) => b.confidence - a.confidence || a.passNo - b.passNo);
  const first = sorted[0];
  if (!first) throw new Error("buildVerdictDraft: no passes");
  return first;
}

function pooledQuotes(passes: readonly PassOutput[], side: SideLabel, key: string, rep: PassOutput): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const pass of [rep, ...passes.filter((p) => p !== rep)]) {
    for (const quote of pass.sides[side].criteria[key]?.quotes ?? []) {
      const k = normaliseForQuoteMatch(quote);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(quote);
      if (out.length >= MAX_QUOTES_PER_CRITERION) return out;
    }
  }
  return out;
}

function summaryFor(result: ComparisonResult, totals: VerdictScores["totals"], passCount: number, rationale: string): string {
  const score = `${totals.A}–${totals.B}`;
  const readings =
    passCount >= 4
      ? "four independent readings (the first two disagreed, so a second pair was run, again in swapped order)"
      : "two independent readings in swapped order";
  let lead: string;
  if (result.kind === "decided" && result.outcome === "draw") {
    lead = `This debate is a draw: on the rubric the sides finished ${score}, too close to name a winner fairly, across ${readings}.`;
  } else if (result.kind === "decided") {
    const stance = result.outcome === "A" ? "FOR" : "AGAINST";
    lead = `Side ${result.outcome} (${stance}) wins on the rubric, ${score}, across ${readings}.`;
  } else {
    lead = `The AI judge could not reach a consistent, confident decision across ${readings}, so a human reviewer will look at this debate instead of forcing a winner.`;
  }
  return rationale ? `${lead} ${rationale}` : lead;
}

export function buildVerdictDraft(
  passes: readonly PassOutput[],
  result: ComparisonResult,
  rubric: RubricDef,
  meta: VerdictMeta,
): VerdictDraft {
  if (result.kind === "needs_another_pass") throw new Error("buildVerdictDraft: comparison is not final");
  const deciding = decidingPasses(passes, result);
  const rep = representative(deciding);

  const averaged = (side: SideLabel, key: string) =>
    deciding.reduce((sum, p) => sum + (p.sides[side].criteria[key]?.score ?? 0), 0) / deciding.length;

  const criteria = rubric.criteria.map((c) => ({
    key: c.key,
    label: c.label,
    weight: c.weight,
    A: round1(averaged("A", c.key)),
    B: round1(averaged("B", c.key)),
  }));
  const asRecord = (side: SideLabel) => Object.fromEntries(criteria.map((c) => [c.key, { score: c[side] }]));
  const totals = { A: round2(weightedTotal(asRecord("A"), rubric)), B: round2(weightedTotal(asRecord("B"), rubric)) };

  const scores: VerdictScores = { rubric: { id: rubric.id, version: rubric.version }, criteria, totals, maxTotal: 100 };

  const flaggedClaims: VerdictExplanation["flaggedClaims"] = [];
  const seenClaims = new Set<string>();
  for (const pass of [rep, ...deciding.filter((p) => p !== rep)]) {
    for (const side of SIDES) {
      for (const claim of pass.sides[side].claims) {
        if (claim.classification !== "likely_false" && claim.classification !== "unsupported") continue;
        const k = `${side}:${claim.claim.toLocaleLowerCase()}`;
        if (seenClaims.has(k) || flaggedClaims.length >= 8) continue;
        seenClaims.add(k);
        flaggedClaims.push({ side, claim: claim.claim, classification: claim.classification });
      }
    }
  }

  const explanation: VerdictExplanation = {
    summary: summaryFor(result, totals, passes.length, rep.rationale),
    perCriterion: rubric.criteria.map((c) => ({
      key: c.key,
      A: { reason: rep.sides.A.criteria[c.key]?.reason ?? "", quotes: pooledQuotes(deciding, "A", c.key, rep) },
      B: { reason: rep.sides.B.criteria[c.key]?.reason ?? "", quotes: pooledQuotes(deciding, "B", c.key, rep) },
    })),
    strengths: { A: [...rep.sides.A.strengths], B: [...rep.sides.B.strengths] },
    weaknesses: { A: [...rep.sides.A.weaknesses], B: [...rep.sides.B.weaknesses] },
    flaggedClaims,
    confidenceLabel: confidenceLabel(result.confidence),
    method: {
      blind: true,
      passCount: passes.length,
      orders: [...passes].sort((a, b) => a.passNo - b.passNo).map((p) => p.order),
      model: meta.model,
      promptVersion: meta.promptVersion,
      rubric: { id: rubric.id, version: rubric.version },
    },
    injectionDetected: meta.injectionDetected,
  };

  return {
    outcome: result.kind === "decided" ? result.outcome : "inconclusive",
    confidence: result.confidence,
    scores,
    explanation,
  };
}
