/**
 * Owner: challenges. Competition lifecycle (design §4.2, §5.2): lazy deadline enforcement, the cron
 * sweep, and the transactional executor every competition server action goes through.
 *
 * Server timestamps are authoritative: every read/write of a competition first applies any passed
 * deadline (`advance`), inside a transaction that holds the competition row lock, so a late submission
 * can never race a round closing.
 */
import "server-only";

import { and, eq, gt, lte, or, sql } from "drizzle-orm";
import { ActionError } from "@domain/lib/action-result";
import { addHours, now } from "@domain/lib/time";
import { db, type Tx } from "@domain/db";
import {
  competitionParticipants,
  competitions,
  notifications,
  submissions,
  type CompetitionRound,
  type CompetitionStatus,
} from "@domain/db/schema";
import { enqueueEvaluation } from "@domain/judging";
import { notify } from "@domain/notifications";
import { applyCompetitionResult } from "@domain/reputation";
import { loadForUpdate, persistState, runSteps, type Deferred, type LoadedCompetition } from "./repository";
import { advance, decide, isDue, type Command, type MachineState, type RejectionCode } from "./state-machine";
import { DEADLINE_SOON_HOURS } from "./terms";

export interface AdvanceResult {
  status: CompetitionStatus;
  round: CompetitionRound | null;
  /** True if this call changed the competition's state. */
  changed: boolean;
}

const SWEEP_BATCH = 200;

/**
 * Lazily enforce deadlines for one competition (call at the start of every read/write of it):
 * expire pending challenges, close the opening round (no-show → forfeit/cancelled), close the rebuttal
 * round → `locked` → enqueueEvaluation(id, "close"). Safe to call concurrently and repeatedly.
 */
export async function advanceCompetition(competitionId: string): Promise<AdvanceResult> {
  // Cheap unlocked pre-check: most reads find nothing due and never open a transaction.
  const [peek] = await db
    .select({
      status: competitions.status,
      round: competitions.round,
      acceptDeadline: competitions.acceptDeadline,
      openingClosesAt: competitions.openingClosesAt,
      rebuttalClosesAt: competitions.rebuttalClosesAt,
    })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .limit(1);
  if (!peek) throw new ActionError("NOT_FOUND", "We couldn't find that challenge.");
  const at = now();
  if (!isDue(peek, at)) return { status: peek.status, round: peek.round, changed: false };

  const { result, deferred } = await db.transaction(async (tx) => {
    const loaded = await requireLoaded(tx, competitionId);
    const applied = await applyAdvance(tx, loaded, at);
    return {
      result: { status: applied.state.status, round: applied.state.round, changed: applied.changed },
      deferred: applied.deferred,
    };
  });
  await runDeferred(competitionId, deferred);
  return result;
}

/**
 * Cron: advance every competition with a passed deadline, retry handing locked competitions to the
 * judge, and send one "deadline soon" nudge per participant per round. Returns how many changed.
 */
export async function sweepDeadlines(): Promise<number> {
  const at = now();
  const due = await db
    .select({ id: competitions.id })
    .from(competitions)
    .where(
      or(
        and(eq(competitions.status, "pending_acceptance"), lte(competitions.acceptDeadline, at)),
        and(eq(competitions.status, "active"), eq(competitions.round, "opening"), lte(competitions.openingClosesAt, at)),
        and(
          eq(competitions.status, "active"),
          eq(competitions.round, "rebuttal"),
          lte(competitions.rebuttalClosesAt, at),
        ),
      ),
    )
    .limit(SWEEP_BATCH);

  let changed = 0;
  for (const { id } of due) {
    try {
      if ((await advanceCompetition(id)).changed) changed++;
    } catch (error) {
      console.error("[competitions] sweep failed to advance", id, error);
    }
  }

  // `locked` is transient: the judge moves it to `evaluating`. Anything still here had its hand-off
  // fail (enqueueEvaluation is idempotent, so retrying is safe).
  const stuck = await db
    .select({ id: competitions.id })
    .from(competitions)
    .where(eq(competitions.status, "locked"))
    .limit(SWEEP_BATCH);
  for (const { id } of stuck) await runDeferred(id, [{ kind: "enqueue_evaluation" }]);

  await notifyDeadlinesSoon(at);
  return changed;
}

