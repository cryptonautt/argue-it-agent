/**
 * Owner: verdict. Appeal and human-review decisions (design §4.3.3, §4.4).
 *
 * These functions take an already-authenticated actor and validated input; the "use server" wrappers in
 * actions.ts add auth, zod, rate limits and idempotency. Every decision:
 *   - is serialised on the competition / appeal row (SELECT … FOR UPDATE + status guards),
 *   - refuses reviewers who took part in the debate (conflict of interest),
 *   - writes audit rows and notifications in the same transaction,
 *   - re-applies reputation from scratch via applyCompetitionResult() when the outcome changes.
 */
import "server-only";

import { and, desc, eq, max } from "drizzle-orm";
import { ActionError, type ActionErrorCode } from "@domain/lib/action-result";
import { now } from "@domain/lib/time";
import { writeAudit } from "@domain/audit";
import { db, type Tx } from "@domain/db";
import { isUniqueViolation } from "@domain/db/errors";
import type { NotificationData, VerdictExplanation } from "@domain/db/json-types";
import {
  appeals,
  competitions,
  evaluationRuns,
  verdicts,
  type AppealGround,
  type AppealStatus,
  type Verdict,
  type VerdictOutcome,
} from "@domain/db/schema";
import { enqueueEvaluation } from "@domain/judging";
import { notify } from "@domain/notifications";
import { applyCompetitionResult } from "@domain/reputation";
import { getCurrentVerdict, isParticipant, loadCompetitionCore, type CompetitionCore } from "./core";
import { getAppealEligibility, type IneligibleReason } from "./eligibility";
import { personalOutcomeLabel, winnerUserIdFor } from "./verdict-view";

export interface Actor {
  id: string;
}

export type HumanOutcome = "A" | "B" | "draw" | "inconclusive";

