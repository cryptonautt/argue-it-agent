import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { competitions, reputationEvents, userRatings } from "@domain/db/schema";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestUser } from "@domain/test-helpers/factories";
import { rateHeadToHead } from "./glicko2";
import { applyCompetitionResult, applyCompetitionResultDetailed, getUserRatingSummary } from "./index";
import { createFinishedCompetition, sampleScores, setVerdict } from "./test-fixtures";

const t = setupTestDb();
const FRESH = { rating: 1500, rd: 350, volatility: 0.06 };

async function twoUsers() {
  const a = await createTestUser(t.db, { handle: "ada_for" });
  const b = await createTestUser(t.db, { handle: "bola_against" });
  return { forUserId: a.user.id, againstUserId: b.user.id };
}

async function rating(userId: string, categoryId: string | null = null) {
  const [row] = await t.db
    .select()
    .from(userRatings)
    .where(and(eq(userRatings.userId, userId), categoryId === null ? isNull(userRatings.categoryId) : eq(userRatings.categoryId, categoryId)));
  return row;
}

async function events(competitionId: string) {
  return t.db.select().from(reputationEvents).where(eq(reputationEvents.competitionId, competitionId));
}

/** Ledger invariant: a user's materialised rating equals the default plus the sum of their event deltas. */
async function expectLedgerConsistent(userId: string, categoryId: string | null = null) {
  const rows = await t.db
    .select()
    .from(reputationEvents)
    .where(
      and(
        eq(reputationEvents.userId, userId),
        categoryId === null ? isNull(reputationEvents.categoryId) : eq(reputationEvents.categoryId, categoryId),
      ),
    );
  const sum = rows.reduce((acc, e) => acc + e.delta, 0);
  const row = await rating(userId, categoryId);
  expect(row?.rating ?? 1500).toBeCloseTo(1500 + sum, 9);
}

describe("applyCompetitionResult — judged win", () => {
  it("updates overall and category ratings with the Glicko-2 head-to-head result", async () => {
    const users = await twoUsers();
    const comp = await createFinishedCompetition(t.db, users);
    await setVerdict(t.db, comp, "A");

    await applyCompetitionResult(comp.id);

    const expected = rateHeadToHead(FRESH, FRESH, 1);
    for (const categoryId of [null, comp.categoryId]) {
      const winner = await rating(users.forUserId, categoryId);
      const loser = await rating(users.againstUserId, categoryId);
      expect(winner?.rating).toBeCloseTo(expected.a.rating, 9);
      expect(winner?.rd).toBeCloseTo(expected.a.rd, 9);
      expect(loser?.rating).toBeCloseTo(expected.b.rating, 9);
      expect(winner).toMatchObject({ wins: 1, losses: 0, draws: 0 });
      expect(loser).toMatchObject({ wins: 0, losses: 1, draws: 0 });
    }

    const ledger = await events(comp.id);
    expect(ledger).toHaveLength(4);
    expect(ledger.every((e) => e.kind === "result" && e.weight === 1)).toBe(true);
  });

  it("maps outcome B to the AGAINST participant", async () => {
    const users = await twoUsers();
    const comp = await createFinishedCompetition(t.db, users);
    await setVerdict(t.db, comp, "B");
    await applyCompetitionResult(comp.id);
    expect((await rating(users.againstUserId))?.wins).toBe(1);
    expect((await rating(users.forUserId))?.losses).toBe(1);
  });

  it("gives both players 0.5 on a draw", async () => {
    const users = await twoUsers();
    const comp = await createFinishedCompetition(t.db, users);
    await setVerdict(t.db, comp, "draw");
    await applyCompetitionResult(comp.id);
    const a = await rating(users.forUserId);
    const b = await rating(users.againstUserId);
    expect(a?.rating).toBeCloseTo(1500, 9);
    expect(b?.rating).toBeCloseTo(1500, 9);
    expect(a?.draws).toBe(1);
    expect(b?.draws).toBe(1);
    expect(a?.rd).toBeLessThan(350);
  });
});

