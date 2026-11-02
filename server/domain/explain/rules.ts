/**
 * Owner: verdict explainer. Pure, client-safe helpers: how a verdict's decision rule is labelled, the
 * "Judged by …" line, and per-criterion averaging across stored passes. No DB, no server-only imports
 * (types only), so the verdict page can import it too.
 */
import type { PassOutputView } from "@domain/appeals/pass-output";
import type { DecidedBy, VerdictOutcome } from "@domain/db/schema";
import { DRAW_MARGIN_POINTS, MIN_DECISION_CONFIDENCE } from "@domain/judging/config";

/**
 * App-state keys the agent's prefill actions write (writeAppStateForCurrentTab). That helper stores
 * `<key>:<browserTabId>` when the agent run carries a tab id, and the bare key otherwise (CLI). The app-state
 * HTTP route does NOT tab-scope these keys, so the page must read `<key>:<getBrowserTabId()>` first and fall
 * back to the bare key — see app/components/argue/agent/use-agent-draft.ts.
 */
export const APPEAL_DRAFT_KEY = "appeal-draft";
export const ARGUMENT_DRAFT_KEY = "argument-draft";

export type DecisionRuleKind = "agreed" | "draw" | "three_of_four" | "inconclusive" | "forfeit" | "human";

export interface DecisionRule {
  kind: DecisionRuleKind;
  /** One plain-English sentence naming the published rule that produced this outcome. */
  label: string;
}

const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

/** Passes (of four) that must agree for a winner once the first pair disagreed. Mirrors judging/compare. */
const AGREEING_OF_FOUR = 3;
const FULL_PASS_COUNT = 4;

/**
 * Which fairness rule (design §4.3) decided this verdict. Human and forfeit results get their own label:
 * the AI never decided them, so they are never described as one of the AI rules.
 */
export function decisionRuleFor(input: {
  outcome: VerdictOutcome;
  decidedBy: DecidedBy;
  passCount: number;
}): DecisionRule {
  const { outcome, decidedBy, passCount } = input;
  if (decidedBy === "human") {
    return { kind: "human", label: "Decided by a human reviewer who was not in the debate, with a written reason." };
  }
  if (outcome === "forfeit") {
    return { kind: "forfeit", label: "Forfeit: one side didn't submit an opening before the deadline, so there was no AI judging." };
  }
  if (outcome === "inconclusive") {
    return {
      kind: "inconclusive",
      label: "Inconclusive: the passes couldn't confidently separate the sides, so no winner was forced and a human reviews it.",
    };
  }
  if (outcome === "draw") {
    return {
      kind: "draw",
      label: `Draw: the averaged score gap was within ${DRAW_MARGIN_POINTS} points out of 100 (or every pass scored a draw).`,
    };
  }
  if (passCount >= FULL_PASS_COUNT) {
    return {
      kind: "three_of_four",
      label: `The first two passes disagreed, so two more ran in swapped order; ${AGREEING_OF_FOUR} of ${FULL_PASS_COUNT} passes picked this side with average confidence of at least ${pct(MIN_DECISION_CONFIDENCE)}.`,
    };
  }
  return {
    kind: "agreed",
    label: `Both passes, read in swapped order, picked the same side with at least ${pct(MIN_DECISION_CONFIDENCE)} confidence.`,
  };
}

export interface PassSummary {
  passNo: number;
  order: "AB" | "BA";
  winner: "A" | "B" | "draw" | null;
  confidence: number | null;
  /** The model id recorded on the stored pass row (never inferred). */
  model: string;
}

/** "Judged by claude-… · 2 passes". Null when no pass rows are stored (e.g. forfeit or human decision). */
export function judgedByLine(passes: readonly Pick<PassSummary, "model">[]): string | null {
  if (passes.length === 0) return null;
  const models = [...new Set(passes.map((p) => p.model).filter((m) => m.trim().length > 0))];
  if (models.length === 0) return null;
  return `Judged by ${models.join(", ")} · ${passes.length} pass${passes.length === 1 ? "" : "es"}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Mean of each side's score per criterion across the given (canonical-label) pass outputs. */
export function averageCriterionScores(
  outputs: readonly PassOutputView[],
): Map<string, { A: number | null; B: number | null; passCount: number }> {
  const sums = new Map<string, { a: number; aN: number; b: number; bN: number }>();
  for (const out of outputs) {
    for (const c of out.criteria) {
      const s = sums.get(c.key) ?? { a: 0, aN: 0, b: 0, bN: 0 };
      if (c.A !== null) {
        s.a += c.A;
        s.aN += 1;
      }
      if (c.B !== null) {
        s.b += c.B;
        s.bN += 1;
      }
      sums.set(c.key, s);
    }
  }
  const result = new Map<string, { A: number | null; B: number | null; passCount: number }>();
  for (const [key, s] of sums) {
    result.set(key, {
      A: s.aN > 0 ? round2(s.a / s.aN) : null,
      B: s.bN > 0 ? round2(s.b / s.bN) : null,
      passCount: Math.max(s.aN, s.bN),
    });
  }
  return result;
}
