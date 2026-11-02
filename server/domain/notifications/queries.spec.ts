import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actAs, actAsSignedOut } from "@domain/test-helpers/auth";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestArgument, createTestUser } from "@domain/test-helpers/factories";
import { unwrap } from "@domain/lib/action-result";
import { MINUTE_MS, advanceClock, resetClock, setClock } from "@domain/lib/time";
import { blocks, notifications } from "@domain/db/schema";
import { createComment, followUser } from "@domain/social/actions";
import { getUnreadNotificationCount, markAllNotificationsRead, markNotificationsRead } from "./actions";
import { notify } from "./index";
import { countUnreadNotifications, listNotifications } from "./queries";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const t = setupTestDb();
afterEach(() => resetClock());

describe("notification inbox", () => {
  it("lists newest first with actor, read state and resolved link context", async () => {
    setClock(new Date("2026-10-31T09:00:00Z"));
    const me = await createTestUser(t.db, { handle: "me_user" });
    const ada = await createTestUser(t.db, { handle: "ada", displayName: "Ada" });
    const argument = await createTestArgument(t.db, me.user.id);

    actAs(ada.user.id);
    await followUser({ userId: me.user.id });
    advanceClock(MINUTE_MS);
    const comment = unwrap(await createComment({ argumentId: argument.id, body: "Nice", idempotencyKey: randomUUID() }));
    advanceClock(MINUTE_MS);
    // A reply notification targets the comment; its argument is resolved from the comment row.
    await notify({ userId: me.user.id, actorId: ada.user.id, type: "comment_reply", targetType: "comment", targetId: comment.id });

    const page = await listNotifications(me.user.id);
    expect(page.items.map((n) => n.type)).toEqual(["comment_reply", "argument_comment", "follow"]);
    expect(page.items[0]).toMatchObject({
      read: false,
      actor: { handle: "ada", displayName: "Ada" },
      context: { argumentId: argument.id, commentId: comment.id },
    });
    expect(page.items[1]?.context).toMatchObject({ argumentId: argument.id, commentId: comment.id });
    expect(page.items[2]?.context).toEqual({ handle: "ada" });
    expect(await countUnreadNotifications(me.user.id)).toBe(3);
  });

  it("marks read individually (own only) and all at once; unread filter follows", async () => {
    const me = await createTestUser(t.db);
    const other = await createTestUser(t.db);
    const actor = await createTestUser(t.db);
    const base = { actorId: actor.user.id, targetType: "competition" as const };
    const mine1 = await notify({ ...base, userId: me.user.id, type: "challenge_received", targetId: randomUUID() });
    await notify({ ...base, userId: me.user.id, type: "challenge_accepted", targetId: randomUUID() });
    const theirs = await notify({ ...base, userId: other.user.id, type: "challenge_received", targetId: randomUUID() });
    if (!mine1.created || !theirs.created) throw new Error("setup failed");

    actAs(me.user.id);
    expect(unwrap(await markNotificationsRead({ ids: [mine1.id, theirs.id] }))).toEqual({ unread: 1 });
    expect(await countUnreadNotifications(other.user.id)).toBe(1); // someone else's id was ignored
    const unread = await listNotifications(me.user.id, { filter: "unread" });
    expect(unread.items.map((n) => n.type)).toEqual(["challenge_accepted"]);

    expect(unwrap(await markAllNotificationsRead())).toEqual({ marked: 1, unread: 0 });
    expect(unwrap(await getUnreadNotificationCount())).toBe(0);
    expect((await listNotifications(me.user.id, { filter: "unread" })).items).toHaveLength(0);
    expect((await listNotifications(me.user.id)).items.every((n) => n.read)).toBe(true);

    actAsSignedOut();
    expect(unwrap(await getUnreadNotificationCount())).toBe(0);
    expect(await markAllNotificationsRead()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("dedupes repeated events and hides notifications from accounts in a block relationship", async () => {
    const me = await createTestUser(t.db);
    const ada = await createTestUser(t.db);
    const bob = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, me.user.id);

    actAs(ada.user.id);
    await createComment({ argumentId: argument.id, body: "one", idempotencyKey: randomUUID() });
    await createComment({ argumentId: argument.id, body: "two", idempotencyKey: randomUUID() });
    actAs(bob.user.id);
    await createComment({ argumentId: argument.id, body: "three", idempotencyKey: randomUUID() });

    // Two comments from Ada within 10 minutes → one "argument_comment" from her.
    expect(await countUnreadNotifications(me.user.id)).toBe(2);

    // Bob blocks me later: his existing notification disappears from my inbox and my count.
    await t.db.insert(blocks).values({ blockerId: bob.user.id, blockedId: me.user.id });
    const page = await listNotifications(me.user.id);
    expect(page.items.map((n) => n.actor?.id)).toEqual([ada.user.id]);
    expect(await countUnreadNotifications(me.user.id)).toBe(1);
  });

  it("paginates with a cursor", async () => {
    setClock(new Date("2026-10-31T09:00:00Z"));
    const me = await createTestUser(t.db);
    for (let i = 0; i < 5; i++) {
      await notify({ userId: me.user.id, type: "deadline_soon", targetType: "competition", targetId: randomUUID() });
      advanceClock(MINUTE_MS);
    }
    const first = await listNotifications(me.user.id, { limit: 3 });
    expect(first.items).toHaveLength(3);
    const second = await listNotifications(me.user.id, { limit: 3, cursor: first.nextCursor });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const all = new Set([...first.items, ...second.items].map((n) => n.id));
    expect(all.size).toBe(5);
    const rows = await t.db.select().from(notifications).where(eq(notifications.userId, me.user.id));
    expect(rows).toHaveLength(5);
  });
});