describe("applyCompetitionResult — idempotency", () => {
  it("is a no-op when called again for the same verdict", async () => {
    const users = await twoUsers();
    const comp = await createFinishedCompetition(t.db, users);
    await setVerdict(t.db, comp, "A");

    const first = await applyCompetitionResultDetailed(comp.id);
    const afterFirst = await rating(users.forUserId);
    const second = await applyCompetitionResultDetailed(comp.id);
    const third = await applyCompetitionResultDetailed(comp.id);

    expect(first.status).toBe("applied");
    expect(second).toMatchObject({ status: "unchanged", reversedEvents: 0, createdEvents: 0 });
    expect(third.status).toBe("unchanged");
    expect(await rating(users.forUserId)).toEqual(afterFirst);
    expect(await events(comp.id)).toHaveLength(4);
  });

  it("reverses the old result and applies the new one when the verdict changes (appeal overturn)", async () => {
    const users = await twoUsers();
    const comp = await createFinishedCompetition(t.db, users);
    await setVerdict(t.db, comp, "A");
    await applyCompetitionResult(comp.id);

    const newVerdictId = await setVerdict(t.db, comp, "B");
    const result = await applyCompetitionResultDetailed(comp.id);
    expect(result).toMatchObject({ status: "applied", verdictId: newVerdictId, reversedEvents: 4, createdEvents: 4 });

    // Same as if B had won in the first place: nothing double-counted.
    const expected = rateHeadToHead(FRESH, FRESH, 1);
    for (const categoryId of [null, comp.categoryId]) {
      const nowWinner = await rating(users.againstUserId, categoryId);
      const nowLoser = await rating(users.forUserId, categoryId);
      expect(nowWinner?.rating).toBeCloseTo(expected.a.rating, 9);
      expect(nowWinner?.rd).toBeCloseTo(expected.a.rd, 9);
      expect(nowLoser?.rating).toBeCloseTo(expected.b.rating, 9);
      expect(nowWinner).toMatchObject({ wins: 1, losses: 0, draws: 0 });
      expect(nowLoser).toMatchObject({ wins: 0, losses: 1, draws: 0 });
    }

    const ledger = await events(comp.id);
    expect(ledger).toHaveLength(12);
    const reversals = ledger.filter((e) => e.kind === "reversal");
    expect(reversals).toHaveLength(4);
    expect(reversals.every((r) => ledger.some((e) => e.id === r.reversesEventId && e.kind === "result"))).toBe(true);
    // Every result row is immutable history: the original events are still there.
    expect(ledger.filter((e) => e.kind === "result")).toHaveLength(8);

    // Re-applying the overturned verdict again is still a no-op.
    expect((await applyCompetitionResultDetailed(comp.id)).status).toBe("unchanged");
  });

  it("keeps the ledger consistent when the reversed competition is not the player's latest", async () => {
    const users = await twoUsers();
    const carol = (await createTestUser(t.db, { handle: "carol_third" })).user.id;
    const first = await createFinishedCompetition(t.db, users);
    await setVerdict(t.db, first, "A");
    await applyCompetitionResult(first.id);

    const second = await createFinishedCompetition(t.db, { forUserId: users.forUserId, againstUserId: carol });
    await setVerdict(t.db, second, "B");
    await applyCompetitionResult(second.id);

    // The first competition is overturned after the second was rated.
    await setVerdict(t.db, first, "B");
    await applyCompetitionResult(first.id);

    for (const userId of [users.forUserId, users.againstUserId, carol]) {
      await expectLedgerConsistent(userId);
      await expectLedgerConsistent(userId, first.categoryId);
    }
    expect(await rating(users.forUserId)).toMatchObject({ wins: 0, losses: 2, draws: 0 });
    expect(await rating(users.againstUserId)).toMatchObject({ wins: 1, losses: 0 });
  });

  it("joins a caller's transaction and rolls back with it", async () => {
    const users = await twoUsers();
    const comp = await createFinishedCompetition(t.db, users);
    await setVerdict(t.db, comp, "A");

    await expect(
      t.db.transaction(async (tx) => {
        await applyCompetitionResult(comp.id, tx);
        throw new Error("caller failed after applying");
      }),
    ).rejects.toThrow("caller failed");
    expect(await events(comp.id)).toHaveLength(0);

    await t.db.transaction(async (tx) => applyCompetitionResult(comp.id, tx));
    expect(await events(comp.id)).toHaveLength(4);
  });
});

