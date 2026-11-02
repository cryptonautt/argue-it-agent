import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestArgument, createTestUser, getCategory } from "@domain/test-helpers/factories";
import { HOUR_MS, addMs, resetClock, setClock } from "@domain/lib/time";
import {
  argumentPositions,
  argumentsTable,
  blocks,
  comments,
  competitions,
  follows,
  profiles,
  reactions,
  users,
} from "@domain/db/schema";
import { decodeCursor } from "./cursor";
import { getFeedPage, viewerAffinity } from "./feed";
import type { FeedTab } from "./feed-params";
import { RANKING, trendingScore } from "./ranking";

const t = setupTestDb();
const NOW = new Date("2026-10-31T12:00:00Z");
const hoursAgo = (h: number) => addMs(NOW, -h * HOUR_MS);

beforeEach(() => setClock(NOW));
afterEach(() => resetClock());

async function argumentAt(authorId: string, createdAt: Date, overrides: Parameters<typeof createTestArgument>[2] = {}) {
  const argument = await createTestArgument(t.db, authorId, overrides);
  await t.db.update(argumentsTable).set({ createdAt }).where(eq(argumentsTable.id, argument.id));
  return { ...argument, createdAt };
}

async function addPosition(argumentId: string, userId: string, at: Date, side: "AGREE" | "AGAINST" = "AGREE") {
  await t.db.insert(argumentPositions).values({ argumentId, userId, side, createdAt: at, updatedAt: at });
}

async function addComment(argumentId: string, authorId: string, at: Date, status: "visible" | "hidden" = "visible") {
  await t.db.insert(comments).values({ argumentId, authorId, body: "Good point", createdAt: at, status });
}

async function addLiveCompetition(argumentId: string, creatorId: string, openingClosesAt: Date, acceptedAt = hoursAgo(1)) {
  const category = await getCategory(t.db);
  await t.db.insert(competitions).values({
    rootArgumentId: argumentId,
    creatorId,
    categoryId: category.id,
    status: "active",
    round: "opening",
    rulesSnapshot: {} as never,
    termsHash: "x",
    rubricId: "sports",
    rubricVersion: 1,
    acceptDeadline: addMs(acceptedAt, 48 * HOUR_MS),
    acceptedAt,
    openingClosesAt,
    rebuttalClosesAt: addMs(openingClosesAt, 24 * HOUR_MS),
  });
}

async function ids(tab: FeedTab, viewerId: string, extra: { categorySlug?: string; limit?: number } = {}) {
  const page = await getFeedPage({ tab, viewerId, ...extra });
  return page.items.map((i) => i.id);
}

async function users3() {
  const viewer = (await createTestUser(t.db)).user;
  const alice = (await createTestUser(t.db)).user;
  const bob = (await createTestUser(t.db)).user;
  return { viewer, alice, bob };
}

