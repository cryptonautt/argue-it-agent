import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actAs } from "@domain/test-helpers/auth";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestArgument, createTestUser } from "@domain/test-helpers/factories";
import { unwrap } from "@domain/lib/action-result";
import { MINUTE_MS, advanceClock, resetClock, setClock } from "@domain/lib/time";
import { auditLogs, blocks, comments, notifications } from "@domain/db/schema";
import { createComment, deleteComment, editComment, setPosition } from "./actions";
import { listCommentThreads } from "./comments";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const t = setupTestDb();
afterEach(() => resetClock());

const key = () => randomUUID();

async function setup() {
  const author = await createTestUser(t.db, { handle: "author" });
  const ada = await createTestUser(t.db, { handle: "ada" });
  const bob = await createTestUser(t.db, { handle: "bob" });
  const argument = await createTestArgument(t.db, author.user.id);
  return { author, ada, bob, argument };
}

async function notificationsFor(userId: string) {
  return t.db.select().from(notifications).where(eq(notifications.userId, userId));
}

describe("comment threading", () => {
  it("posts a top-level comment tagged with the commenter's position and notifies the author", async () => {
    const { author, ada, argument } = await setup();
    actAs(ada.user.id);
    await setPosition({ argumentId: argument.id, side: "AGAINST" });

    const view = unwrap(await createComment({ argumentId: argument.id, body: "  Ronaldo scored more.  ", idempotencyKey: key() }));
    expect(view).toMatchObject({ body: "Ronaldo scored more.", positionTag: "AGAINST", parentCommentId: null, isOwn: true, state: "visible" });
    expect(view.author?.handle).toBe("ada");

    const sent = await notificationsFor(author.user.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "argument_comment", targetType: "argument", targetId: argument.id, actorId: ada.user.id });
    expect(sent[0]?.data).toMatchObject({ commentId: view.id, argumentId: argument.id });
  });

  it("lets the commenter opt out of the position tag", async () => {
    const { ada, argument } = await setup();
    actAs(ada.user.id);
    await setPosition({ argumentId: argument.id, side: "AGREE" });
    const view = unwrap(await createComment({ argumentId: argument.id, body: "No tag", showPosition: false, idempotencyKey: key() }));
    expect(view.positionTag).toBeNull();
  });

  it("attaches a reply-to-a-reply to the top-level comment with an @mention of the person answered", async () => {
    const { author, ada, bob, argument } = await setup();
    actAs(ada.user.id);
    const top = unwrap(await createComment({ argumentId: argument.id, body: "Top", idempotencyKey: key() }));
    actAs(bob.user.id);
    const reply = unwrap(await createComment({ argumentId: argument.id, parentCommentId: top.id, body: "Reply", idempotencyKey: key() }));
    expect(reply.parentCommentId).toBe(top.id);
    expect(reply.body).toBe("Reply");

    actAs(author.user.id);
    const nested = unwrap(
      await createComment({ argumentId: argument.id, parentCommentId: reply.id, body: "Answering bob", idempotencyKey: key() }),
    );
    expect(nested.parentCommentId).toBe(top.id);
    expect(nested.body).toBe("@bob Answering bob");

    // ada was answered by bob; bob was answered (and mentioned) by the author — one notification each.
    expect((await notificationsFor(ada.user.id)).map((n) => n.type)).toEqual(["comment_reply"]);
    const bobs = await notificationsFor(bob.user.id);
    expect(bobs.map((n) => n.type)).toEqual(["comment_reply"]);
    expect(bobs[0]?.targetId).toBe(reply.id);

    const page = await listCommentThreads({ argumentId: argument.id, viewerId: null });
    expect(page.threads).toHaveLength(1);
    expect(page.threads[0]?.replies.map((r) => r.id)).toEqual([reply.id, nested.id]);
  });

  it("notifies @mentioned users once, ignoring unknown handles and self-mentions", async () => {
    const { author, ada, bob, argument } = await setup();
    actAs(ada.user.id);
    unwrap(await createComment({ argumentId: argument.id, body: "@bob @BOB @nobody_here @ada @author look", idempotencyKey: key() }));
    expect((await notificationsFor(bob.user.id)).map((n) => n.type)).toEqual(["mention"]);
    // The author gets the argument_comment notification, not an extra mention.
    expect((await notificationsFor(author.user.id)).map((n) => n.type)).toEqual(["argument_comment"]);
    expect(await notificationsFor(ada.user.id)).toHaveLength(0);
  });

  it("is idempotent per client key", async () => {
    const { ada, argument } = await setup();
    actAs(ada.user.id);
    const k = key();
    const first = unwrap(await createComment({ argumentId: argument.id, body: "Once", idempotencyKey: k }));
    const second = unwrap(await createComment({ argumentId: argument.id, body: "Once", idempotencyKey: k }));
    expect(second.id).toBe(first.id);
    expect(await t.db.select().from(comments)).toHaveLength(1);
  });

  it("validates length and rejects replies across arguments", async () => {
    const { ada, argument, author } = await setup();
    actAs(ada.user.id);
    const tooLong = await createComment({ argumentId: argument.id, body: "x".repeat(2001), idempotencyKey: key() });
    expect(tooLong).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await createComment({ argumentId: argument.id, body: "   ", idempotencyKey: key() })).toMatchObject({ ok: false });

    const other = await createTestArgument(t.db, author.user.id);
    const top = unwrap(await createComment({ argumentId: other.id, body: "Elsewhere", idempotencyKey: key() }));
    const wrong = await createComment({ argumentId: argument.id, parentCommentId: top.id, body: "x", idempotencyKey: key() });
    expect(wrong).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("paginates top-level comments newest first with a stable cursor", async () => {
    const { ada, argument } = await setup();
    actAs(ada.user.id);
    setClock(new Date("2026-10-31T10:00:00Z"));
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(unwrap(await createComment({ argumentId: argument.id, body: `c${i}`, idempotencyKey: key() })).id);
      advanceClock(MINUTE_MS);
    }
    const first = await listCommentThreads({ argumentId: argument.id, viewerId: ada.user.id, limit: 2 });
    expect(first.threads.map((th) => th.comment.body)).toEqual(["c4", "c3"]);
    const second = await listCommentThreads({ argumentId: argument.id, viewerId: ada.user.id, limit: 2, cursor: first.nextCursor });
    expect(second.threads.map((th) => th.comment.body)).toEqual(["c2", "c1"]);
    const third = await listCommentThreads({ argumentId: argument.id, viewerId: ada.user.id, limit: 2, cursor: second.nextCursor });
    expect(third.threads.map((th) => th.comment.body)).toEqual(["c0"]);
    expect(third.nextCursor).toBeNull();
  });
});