describe("applyCompetitionResult — forfeit and unrated outcomes", () => {
  it("applies a forfeit at half weight (smaller change than a judged win)", async () => {
    const users = await twoUsers();
    const comp = await createFinishedCompetition(t.db, users);
    await setVerdict(t.db, comp, "forfeit", { winnerUserId: users.againstUserId });

    await applyCompetitionResult(comp.id);

    const half = rateHeadToHead(FRESH, FRESH, 1, 0.5);
    const full = rateHeadToHead(FRESH, FRESH, 1, 1);
    const winner = await rating(users.againstUserId);
    expect(winner?.rating).toBeCloseTo(half.a.rating, 9);
    expect(winner!.rating - 1500).toBeLessThan(full.a.rating - 1500);
    expect(winner!.rating).toBeGreaterThan(1500);
    expect(winner?.wins).toBe(1);
    expect((await rating(users.forUserId))?.losses).toBe(1);
    expect((await events(comp.id)).every((e) => e.weight === 0.5)).toBe(true);
  });

  it("does not rate a forfeit verdict without a winner", async () => {
    const users = await twoUsers();
    const comp = await createFinishedCompetition(t.db, users);
    await setVerdict(t.db, comp, "forfeit", { winnerUserId: null });
    const result = await applyCompetitionResultDetailed(comp.id);
    expect(result).toMatchObject({ status: "unchanged", unratedReason: "forfeit_without_winner" });
    expect(await events(comp.id)).toHaveLength(0);
  });

  it("makes no change for an inconclusive verdict", async () => {
    const users = await twoUsers();
    const comp = await createFinishedCompetition(t.db, users);
    await t.db.update(competitions).set({ status: "needs_review" }).where(eq(competitions.id, comp.id));
    await setVerdict(t.db, comp, "inconclusive");

    const result = await applyCompetitionResultDetailed(comp.id);

    expect(result).toMatchObject({ status: "unchanged", unratedReason: "inconclusive", createdEvents: 0 });
    expect(await events(comp.id)).toHaveLength(0);
    expect(await rating(users.forUserId)).toBeUndefined();
    const summary = await getUserRatingSummary(users.forUserId);
    expect(summary.overall).toEqual({ rating: 1500, rd: 350, provisional: true, wins: 0, losses: 0, draws: 0 });
  });

  it("removes a previous result when re-evaluation ends inconclusive", async () => {
    const users = await twoUsers();
    const comp = await createFinishedCompetition(t.db, users);
    await setVerdict(t.db, comp, "A");
    await applyCompetitionResult(comp.id);

    await setVerdict(t.db, comp, "inconclusive");
    const result = await applyCompetitionResultDetailed(comp.id);

    expect(result).toMatchObject({ status: "reversed", unratedReason: "inconclusive", reversedEvents: 4, createdEvents: 0 });
    for (const userId of [users.forUserId, users.againstUserId]) {
      const row = await rating(userId);
      expect(row?.rating).toBeCloseTo(1500, 9);
      expect(row?.rd).toBeCloseTo(350, 9);
      expect(row?.volatility).toBeCloseTo(0.06, 9);
      expect(row).toMatchObject({ wins: 0, losses: 0, draws: 0 });
    }
  });

  it("makes no change for a cancelled competition, even if a verdict row exists", async () => {
    const users = await twoUsers();
    const comp = await createFinishedCompetition(t.db, users);
    await setVerdict(t.db, comp, "A");
    await t.db.update(competitions).set({ status: "cancelled" }).where(eq(competitions.id, comp.id));

    const result = await applyCompetitionResultDetailed(comp.id);
    expect(result).toMatchObject({ status: "unchanged", unratedReason: "cancelled" });
    expect(await events(comp.id)).toHaveLength(0);
  });

  it("makes no change when there is no current verdict", async () => {
    const users = await twoUsers();
    const comp = await createFinishedCompetition(t.db, users);
    expect((await applyCompetitionResultDetailed(comp.id)).unratedReason).toBe("no_verdict");
  });

  it("throws for an unknown competition", async () => {
    await expect(applyCompetitionResult("00000000-0000-4000-8000-000000000000")).rejects.toThrow(/not found/);
  });
});

describe("getUserRatingSummary", () => {
  it("returns overall, per-category lines and criterion averages from judged debates", async () => {
    const users = await twoUsers();
    const sports = await createFinishedCompetition(t.db, { ...users, categorySlug: "sports" });
    await setVerdict(t.db, sports, "A", {
      scores: sampleScores({ evidence: 8, reasoning: 6, clarity: 7 }, { evidence: 5, reasoning: 5, clarity: 6 }),
    });
    await applyCompetitionResult(sports.id);

    const tech = await createFinishedCompetition(t.db, { ...users, categorySlug: "technology" });
    await setVerdict(t.db, tech, "B", {
      scores: sampleScores({ evidence: 6, reasoning: 4, clarity: 7 }, { evidence: 7, reasoning: 8, clarity: 8 }),
    });
    await applyCompetitionResult(tech.id);

    // Forfeits count in the record but have no scores to average.
    const forfeit = await createFinishedCompetition(t.db, { ...users, categorySlug: "sports" });
    await setVerdict(t.db, forfeit, "forfeit", { winnerUserId: users.forUserId });
    await applyCompetitionResult(forfeit.id);

    const summary = await getUserRatingSummary(users.forUserId);
    expect(summary.overall).toMatchObject({ wins: 2, losses: 1, draws: 0, provisional: true });
    expect(summary.categories.map((c) => [c.slug, c.wins, c.losses])).toEqual([
      ["sports", 2, 0],
      ["technology", 0, 1],
    ]);
    expect(summary.averageCriterionScores).toEqual({ evidence: 7, reasoning: 5, clarity: 7 });
    expect(summary.completedCompetitions).toBe(3);

    const opponent = await getUserRatingSummary(users.againstUserId);
    expect(opponent.averageCriterionScores).toEqual({ evidence: 6, reasoning: 6.5, clarity: 7 });
  });

  it("returns provisional defaults for a user with no debates", async () => {
    const { user } = await createTestUser(t.db, { handle: "newbie" });
    const summary = await getUserRatingSummary(user.id);
    expect(summary).toEqual({
      userId: user.id,
      overall: { rating: 1500, rd: 350, provisional: true, wins: 0, losses: 0, draws: 0 },
      categories: [],
      averageCriterionScores: {},
      completedCompetitions: 0,
    });
  });
});
