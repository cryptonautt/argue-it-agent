import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestArgument, createTestUser, getCategory } from "@domain/test-helpers/factories";
import { HOUR_MS, addMs, resetClock, setClock } from "@domain/lib/time";
import { argumentsTable, blocks, comments, competitionParticipants, competitions, follows, users } from "@domain/db/schema";
import { escapeLike, normalizeQuery, searchArguments, searchDebates, searchPeople } from "./search";

const t = setupTestDb();
afterEach(() => resetClock());

async function seedArguments(authorId: string) {
  const messi = await createTestArgument(t.db, authorId, {
    title: "Messi is the greatest of all time",
    proposition: "Lionel Messi is the greatest footballer ever.",
    body: "Eight Ballon d'Or awards.",
  });
  const bitcoin = await createTestArgument(t.db, authorId, {
    title: "Bitcoin will hit 200k",
    proposition: "Bitcoin will trade above $200,000 before 2028.",
    body: "Halving cycles and ETF inflows. Messi also mentioned once.",
    categorySlug: "crypto",
  });
  const gaming = await createTestArgument(t.db, authorId, {
    title: "100%_real takes only",
    proposition: "FIFA is better than eFootball in every way.",
    body: "Licences, modes, and the community.",
    categorySlug: "gaming",
  });
  return { messi, bitcoin, gaming };
}

describe("normalizeQuery / escapeLike", () => {
  it("collapses whitespace and caps length", () => {
    expect(normalizeQuery("  messi \n  goat ")).toBe("messi goat");
    expect(normalizeQuery("x".repeat(500))).toHaveLength(100);
    expect(normalizeQuery(undefined)).toBe("");
  });
  it("escapes LIKE wildcards", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });
});

describe("searchArguments", () => {
  it("finds by full-text stem and by partial title, ranking title hits first", async () => {
    const { user } = await createTestUser(t.db);
    const { messi, bitcoin } = await seedArguments(user.id);
    const result = await searchArguments({ q: "messi", sort: "relevance", viewerId: null });
    expect(result.items.map((i) => i.id)).toEqual([messi.id, bitcoin.id]);

    const partial = await searchArguments({ q: "mess", sort: "relevance", viewerId: null });
    expect(partial.items.map((i) => i.id)).toEqual([messi.id]);

    const stemmed = await searchArguments({ q: "footballers", sort: "relevance", viewerId: null });
    expect(stemmed.items.map((i) => i.id)).toEqual([messi.id]);
  });

  it("treats LIKE wildcards in the query literally", async () => {
    const { user } = await createTestUser(t.db);
    const { gaming } = await seedArguments(user.id);
    // "%" matches only the title that literally contains it, not everything.
    expect((await searchArguments({ q: "%", sort: "relevance", viewerId: null })).items.map((i) => i.id)).toEqual([gaming.id]);
    expect((await searchArguments({ q: "_", sort: "relevance", viewerId: null })).items.map((i) => i.id)).toEqual([gaming.id]);
    expect((await searchArguments({ q: "100%_real", sort: "new", viewerId: null })).items.map((i) => i.id)).toEqual([
      gaming.id,
    ]);
  });

  it("does not error on query syntax websearch can't parse", async () => {
    const { user } = await createTestUser(t.db);
    await seedArguments(user.id);
    await expect(searchArguments({ q: `" ( ) - OR ! :*`, sort: "relevance", viewerId: null })).resolves.toBeDefined();
  });

  it("browses without a query, with category filter and sorts", async () => {
    const { user } = await createTestUser(t.db);
    const fan = (await createTestUser(t.db)).user;
    setClock(new Date("2026-10-31T12:00:00Z"));
    const { messi, bitcoin, gaming } = await seedArguments(user.id);
    await t.db.update(argumentsTable).set({ createdAt: new Date("2026-10-31T09:00:00Z") }).where(eq(argumentsTable.id, messi.id));
    await t.db.update(argumentsTable).set({ createdAt: new Date("2026-10-31T10:00:00Z") }).where(eq(argumentsTable.id, bitcoin.id));
    await t.db.update(argumentsTable).set({ createdAt: new Date("2026-10-31T11:00:00Z") }).where(eq(argumentsTable.id, gaming.id));
    await t.db.insert(comments).values([
      { argumentId: messi.id, authorId: fan.id, body: "yes", createdAt: new Date("2026-10-31T11:30:00Z") },
      { argumentId: messi.id, authorId: fan.id, body: "yes!", createdAt: new Date("2026-10-31T11:40:00Z") },
    ]);

    const newest = await searchArguments({ q: "", sort: "new", viewerId: null });
    expect(newest.items.map((i) => i.id)).toEqual([gaming.id, bitcoin.id, messi.id]);
    const trending = await searchArguments({ q: "", sort: "relevance", viewerId: null });
    expect(trending.items[0]?.id).toBe(messi.id);
    const crypto = await searchArguments({ q: "", sort: "new", categorySlug: "crypto", viewerId: null });
    expect(crypto.items.map((i) => i.id)).toEqual([bitcoin.id]);
  });

  it("excludes hidden/removed content and blocked authors", async () => {
    const { user: author } = await createTestUser(t.db);
    const { user: viewer } = await createTestUser(t.db);
    await createTestArgument(t.db, author.id, { title: "Messi hidden", status: "hidden" });
    await createTestArgument(t.db, author.id, { title: "Messi removed", status: "removed" });
    const visible = await createTestArgument(t.db, author.id, { title: "Messi visible" });
    expect((await searchArguments({ q: "messi", sort: "new", viewerId: viewer.id })).items.map((i) => i.id)).toEqual([
      visible.id,
    ]);
    await t.db.insert(blocks).values({ blockerId: author.id, blockedId: viewer.id });
    expect((await searchArguments({ q: "messi", sort: "new", viewerId: viewer.id })).items).toEqual([]);
  });

  it("pages with offset and reports hasMore", async () => {
    const { user } = await createTestUser(t.db);
    for (let i = 0; i < 21; i++) await createTestArgument(t.db, user.id, { title: `Take number ${i}` });
    const first = await searchArguments({ q: "take", sort: "new", viewerId: null });
    const second = await searchArguments({ q: "take", sort: "new", viewerId: null, page: 2 });
    expect(first.items).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
  });
});