// ---------------------------------------------------------------------------------------------------
// Command executor (used by actions.ts)
// ---------------------------------------------------------------------------------------------------

export interface CommandHooks {
  /** Extra checks once the command is known to be allowed (e.g. the accept terms hash). Throw ActionError. */
  check?: (loaded: LoadedCompetition) => void | Promise<void>;
  /** Writes that must land before the transition's effects run (e.g. saving the submission text). */
  write?: (tx: Tx, loaded: LoadedCompetition) => Promise<void>;
}

const REJECTION_TO_ACTION: Record<RejectionCode, "FORBIDDEN" | "CONFLICT"> = {
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  DEADLINE_PASSED: "CONFLICT",
};

/**
 * Apply passed deadlines, then `command`, atomically under the competition row lock. Deadline changes
 * are committed even when the command itself is rejected (e.g. a late submission closes the round and
 * is then refused). Throws ActionError on rejection.
 */
export async function performCommand(
  competitionId: string,
  command: Command,
  hooks: CommandHooks = {},
): Promise<AdvanceResult & { state: MachineState; argumentId: string }> {
  const at = now();
  const outcome = await db.transaction(async (tx) => {
    const loaded = await requireLoaded(tx, competitionId);
    const advanced = await applyAdvance(tx, loaded, at);
    const current: LoadedCompetition = { row: loaded.row, state: advanced.state };

    const decision = decide(advanced.state, command, at);
    if (!decision.ok) {
      return { rejection: decision, deferred: advanced.deferred, state: advanced.state, argumentId: loaded.row.rootArgumentId };
    }

    await hooks.check?.(current);
    await hooks.write?.(tx, current);
    await persistState(tx, competitionId, decision.state, at);
    const deferred = await runSteps(
      { tx, row: loaded.row, state: decision.state, actorId: command.actorId, at },
      decision.steps,
    );
    return {
      rejection: null,
      deferred: [...advanced.deferred, ...deferred],
      state: decision.state,
      argumentId: loaded.row.rootArgumentId,
    };
  });

  await runDeferred(competitionId, outcome.deferred);
  if (outcome.rejection) {
    throw new ActionError(REJECTION_TO_ACTION[outcome.rejection.code], outcome.rejection.message);
  }
  return {
    status: outcome.state.status,
    round: outcome.state.round,
    changed: true,
    state: outcome.state,
    argumentId: outcome.argumentId,
  };
}

/**
 * Block hook (call inside the block transaction, passing its `tx`): a block ends any PENDING challenge
 * between the two users — withdrawn if the blocker sent it, declined if the blocker received it.
 * Active debates are left alone (only mutual/admin cancel can end those, design §4.2).
 * Returns how many challenges were closed.
 */
export async function onUsersBlocked(blockerId: string, blockedId: string, tx: Tx): Promise<number> {
  const at = now();
  const rows = await tx
    .select({ id: competitions.id, userId: competitionParticipants.userId })
    .from(competitions)
    .innerJoin(competitionParticipants, eq(competitionParticipants.competitionId, competitions.id))
    .where(
      and(
        eq(competitions.status, "pending_acceptance"),
        or(eq(competitionParticipants.userId, blockerId), eq(competitionParticipants.userId, blockedId)),
      ),
    );
  const members = new Map<string, Set<string>>();
  for (const row of rows) members.set(row.id, (members.get(row.id) ?? new Set()).add(row.userId));

  let closed = 0;
  for (const [competitionId, users] of members) {
    if (users.size !== 2) continue;
    const loaded = await requireLoaded(tx, competitionId);
    const advanced = await applyAdvance(tx, loaded, at);
    if (advanced.state.status !== "pending_acceptance") continue;
    const command: Command =
      advanced.state.challenger.userId === blockerId
        ? { type: "withdraw", actorId: blockerId }
        : { type: "decline", actorId: blockerId, reason: null };
    const decision = decide(advanced.state, command, at);
    if (!decision.ok) continue;
    await persistState(tx, competitionId, decision.state, at);
    await runSteps({ tx, row: loaded.row, state: decision.state, actorId: blockerId, at }, decision.steps);
    closed++;
  }
  return closed;
}