describe("New tab", () => {
  it("orders by created_at desc and paginates with a cursor without gaps or repeats", async () => {
    const { viewer, alice } = await users3();
    const created = [];
    for (let i = 0; i < 7; i++) created.push(await argumentAt(alice.id, hoursAgo(i)));

    const first = await getFeedPage({ tab: "new", viewerId: viewer.id, limit: 3 });
    expect(first.items.map((i) => i.id)).toEqual(created.slice(0, 3).map((a) => a.id));
    expect(first.nextCursor).not.toBeNull();

    const second = await getFeedPage({ tab: "new", viewerId: viewer.id, limit: 3, cursor: first.nextCursor });
    const third = await getFeedPage({ tab: "new", viewerId: viewer.id, limit: 3, cursor: second.nextCursor });
    expect(second.items.map((i) => i.id)).toEqual(created.slice(3, 6).map((a) => a.id));
    expect(third.items.map((i) => i.id)).toEqual([created[6]?.id]);
    expect(third.nextCursor).toBeNull();
  });

  it("keeps sub-millisecond ordering exact across pages", async () => {
    const { viewer, alice } = await users3();
    // Same millisecond, different microseconds: JS Dates can't tell these apart; the cursor must.
    const a = await createTestArgument(t.db, alice.id);
    const b = await createTestArgument(t.db, alice.id);
    await t.db.execute(`update arguments set created_at = '2026-10-31 11:00:00.000100+00' where id = '${a.id}'`);
    await t.db.execute(`update arguments set created_at = '2026-10-31 11:00:00.000900+00' where id = '${b.id}'`);
    const first = await getFeedPage({ tab: "new", viewerId: viewer.id, limit: 1 });
    const second = await getFeedPage({ tab: "new", viewerId: viewer.id, limit: 1, cursor: first.nextCursor });
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual([b.id, a.id]);
  });

  it("excludes hidden and removed arguments and deleted authors", async () => {
    const { viewer, alice, bob } = await users3();
    const visible = await argumentAt(alice.id, hoursAgo(1));
    await argumentAt(alice.id, hoursAgo(2), { status: "hidden" });
    await argumentAt(alice.id, hoursAgo(3), { status: "removed" });
    await argumentAt(bob.id, hoursAgo(4));
    await t.db.update(users).set({ status: "deleted" }).where(eq(users.id, bob.id));
    expect(await ids("new", viewer.id)).toEqual([visible.id]);
  });

  it("excludes users blocked in either direction", async () => {
    const { viewer, alice, bob } = await users3();
    const carol = (await createTestUser(t.db)).user;
    await argumentAt(alice.id, hoursAgo(1));
    await argumentAt(bob.id, hoursAgo(2));
    const fromCarol = await argumentAt(carol.id, hoursAgo(3));
    await t.db.insert(blocks).values([
      { blockerId: viewer.id, blockedId: alice.id },
      { blockerId: bob.id, blockedId: viewer.id },
    ]);
    expect(await ids("new", viewer.id)).toEqual([fromCarol.id]);
  });

  it("filters by category and returns nothing for unknown categories", async () => {
    const { viewer, alice } = await users3();
    const sports = await argumentAt(alice.id, hoursAgo(1), { categorySlug: "sports" });
    await argumentAt(alice.id, hoursAgo(2), { categorySlug: "gaming" });
    expect(await ids("new", viewer.id, { categorySlug: "sports" })).toEqual([sports.id]);
    expect(await ids("new", viewer.id, { categorySlug: "nope" })).toEqual([]);
  });

  it("rejects a cursor from another tab or category", async () => {
    const { viewer, alice } = await users3();
    for (let i = 0; i < 3; i++) await argumentAt(alice.id, hoursAgo(i));
    const page = await getFeedPage({ tab: "new", viewerId: viewer.id, limit: 1 });
    await expect(getFeedPage({ tab: "following", viewerId: viewer.id, cursor: page.nextCursor })).rejects.toThrow(
      /feed has changed/,
    );
    await expect(
      getFeedPage({ tab: "new", viewerId: viewer.id, categorySlug: "sports", cursor: page.nextCursor }),
    ).rejects.toThrow(/feed has changed/);
    await expect(getFeedPage({ tab: "new", viewerId: viewer.id, cursor: "garbage" })).rejects.toThrow(/feed has changed/);
  });
});

describe("card data", () => {
  it("derives counts from rows and includes the viewer's own side", async () => {
    const { viewer, alice, bob } = await users3();
    const argument = await argumentAt(alice.id, hoursAgo(1));
    await addPosition(argument.id, viewer.id, hoursAgo(1), "AGAINST");
    await addPosition(argument.id, bob.id, hoursAgo(1), "AGREE");
    await addComment(argument.id, bob.id, hoursAgo(1));
    await addComment(argument.id, bob.id, hoursAgo(1), "hidden");
    await addLiveCompetition(argument.id, bob.id, addMs(NOW, 5 * HOUR_MS));

    const [card] = (await getFeedPage({ tab: "new", viewerId: viewer.id })).items;
    expect(card?.counts).toEqual({ agree: 1, against: 1, comments: 1, liveDebates: 1 });
    expect(card?.viewerSide).toBe("AGAINST");
    expect(card?.nextDeadline).toBe(addMs(NOW, 5 * HOUR_MS).toISOString());
    expect(card?.author.id).toBe(alice.id);
  });
});

describe("Following tab", () => {
  it("shows only arguments from followed users", async () => {
    const { viewer, alice, bob } = await users3();
    const fromAlice = await argumentAt(alice.id, hoursAgo(1));
    await argumentAt(bob.id, hoursAgo(1));
    await t.db.insert(follows).values({ followerId: viewer.id, followingId: alice.id });
    expect(await ids("following", viewer.id)).toEqual([fromAlice.id]);
  });
});

