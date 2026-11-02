import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { actAs } from "@domain/test-helpers/auth";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestArgument, createTestUser } from "@domain/test-helpers/factories";
import { unwrap } from "@domain/lib/action-result";
import { argumentsTable, auditLogs, comments, follows, notifications, reactions } from "@domain/db/schema";
import { blockUser, followUser, setReaction, unblockUser, unfollowUser } from "./actions";
import { getBlockedUserIds, hasBlocked, isBlocked, listBlockedUsers, notBlockedWith } from "./blocks";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const t = setupTestDb();

describe("blocks", () => {
  it("isBlocked is symmetric; hasBlocked is directional", async () => {
    const a = await createTestUser(t.db);
    const b = await createTestUser(t.db);
    const c = await createTestUser(t.db);
    actAs(a.user.id);
    expect(unwrap(await blockUser({ userId: b.user.id }))).toEqual({ userId: b.user.id, blocked: true });

    expect(await isBlocked(a.user.id, b.user.id)).toBe(true);
    expect(await isBlocked(b.user.id, a.user.id)).toBe(true);
    expect(await isBlocked(a.user.id, c.user.id)).toBe(false);
    expect(await hasBlocked(a.user.id, b.user.id)).toBe(true);
    expect(await hasBlocked(b.user.id, a.user.id)).toBe(false);
    expect([...(await getBlockedUserIds(b.user.id))]).toEqual([a.user.id]);
    expect((await listBlockedUsers(a.user.id)).map((u) => u.id)).toEqual([b.user.id]);
  });

  it("is idempotent, removes follows both ways, audits, and can be undone", async () => {
    const a = await createTestUser(t.db);
    const b = await createTestUser(t.db);
    await t.db.insert(follows).values([
      { followerId: a.user.id, followingId: b.user.id },
      { followerId: b.user.id, followingId: a.user.id },
    ]);
    actAs(a.user.id);
    expect((await blockUser({ userId: b.user.id })).ok).toBe(true);
    expect((await blockUser({ userId: b.user.id })).ok).toBe(true);
    expect(await t.db.select().from(follows)).toHaveLength(0);
    expect((await t.db.select().from(auditLogs).where(eq(auditLogs.action, "social.block"))).length).toBe(1);

    expect(unwrap(await unblockUser({ userId: b.user.id })).blocked).toBe(false);
    expect(await isBlocked(a.user.id, b.user.id)).toBe(false);
    expect(await blockUser({ userId: a.user.id })).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("notBlockedWith filters content authored by blocked users in either direction", async () => {
    const viewer = await createTestUser(t.db);
    const blockedByViewer = await createTestUser(t.db);
    const blockerOfViewer = await createTestUser(t.db);
    const stranger = await createTestUser(t.db);
    for (const u of [blockedByViewer, blockerOfViewer, stranger]) await createTestArgument(t.db, u.user.id);
    actAs(viewer.user.id);
    await blockUser({ userId: blockedByViewer.user.id });
    actAs(blockerOfViewer.user.id);
    await blockUser({ userId: viewer.user.id });

    const visible = await t.db
      .select({ authorId: argumentsTable.authorId })
      .from(argumentsTable)
      .where(notBlockedWith(viewer.user.id, argumentsTable.authorId));
    expect(visible.map((r) => r.authorId)).toEqual([stranger.user.id]);
    const anonymous = await t.db.select().from(argumentsTable).where(notBlockedWith(null, argumentsTable.authorId));
    expect(anonymous).toHaveLength(3);
  });

  it("prevents following across a block", async () => {
    const a = await createTestUser(t.db);
    const b = await createTestUser(t.db);
    actAs(b.user.id);
    await blockUser({ userId: a.user.id });
    actAs(a.user.id);
    expect(await followUser({ userId: b.user.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("follows", () => {
  it("follows once, notifies once (deduped), and unfollows", async () => {
    const a = await createTestUser(t.db, { handle: "ada" });
    const b = await createTestUser(t.db);
    actAs(a.user.id);
    expect(unwrap(await followUser({ userId: b.user.id }))).toEqual({ userId: b.user.id, following: true, followerCount: 1 });
    expect(unwrap(await followUser({ userId: b.user.id })).followerCount).toBe(1);
    expect(unwrap(await unfollowUser({ userId: b.user.id }))).toMatchObject({ following: false, followerCount: 0 });
    // Follow → unfollow → follow within 10 minutes produces a single notification.
    await followUser({ userId: b.user.id });
    const sent = await t.db.select().from(notifications).where(eq(notifications.userId, b.user.id));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "follow", targetType: "user", targetId: a.user.id });
    expect(sent[0]?.data).toMatchObject({ handle: "ada" });

    expect(await followUser({ userId: a.user.id })).toMatchObject({ ok: false, code: "VALIDATION" });
  });
});

describe("reactions", () => {
  it("is unique per user/target and toggles idempotently", async () => {
    const author = await createTestUser(t.db);
    const fan = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, author.user.id);
    actAs(fan.user.id);
    const target = { targetType: "argument" as const, targetId: argument.id };

    expect(unwrap(await setReaction({ ...target, active: true }))).toMatchObject({ count: 1, viewerReacted: true, type: "fire" });
    expect(unwrap(await setReaction({ ...target, active: true })).count).toBe(1);
    expect(await t.db.select().from(reactions)).toHaveLength(1);
    expect(unwrap(await setReaction({ ...target, active: false }))).toMatchObject({ count: 0, viewerReacted: false });
    expect(unwrap(await setReaction({ ...target, active: false })).count).toBe(0);
  });

  it("rejects reacting to your own content, hidden content and blocked users' content", async () => {
    const author = await createTestUser(t.db);
    const fan = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, author.user.id);
    const [comment] = await t.db
      .insert(comments)
      .values({ argumentId: argument.id, authorId: author.user.id, body: "hello" })
      .returning();
    if (!comment) throw new Error("no comment");

    actAs(author.user.id);
    expect(await setReaction({ targetType: "argument", targetId: argument.id, active: true })).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });

    actAs(fan.user.id);
    expect((await setReaction({ targetType: "comment", targetId: comment.id, active: true })).ok).toBe(true);
    await t.db.update(comments).set({ status: "hidden" }).where(eq(comments.id, comment.id));
    expect(await setReaction({ targetType: "comment", targetId: comment.id, active: true })).toMatchObject({ ok: false });
    // Taking a reaction back always works.
    expect((await setReaction({ targetType: "comment", targetId: comment.id, active: false })).ok).toBe(true);

    actAs(author.user.id);
    await blockUser({ userId: fan.user.id });
    actAs(fan.user.id);
    expect(await setReaction({ targetType: "argument", targetId: argument.id, active: true })).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    const left = await t.db
      .select()
      .from(reactions)
      .where(and(eq(reactions.userId, fan.user.id), eq(reactions.targetId, argument.id)));
    expect(left).toHaveLength(0);
  });
});
