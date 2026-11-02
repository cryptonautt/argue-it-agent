/**
 * Deterministic offline judge (JUDGE_PROVIDER=mock, or no ANTHROPIC_API_KEY). No network.
 *
 * It scores each side from simple, order-independent text features (specific figures, cited links,
 * reasoning connectives, engagement with the other side's opening in the rebuttal, sentence length), with
 * every length-related feature capped so writing more never wins on its own. It returns schema-valid
 * output in presentation labels, which then goes through exactly the same relabelling, quote validation
 * and confidence rules as the real model. It is a stand-in so the whole app works offline — NOT a judge.
 */
import { MOCK_JUDGE_MODEL } from "../config";
import { CLAIM_CLASSIFICATIONS, finalizePass, parseJudgeOutput, type JudgeRawOutput } from "../output-schema";
import { presentCase, type PresentedSide } from "../presentation";
import { clamp, weightedTotal } from "../scoring";
import type { JudgePassInput, JudgePassResult, JudgeProvider, RubricDef } from "../types";

type RawSide = JudgeRawOutput["sides"]["X"];
type RawCriterion = RawSide["criteria"][string];
type Classification = (typeof CLAIM_CLASSIFICATIONS)[number];

const CONNECTIVES =
  /\b(?:because|therefore|so that|since|which means|thus|hence|as a result|that's why|this shows|this proves|for example|for instance|na why|e mean say)\b/giu;
const HAS_CONNECTIVE = new RegExp(CONNECTIVES.source, "iu");
const NUMBER = /\d+(?:[.,]\d+)?%?/gu;
const HAS_DIGIT = /\d/u;
const OPINION = /\b(?:i think|i believe|in my opinion|i feel|to me|abeg|personally)\b/iu;
const MAX_QUOTE_CHARS = 160;

interface SideFeatures {
  hasText: boolean;
  sentences: string[];
  rebuttalSentences: string[];
  words: number;
  numbers: number;
  links: number;
  connectives: number;
  rebuttalWords: number;
  engagement: number;
  avgSentenceWords: number;
}

const wordsOf = (text: string) => text.split(/\s+/u).filter((w) => w.length > 0);

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => wordsOf(s).length >= 3);
}

const contentWords = (text: string) =>
  new Set(
    wordsOf(text.toLocaleLowerCase())
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter((w) => w.length >= 5),
  );

function featuresOf(side: PresentedSide, opponent: PresentedSide): SideFeatures {
  const opening = side.opening?.text ?? "";
  const rebuttal = side.rebuttal?.text ?? "";
  const all = `${opening}\n${rebuttal}`.trim();
  const sentences = sentencesOf(all);
  const opponentWords = contentWords(opponent.opening?.text ?? "");
  const engagement = [...contentWords(rebuttal)].filter((w) => opponentWords.has(w)).length;
  const words = wordsOf(all).length;
  return {
    hasText: all.length > 0,
    sentences,
    rebuttalSentences: sentencesOf(rebuttal),
    words,
    numbers: all.match(NUMBER)?.length ?? 0,
    links: (side.opening?.links.length ?? 0) + (side.rebuttal?.links.length ?? 0),
    connectives: all.match(CONNECTIVES)?.length ?? 0,
    rebuttalWords: wordsOf(rebuttal).length,
    engagement,
    avgSentenceWords: sentences.length > 0 ? words / sentences.length : 0,
  };
}

const quoteOf = (sentence: string | undefined) => (sentence ? [sentence.slice(0, MAX_QUOTE_CHARS)] : []);
const score = (n: number) => Math.round(clamp(n, 0, 10));