describe("Active Debates and Ending Soon", () => {
  it("lists only arguments with an active challenge, ordered by most recent start / nearest deadline", async () => {
    const { viewer, alice, bob } = await users3();
    const soon = await argumentAt(alice.id, hoursAgo(30));
    const later = await argumentAt(alice.id, hoursAgo(20));
    await argumentAt(alice.id, hoursAgo(1)); // no debate
    await addLiveCompetition(soon.id, bob.id, addMs(NOW, 1 * HOUR_MS), hoursAgo(23));
    await addLiveCompetition(later.id, bob.id, addMs(NOW, 10 * HOUR_MS), hoursAgo(2));

    expect(await ids("active", viewer.id)).toEqual([later.id, soon.id]);
    expect(await ids("ending", viewer.id)).toEqual([soon.id, later.id]);

    const first = await getFeedPage({ tab: "ending", viewerId: viewer.id, limit: 1 });
    const second = await getFeedPage({ tab: "ending", viewerId: viewer.id, limit: 1, cursor: first.nextCursor });
    expect(second.items.map((i) => i.id)).toEqual([later.id]);
  });

  it("skips debates whose round deadline already passed", async () => {
    const { viewer, alice, bob } = await users3();
    const argument = await argumentAt(alice.id, hoursAgo(30));
    await addLiveCompetition(argument.id, bob.id, hoursAgo(1), hoursAgo(25));
    expect(await ids("ending", viewer.id)).toEqual([]);
  });
});

