/**
 * Owner: challenges. Maps competition rows ⇄ the pure `MachineState`, persists transitions and runs
 * their in-transaction side effects (notifications, freezing submissions, forfeit verdicts, audit).
 * Effects that call other modules (AI judge queue, reputation) are returned as `Deferred` work and
 * run by the caller AFTER the transaction commits.
 */
import "server-only";

import { and, eq, isNull, max } from "drizzle-orm";
import { writeAudit } from "@domain/audit";
import type { Tx } from "@domain/db";
import type { VerdictExplanation } from "@domain/db/json-types";
import {
  argumentsTable,
  competitionParticipants,
  competitions,
  submissions,
  verdicts,
  type Competition,
  type CompetitionParticipant,
} from "@domain/db/schema";
import { notify } from "@domain/notifications";
import {
  InvalidCompetitionStateError,
  NO_SUBMISSION,
  type Effect,
  type MachineState,
  type ParticipantRole,
  type ParticipantState,
  type Step,
  type SubmissionMark,
} from "./state-machine";

export interface LoadedCompetition {
  row: Competition;
  state: MachineState;
}

/** Work that must happen after commit (it calls other modules that open their own transactions). */
export type Deferred = { kind: "enqueue_evaluation" } | { kind: "apply_result" };

/** Load a competition and lock its row for the rest of the transaction (serialises state changes). */
export async function loadForUpdate(tx: Tx, competitionId: string): Promise<LoadedCompetition | null> {
  const [row] = await tx.select().from(competitions).where(eq(competitions.id, competitionId)).for("update").limit(1);
  if (!row) return null;
  const participants = await tx
    .select()
    .from(competitionParticipants)
    .where(eq(competitionParticipants.competitionId, competitionId));
  const marks = await tx
    .select({ authorId: submissions.authorId, round: submissions.round, lockedAt: submissions.lockedAt })
    .from(submissions)
    .where(eq(submissions.competitionId, competitionId));
  return { row, state: toMachineState(row, participants, marks) };
}

export function toMachineState(
  row: Competition,
  participants: readonly CompetitionParticipant[],
  marks: ReadonlyArray<{ authorId: string; round: "opening" | "rebuttal"; lockedAt: Date | null }>,
): MachineState {
  const toParticipant = (role: ParticipantRole): ParticipantState => {
    const p = participants.find((candidate) => candidate.role === role);
    if (!p) throw new InvalidCompetitionStateError(`Competition ${row.id} has no ${role}.`);
    const mark = (round: "opening" | "rebuttal"): SubmissionMark => {
      const found = marks.find((m) => m.authorId === p.userId && m.round === round);
      return found ? { present: true, lockedAt: found.lockedAt } : NO_SUBMISSION;
    };
    return {
      userId: p.userId,
      role,
      side: p.side,
      acceptance: p.acceptanceStatus,
      acceptedAt: p.acceptedAt,
      cancelRequestedAt: p.cancelRequestedAt,
      opening: mark("opening"),
      rebuttal: mark("rebuttal"),
    };
  };
  return {
    status: row.status,
    round: row.round,
    roundDurationHours: row.rulesSnapshot.roundDurationHours,
    acceptDeadline: row.acceptDeadline,
    acceptedAt: row.acceptedAt,
    openingClosesAt: row.openingClosesAt,
    rebuttalClosesAt: row.rebuttalClosesAt,
    lockedAt: row.lockedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    cancelledBy: row.cancelledBy,
    declineReason: row.declineReason,
    challenger: toParticipant("challenger"),
    recipient: toParticipant("recipient"),
  };
}

/** Write the machine-owned columns of the competition and its participants. */
export async function persistState(tx: Tx, competitionId: string, state: MachineState, at: Date): Promise<void> {
  await tx
    .update(competitions)
    .set({
      status: state.status,
      round: state.round,
      acceptedAt: state.acceptedAt,
      openingClosesAt: state.openingClosesAt,
      rebuttalClosesAt: state.rebuttalClosesAt,
      lockedAt: state.lockedAt,
      completedAt: state.completedAt,
      cancelledAt: state.cancelledAt,
      cancelReason: state.cancelReason,
      cancelledBy: state.cancelledBy,
      declineReason: state.declineReason,
      updatedAt: at,
    })
    .where(eq(competitions.id, competitionId));
  for (const p of [state.challenger, state.recipient]) {
    await tx
      .update(competitionParticipants)
      .set({ acceptanceStatus: p.acceptance, acceptedAt: p.acceptedAt, cancelRequestedAt: p.cancelRequestedAt })
      .where(and(eq(competitionParticipants.competitionId, competitionId), eq(competitionParticipants.userId, p.userId)));
  }
}