const INELIGIBLE_CODES: Record<IneligibleReason, ActionErrorCode> = {
  signed_out: "UNAUTHENTICATED",
  not_participant: "FORBIDDEN",
  no_verdict: "CONFLICT",
  appeal_in_progress: "CONFLICT",
  already_appealed: "CONFLICT",
  window_closed: "CONFLICT",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function lockCompetition(tx: Tx, competitionId: string): Promise<CompetitionCore> {
  const [locked] = await tx
    .select({ id: competitions.id })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .for("update");
  const core = locked ? await loadCompetitionCore(competitionId, tx) : null;
  if (!core) throw new ActionError("NOT_FOUND", "That debate no longer exists.");
  return core;
}

function assertNotParticipant(core: CompetitionCore, actor: Actor): void {
  if (isParticipant(core, actor.id)) {
    throw new ActionError("FORBIDDEN", "You took part in this debate, so another reviewer has to decide it.");
  }
}

function participantIds(core: CompetitionCore): [string, string] {
  return [core.sides.A.userId, core.sides.B.userId];
}

function minimalExplanation(note: string): VerdictExplanation {
  return {
    summary: note,
    perCriterion: [],
    strengths: { A: [], B: [] },
    weaknesses: { A: [], B: [] },
    flaggedClaims: [],
    confidenceLabel: "low",
    method: null,
    injectionDetected: false,
    note,
  };
}

/**
 * Replace the current verdict with a human decision. The previous verdict is kept (is_current = false)
 * so the history shows exactly what changed. AI scores/explanation are carried over for reference.
 */
async function writeHumanVerdict(
  tx: Tx,
  args: { core: CompetitionCore; previous: Verdict | undefined; outcome: HumanOutcome; reviewerId: string; note: string },
): Promise<Verdict> {
  const { core, previous, outcome, reviewerId, note } = args;
  const competitionId = core.competition.id;
  const [top] = await tx
    .select({ version: max(verdicts.version) })
    .from(verdicts)
    .where(eq(verdicts.competitionId, competitionId));
  const version = (top?.version ?? 0) + 1;

  if (previous) {
    await tx.update(verdicts).set({ isCurrent: false }).where(eq(verdicts.id, previous.id));
  }
  const carryScores = previous && previous.outcome !== "forfeit";
  const [inserted] = await tx
    .insert(verdicts)
    .values({
      competitionId,
      runId: carryScores ? previous.runId : null,
      version,
      outcome,
      winnerUserId: winnerUserIdFor(outcome, { A: core.sides.A.userId, B: core.sides.B.userId }),
      scores: carryScores ? previous.scores : null,
      explanation: carryScores && previous.explanation ? { ...previous.explanation, note } : minimalExplanation(note),
      confidence: null,
      isCurrent: true,
      decidedBy: "human",
      reviewerId,
      reviewNote: note,
      createdAt: now(),
    })
    .returning();
  if (!inserted) throw new Error("writeHumanVerdict: insert failed");
  return inserted;
}

/**
 * Re-apply ratings for a competition from scratch. Never undoes a decision if reputation fails —
 * it reports `false` so staff can retry (applyCompetitionResult is idempotent).
 */
export async function reapplyReputation(competitionId: string): Promise<boolean> {
  try {
    await applyCompetitionResult(competitionId);
    return true;
  } catch (error) {
    console.error("[appeals] applyCompetitionResult failed", { competitionId, error });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------

export interface FileAppealInput {
  competitionId: string;
  ground: AppealGround;
  text: string;
}

export async function fileAppeal(actor: Actor, input: FileAppealInput): Promise<{ appealId: string }> {
  return db.transaction(async (tx) => {
    const core = await lockCompetition(tx, input.competitionId);
    const current = await getCurrentVerdict(core.competition.id, tx);
    const existing = await tx.select().from(appeals).where(eq(appeals.competitionId, core.competition.id));
    const at = now();

    const eligibility = getAppealEligibility({
      viewerId: actor.id,
      participantIds: participantIds(core),
      competitionStatus: core.competition.status,
      currentVerdict: current ? { id: current.id, createdAt: current.createdAt } : null,
      appeals: existing,
      at,
    });
    if (!eligibility.eligible) throw new ActionError(INELIGIBLE_CODES[eligibility.reason], eligibility.message);
    if (!current) throw new ActionError("CONFLICT", "There's no verdict to appeal yet.");

    let appealId: string;
    try {
      const [row] = await tx
        .insert(appeals)
        .values({
          competitionId: core.competition.id,
          verdictId: current.id,
          appellantId: actor.id,
          ground: input.ground,
          text: input.text,
          createdAt: at,
        })
        .returning({ id: appeals.id });
      if (!row) throw new Error("fileAppeal: insert failed");
      appealId = row.id;
    } catch (error) {
      if (isUniqueViolation(error, "appeals_one_per_participant_uq")) {
        throw new ActionError("CONFLICT", "You've already used your one appeal for this debate.");
      }
      throw error;
    }

    await tx.update(competitions).set({ status: "under_appeal" }).where(eq(competitions.id, core.competition.id));
    await writeAudit(
      {
        actorId: actor.id,
        action: "appeal.file",
        targetType: "appeal",
        targetId: appealId,
        before: { competitionStatus: core.competition.status },
        after: { competitionStatus: "under_appeal", ground: input.ground, verdictId: current.id },
      },
      tx,
    );
    const opponent = core.sides.A.userId === actor.id ? core.sides.B : core.sides.A;
    await notify(
      {
        userId: opponent.userId,
        actorId: null, // must reach the opponent even if they blocked the appellant after the debate
        type: "appeal_filed",
        targetType: "competition",
        targetId: core.competition.id,
        data: { appealId, ground: input.ground, proposition: core.competition.rulesSnapshot.proposition },
      },
      tx,
    );
    return { appealId };
  });
}

// ---------------------------------------------------------------------------
// Appeal decisions
// ---------------------------------------------------------------------------

export type AppealDecisionInput =
  | { appealId: string; decision: "uphold"; note: string }
  | { appealId: string; decision: "reevaluate"; note: string }
  | { appealId: string; decision: "overturn"; note: string; outcome: HumanOutcome };

export interface AppealDecisionResult {
  appealId: string;
  competitionId: string;
  status: AppealStatus;
  /** New verdict id for overturns. */
  verdictId: string | null;
  /** Null when ratings weren't touched by this decision. */
  ratingsUpdated: boolean | null;
}

interface OpenAppealContext {
  appeal: typeof appeals.$inferSelect;
  core: CompetitionCore;
  current: Verdict;
}

async function loadOpenAppealForDecision(tx: Tx, actor: Actor, appealId: string): Promise<OpenAppealContext> {
  const [appeal] = await tx.select().from(appeals).where(eq(appeals.id, appealId)).for("update");
  if (!appeal) throw new ActionError("NOT_FOUND", "That appeal no longer exists.");
  if (appeal.status !== "open") throw new ActionError("CONFLICT", "This appeal has already been decided.");
  const core = await lockCompetition(tx, appeal.competitionId);
  assertNotParticipant(core, actor);
  if (core.competition.status !== "under_appeal") {
    throw new ActionError("CONFLICT", "This debate isn't under appeal any more. Refresh to see its current state.");
  }
  const current = await getCurrentVerdict(core.competition.id, tx);
  if (!current || current.id !== appeal.verdictId) {
    throw new ActionError("CONFLICT", "The verdict changed since this appeal was filed. Refresh and review again.");
  }
  return { appeal, core, current };
}

async function markAppealDecided(
  tx: Tx,
  appealId: string,
  status: Exclude<AppealStatus, "open">,
  actor: Actor,
  note: string,
): Promise<void> {
  const updated = await tx
    .update(appeals)
    .set({ status, reviewerId: actor.id, decisionNote: note, decidedAt: now() })
    .where(and(eq(appeals.id, appealId), eq(appeals.status, "open")))
    .returning({ id: appeals.id });
  if (updated.length === 0) throw new ActionError("CONFLICT", "This appeal has already been decided.");
}

const DECISION_LABELS: Record<Exclude<AppealStatus, "open">, string> = {
  upheld: "The verdict stands",
  reevaluated: "A fresh AI evaluation was ordered",
  overturned: "The result was changed",
};

/**
 * One notification per debater, with a personal outcome line ("You won", "Draw"…) when the result changed.
 * Sent as a system notification (no actor): a decision about your own debate must reach you even if you
 * blocked the reviewer, and reviewers stay anonymous to debaters.
 */
async function notifyParticipants(
  core: CompetitionCore,
  type: "appeal_decided" | "verdict_ready",
  data: NotificationData,
  result: { outcome: VerdictOutcome; winnerUserId: string | null } | null,
  tx?: Tx,
): Promise<void> {
  for (const userId of participantIds(core)) {
    await notify(
      {
        userId,
        actorId: null,
        type,
        targetType: "competition",
        targetId: core.competition.id,
        data: {
          proposition: core.competition.rulesSnapshot.proposition,
          ...data,
          ...(result ? { outcomeLabel: personalOutcomeLabel(result.outcome, result.winnerUserId, userId) } : {}),
        },
      },
      tx,
    );
  }
}

async function notifyDecision(
  core: CompetitionCore,
  appealId: string,
  decision: Exclude<AppealStatus, "open">,
  result: { outcome: VerdictOutcome; winnerUserId: string | null } | null,
  tx?: Tx,
): Promise<void> {
  await notifyParticipants(
    core,
    "appeal_decided",
    { appealId, decision, ...(result ? {} : { outcomeLabel: DECISION_LABELS[decision] }) },
    result,
    tx,
  );
}

export async function decideAppeal(actor: Actor, input: AppealDecisionInput): Promise<AppealDecisionResult> {
  switch (input.decision) {
    case "uphold":
      return upholdAppeal(actor, input.appealId, input.note);
    case "reevaluate":
      return orderReevaluation(actor, input.appealId, input.note);
    case "overturn":
      return overturnAppeal(actor, input.appealId, input.note, input.outcome);
  }
}

async function upholdAppeal(actor: Actor, appealId: string, note: string): Promise<AppealDecisionResult> {
  const competitionId = await db.transaction(async (tx) => {
    const { core, current } = await loadOpenAppealForDecision(tx, actor, appealId);
    await markAppealDecided(tx, appealId, "upheld", actor, note);
    await tx.update(competitions).set({ status: "completed" }).where(eq(competitions.id, core.competition.id));
    await writeAudit(
      {
        actorId: actor.id,
        action: "appeal.uphold",
        targetType: "appeal",
        targetId: appealId,
        before: { status: "open", competitionStatus: "under_appeal" },
        after: { status: "upheld", competitionStatus: "completed", verdictId: current.id, note },
      },
      tx,
    );
    await notifyDecision(core, appealId, "upheld", null, tx);
    return core.competition.id;
  });
  return { appealId, competitionId, status: "upheld", verdictId: null, ratingsUpdated: null };
}

async function orderReevaluation(actor: Actor, appealId: string, note: string): Promise<AppealDecisionResult> {
  const core = await db.transaction(async (tx) => {
    const ctx = await loadOpenAppealForDecision(tx, actor, appealId);
    if (ctx.current.outcome === "forfeit") {
      throw new ActionError(
        "CONFLICT",
        "A forfeit wasn't judged by the AI, so there's nothing to re-run. Uphold or overturn it instead.",
      );
    }
    const [previous] = await tx
      .select({ id: appeals.id })
      .from(appeals)
      .where(and(eq(appeals.competitionId, ctx.core.competition.id), eq(appeals.status, "reevaluated")))
      .limit(1);
    if (previous) {
      throw new ActionError(
        "CONFLICT",
        "This debate has already had its one appeal re-evaluation. Uphold or overturn this appeal instead.",
      );
    }
    await markAppealDecided(tx, appealId, "reevaluated", actor, note);
    // Same transaction: the decision and the queued job commit together or not at all. The judge sets
    // the competition to `evaluating`, writes the new verdict (old one kept in history) and re-applies
    // reputation when it finishes.
    await enqueueEvaluation(ctx.core.competition.id, "appeal", tx);
    await writeAudit(
      {
        actorId: actor.id,
        action: "appeal.reevaluate",
        targetType: "appeal",
        targetId: appealId,
        before: { status: "open", verdictId: ctx.current.id },
        after: { status: "reevaluated", note },
      },
      tx,
    );
    await notifyDecision(ctx.core, appealId, "reevaluated", null, tx);
    return ctx.core;
  });
  return { appealId, competitionId: core.competition.id, status: "reevaluated", verdictId: null, ratingsUpdated: null };
}

async function overturnAppeal(
  actor: Actor,
  appealId: string,
  note: string,
  outcome: HumanOutcome,
): Promise<AppealDecisionResult> {
  const { competitionId, verdictId } = await db.transaction(async (tx) => {
    const { core, current } = await loadOpenAppealForDecision(tx, actor, appealId);
    if (current.outcome === outcome) {
      throw new ActionError("VALIDATION", "That's already the outcome. Choose Uphold if the verdict should stand.", {
        outcome: ["Pick a different outcome, or uphold the appeal instead."],
      });
    }
    await markAppealDecided(tx, appealId, "overturned", actor, note);
    const next = await writeHumanVerdict(tx, { core, previous: current, outcome, reviewerId: actor.id, note });
    await tx.update(competitions).set({ status: "completed" }).where(eq(competitions.id, core.competition.id));
    await writeAudit(
      {
        actorId: actor.id,
        action: "appeal.overturn",
        targetType: "appeal",
        targetId: appealId,
        before: { status: "open" },
        after: { status: "overturned", verdictId: next.id, note },
      },
      tx,
    );
    await writeAudit(
      {
        actorId: actor.id,
        action: "verdict.override",
        targetType: "verdict",
        targetId: next.id,
        before: { verdictId: current.id, version: current.version, outcome: current.outcome, decidedBy: current.decidedBy },
        after: { verdictId: next.id, version: next.version, outcome: next.outcome, decidedBy: "human", appealId },
      },
      tx,
    );
    await notifyDecision(core, appealId, "overturned", next, tx);
    return { competitionId: core.competition.id, verdictId: next.id };
  });

  const ratingsUpdated = await reapplyReputation(competitionId);
  return { appealId, competitionId, status: "overturned", verdictId, ratingsUpdated };
}

// ---------------------------------------------------------------------------
// Needs-review queue (inconclusive or failed evaluations)
// ---------------------------------------------------------------------------

export interface ResolveReviewInput {
  competitionId: string;
  /** "inconclusive" confirms the AI's "no winner"; A/B/draw sets the result. */
  outcome: HumanOutcome;
  note: string;
}

export interface ResolveReviewResult {
  competitionId: string;
  verdictId: string;
  ratingsUpdated: boolean;
}

export async function resolveReview(actor: Actor, input: ResolveReviewInput): Promise<ResolveReviewResult> {
  const verdictId = await db.transaction(async (tx) => {
    const core = await lockCompetition(tx, input.competitionId);
    assertNotParticipant(core, actor);
    if (core.competition.status !== "needs_review") {
      throw new ActionError("CONFLICT", "This debate isn't waiting for review any more. Refresh to see its state.");
    }
    const previous = await getCurrentVerdict(core.competition.id, tx);
    const next = await writeHumanVerdict(tx, {
      core,
      previous,
      outcome: input.outcome,
      reviewerId: actor.id,
      note: input.note,
    });
    await tx
      .update(competitions)
      .set({ status: "completed", completedAt: core.competition.completedAt ?? now() })
      .where(eq(competitions.id, core.competition.id));
    await writeAudit(
      {
        actorId: actor.id,
        action: input.outcome === "inconclusive" ? "review.confirm_inconclusive" : "review.decide",
        targetType: "competition",
        targetId: core.competition.id,
        before: {
          status: "needs_review",
          verdictId: previous?.id ?? null,
          outcome: previous?.outcome ?? null,
        },
        after: { status: "completed", verdictId: next.id, outcome: next.outcome, decidedBy: "human", note: input.note },
      },
      tx,
    );
    await notifyParticipants(core, "verdict_ready", { verdictId: next.id, decidedBy: "human" }, next, tx);
    return next.id;
  });

  const ratingsUpdated = await reapplyReputation(input.competitionId);
  return { competitionId: input.competitionId, verdictId, ratingsUpdated };
}

/**
 * Re-queue the AI evaluation for a needs-review debate whose last run FAILED (provider outage, refusal)
 * and produced no result. Not allowed for inconclusive results: re-running until a winner appears is
 * exactly the "reroll" the rules forbid.
 */
export async function retryFailedEvaluation(actor: Actor, competitionId: string): Promise<{ competitionId: string }> {
  await db.transaction(async (tx) => {
    const core = await lockCompetition(tx, competitionId);
    assertNotParticipant(core, actor);
    if (core.competition.status !== "needs_review") {
      throw new ActionError("CONFLICT", "This debate isn't waiting for review any more.");
    }
    const [latestRun] = await tx
      .select({ id: evaluationRuns.id, status: evaluationRuns.status, reason: evaluationRuns.reason })
      .from(evaluationRuns)
      .where(eq(evaluationRuns.competitionId, competitionId))
      .orderBy(desc(evaluationRuns.startedAt))
      .limit(1);
    if (latestRun && latestRun.status !== "failed") {
      throw new ActionError(
        "CONFLICT",
        "The last evaluation finished with a result. Decide it yourself rather than re-running the AI.",
      );
    }
    const reason = latestRun?.reason ?? "close";
    await enqueueEvaluation(competitionId, reason, tx);
    // The judge queues a closing evaluation at most once ever; if nothing was queued, say so honestly.
    const [after] = await tx
      .select({ status: competitions.status })
      .from(competitions)
      .where(eq(competitions.id, competitionId));
    if (after?.status !== "evaluating") {
      throw new ActionError(
        "CONFLICT",
        "The judge won't re-run this evaluation automatically. Please decide it below with a written reason.",
      );
    }
    await writeAudit(
      {
        actorId: actor.id,
        action: "review.retry_evaluation",
        targetType: "competition",
        targetId: competitionId,
        before: { status: "needs_review", runId: latestRun?.id ?? null },
        after: { status: "evaluating", reason },
      },
      tx,
    );
  });
  return { competitionId };
}

/** Staff retry when a decision went through but the rating update failed. */
export async function retryReputation(actor: Actor, competitionId: string): Promise<{ ratingsUpdated: boolean }> {
  const core = await loadCompetitionCore(competitionId);
  if (!core) throw new ActionError("NOT_FOUND", "That debate no longer exists.");
  assertNotParticipant(core, actor);
  const ratingsUpdated = await reapplyReputation(competitionId);
  await writeAudit({
    actorId: actor.id,
    action: "reputation.reapply",
    targetType: "competition",
    targetId: competitionId,
    after: { ratingsUpdated },
  });
  return { ratingsUpdated };
}