describe("searchPeople", () => {
  it("matches handle prefix and display name, exact handle first, then by followers", async () => {
    const ada = (await createTestUser(t.db, { handle: "ada", displayName: "Ada Obi" })).user;
    const adamu = (await createTestUser(t.db, { handle: "adamu", displayName: "Adamu Musa" })).user;
    const tunde = (await createTestUser(t.db, { handle: "tunde", displayName: "Tunde Adah" })).user;
    const fan = (await createTestUser(t.db, { handle: "fan_1" })).user;
    await t.db.insert(follows).values({ followerId: fan.id, followingId: tunde.id });

    const result = await searchPeople("@Ada", null);
    expect(result.map((p) => p.userId)).toEqual([ada.id, adamu.id, tunde.id]);
    expect(result.find((p) => p.userId === tunde.id)?.followers).toBe(1);
  });

  it("hides deleted accounts and blocked users, and needs a query", async () => {
    const { user: viewer } = await createTestUser(t.db, { handle: "viewer" });
    const { user: gone } = await createTestUser(t.db, { handle: "ada_gone" });
    const { user: blocker } = await createTestUser(t.db, { handle: "ada_blocker" });
    await t.db.update(users).set({ status: "deleted" }).where(eq(users.id, gone.id));
    await t.db.insert(blocks).values({ blockerId: blocker.id, blockedId: viewer.id });
    expect(await searchPeople("ada", viewer.id)).toEqual([]);
    expect(await searchPeople("   ", viewer.id)).toEqual([]);
  });
});

describe("searchDebates", () => {
  async function liveDebate(argumentId: string, forUser: string, againstUser: string, closesInHours: number) {
    const category = await getCategory(t.db);
    const at = new Date("2026-10-31T12:00:00Z");
    const [row] = await t.db
      .insert(competitions)
      .values({
        rootArgumentId: argumentId,
        creatorId: forUser,
        categoryId: category.id,
        status: "active",
        round: "opening",
        rulesSnapshot: { proposition: "Messi is better than Ronaldo." } as never,
        termsHash: "x",
        rubricId: "sports",
        rubricVersion: 1,
        acceptDeadline: addMs(at, 48 * HOUR_MS),
        acceptedAt: at,
        openingClosesAt: addMs(at, closesInHours * HOUR_MS),
      })
      .returning();
    await t.db.insert(competitionParticipants).values([
      { competitionId: row!.id, userId: forUser, side: "FOR", role: "challenger", acceptanceStatus: "accepted" },
      { competitionId: row!.id, userId: againstUser, side: "AGAINST", role: "recipient", acceptanceStatus: "accepted" },
    ]);
    return row!;
  }

  it("lists live debates by nearest deadline with both sides, matching the snapshot proposition", async () => {
    const { user: a } = await createTestUser(t.db, { handle: "side_a" });
    const { user: b } = await createTestUser(t.db, { handle: "side_b" });
    const argument = await createTestArgument(t.db, a.id, { title: "Football GOAT debate" });
    const later = await liveDebate(argument.id, a.id, b.id, 20);
    const sooner = await liveDebate(argument.id, b.id, a.id, 2);

    const all = await searchDebates("", null);
    expect(all.map((d) => d.id)).toEqual([sooner.id, later.id]);
    expect(all[1]?.participants.map((p) => [p.side, p.handle])).toEqual([
      ["FOR", "side_a"],
      ["AGAINST", "side_b"],
    ]);
    expect((await searchDebates("ronaldo", null)).map((d) => d.id)).toHaveLength(2);
    expect(await searchDebates("bitcoin", null)).toEqual([]);
  });

  it("hides debates on hidden arguments or involving blocked users", async () => {
    const { user: a } = await createTestUser(t.db);
    const { user: b } = await createTestUser(t.db);
    const { user: viewer } = await createTestUser(t.db);
    const hidden = await createTestArgument(t.db, a.id, { status: "hidden" });
    await liveDebate(hidden.id, a.id, b.id, 5);
    const visible = await createTestArgument(t.db, a.id);
    await liveDebate(visible.id, a.id, b.id, 5);
    expect(await searchDebates("", viewer.id)).toHaveLength(1);
    await t.db.insert(blocks).values({ blockerId: viewer.id, blockedId: b.id });
    expect(await searchDebates("", viewer.id)).toEqual([]);
  });
});