describe("edit and delete", () => {
  it("edits own comments only, marks edited, and notifies only newly added mentions", async () => {
    const { ada, bob, argument } = await setup();
    const carl = await createTestUser(t.db, { handle: "carl" });
    actAs(ada.user.id);
    const view = unwrap(await createComment({ argumentId: argument.id, body: "hi @bob", idempotencyKey: key() }));

    const edited = unwrap(await editComment({ commentId: view.id, body: "hi @bob and @carl" }));
    expect(edited.body).toBe("hi @bob and @carl");
    expect(edited.editedAt).not.toBeNull();
    expect(await notificationsFor(bob.user.id)).toHaveLength(1);
    expect((await notificationsFor(carl.user.id)).map((n) => n.type)).toEqual(["mention"]);

    actAs(bob.user.id);
    expect(await editComment({ commentId: view.id, body: "hijack" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await deleteComment({ commentId: view.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("deletes into a placeholder that keeps the thread, audits the original text, and is idempotent", async () => {
    const { ada, bob, argument } = await setup();
    actAs(ada.user.id);
    const top = unwrap(await createComment({ argumentId: argument.id, body: "Delete me", idempotencyKey: key() }));
    actAs(bob.user.id);
    unwrap(await createComment({ argumentId: argument.id, parentCommentId: top.id, body: "Reply stays", idempotencyKey: key() }));

    actAs(ada.user.id);
    expect((await deleteComment({ commentId: top.id })).ok).toBe(true);
    expect((await deleteComment({ commentId: top.id })).ok).toBe(true);
    expect(await editComment({ commentId: top.id, body: "back" })).toMatchObject({ ok: false, code: "FORBIDDEN" });

    const page = await listCommentThreads({ argumentId: argument.id, viewerId: bob.user.id });
    expect(page.threads).toHaveLength(1);
    expect(page.threads[0]?.comment).toMatchObject({ state: "removed", body: null, author: null });
    expect(page.threads[0]?.replies[0]?.body).toBe("Reply stays");

    const audits = await t.db.select().from(auditLogs).where(eq(auditLogs.targetId, top.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.before).toMatchObject({ body: "Delete me" });

    // Replying into a thread whose top-level comment is gone is closed.
    actAs(bob.user.id);
    expect(
      await createComment({ argumentId: argument.id, parentCommentId: top.id, body: "late", idempotencyKey: key() }),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("drops a removed top-level comment with no readable replies", async () => {
    const { ada, argument } = await setup();
    actAs(ada.user.id);
    const top = unwrap(await createComment({ argumentId: argument.id, body: "Alone", idempotencyKey: key() }));
    await deleteComment({ commentId: top.id });
    expect((await listCommentThreads({ argumentId: argument.id, viewerId: null })).threads).toHaveLength(0);
  });

  it("shows a moderator-hidden comment to its author only", async () => {
    const { ada, bob, argument } = await setup();
    actAs(ada.user.id);
    const top = unwrap(await createComment({ argumentId: argument.id, body: "Borderline", idempotencyKey: key() }));
    actAs(bob.user.id);
    unwrap(await createComment({ argumentId: argument.id, parentCommentId: top.id, body: "Reply", idempotencyKey: key() }));
    await t.db.update(comments).set({ status: "hidden" }).where(eq(comments.id, top.id));

    const asAuthor = await listCommentThreads({ argumentId: argument.id, viewerId: ada.user.id });
    expect(asAuthor.threads[0]?.comment).toMatchObject({ state: "hidden", body: "Borderline", isOwn: true });
    const asOther = await listCommentThreads({ argumentId: argument.id, viewerId: bob.user.id });
    expect(asOther.threads[0]?.comment).toMatchObject({ state: "hidden", body: null, author: null });
  });
});

describe("blocks in comment threads", () => {
  it("prevents commenting on, or replying to, someone in a block relationship (both directions)", async () => {
    const { author, ada, bob, argument } = await setup();
    await t.db.insert(blocks).values({ blockerId: author.user.id, blockedId: ada.user.id });
    actAs(ada.user.id);
    expect(await createComment({ argumentId: argument.id, body: "hi", idempotencyKey: key() })).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });

    actAs(bob.user.id);
    const top = unwrap(await createComment({ argumentId: argument.id, body: "Bob here", idempotencyKey: key() }));
    await t.db.insert(blocks).values({ blockerId: ada.user.id, blockedId: bob.user.id });
    const other = await createTestArgument(t.db, (await createTestUser(t.db)).user.id);
    actAs(ada.user.id);
    expect(
      await createComment({ argumentId: argument.id, parentCommentId: top.id, body: "x", idempotencyKey: key() }),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await createComment({ argumentId: other.id, body: "fine", idempotencyKey: key() })).ok).toBe(true);
  });

  it("hides blocked users' comments from each other and never notifies across a block", async () => {
    const { ada, bob, argument } = await setup();
    actAs(ada.user.id);
    const adaTop = unwrap(await createComment({ argumentId: argument.id, body: "Ada top", idempotencyKey: key() }));
    actAs(bob.user.id);
    unwrap(await createComment({ argumentId: argument.id, body: "Bob top", idempotencyKey: key() }));
    unwrap(await createComment({ argumentId: argument.id, parentCommentId: adaTop.id, body: "Bob reply", idempotencyKey: key() }));

    await t.db.insert(blocks).values({ blockerId: bob.user.id, blockedId: ada.user.id });

    // Ada (the blocked one) no longer sees Bob's content…
    const asAda = await listCommentThreads({ argumentId: argument.id, viewerId: ada.user.id });
    expect(asAda.threads.map((th) => th.comment.body)).toEqual(["Ada top"]);
    expect(asAda.threads[0]?.replies).toHaveLength(0);
    // …and Bob no longer sees Ada's: her top-level becomes an "unavailable" placeholder above his reply.
    const asBob = await listCommentThreads({ argumentId: argument.id, viewerId: bob.user.id });
    const adaThread = asBob.threads.find((th) => th.comment.id === adaTop.id);
    expect(adaThread?.comment).toMatchObject({ state: "unavailable", body: null, author: null });
    expect(adaThread?.replies[0]?.body).toBe("Bob reply");

    // Mentions across a block are not delivered.
    const carl = await createTestUser(t.db, { handle: "carl" });
    actAs(carl.user.id);
    const other = await createTestArgument(t.db, carl.user.id);
    actAs(ada.user.id);
    unwrap(await createComment({ argumentId: other.id, body: "hey @bob", idempotencyKey: key() }));
    const bobMentions = await t.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, bob.user.id), eq(notifications.type, "mention")));
    expect(bobMentions).toHaveLength(0);
  });

  it("does not notify mentioned users who are in a block relationship with the argument author", async () => {
    const { author, ada, bob, argument } = await setup();
    await t.db.insert(blocks).values({ blockerId: author.user.id, blockedId: bob.user.id });
    actAs(ada.user.id);
    unwrap(await createComment({ argumentId: argument.id, body: "what do you think @bob", idempotencyKey: key() }));
    expect(await notificationsFor(bob.user.id)).toHaveLength(0);
  });
});
