import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { now } from "@domain/lib/time";
import { writeAudit } from "@domain/audit";
import { db, type DbOrTx } from "@domain/db";
import {
  competitionParticipants,
  competitions,
  reputationEvents,
  userRatings,
  verdicts,
  type ReputationEvent,
} from "@domain/db/schema";
import { DEFAULT_GLICKO2_CONFIG, rateHeadToHead, type Glicko2Rating } from "./glicko2";
import { recordColumn, resolveCompetitionOutcome, type PlayerResult } from "./outcome";
import type { ApplyCompetitionResultOutcome } from "./types";

/**
 * Reputation is an append-only ledger (`reputation_events`) with a materialised balance (`user_ratings`).
 *
 * applyCompetitionResult(competitionId) makes the ledger reflect the competition's CURRENT verdict:
 *   1. If the live (un-reversed) result events already match the current verdict → nothing to do.
 *   2. Otherwise every live result event is reversed with a compensating `reversal` event (its rating,
 *      RD and volatility deltas are subtracted from the user's current values; W/L/D decremented), and
 *   3. the current verdict is applied fresh — overall and in the competition's category — from the
 *      post-reversal ratings of both players (one Glicko-2 rating period per competition).
 *
 * Re-applying after an appeal therefore never double-counts, and an appeal that ends `inconclusive`
 * simply removes the old result. History is never edited: every change is a new row.
 *
 * Concurrency: the competition row and both players' rating rows are locked FOR UPDATE inside one
 * transaction, so concurrent applies (same competition or a shared player) serialise.
 */

type ScopeKey = string;
const scopeKey = (userId: string, categoryId: string | null): ScopeKey => `${userId}:${categoryId ?? "overall"}`;

interface RatingState extends Glicko2Rating {
  id: string;
  userId: string;
  categoryId: string | null;
  wins: number;
  losses: number;
  draws: number;
  dirty: boolean;
}

interface DesiredEvent {
  userId: string;
  categoryId: string | null;
  score: number;
  weight: number;
}

const MIN_VOLATILITY = 0.0001;

function clampRd(rd: number): number {
  return Math.min(DEFAULT_GLICKO2_CONFIG.defaultRd, Math.max(DEFAULT_GLICKO2_CONFIG.minRd, rd));
}

/** Live = result events of this competition that no reversal event points at. */
export function liveResultEvents(events: readonly ReputationEvent[]): ReputationEvent[] {
  const reversed = new Set(events.filter((e) => e.kind === "reversal" && e.reversesEventId).map((e) => e.reversesEventId));
  return events.filter((e) => e.kind === "result" && !reversed.has(e.id));
}

function sameEvents(live: readonly ReputationEvent[], desired: readonly DesiredEvent[], verdictId: string | null): boolean {
  if (live.length !== desired.length) return false;
  const remaining = [...live];
  for (const want of desired) {
    const index = remaining.findIndex(
      (e) =>
        e.verdictId === verdictId &&
        e.userId === want.userId &&
        e.categoryId === want.categoryId &&
        e.score === want.score &&
        e.weight === want.weight,
    );
    if (index === -1) return false;
    remaining.splice(index, 1);
  }
  return true;
}

function desiredEvents(results: readonly PlayerResult[], categoryId: string): DesiredEvent[] {
  return results.flatMap((r) => [
    { userId: r.userId, categoryId: null, score: r.score, weight: r.weight },
    { userId: r.userId, categoryId, score: r.score, weight: r.weight },
  ]);
}

async function lockRatingRows(tx: DbOrTx, keys: ReadonlyArray<{ userId: string; categoryId: string | null }>) {
  const unique = new Map(keys.map((k) => [scopeKey(k.userId, k.categoryId), k]));
  // Deterministic order for inserts and locks so concurrent applies sharing a player cannot deadlock.
  const values = [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, k]) => k);
  if (values.length === 0) return new Map<ScopeKey, RatingState>();

  // Materialise default rows so there is something to lock (unique on user+category, NULLS NOT DISTINCT).
  await tx
    .insert(userRatings)
    .values(values.map((k) => ({ userId: k.userId, categoryId: k.categoryId })))
    .onConflictDoNothing();

  const userIds = [...new Set(values.map((k) => k.userId))];
  const rows = await tx
    .select()
    .from(userRatings)
    .where(inArray(userRatings.userId, userIds))
    .orderBy(userRatings.userId, userRatings.id)
    .for("update");

  const states = new Map<ScopeKey, RatingState>();
  for (const row of rows) {
    const key = scopeKey(row.userId, row.categoryId);
    if (!unique.has(key)) continue;
    states.set(key, {
      id: row.id,
      userId: row.userId,
      categoryId: row.categoryId,
      rating: row.rating,
      rd: row.rd,
      volatility: row.volatility,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      dirty: false,
    });
  }
  return states;
}

function requireState(states: Map<ScopeKey, RatingState>, userId: string, categoryId: string | null): RatingState {
  const state = states.get(scopeKey(userId, categoryId));
  if (!state) throw new Error(`reputation: rating row missing for ${scopeKey(userId, categoryId)}`);
  return state;
}