function criterionFor(key: string, f: SideFeatures): RawCriterion {
  if (!f.hasText) return { reason: "This side submitted nothing to assess.", quotes: [], score: 0 };
  const first = f.sentences[0];
  switch (key) {
    case "evidence":
    case "justification": {
      const s = score(2 + Math.min(4, f.numbers * 0.8) + Math.min(2, f.links) + Math.min(2, f.sentences.length / 4));
      return {
        reason: `Supports its case with ${f.numbers} specific figure(s) and ${f.links} cited link(s).`,
        quotes: quoteOf(f.sentences.find((x) => HAS_DIGIT.test(x)) ?? first),
        score: s,
      };
    }
    case "reasoning":
    case "coherence": {
      const s = score(2 + Math.min(4, f.connectives * 1.2) + Math.min(3, f.sentences.length / 3));
      const reasoned = f.sentences.find((x) => HAS_CONNECTIVE.test(x));
      return {
        reason: `Links its points to the proposition with ${f.connectives} explicit reasoning step(s).`,
        quotes: quoteOf(reasoned ?? first),
        score: s,
      };
    }
    case "rebuttal": {
      if (f.rebuttalWords === 0) {
        return { reason: "No rebuttal was submitted, so the other side's points went unanswered.", quotes: [], score: 1 };
      }
      const s = score(3 + Math.min(4, f.engagement * 0.6) + Math.min(2, f.rebuttalWords / 60));
      return {
        reason: `The rebuttal engages ${f.engagement} specific point(s) from the other side's opening.`,
        quotes: quoteOf(f.rebuttalSentences[0]),
        score: s,
      };
    }
    case "clarity": {
      const avg = f.avgSentenceWords;
      const s = avg === 0 ? 3 : avg <= 28 ? 8 : avg <= 40 ? 6 : 4;
      const shortest = [...f.sentences].sort((a, b) => a.length - b.length)[0];
      return { reason: "The main claims are easy to follow.", quotes: quoteOf(shortest ?? first), score: s };
    }
    case "consistency": {
      const s = score(6 + (f.rebuttalWords > 0 ? 1 : 0) + (f.words >= 40 ? 1 : 0));
      return { reason: "The position stays the same from opening to rebuttal.", quotes: quoteOf(first), score: s };
    }
    default:
      return { reason: "Assessed on the general quality of the case.", quotes: quoteOf(first), score: 5 };
  }
}

function claimsFor(f: SideFeatures): RawSide["claims"] {
  const claims: RawSide["claims"] = [];
  for (const sentence of f.sentences) {
    let classification: Classification | null = null;
    if (OPINION.test(sentence)) classification = "opinion";
    else if (HAS_DIGIT.test(sentence)) classification = f.links > 0 ? "common_knowledge" : "unsupported";
    if (classification) claims.push({ claim: sentence.slice(0, 140), classification });
    if (claims.length >= 3) break;
  }
  return claims;
}

function sideFor(rubric: RubricDef, f: SideFeatures): RawSide {
  const criteria: Record<string, RawCriterion> = {};
  for (const c of rubric.criteria) criteria[c.key] = criterionFor(c.key, f);
  const ranked = rubric.criteria
    .map((c) => ({ c, s: criteria[c.key]?.score ?? 0 }))
    .sort((a, b) => b.s - a.s || a.c.key.localeCompare(b.c.key));
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  return {
    criteria,
    claims: claimsFor(f),
    strengths: best ? [`Strongest on ${best.c.label.toLocaleLowerCase()}.`] : [],
    weaknesses: worst ? [`Weakest on ${worst.c.label.toLocaleLowerCase()}.`] : [],
  };
}

/** Pure: the mock's raw (presentation-labelled) output for a pass. */
export function mockRawOutput(input: JudgePassInput): JudgeRawOutput {
  const presentation = presentCase(input.caseFile, input.order);
  const [x, y] = presentation.sides;
  const X = sideFor(input.rubric, featuresOf(x, y));
  const Y = sideFor(input.rubric, featuresOf(y, x));
  const totalX = weightedTotal(X.criteria, input.rubric);
  const totalY = weightedTotal(Y.criteria, input.rubric);
  const diff = totalX - totalY;
  const winner = Math.abs(diff) < 3 ? "draw" : diff > 0 ? "X" : "Y";
  const rationale =
    winner === "draw"
      ? `Side X and Side Y finished within a few points of each other on the rubric (${totalX} vs ${totalY}), so this reading calls it a draw.`
      : `Side ${winner} scored higher on the weighted rubric (${Math.max(totalX, totalY)} vs ${Math.min(totalX, totalY)}), mainly through more specific support and engagement.`;
  return {
    sides: { X, Y },
    rationale,
    winner,
    margin: Math.round(Math.abs(diff) * 100) / 100,
    confidence: Math.round(clamp(0.55 + Math.abs(diff) / 25, 0.5, 0.95) * 100) / 100,
  };
}

export class MockJudgeProvider implements JudgeProvider {
  readonly id = "mock";
  readonly model = MOCK_JUDGE_MODEL;

  async runPass(input: JudgePassInput): Promise<JudgePassResult> {
    const raw = mockRawOutput(input);
    const parsed = parseJudgeOutput(raw, input.rubric);
    if (!parsed.ok) {
      return { ok: false, kind: "invalid_output", error: parsed.error, raw, retryable: false, latencyMs: 0, usage: null };
    }
    const presentation = presentCase(input.caseFile, input.order);
    return {
      ok: true,
      output: finalizePass(parsed.output, presentation, input.rubric, input.passNo),
      raw,
      usage: null,
      latencyMs: 0,
      stopReason: "end_turn",
      servedModel: this.model,
    };
  }
}
