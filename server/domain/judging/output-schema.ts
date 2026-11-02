/**
 * The structured output a judging pass must return, in PRESENTATION labels (X = shown first, Y = second),
 * and its conversion into a canonical PassOutput (design §4.3.2). The conversion is shared by every
 * provider, so the mock exercises exactly the same relabelling, quote validation and confidence rules as
 * the real model.
 */
import { z } from "zod";
import {
  INCOHERENT_WINNER_CONFIDENCE_FACTOR,
  INVALID_QUOTE_CONFIDENCE_PENALTY,
  MAX_INVALID_QUOTE_PENALTY,
  MAX_QUOTES_PER_CRITERION,
} from "./config";
import {
  canonicaliseJudgeText,
  canonicaliseQuote,
  sideTexts,
  type Presentation,
  type PresentationLabel,
} from "./presentation";
import { validateQuotesAgainstAny } from "./quotes";
import { clamp, round3, weightedTotal, winnerFromTotals } from "./scoring";
import type { CriterionScore, PassOutput, PassWinner, RubricDef, SidePassResult } from "./types";

export const CLAIM_CLASSIFICATIONS = ["common_knowledge", "unsupported", "likely_false", "opinion"] as const;

const criterionOutputSchema = z.object({
  reason: z.string().describe("One sentence explaining the score, about this side's substance only."),
  quotes: z
    .array(z.string())
    .describe("1-3 short verbatim excerpts copied exactly from THIS side's own submission text that support the score."),
  score: z.number().int().min(0).max(10).describe("Integer 0-10."),
});

const claimOutputSchema = z.object({
  claim: z.string().describe("A short paraphrase of one factual-sounding claim this side made."),
  classification: z.enum(CLAIM_CLASSIFICATIONS),
});

/** Zod schema for one rubric: every criterion key is a required property (no more, no fewer). */
export function judgeOutputSchema(rubric: RubricDef) {
  const criteriaShape: Record<string, typeof criterionOutputSchema> = {};
  for (const c of rubric.criteria) criteriaShape[c.key] = criterionOutputSchema;
  const sideSchema = z.object({
    criteria: z.object(criteriaShape),
    claims: z.array(claimOutputSchema).describe("Up to 5 of this side's most important claims, classified."),
    strengths: z.array(z.string()).describe("1-3 short strengths of this side's case."),
    weaknesses: z.array(z.string()).describe("1-3 short weaknesses of this side's case."),
  });
  return z.object({
    sides: z.object({ X: sideSchema, Y: sideSchema }),
    rationale: z.string().describe("2-3 neutral sentences explaining the overall call, referring to Side X / Side Y."),
    winner: z.enum(["X", "Y", "draw"]),
    margin: z.number().min(0).max(100).describe("Estimated gap between the weighted totals, 0-100."),
    confidence: z.number().min(0).max(1).describe("0-1: how clear-cut this decision is on the rubric."),
  });
}

export type JudgeOutputSchema = ReturnType<typeof judgeOutputSchema>;
export type JudgeRawOutput = z.infer<JudgeOutputSchema>;
type RawSide = JudgeRawOutput["sides"]["X"];

export type ParseJudgeOutputResult = { ok: true; output: JudgeRawOutput } | { ok: false; error: string };

/** Validate untrusted JSON (already parsed) against the rubric's output schema. */
export function parseJudgeOutput(value: unknown, rubric: RubricDef): ParseJudgeOutputResult {
  const result = judgeOutputSchema(rubric).safeParse(value);
  if (result.success) return { ok: true, output: result.data };
  const issues = result.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, error: `judge output failed validation: ${issues}` };
}

/**
 * Convert a validated presentation-labelled output into a canonical PassOutput:
 *  - map Side X / Side Y back to A / B (labels, free text, and redaction tokens inside quotes),
 *  - drop quotes that are not verbatim in that side's own text and lower confidence per dropped quote,
 *  - derive the pass winner from the pass's own weighted rubric totals (so a verdict can never contradict
 *    its score bars); if the judge's stated winner disagrees, confidence is cut as the pass is incoherent.
 */
export function finalizePass(raw: JudgeRawOutput, presentation: Presentation, rubric: RubricDef, passNo: number): PassOutput {
  const { toCanonical } = presentation;
  let invalidQuoteCount = 0;

  const convertSide = (label: PresentationLabel): SidePassResult => {
    const rawSide: RawSide = raw.sides[label];
    const presented = presentation.sides.find((s) => s.label === label);
    const sources = presented ? sideTexts(presented) : [];
    const criteria: Record<string, CriterionScore> = {};
    for (const c of rubric.criteria) {
      const rawCriterion = rawSide.criteria[c.key];
      if (!rawCriterion) throw new Error(`judge output missing criterion "${c.key}"`);
      const { valid, invalid } = validateQuotesAgainstAny(rawCriterion.quotes.slice(0, MAX_QUOTES_PER_CRITERION), sources);
      invalidQuoteCount += invalid.length;
      criteria[c.key] = {
        score: rawCriterion.score,
        reason: canonicaliseJudgeText(rawCriterion.reason.trim(), toCanonical),
        quotes: valid.map((q) => canonicaliseQuote(q, toCanonical)),
      };
    }
    return {
      criteria,
      claims: rawSide.claims.slice(0, 5).map((c) => ({
        claim: canonicaliseJudgeText(c.claim.trim(), toCanonical),
        classification: c.classification,
      })),
      strengths: rawSide.strengths.slice(0, 3).map((s) => canonicaliseJudgeText(s.trim(), toCanonical)),
      weaknesses: rawSide.weaknesses.slice(0, 3).map((s) => canonicaliseJudgeText(s.trim(), toCanonical)),
    };
  };

  const byCanonical = { [toCanonical.X]: convertSide("X"), [toCanonical.Y]: convertSide("Y") };
  const A = byCanonical.A;
  const B = byCanonical.B;
  if (!A || !B) throw new Error("presentation does not cover both sides");

  const statedWinner: PassWinner = raw.winner === "draw" ? "draw" : toCanonical[raw.winner];
  const derivedWinner = winnerFromTotals(weightedTotal(A.criteria, rubric), weightedTotal(B.criteria, rubric));

  let confidence = raw.confidence - Math.min(MAX_INVALID_QUOTE_PENALTY, invalidQuoteCount * INVALID_QUOTE_CONFIDENCE_PENALTY);
  if (statedWinner !== derivedWinner) confidence *= INCOHERENT_WINNER_CONFIDENCE_FACTOR;

  return {
    passNo,
    order: presentation.order,
    sides: { A, B },
    winner: derivedWinner,
    statedWinner,
    margin: raw.margin,
    confidence: round3(clamp(confidence, 0, 1)),
    rationale: canonicaliseJudgeText(raw.rationale.trim(), toCanonical),
    invalidQuoteCount,
  };
}
