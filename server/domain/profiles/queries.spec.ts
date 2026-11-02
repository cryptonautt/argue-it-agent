import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { argumentsTable, competitions } from "@domain/db/schema";
import { createFinishedCompetition, setVerdict } from "@domain/reputation/test-fixtures";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestArgument, createTestUser } from "@domain/test-helpers/factories";
import { debateResultFor } from "./history";
import { decodeCursor, encodeCursor, getDebateHistory, getPostedArguments, getProfileByHandle } from "./queries";

const t = setupTestDb();

describe("debateResultFor", () => {
  const base = { side: "FOR" as const, userId: "me" };
  it.each([
    [{ status: "completed", verdict: { outcome: "A", winnerUserId: "me" } }, "won"],
    [{ status: "completed", verdict: { outcome: "B", winnerUserId: "them" } }, "lost"],
    [{ status: "under_appeal", verdict: { outcome: "A", winnerUserId: "me" } }, "won"],
    [{ status: "completed", verdict: { outcome: "draw", winnerUserId: null } }, "draw"],
    [{ status: "completed", verdict: { outcome: "forfeit", winnerUserId: "me" } }, "won_forfeit"],
    [{ status: "completed", verdict: { outcome: "forfeit", winnerUserId: "them" } }, "lost_forfeit"],
    [{ status: "completed", verdict: { outcome: "inconclusive", winnerUserId: null } }, "inconclusive"],
    [{ status: "needs_review", verdict: { outcome: "inconclusive", winnerUserId: null } }, "under_review"],
    [{ status: "active", verdict: null }, "in_progress"],
    [{ status: "evaluating", verdict: null }, "awaiting_verdict"],
    [{ status: "cancelled", verdict: null }, "cancelled"],
  ] as const)("%o → %s", (input, expected) => {
    expect(debateResultFor({ ...base, ...input })).toBe(expected);
  });

  it("maps B to a win for the AGAINST side", () => {
    expect(
      debateResultFor({ side: "AGAINST", userId: "me", status: "completed", verdict: { outcome: "B", winnerUserId: "me" } }),
    ).toBe("won");
  });
});

describe("profile queries", () => {
  it("finds profiles case-insensitively and rejects malformed handles", async () => {
    await createTestUser(t.db, { handle: "ifeoma" });
    expect((await getProfileByHandle("@IFEOMA"))?.handle).toBe("ifeoma");
    expect(await getProfileByHandle("not a handle!")).toBeNull();
  });

  it("lists started debates only, newest first, with keyset pagination", async () => {
    const me = await createTestUser(t.db, { handle: "jide" });
    const rival = await createTestUser(t.db, { handle: "kemi" });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const comp = await createFinishedCompetition(t.db, { forUserId: me.user.id, againstUserId: rival.user.id });
      await t.db.update(competitions).set({ sentAt: new Date(Date.UTC(2026, 9, 10 + i)) }).where(eq(competitions.id, comp.id));
      await setVerdict(t.db, comp, i === 0 ? "A" : "B");
      ids.push(comp.id);
    }
    const pending = await createFinishedCompetition(t.db, {
      forUserId: me.user.id,
      againstUserId: rival.user.id,
      status: "pending_acceptance",
    });

    const first = await getDebateHistory(me.user.id, { limit: 2 });
    expect(first.items.map((i) => i.competitionId)).toEqual([ids[2], ids[1]]);
    expect(first.items.map((i) => i.result)).toEqual(["lost", "lost"]);
    expect(first.items[0]?.opponent.handle).toBe("kemi");
    expect(first.nextCursor).not.toBeNull();

    const second = await getDebateHistory(me.user.id, { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((i) => [i.competitionId, i.result])).toEqual([[ids[0], "won"]]);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].some((i) => i.competitionId === pending.id)).toBe(false);
  });

  it("flags debates whose argument was removed", async () => {
    const me = await createTestUser(t.db);
    const rival = await createTestUser(t.db);
    const comp = await createFinishedCompetition(t.db, { forUserId: me.user.id, againstUserId: rival.user.id });
    const [row] = await t.db.select().from(competitions).where(eq(competitions.id, comp.id));
    await t.db.update(argumentsTable).set({ status: "removed" }).where(eq(argumentsTable.id, row!.rootArgumentId));
    const history = await getDebateHistory(me.user.id);
    expect(history.items[0]?.argumentUnavailable).toBe(true);
  });

  it("lists only visible arguments the user posted", async () => {
    const me = await createTestUser(t.db);
    await createTestArgument(t.db, me.user.id, { title: "Visible take" });
    await createTestArgument(t.db, me.user.id, { title: "Hidden take", status: "hidden" });
    const page = await getPostedArguments(me.user.id);
    expect(page.items.map((a) => a.title)).toEqual(["Visible take"]);
  });

  it("round-trips cursors and ignores garbage", () => {
    const at = new Date("2026-10-31T12:00:00.000Z");
    const id = "0192f0aa-1111-4222-8333-444455556666";
    expect(decodeCursor(encodeCursor(at, id))).toEqual({ at, id });
    expect(decodeCursor("nonsense")).toBeNull();
    expect(decodeCursor("2026-10-31~not-a-uuid")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });
});