export interface StepContext {
  tx: Tx;
  row: Competition;
  /** State after the steps (used to resolve participants). */
  state: MachineState;
  /** Null = system (deadline). */
  actorId: string | null;
  at: Date;
}

/** Run the effects of each step in order and audit it. Returns the post-commit work. */
export async function runSteps(ctx: StepContext, steps: readonly Step[]): Promise<Deferred[]> {
  const deferred: Deferred[] = [];
  for (const step of steps) {
    for (const effect of step.effects) {
      const after = await runEffect(ctx, effect);
      if (after) deferred.push(after);
    }
    if (step.transition === "accept") await lockRootArgument(ctx);
    await writeAudit(
      {
        actorId: ctx.actorId,
        action: `competition.${step.transition}`,
        targetType: "competition",
        targetId: ctx.row.id,
        before: { phase: step.from },
        after: { phase: step.to, ...(step.to === "cancelled" ? { reason: ctx.state.cancelReason } : {}) },
      },
      ctx.tx,
    );
  }
  return deferred;
}

/**
 * Once a challenge on an argument is accepted, the argument can no longer be edited (design §2): the debate
 * is about the text both sides saw. Arguments-feed also derives the lock from competitions.accepted_at; the
 * flag makes it explicit and survives any later competition clean-up.
 */
async function lockRootArgument({ tx, row, at }: StepContext): Promise<void> {
  await tx
    .update(argumentsTable)
    .set({ lockedAt: at })
    .where(and(eq(argumentsTable.id, row.rootArgumentId), isNull(argumentsTable.lockedAt)));
}

async function runEffect(ctx: StepContext, effect: Effect): Promise<Deferred | null> {
  const { tx, row, state } = ctx;
  switch (effect.kind) {
    case "notify": {
      const recipients =
        effect.to === "both" ? [state.challenger.userId, state.recipient.userId] : [state[effect.to].userId];
      for (const userId of recipients) {
        await notify(
          {
            userId,
            type: effect.type,
            targetType: "competition",
            targetId: row.id,
            actorId: effect.actorId,
            data: { proposition: preview(row.rulesSnapshot.proposition), ...effect.data },
          },
          tx,
        );
      }
      return null;
    }
    case "freeze_round":
      await tx
        .update(submissions)
        .set({ lockedAt: effect.at })
        .where(
          and(eq(submissions.competitionId, row.id), eq(submissions.round, effect.round), isNull(submissions.lockedAt)),
        );
      return null;
    case "lock_submission":
      await tx
        .update(submissions)
        .set({ lockedAt: effect.at })
        .where(
          and(
            eq(submissions.competitionId, row.id),
            eq(submissions.authorId, effect.userId),
            eq(submissions.round, effect.round),
            isNull(submissions.lockedAt),
          ),
        );
      return null;
    case "forfeit":
      await writeForfeitVerdict(tx, row, state, effect.winner);
      return { kind: "apply_result" };
    case "enqueue_evaluation":
      return { kind: "enqueue_evaluation" };
  }
}

function preview(text: string, max = 100): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * The no-show verdict (design §4.2): no AI judging took place, so it is recorded as `decided_by = "system"`
 * (decided by the published rule) with `method: null` and an explicit note.
 */
async function writeForfeitVerdict(tx: Tx, row: Competition, state: MachineState, winner: ParticipantRole) {
  const winnerState = state[winner];
  const winnerLabel = winnerState.side === "FOR" ? "Side A (FOR)" : "Side B (AGAINST)";
  const loserLabel = winnerState.side === "FOR" ? "Side B (AGAINST)" : "Side A (FOR)";
  const explanation: VerdictExplanation = {
    summary:
      `${loserLabel} did not submit an opening before the opening round closed, so ${winnerLabel} wins by ` +
      "forfeit under the no-show rule both sides agreed to. No AI judging took place.",
    perCriterion: [],
    strengths: { A: [], B: [] },
    weaknesses: { A: [], B: [] },
    flaggedClaims: [],
    confidenceLabel: "high",
    method: null,
    injectionDetected: false,
    note: "Forfeit (no-show). Decided by the published rule, not by the AI judge. Rating change is applied at half weight.",
  };
  const [latest] = await tx
    .select({ version: max(verdicts.version) })
    .from(verdicts)
    .where(eq(verdicts.competitionId, row.id));
  await tx.update(verdicts).set({ isCurrent: false }).where(eq(verdicts.competitionId, row.id));
  await tx.insert(verdicts).values({
    competitionId: row.id,
    runId: null,
    version: (latest?.version ?? 0) + 1,
    outcome: "forfeit",
    winnerUserId: winnerState.userId,
    scores: null,
    explanation,
    confidence: null,
    isCurrent: true,
    decidedBy: "system",
    createdAt: state.completedAt ?? undefined,
  });
}
