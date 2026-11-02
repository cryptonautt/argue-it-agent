import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { getSession } from "@domain/auth";
import {
  accounts,
  auditLogs,
  blocks,
  competitionParticipants,
  competitions,
  follows,
  profiles,
  sessions,
  users,
  verdicts,
} from "@domain/db/schema";
import { createFinishedCompetition, setVerdict } from "@domain/reputation/test-fixtures";
import { actAs, actAsSignedOut } from "@domain/test-helpers/auth";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestUser } from "@domain/test-helpers/factories";
import { deleteAccount, saveInterests, updateProfile } from "./actions";
import { getDebateHistory, getProfileByHandle } from "./queries";
import { deletedHandleFor } from "./schemas";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const t = setupTestDb();

describe("updateProfile", () => {
  it("updates display name, bio and avatar and audits the change", async () => {
    const { user } = await createTestUser(t.db, { handle: "ada" });
    actAs(user.id);

    const result = await updateProfile({
      displayName: "  Ada Obi ",
      bio: "  Arsenal till I die.\r\nFacts > vibes.  ",
      avatarUrl: "https://example.com/me.png",
    });

    expect(result).toEqual({
      ok: true,
      data: { handle: "ada", displayName: "Ada Obi", bio: "Arsenal till I die.\nFacts > vibes.", avatarUrl: "https://example.com/me.png" },
    });
    const [profile] = await t.db.select().from(profiles).where(eq(profiles.userId, user.id));
    expect(profile).toMatchObject({ displayName: "Ada Obi", avatarUrl: "https://example.com/me.png" });
    const [row] = await t.db.select({ name: users.name }).from(users).where(eq(users.id, user.id));
    expect(row?.name).toBe("Ada Obi");
    const audit = await t.db.select().from(auditLogs).where(eq(auditLogs.action, "profile.update"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.after).toMatchObject({ displayName: "Ada Obi" });
  });

  it("clears bio and avatar when given empty strings, and skips the audit when nothing changed", async () => {
    const { user } = await createTestUser(t.db, { handle: "bola", displayName: "Bola" });
    actAs(user.id);
    await updateProfile({ displayName: "Bola", bio: "hi", avatarUrl: "https://example.com/a.png" });
    const cleared = await updateProfile({ displayName: "Bola", bio: "   ", avatarUrl: "" });
    expect(cleared.ok && cleared.data).toMatchObject({ bio: null, avatarUrl: null });
    await updateProfile({ displayName: "Bola", bio: "", avatarUrl: "" });
    expect(await t.db.select().from(auditLogs).where(eq(auditLogs.action, "profile.update"))).toHaveLength(2);
  });

  it.each([
    [{ displayName: "" }, "displayName"],
    [{ displayName: "AI Judge" }, "displayName"],
    [{ displayName: "argue-it" }, "displayName"],
    [{ displayName: "Ok", bio: "x".repeat(281) }, "bio"],
    [{ displayName: "Ok", avatarUrl: "javascript:alert(1)" }, "avatarUrl"],
    [{ displayName: "Ok", avatarUrl: "http://example.com/a.png" }, "avatarUrl"],
  ])("rejects invalid input %o", async (input, field) => {
    const { user } = await createTestUser(t.db);
    actAs(user.id);
    const result = await updateProfile(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.[field]).toBeDefined();
  });

  it("requires sign-in", async () => {
    actAsSignedOut();
    expect(await updateProfile({ displayName: "X" })).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("rejects suspended users", async () => {
    const { user } = await createTestUser(t.db);
    await t.db.update(users).set({ status: "suspended", suspendedUntil: new Date("2999-01-01") }).where(eq(users.id, user.id));
    actAs(user.id);
    expect(await updateProfile({ displayName: "X" })).toMatchObject({ ok: false, code: "SUSPENDED" });
  });
});

describe("saveInterests", () => {
  it("stores known categories, dedupes, and marks onboarding complete once", async () => {
    const { user } = await createTestUser(t.db);
    actAs(user.id);
    const result = await saveInterests({ categorySlugs: ["sports", "crypto", "sports"], completeOnboarding: true });
    expect(result).toEqual({ ok: true, data: { categorySlugs: ["sports", "crypto"] } });
    const [first] = await t.db.select().from(profiles).where(eq(profiles.userId, user.id));
    expect(first?.interests).toEqual(["sports", "crypto"]);
    expect(first?.onboardedAt).toBeInstanceOf(Date);

    await saveInterests({ categorySlugs: [], completeOnboarding: true });
    const [second] = await t.db.select().from(profiles).where(eq(profiles.userId, user.id));
    expect(second?.interests).toEqual([]);
    expect(second?.onboardedAt?.getTime()).toBe(first?.onboardedAt?.getTime());
  });

  it("rejects unknown categories and more than five", async () => {
    const { user } = await createTestUser(t.db);
    actAs(user.id);
    expect(await saveInterests({ categorySlugs: ["sports", "knitting"] })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await saveInterests({ categorySlugs: ["a", "b", "c", "d", "e", "f"] })).toMatchObject({ ok: false });
  });
});

describe("deleteAccount", () => {
  it("requires the exact handle", async () => {
    const { user } = await createTestUser(t.db, { handle: "chidi" });
    actAs(user.id);
    const result = await deleteAccount({ confirmHandle: "chid" });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    if (!result.ok) expect(result.fieldErrors?.confirmHandle).toBeDefined();
  });

  it("refuses while a challenge is pending or live", async () => {
    const a = await createTestUser(t.db, { handle: "dayo" });
    const b = await createTestUser(t.db, { handle: "emeka" });
    const comp = await createFinishedCompetition(t.db, { forUserId: a.user.id, againstUserId: b.user.id, status: "active" });
    actAs(a.user.id);
    expect(await deleteAccount({ confirmHandle: "@Dayo" })).toMatchObject({ ok: false, code: "CONFLICT" });
    await t.db.update(competitions).set({ status: "completed" }).where(eq(competitions.id, comp.id));
    expect((await deleteAccount({ confirmHandle: "@Dayo" })).ok).toBe(true);
  });

  it("anonymises the profile, removes login, and keeps competition integrity", async () => {
    const me = await createTestUser(t.db, { handle: "funmi", displayName: "Funmi A" });
    const rival = await createTestUser(t.db, { handle: "gbenga" });
    const fan = await createTestUser(t.db, { handle: "halima" });
    const comp = await createFinishedCompetition(t.db, { forUserId: me.user.id, againstUserId: rival.user.id });
    await setVerdict(t.db, comp, "B");
    await t.db.insert(sessions).values({ token: "tok-1", userId: me.user.id, expiresAt: new Date("2999-01-01") });
    await t.db.insert(accounts).values({ accountId: me.user.id, providerId: "credential", userId: me.user.id, password: "hash" });
    await t.db.insert(follows).values([
      { followerId: fan.user.id, followingId: me.user.id },
      { followerId: me.user.id, followingId: rival.user.id },
    ]);
    await t.db.insert(blocks).values([
      { blockerId: me.user.id, blockedId: fan.user.id },
      { blockerId: rival.user.id, blockedId: me.user.id },
    ]);
    actAs(me.user.id);

    const result = await deleteAccount({ confirmHandle: "funmi" });
    expect(result).toEqual({ ok: true, data: { redirectTo: "/" } });

    const [profile] = await t.db.select().from(profiles).where(eq(profiles.userId, me.user.id));
    expect(profile).toMatchObject({
      handle: deletedHandleFor(me.user.id),
      displayName: "Deleted user",
      bio: null,
      avatarUrl: null,
      interests: [],
    });
    const [account] = await t.db.select().from(users).where(eq(users.id, me.user.id));
    expect(account?.status).toBe("deleted");
    expect(account?.email).not.toContain("funmi");
    expect(await t.db.select().from(sessions).where(eq(sessions.userId, me.user.id))).toHaveLength(0);
    expect(await t.db.select().from(accounts).where(eq(accounts.userId, me.user.id))).toHaveLength(0);
    expect(await getSession()).toBeNull();

    // Social graph: follows gone; the user's own blocks gone; blocks against them kept.
    expect(await t.db.select().from(follows)).toHaveLength(0);
    expect(await t.db.select().from(blocks)).toEqual([expect.objectContaining({ blockerId: rival.user.id, blockedId: me.user.id })]);

    // Competition history intact for the opponent.
    expect(
      await t.db
        .select()
        .from(competitionParticipants)
        .where(and(eq(competitionParticipants.competitionId, comp.id), eq(competitionParticipants.userId, me.user.id))),
    ).toHaveLength(1);
    expect(await t.db.select().from(verdicts).where(eq(verdicts.competitionId, comp.id))).toHaveLength(1);
    const history = await getDebateHistory(rival.user.id);
    expect(history.items[0]).toMatchObject({ result: "won", opponent: { displayName: "Deleted user", deleted: true } });

    // Old handle no longer resolves; audit keeps the trail.
    expect(await getProfileByHandle("funmi")).toBeNull();
    const [audit] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, "user.delete"));
    expect(audit?.before).toMatchObject({ handle: "funmi" });
  });
});
