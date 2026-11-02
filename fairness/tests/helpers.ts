/**
 * Shared fixtures for the fairness tests: hand-built passes and fake judge providers. Owner: fairness.
 *
 * Fake providers come in two kinds:
 *   - canonical fakes return PassOutput directly (they decide in A/B terms);
 *   - presentation fakes produce RAW output in presentation labels (X = shown first, Y = shown second) and
 *     go through the judge's own `finalizePass`, so they exercise the real order-swap mapping and quote
 *     validation exactly like the Anthropic provider does.
 */
import { finalizePass, parseJudgeOutput, type JudgeRawOutput } from "@domain/judging/output-schema";
import { presentCase, type PresentedSide } from "@domain/judging/presentation";
import type {
  CaseFile,
  JudgePassInput,
  JudgePassResult,
  JudgeProvider,
  PassOrder,
  PassOutput,
  PassWinner,
  RubricDef,
  SidePassResult,
} from "@domain/judging";
import { getRubric } from "@domain/judging";

export function rubricOrThrow(id: string, version = 1): RubricDef {
  const rubric = getRubric(id, version);
  if (!rubric) throw new Error(`test rubric ${id}@${version} missing`);
  return rubric;
}

/** A side where every criterion has the same score (so the weighted total is score × 10). */
export function uniformSide(rubric: RubricDef, score: number, quote?: string): SidePassResult {
  return {
    criteria: Object.fromEntries(
      rubric.criteria.map((c) => [c.key, { score, reason: `${c.label} scored ${score}.`, quotes: quote ? [quote] : [] }]),
    ),
    claims: [],
    strengths: [],
    weaknesses: [],
  };
}

export interface PassSpec {
  passNo: number;
  order?: PassOrder;
  /** Uniform criterion score per side (0–10). Weighted totals = score × 10. */
  a: number;
  b: number;
  confidence: number;
  winner?: PassWinner;
}

/** Build a canonical PassOutput whose winner matches its own totals unless overridden. */
export function pass(rubric: RubricDef, spec: PassSpec): PassOutput {
  const diff = (spec.a - spec.b) * 10;
  const derived: PassWinner = Math.abs(diff) < 3 ? "draw" : diff > 0 ? "A" : "B";
  return {
    passNo: spec.passNo,
    order: spec.order ?? (spec.passNo === 2 ? "BA" : "AB"),
    sides: { A: uniformSide(rubric, spec.a), B: uniformSide(rubric, spec.b) },
    winner: spec.winner ?? derived,
    margin: Math.abs(diff),
    confidence: spec.confidence,
    rationale: "fixture",
    invalidQuoteCount: 0,
  };
}

const firstWords = (text: string | undefined, n = 6) => (text ? text.split(/\s+/u).slice(0, n).join(" ") : undefined);

/** A canonical-label provider driven by a decision function. Quotes come from each side's own opening. */
export function canonicalProvider(
  decide: (input: JudgePassInput) => { a: number; b: number; confidence: number },
  id = "fake-canonical",
): JudgeProvider & { calls: JudgePassInput[] } {
  const calls: JudgePassInput[] = [];
  return {
    id,
    model: `${id}-model`,
    calls,
    async runPass(input) {
      calls.push(input);
      const d = decide(input);
      const output = pass(input.rubric, { passNo: input.passNo, order: input.order, ...d });
      output.sides.A = uniformSide(input.rubric, d.a, firstWords(input.caseFile.sides.A.opening?.text));
      output.sides.B = uniformSide(input.rubric, d.b, firstWords(input.caseFile.sides.B.opening?.text));
      return { ok: true, output, raw: output, usage: { inputTokens: 1000, outputTokens: 200 }, latencyMs: 1, stopReason: "end_turn" };
    },
  };
}

type RawScorer = (first: PresentedSide, second: PresentedSide, input: JudgePassInput) => { x: number; y: number; confidence: number };

/** A presentation-label provider: scores Side X / Side Y, quotes from the presented text, real finalizePass. */
export function presentationProvider(score: RawScorer, id = "fake-presentation"): JudgeProvider {
  return {
    id,
    model: `${id}-model`,
    async runPass(input): Promise<JudgePassResult> {
      const presentation = presentCase(input.caseFile, input.order);
      const [x, y] = presentation.sides;
      const s = score(x, y, input);
      const rawSide = (side: PresentedSide, value: number) => ({
        criteria: Object.fromEntries(
          input.rubric.criteria.map((c) => [c.key, { reason: "fake", quotes: [firstWords(side.opening?.text) ?? ""].filter(Boolean), score: value }]),
        ),
        claims: [],
        strengths: [],
        weaknesses: [],
      });
      const diff = (s.x - s.y) * 10;
      const raw: JudgeRawOutput = {
        sides: { X: rawSide(x, s.x), Y: rawSide(y, s.y) },
        rationale: "fake",
        winner: Math.abs(diff) < 3 ? "draw" : diff > 0 ? "X" : "Y",
        margin: Math.abs(diff),
        confidence: s.confidence,
      };
      const parsed = parseJudgeOutput(raw, input.rubric);
      if (!parsed.ok) return { ok: false, kind: "invalid_output", error: parsed.error, latencyMs: 0, retryable: false };
      const output = finalizePass(parsed.output, presentation, input.rubric, input.passNo);
      return { ok: true, output, raw, usage: null, latencyMs: 0, stopReason: "end_turn" };
    },
  };
}

/** Text of one canonical side (opening + rebuttal). */
export function sideText(caseFile: CaseFile, side: "A" | "B"): string {
  const s = caseFile.sides[side];
  return [s.opening?.text, s.rebuttal?.text].filter(Boolean).join("\n");
}
