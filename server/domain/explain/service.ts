/**
 * Owner: verdict explainer (Task 10). Read model the agent explains a verdict from, plus the checks behind
 * the two agent "prefill" actions. Nothing here writes: the actions write tab-scoped app state, and the
 * user still submits (file-appeal / create-argument).
 *
 * Visibility: built on getVerdictPageData (the same read model get-verdict uses), so quotes from
 * submissions that moderators hid are already withheld. On top of that, a verdict that is not final
 * (evaluating / needs_review) or does not exist yet is NOT_FOUND for anyone who is neither a debater nor
 * staff — see docs/port-notes.md "8-explainer-host".
 */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { parseInput } from "@domain/action";
import { getCurrentVerdict } from "@domain/appeals/core";
import { readPassOutput, type PassOutputView } from "@domain/appeals/pass-output";
import { getVerdictPageData } from "@domain/appeals/queries";
import { findRubric } from "@domain/appeals/rubrics";
import { APPEAL_GROUND_VALUES, APPEAL_TEXT_MAX, APPEAL_TEXT_MIN } from "@domain/appeals/rules";
import { argumentFieldsSchema } from "@domain/arguments/validation";
import type { SessionUser } from "@domain/auth";
import { db } from "@domain/db";
import type { SideLabel } from "@domain/db/json-types";
import {
  categories,
  evaluationPasses,
  type AppealGround,
  type CompetitionStatus,
  type DecidedBy,
  type VerdictOutcome,
} from "@domain/db/schema";
import { ActionError } from "@domain/lib/action-result";
import {
  averageCriterionScores,
  decisionRuleFor,
  judgedByLine,
  type DecisionRule,
  type PassSummary,
} from "./rules";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface ExplainedSide {
  /** Mean 0–10 score across the stored passes (falls back to the verdict's stored score). */
  score: number | null;
  reason: string | null;
  quotes: string[];
}

export interface ExplainedCriterion {
  key: string;
  label: string;
  /** Relative weight; weights sum to 100. */
  weight: number;
  A: ExplainedSide;
  B: ExplainedSide;
  /** A − B on the 0–10 scale (null when either side has no score). */
  gap: number | null;
  /** How many stored passes the averages come from (0 = the verdict's stored scores were used). */
  passCount: number;
}

/** Named this way so it does not shadow json-types' VerdictExplanation (the judge's stored explanation). */
export interface VerdictExplanationView {
  competitionId: string;
  status: CompetitionStatus;
  proposition: string;
  category: { slug: string; name: string };
  sides: Record<SideLabel, { displayName: string; stance: "FOR" | "AGAINST" }>;
  viewer: { side: SideLabel | null; isStaff: boolean };
  rubric: { id: string; version: number; name: string | null; criteria: Array<{ key: string; label: string; weight: number }> };
  outcome: VerdictOutcome;
  winnerSide: SideLabel | null;
  decidedBy: DecidedBy;
  confidence: number | null;
  summary: string | null;
  reviewNote: string | null;
  totals: { A: number; B: number } | null;
  criteria: ExplainedCriterion[];
  passes: PassSummary[];
  /** "Judged by <model> · N passes", from the stored pass rows; null when none are stored. */
  judgedBy: string | null;
  rule: DecisionRule;
  /** Quotes withheld because their submission was hidden by moderation. */
  hiddenQuoteCount: number;
  appeal: {
    eligible: boolean;
    deadline: string | null;
    grounds: AppealGround[];
    alreadyFiled: boolean;
    /** Why the viewer can't appeal (null when eligible). */
    message: string | null;
  };
}

const NOT_FINAL: ReadonlySet<CompetitionStatus> = new Set<CompetitionStatus>(["evaluating", "needs_review"]);
const NOT_FOUND_MESSAGE = "We couldn't find a verdict for that debate.";