// ---------------------------------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------------------------------

async function requireLoaded(tx: Tx, competitionId: string): Promise<LoadedCompetition> {
  const loaded = await loadForUpdate(tx, competitionId);
  if (!loaded) throw new ActionError("NOT_FOUND", "We couldn't find that challenge.");
  return loaded;
}

async function applyAdvance(
  tx: Tx,
  loaded: LoadedCompetition,
  at: Date,
): Promise<{ state: MachineState; changed: boolean; deferred: Deferred[] }> {
  const advanced = advance(loaded.state, at);
  if (advanced.steps.length === 0) return { state: loaded.state, changed: false, deferred: [] };
  await persistState(tx, loaded.row.id, advanced.state, at);
  const deferred = await runSteps(
    { tx, row: loaded.row, state: advanced.state, actorId: null, at },
    advanced.steps,
  );
  return { state: advanced.state, changed: true, deferred };
}

/**
 * Cross-module hand-offs after commit. Failures are logged, never thrown: the competition's own state
 * is already correct, and the sweep retries the judge hand-off for anything left `locked`.
 */
async function runDeferred(competitionId: string, deferred: readonly Deferred[]): Promise<void> {
  for (const work of deferred) {
    try {
      if (work.kind === "enqueue_evaluation") await enqueueEvaluation(competitionId, "close");
      else await applyCompetitionResult(competitionId);
    } catch (error) {
      console.error(`[competitions] ${work.kind} failed for ${competitionId}`, error);
    }
  }
}

async function notifyDeadlinesSoon(at: Date): Promise<void> {
  const horizon = addHours(at, DEADLINE_SOON_HOURS);
  const closing = await db
    .select({
      id: competitions.id,
      round: competitions.round,
      openingClosesAt: competitions.openingClosesAt,
      rebuttalClosesAt: competitions.rebuttalClosesAt,
      proposition: sql<string>`${competitions.rulesSnapshot}->>'proposition'`,
    })
    .from(competitions)
    .where(
      and(
        eq(competitions.status, "active"),
        or(
          and(
            eq(competitions.round, "opening"),
            gt(competitions.openingClosesAt, at),
            lte(competitions.openingClosesAt, horizon),
          ),
          and(
            eq(competitions.round, "rebuttal"),
            gt(competitions.rebuttalClosesAt, at),
            lte(competitions.rebuttalClosesAt, horizon),
          ),
        ),
      ),
    )
    .limit(SWEEP_BATCH);

  for (const competition of closing) {
    const round = competition.round;
    if (round === null) continue;
    const closesAt = round === "opening" ? competition.openingClosesAt : competition.rebuttalClosesAt;
    const participants = await db
      .select({ userId: competitionParticipants.userId, lockedAt: submissions.lockedAt })
      .from(competitionParticipants)
      .leftJoin(
        submissions,
        and(
          eq(submissions.competitionId, competitionParticipants.competitionId),
          eq(submissions.authorId, competitionParticipants.userId),
          eq(submissions.round, round),
        ),
      )
      .where(eq(competitionParticipants.competitionId, competition.id));

    for (const participant of participants) {
      if (participant.lockedAt !== null) continue; // Already locked in: nothing to nudge.
      const [already] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, participant.userId),
            eq(notifications.type, "deadline_soon"),
            eq(notifications.targetId, competition.id),
            sql`${notifications.data}->>'round' = ${round}`,
          ),
        )
        .limit(1);
      if (already) continue;
      await notify({
        userId: participant.userId,
        type: "deadline_soon",
        targetType: "competition",
        targetId: competition.id,
        actorId: null,
        data: {
          round,
          closesAt: closesAt?.toISOString() ?? null,
          proposition: competition.proposition.length > 100 ? `${competition.proposition.slice(0, 99)}…` : competition.proposition,
        },
      });
    }
  }
}