describe("Trending tab", () => {
  it("ranks by decayed engagement (comments count double) and matches the reference formula", async () => {
    const { viewer, alice } = await users3();
    const fans = await Promise.all(Array.from({ length: 4 }, () => createTestUser(t.db)));
    const quiet = await argumentAt(alice.id, hoursAgo(30));
    const positions = await argumentAt(alice.id, hoursAgo(30));
    const discussed = await argumentAt(alice.id, hoursAgo(30));
    const stale = await argumentAt(alice.id, hoursAgo(100));

    for (const fan of fans.slice(0, 3)) await addPosition(positions.id, fan.user.id, hoursAgo(2));
    for (const fan of fans.slice(0, 2)) await addComment(discussed.id, fan.user.id, hoursAgo(2));
    await t.db
      .insert(reactions)
      .values({ userId: fans[0]!.user.id, targetType: "argument", targetId: discussed.id, type: "fire", createdAt: hoursAgo(2) });
    // Engagement outside the 48h window must not count.
    await addPosition(stale.id, fans[3]!.user.id, hoursAgo(60));

    const result = await ids("trending", viewer.id);
    // stale is neither engaged nor created within the window → not a candidate.
    expect(result).toEqual([discussed.id, positions.id, quiet.id]);

    const expected = {
      discussed: trendingScore(
        [
          { kind: "comment", ageHours: 2 },
          { kind: "comment", ageHours: 2 },
          { kind: "reaction", ageHours: 2 },
        ],
        30,
      ),
      positions: trendingScore(
        [1, 2, 3].map(() => ({ kind: "position" as const, ageHours: 2 })),
        30,
      ),
    };
    expect(expected.discussed).toBeGreaterThan(expected.positions);
  });

  it("computes the same score in SQL as the reference implementation", async () => {
    const { viewer, alice, bob } = await users3();
    const carol = (await createTestUser(t.db)).user;
    const target = await argumentAt(alice.id, hoursAgo(10));
    await argumentAt(alice.id, hoursAgo(47)); // a second candidate so page one has a cursor
    await addPosition(target.id, bob.id, hoursAgo(3));
    await addPosition(target.id, carol.id, hoursAgo(20), "AGAINST");
    await addComment(target.id, bob.id, hoursAgo(7));
    await t.db
      .insert(reactions)
      .values({ userId: carol.id, targetType: "argument", targetId: target.id, type: "facts", createdAt: hoursAgo(1) });

    const page = await getFeedPage({ tab: "trending", viewerId: viewer.id, limit: 1 });
    expect(page.items[0]?.id).toBe(target.id);
    const sqlScore = Number(decodeCursor(page.nextCursor ?? "")?.key);
    const reference = trendingScore(
      [
        { kind: "position", ageHours: 3 },
        { kind: "position", ageHours: 20 },
        { kind: "comment", ageHours: 7 },
        { kind: "reaction", ageHours: 1 },
      ],
      10,
    );
    expect(sqlScore).toBeCloseTo(reference, 5);
  });

  it("decays: older engagement weighs less than the same engagement recently", async () => {
    const { viewer, alice, bob } = await users3();
    const old = await argumentAt(alice.id, hoursAgo(40));
    const fresh = await argumentAt(alice.id, hoursAgo(40));
    await addComment(old.id, bob.id, hoursAgo(36));
    await addComment(fresh.id, bob.id, hoursAgo(1));
    expect(await ids("trending", viewer.id)).toEqual([fresh.id, old.id]);
  });

  it("paginates against a fixed snapshot: engagement after page one does not reshuffle later pages", async () => {
    const { viewer, alice, bob } = await users3();
    const args = [];
    for (let i = 0; i < 4; i++) args.push(await argumentAt(alice.id, hoursAgo(i + 1)));
    const first = await getFeedPage({ tab: "trending", viewerId: viewer.id, limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual([args[0]?.id, args[1]?.id]);
    expect(decodeCursor(first.nextCursor ?? "")?.asOf?.toISOString()).toBe(NOW.toISOString());

    // New engagement lands on the last argument after page one was served.
    setClock(addMs(NOW, 60_000));
    for (let i = 0; i < 3; i++) await addComment(args[3]!.id, bob.id, addMs(NOW, 30_000));

    const second = await getFeedPage({ tab: "trending", viewerId: viewer.id, limit: 2, cursor: first.nextCursor });
    expect(second.items.map((i) => i.id)).toEqual([args[2]?.id, args[3]?.id]);
    expect(second.nextCursor).toBeNull();
  });

  it("still excludes hidden content and blocked authors", async () => {
    const { viewer, alice, bob } = await users3();
    const hidden = await argumentAt(alice.id, hoursAgo(1), { status: "hidden" });
    await addComment(hidden.id, bob.id, hoursAgo(1));
    await argumentAt(bob.id, hoursAgo(1));
    await t.db.insert(blocks).values({ blockerId: viewer.id, blockedId: bob.id });
    expect(await ids("trending", viewer.id)).toEqual([]);
  });
});

describe("For You tab", () => {
  it("falls back to Trending when the viewer has no category signals", async () => {
    const { viewer, alice, bob } = await users3();
    const a = await argumentAt(alice.id, hoursAgo(5), { categorySlug: "gaming" });
    const b = await argumentAt(alice.id, hoursAgo(5), { categorySlug: "sports" });
    await addComment(b.id, bob.id, hoursAgo(1));
    expect(await viewerAffinity(viewer.id)).toEqual(new Map());
    expect(await ids("for-you", viewer.id)).toEqual([b.id, a.id]);
  });

  it("boosts categories the viewer engaged with or picked as interests", async () => {
    const { viewer, alice, bob } = await users3();
    const gamingEngaged = await argumentAt(alice.id, hoursAgo(50), { categorySlug: "gaming" });
    await addPosition(gamingEngaged.id, viewer.id, hoursAgo(10));

    const gaming = await argumentAt(alice.id, hoursAgo(6), { categorySlug: "gaming" });
    const sports = await argumentAt(alice.id, hoursAgo(6), { categorySlug: "sports" });
    await addPosition(sports.id, bob.id, hoursAgo(5)); // sports is ahead on raw engagement

    const trending = await ids("trending", viewer.id);
    expect(trending.indexOf(sports.id)).toBeLessThan(trending.indexOf(gaming.id));

    const forYou = await ids("for-you", viewer.id);
    expect(forYou.indexOf(gaming.id)).toBeLessThan(forYou.indexOf(sports.id));

    const tech = await argumentAt(alice.id, hoursAgo(6), { categorySlug: "technology" });
    await t.db.update(profiles).set({ interests: ["technology"] }).where(eq(profiles.userId, viewer.id));
    const withInterest = await ids("for-you", viewer.id);
    expect(withInterest.indexOf(tech.id)).toBeLessThan(withInterest.indexOf(sports.id));
  });

  it("considers quieter posts from the last week, unlike Trending", async () => {
    const { viewer, alice } = await users3();
    const fiveDaysOld = await argumentAt(alice.id, hoursAgo(5 * 24));
    expect(await ids("trending", viewer.id)).toEqual([]);
    expect(await ids("for-you", viewer.id)).toEqual([fiveDaysOld.id]);
    expect(RANKING.forYouCreationWindowHours).toBeGreaterThan(RANKING.trendingCreationWindowHours);
  });

  it("carries the affinity snapshot in the cursor", async () => {
    const { viewer, alice } = await users3();
    const engaged = await argumentAt(alice.id, hoursAgo(80), { categorySlug: "crypto" });
    await addPosition(engaged.id, viewer.id, hoursAgo(1));
    for (let i = 0; i < 3; i++) await argumentAt(alice.id, hoursAgo(i + 1), { categorySlug: "crypto" });
    const page = await getFeedPage({ tab: "for-you", viewerId: viewer.id, limit: 1 });
    const cursor = decodeCursor(page.nextCursor ?? "");
    const crypto = await getCategory(t.db, "crypto");
    expect(cursor?.affinity?.get(crypto.id)).toBe(1 + RANKING.affinityMaxBoost);
  });
});