async function applyInTransaction(tx: DbOrTx, competitionId: string): Promise<ApplyCompetitionResultOutcome> {
  const [competition] = await tx
    .select({ id: competitions.id, status: competitions.status, categoryId: competitions.categoryId })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .for("update");
  if (!competition) throw new Error(`reputation.applyCompetitionResult: competition ${competitionId} not found`);

  const participants = await tx
    .select({ userId: competitionParticipants.userId, side: competitionParticipants.side })
    .from(competitionParticipants)
    .where(eq(competitionParticipants.competitionId, competitionId));

  const [verdict] = await tx
    .select({ id: verdicts.id, outcome: verdicts.outcome, winnerUserId: verdicts.winnerUserId })
    .from(verdicts)
    .where(and(eq(verdicts.competitionId, competitionId), eq(verdicts.isCurrent, true)))
    .limit(1);

  const resolved = resolveCompetitionOutcome({ status: competition.status, participants, verdict: verdict ?? null });
  const desired = resolved.kind === "rated" ? desiredEvents(resolved.results, competition.categoryId) : [];
  const verdictId = resolved.verdictId;
  const unratedReason = resolved.kind === "unrated" ? resolved.reason : null;

  const events = await tx.select().from(reputationEvents).where(eq(reputationEvents.competitionId, competitionId));
  const live = liveResultEvents(events);

  if (sameEvents(live, desired, verdictId)) {
    return { status: "unchanged", unratedReason, verdictId, reversedEvents: 0, createdEvents: 0 };
  }

  const states = await lockRatingRows(tx, [...live, ...desired]);
  const timestamp = now();
  const newEvents: Array<typeof reputationEvents.$inferInsert> = [];

  // 1. Reverse every live result event against the user's CURRENT values.
  for (const event of live) {
    const state = requireState(states, event.userId, event.categoryId);
    const before = { rating: state.rating, rd: state.rd, volatility: state.volatility };
    state.rating -= event.ratingAfter - event.ratingBefore;
    state.rd = clampRd(state.rd - (event.rdAfter - event.rdBefore));
    state.volatility = Math.max(MIN_VOLATILITY, state.volatility - (event.volatilityAfter - event.volatilityBefore));
    const column = recordColumn(event.score);
    state[column] = Math.max(0, state[column] - 1);
    state.dirty = true;
    newEvents.push({
      userId: event.userId,
      competitionId,
      verdictId: event.verdictId,
      categoryId: event.categoryId,
      kind: "reversal",
      score: event.score,
      weight: event.weight,
      ratingBefore: before.rating,
      ratingAfter: state.rating,
      rdBefore: before.rd,
      rdAfter: state.rd,
      volatilityBefore: before.volatility,
      volatilityAfter: state.volatility,
      delta: state.rating - before.rating,
      reversesEventId: event.id,
      createdAt: timestamp,
    });
  }

  // 2. Apply the current verdict: one simultaneous head-to-head update per scope (overall, category).
  if (resolved.kind === "rated") {
    const [first, second] = resolved.results;
    for (const categoryId of [null, competition.categoryId] as const) {
      const a = requireState(states, first.userId, categoryId);
      const b = requireState(states, second.userId, categoryId);
      const next = rateHeadToHead(a, b, first.score, first.weight);
      for (const [state, result, after] of [
        [a, first, next.a],
        [b, second, next.b],
      ] as const) {
        newEvents.push({
          userId: state.userId,
          competitionId,
          verdictId: resolved.verdictId,
          categoryId,
          kind: "result",
          score: result.score,
          weight: result.weight,
          ratingBefore: state.rating,
          ratingAfter: after.rating,
          rdBefore: state.rd,
          rdAfter: after.rd,
          volatilityBefore: state.volatility,
          volatilityAfter: after.volatility,
          delta: after.rating - state.rating,
          reversesEventId: null,
          createdAt: timestamp,
        });
      }
      // Update after computing both sides so each used the other's pre-game rating.
      for (const [state, result, after] of [
        [a, first, next.a],
        [b, second, next.b],
      ] as const) {
        state.rating = after.rating;
        state.rd = after.rd;
        state.volatility = after.volatility;
        state[recordColumn(result.score)] += 1;
        state.dirty = true;
      }
    }
  }

  if (newEvents.length > 0) await tx.insert(reputationEvents).values(newEvents);
  for (const state of states.values()) {
    if (!state.dirty) continue;
    await tx
      .update(userRatings)
      .set({
        rating: state.rating,
        rd: state.rd,
        volatility: state.volatility,
        wins: state.wins,
        losses: state.losses,
        draws: state.draws,
        updatedAt: timestamp,
      })
      .where(eq(userRatings.id, state.id));
  }

  const createdEvents = newEvents.length - live.length;
  const outcome: ApplyCompetitionResultOutcome = {
    status: resolved.kind === "rated" ? "applied" : "reversed",
    unratedReason,
    verdictId,
    reversedEvents: live.length,
    createdEvents,
  };

  await writeAudit(
    {
      actorId: null,
      action: live.length > 0 ? "reputation.reapply" : "reputation.apply",
      targetType: "competition",
      targetId: competitionId,
      before: { liveEventIds: live.map((e) => e.id) },
      after: {
        verdictId,
        unratedReason,
        results: resolved.kind === "rated" ? resolved.results.map(({ userId, score, weight }) => ({ userId, score, weight })) : [],
      },
    },
    tx,
  );

  return outcome;
}

/**
 * Detailed variant of applyCompetitionResult(). Pass `tx` to run inside the caller's transaction
 * (e.g. the judge writing the verdict and the rating change atomically).
 */
export async function applyCompetitionResultDetailed(
  competitionId: string,
  tx?: DbOrTx,
): Promise<ApplyCompetitionResultOutcome> {
  if (tx) return applyInTransaction(tx, competitionId);
  return db.transaction((inner) => applyInTransaction(inner, competitionId));
}
