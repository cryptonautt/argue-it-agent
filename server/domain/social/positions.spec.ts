import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { actAs, actAsSignedOut } from "@domain/test-helpers/auth";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestArgument, createTestUser } from "@domain/test-helpers/factories";
import { argumentPositions, argumentsTable, blocks, users } from "@domain/db/schema";
import { removePosition, setPosition } from "./actions";
import { getPositionCounts, getPositionSummary } from "./positions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const t = setupTestDb();

async function setup() {
  const author = await createTestUser(t.db);
  const viewer = await createTestUser(t.db);
  const argument = await createTestArgument(t.db, author.user.id);
  return { author, viewer, argument };
}

describe("positions", () => {
  it("takes, changes and removes a position with derived counts", async () => {
    const { viewer, argument } = await setup();
    actAs(viewer.user.id);

    const taken = await setPosition({ argumentId: argument.id, side: "AGREE" });
    expect(taken).toEqual({ ok: true, data: { argumentId: argument.id, agree: 1, against: 0, viewerSide: "AGREE" } });

    const changed = await setPosition({ argumentId: argument.id, side: "AGAINST" });
    expect(changed.ok && changed.data).toMatchObject({ agree: 0, against: 1, viewerSide: "AGAINST" });

    const removed = await removePosition({ argumentId: argument.id });
    expect(removed.ok && removed.data).toMatchObject({ agree: 0, against: 0, viewerSide: null });

    // Removing again is a harmless no-op.
    expect((await removePosition({ argumentId: argument.id })).ok).toBe(true);
  });

  it("keeps exactly one row per user per argument, even under concurrent taps", async () => {
    const { viewer, argument } = await setup();
    actAs(viewer.user.id);
    const results = await Promise.all([
      setPosition({ argumentId: argument.id, side: "AGREE" }),
      setPosition({ argumentId: argument.id, side: "AGAINST" }),
      setPosition({ argumentId: argument.id, side: "AGREE" }),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    const rows = await t.db.select().from(argumentPositions).where(eq(argumentPositions.argumentId, argument.id));
    expect(rows).toHaveLength(1);
  });

  it("counts positions from many users", async () => {
    const { argument } = await setup();
    for (const side of ["AGREE", "AGREE", "AGAINST"] as const) {
      const u = await createTestUser(t.db);
      actAs(u.user.id);
      expect((await setPosition({ argumentId: argument.id, side })).ok).toBe(true);
    }
    const summary = await getPositionSummary(argument.id, null);
    expect(summary).toEqual({ argumentId: argument.id, agree: 2, against: 1, viewerSide: null });
    const other = await createTestArgument(t.db, (await createTestUser(t.db)).user.id);
    const counts = await getPositionCounts([argument.id, other.id]);
    expect(counts.get(other.id)).toEqual({ agree: 0, against: 0 });
  });

  it("rejects signed-out, suspended, blocked and closed-argument requests", async () => {
    const { author, viewer, argument } = await setup();

    actAsSignedOut();
    expect(await setPosition({ argumentId: argument.id, side: "AGREE" })).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });

    await t.db.update(users).set({ status: "suspended" }).where(eq(users.id, viewer.user.id));
    actAs(viewer.user.id);
    expect(await setPosition({ argumentId: argument.id, side: "AGREE" })).toMatchObject({ ok: false, code: "SUSPENDED" });
    await t.db.update(users).set({ status: "active" }).where(eq(users.id, viewer.user.id));

    await t.db.insert(blocks).values({ blockerId: author.user.id, blockedId: viewer.user.id });
    expect(await setPosition({ argumentId: argument.id, side: "AGREE" })).toMatchObject({ ok: false, code: "FORBIDDEN" });

    const removedArg = await createTestArgument(t.db, (await createTestUser(t.db)).user.id, { status: "removed" });
    expect(await setPosition({ argumentId: removedArg.id, side: "AGREE" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await setPosition({ argumentId: "not-a-uuid", side: "AGREE" })).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("still lets a user remove their position after the argument is closed", async () => {
    const { viewer, argument } = await setup();
    actAs(viewer.user.id);
    await setPosition({ argumentId: argument.id, side: "AGREE" });
    await t.db.update(argumentsTable).set({ status: "hidden" }).where(eq(argumentsTable.id, argument.id));
    expect((await removePosition({ argumentId: argument.id })).ok).toBe(true);
  });
});