async function storedPasses(competitionId: string, runId: string | null): Promise<Array<PassSummary & { parsed: PassOutputView }>> {
  if (!runId) return [];
  const rows = await db
    .select()
    .from(evaluationPasses)
    .where(and(eq(evaluationPasses.competitionId, competitionId), eq(evaluationPasses.evaluationRunId, runId)))
    .orderBy(asc(evaluationPasses.passNo));
  const result: Array<PassSummary & { parsed: PassOutputView }> = [];
  for (const row of rows) {
    if (row.error) continue;
    // Canonical labels only (never `raw`), so a BA pass is not read with its sides swapped.
    const parsed = readPassOutput(row.output);
    if (!parsed) continue;
    result.push({
      passNo: row.passNo,
      order: row.order,
      winner: parsed.winner,
      confidence: row.confidence ?? parsed.confidence,
      model: row.model,
      parsed,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// get-verdict-explanation
// ---------------------------------------------------------------------------

export async function getVerdictExplanation(actor: SessionUser | null, competitionId: string): Promise<VerdictExplanationView> {
  const id = parseInput(z.object({ competitionId: z.uuid("That debate doesn't exist.") }), { competitionId }).competitionId;
  const data = await getVerdictPageData(id, actor);
  if (!data) throw new ActionError("NOT_FOUND", NOT_FOUND_MESSAGE);

  const privileged = data.viewer.side !== null || data.viewer.isStaff;
  const current = data.current;
  if (!current) {
    throw new ActionError("NOT_FOUND", privileged ? "There's no verdict to explain yet." : NOT_FOUND_MESSAGE);
  }
  if (!privileged && NOT_FINAL.has(data.status)) throw new ActionError("NOT_FOUND", NOT_FOUND_MESSAGE);

  const row = await getCurrentVerdict(id);
  const passes = await storedPasses(id, row && row.id === current.id ? row.runId : null);
  const averages = averageCriterionScores(passes.map((p) => p.parsed));
  const rubric = await findRubric(data.rubric.id, data.rubric.version);

  const scoreCriteria = current.scores?.criteria ?? [];
  const criteriaDefs =
    scoreCriteria.length > 0
      ? scoreCriteria.map((c) => ({ key: c.key, label: c.label, weight: c.weight }))
      : (rubric?.criteria ?? []).map((c) => ({ key: c.key, label: c.label, weight: c.weight }));

  const criteria: ExplainedCriterion[] = criteriaDefs.map((def) => {
    const avg = averages.get(def.key);
    const stored = scoreCriteria.find((c) => c.key === def.key);
    const reasons = current.explanation?.perCriterion.find((c) => c.key === def.key);
    const scoreA = avg?.A ?? stored?.A ?? null;
    const scoreB = avg?.B ?? stored?.B ?? null;
    return {
      ...def,
      A: { score: scoreA, reason: reasons?.A.reason ?? null, quotes: reasons?.A.quotes ?? [] },
      B: { score: scoreB, reason: reasons?.B.reason ?? null, quotes: reasons?.B.quotes ?? [] },
      gap: scoreA !== null && scoreB !== null ? Math.round((scoreA - scoreB) * 100) / 100 : null,
      passCount: avg?.passCount ?? 0,
    };
  });

  const passSummaries: PassSummary[] = passes.map(({ parsed: _parsed, ...p }) => p);
  const passCount = passSummaries.length > 0 ? passSummaries.length : (current.explanation?.method?.passCount ?? 0);
  const viewerSide = data.viewer.side;

  return {
    competitionId: data.competitionId,
    status: data.status,
    proposition: data.proposition,
    category: data.category,
    sides: {
      A: { displayName: data.sides.A.displayName, stance: data.sides.A.stance },
      B: { displayName: data.sides.B.displayName, stance: data.sides.B.stance },
    },
    viewer: { side: viewerSide, isStaff: data.viewer.isStaff },
    rubric: { id: data.rubric.id, version: data.rubric.version, name: rubric?.name ?? null, criteria: criteriaDefs },
    outcome: current.outcome,
    winnerSide: current.outcomeView.winnerSide,
    decidedBy: current.decidedBy,
    confidence: current.confidence,
    summary: current.explanation?.summary ?? null,
    reviewNote: current.reviewNote,
    totals: current.scores?.totals ?? null,
    criteria,
    passes: passSummaries,
    judgedBy: judgedByLine(passSummaries),
    rule: decisionRuleFor({ outcome: current.outcome, decidedBy: current.decidedBy, passCount }),
    hiddenQuoteCount: current.hiddenQuoteCount,
    appeal: {
      eligible: data.eligibility.eligible,
      deadline: data.eligibility.closesAt,
      grounds: [...APPEAL_GROUND_VALUES],
      alreadyFiled: viewerSide !== null && data.appeals.some((a) => a.appellantSide === viewerSide),
      message: data.eligibility.eligible ? null : data.eligibility.message,
    },
  };
}

// ---------------------------------------------------------------------------
// prefill-appeal
// ---------------------------------------------------------------------------

export const appealDraftSchema = z.object({
  competitionId: z.uuid("That debate doesn't exist."),
  ground: z.enum(APPEAL_GROUND_VALUES, "Pick one of the five appeal grounds."),
  statement: z
    .string()
    .trim()
    .min(APPEAL_TEXT_MIN, `Explain the mistake in at least ${APPEAL_TEXT_MIN} characters.`)
    .max(APPEAL_TEXT_MAX, `Keep the appeal under ${APPEAL_TEXT_MAX} characters.`),
});

export type AppealDraftInput = z.input<typeof appealDraftSchema>;

export interface AppealDraft {
  competitionId: string;
  ground: AppealGround;
  statement: string;
  /** ISO time the appeal window closes. */
  closesAt: string;
}

/** Validate an agent-drafted appeal for the actor. CONFLICT when the actor can't appeal right now. */
export async function prepareAppealDraft(actor: SessionUser, input: AppealDraftInput): Promise<AppealDraft> {
  const draft = parseInput(appealDraftSchema, input);
  const data = await getVerdictPageData(draft.competitionId, actor);
  if (!data) throw new ActionError("NOT_FOUND", NOT_FOUND_MESSAGE);
  if (!data.eligibility.eligible) {
    throw new ActionError("CONFLICT", data.eligibility.message || "This verdict can't be appealed right now.");
  }
  return { ...draft, closesAt: data.eligibility.closesAt };
}

// ---------------------------------------------------------------------------
// prefill-argument (Task 11)
// ---------------------------------------------------------------------------

/** Same field rules (and length limits) as createArgument. Proposition is optional for a draft. */
export const argumentDraftSchema = argumentFieldsSchema
  .pick({ title: true, body: true, categorySlug: true })
  .extend({ proposition: argumentFieldsSchema.shape.proposition.optional() });

export type ArgumentDraftInput = z.input<typeof argumentDraftSchema>;

export interface ArgumentDraft {
  title: string;
  proposition: string | null;
  body: string;
  categorySlug: string;
  categoryName: string;
  rubricId: string;
}

export async function prepareArgumentDraft(input: ArgumentDraftInput): Promise<ArgumentDraft> {
  const draft = parseInput(argumentDraftSchema, input);
  const [category] = await db
    .select({ slug: categories.slug, name: categories.name, rubricId: categories.rubricId })
    .from(categories)
    .where(and(eq(categories.slug, draft.categorySlug), eq(categories.active, true)))
    .limit(1);
  if (!category) {
    throw new ActionError("NOT_FOUND", `There's no category "${draft.categorySlug}". Use one from list-categories.`);
  }
  return {
    title: draft.title,
    proposition: draft.proposition ?? null,
    body: draft.body,
    categorySlug: category.slug,
    categoryName: category.name,
    rubricId: category.rubricId,
  };
}
