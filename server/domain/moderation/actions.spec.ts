import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actAs, actAsSignedOut } from "@domain/test-helpers/auth";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestArgument, createTestUser } from "@domain/test-helpers/factories";
import { DAY_MS, HOUR_MS, advanceClock, resetClock, setClock } from "@domain/lib/time";
import { requireUser } from "@domain/auth";
import {
  argumentsTable,
  auditLogs,
  comments,
  competitions,
  moderationActions,
  notifications,
  profiles,
  reports,
  submissions,
  users,
  verdicts,
  type UserRole,
} from "@domain/db/schema";
import {
  changeUserRole,
  dismissReport,
  fileReport,
  moderateContent,
  suspendUser,
  unsuspendUser,
  warnUser,
} from "./actions";
import { liftExpiredSuspensions, openAutomaticReport } from "./service";
import { createTestCompetition, createTestSubmission, createTestVerdict } from "./test-fixtures";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const t = setupTestDb();
const key = () => crypto.randomUUID();

beforeEach(() => setClock(new Date("2026-10-31T12:00:00Z")));
afterEach(() => resetClock());

async function staff(role: UserRole, handle?: string) {
  return (await createTestUser(t.db, { role, handle })).user;
}

async function scene() {
  const author = (await createTestUser(t.db, { handle: "author" })).user;
  const reporter = (await createTestUser(t.db, { handle: "reporter" })).user;
  const moderator = await staff("moderator", "mod");
  const admin = await staff("admin", "boss");
  const argument = await createTestArgument(t.db, author.id);
  const [comment] = await t.db
    .insert(comments)
    .values({ argumentId: argument.id, authorId: author.id, body: "You are a clown and everyone knows it" })
    .returning();
  if (!comment) throw new Error("comment insert failed");
  return { author, reporter, moderator, admin, argument, comment };
}

async function auditRows(action: string) {
  return t.db.select().from(auditLogs).where(eq(auditLogs.action, action));
}

// ---------------------------------------------------------------------------------------------------

describe("fileReport", () => {
  it("requires a signed-in, non-suspended user", async () => {
    const { comment, reporter } = await scene();
    actAsSignedOut();
    expect(await fileReport({ targetType: "comment", targetId: comment.id, reason: "harassment" })).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
    });

    await t.db.update(users).set({ status: "suspended", suspendedUntil: null }).where(eq(users.id, reporter.id));
    actAs(reporter.id);
    expect(await fileReport({ targetType: "comment", targetId: comment.id, reason: "harassment" })).toMatchObject({
      ok: false,
      code: "SUSPENDED",
    });
  });

  it("stores a report and treats a repeat as already reported", async () => {
    const { comment, reporter } = await scene();
    actAs(reporter.id);
    const first = await fileReport({ targetType: "comment", targetId: comment.id, reason: "harassment", details: "Insults" });
    expect(first).toMatchObject({ ok: true, data: { alreadyReported: false } });
    const again = await fileReport({ targetType: "comment", targetId: comment.id, reason: "spam" });
    expect(again).toMatchObject({ ok: true, data: { alreadyReported: true } });
    if (!first.ok || !again.ok) throw new Error("unreachable");
    expect(again.data.reportId).toBe(first.data.reportId);
    const rows = await t.db.select().from(reports);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reporterId: reporter.id, reason: "harassment", details: "Insults", isAutomatic: false });
  });

  it("rejects own content, missing targets and 'other' without details", async () => {
    const { comment, author, reporter } = await scene();
    actAs(author.id);
    expect(await fileReport({ targetType: "comment", targetId: comment.id, reason: "spam" })).toMatchObject({ code: "FORBIDDEN" });
    actAs(reporter.id);
    expect(await fileReport({ targetType: "argument", targetId: crypto.randomUUID(), reason: "spam" })).toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await fileReport({ targetType: "comment", targetId: comment.id, reason: "other" })).toMatchObject({
      code: "VALIDATION",
      fieldErrors: { details: ["Tell us briefly what's wrong."] },
    });
  });

  it("can report a profile by user id", async () => {
    const { author, reporter } = await scene();
    actAs(reporter.id);
    expect(await fileReport({ targetType: "profile", targetId: author.id, reason: "impersonation" })).toMatchObject({ ok: true });
  });

  it("does not reveal a sealed opening to outsiders (or to the opponent)", async () => {
    const { author, reporter, argument } = await scene();
    const opponent = (await createTestUser(t.db)).user;
    const competition = await createTestCompetition(t.db, argument, author.id, opponent.id);
    const opening = await createTestSubmission(t.db, competition.id, author.id, "FOR");
    for (const viewer of [reporter, opponent]) {
      actAs(viewer.id);
      expect(await fileReport({ targetType: "submission", targetId: opening.id, reason: "harassment" })).toMatchObject({
        code: "NOT_FOUND",
      });
    }
    await t.db.update(competitions).set({ round: "rebuttal" }).where(eq(competitions.id, competition.id));
    actAs(opponent.id);
    expect(await fileReport({ targetType: "submission", targetId: opening.id, reason: "harassment" })).toMatchObject({ ok: true });
  });

  it("keeps rebuttals sealed until the rebuttal round closes", async () => {
    const { author, argument } = await scene();
    const opponent = (await createTestUser(t.db)).user;
    const competition = await createTestCompetition(t.db, argument, author.id, opponent.id, { status: "active", round: "rebuttal" });
    const [rebuttal] = await t.db
      .insert(submissions)
      .values({ competitionId: competition.id, authorId: author.id, side: "FOR", round: "rebuttal", body: "My rebuttal" })
      .returning();
    actAs(opponent.id);
    expect(await fileReport({ targetType: "submission", targetId: rebuttal!.id, reason: "harassment" })).toMatchObject({ code: "NOT_FOUND" });
    await t.db.update(competitions).set({ status: "evaluating", round: null, lockedAt: new Date() }).where(eq(competitions.id, competition.id));
    expect(await fileReport({ targetType: "submission", targetId: rebuttal!.id, reason: "harassment" })).toMatchObject({ ok: true });
  });

  it("is rate limited to 20 reports a day", async () => {
    const { reporter, author } = await scene();
    actAs(reporter.id);
    for (let i = 0; i < 20; i++) {
      const argument = await createTestArgument(t.db, author.id, { title: `Take ${i}` });
      expect((await fileReport({ targetType: "argument", targetId: argument.id, reason: "spam" })).ok).toBe(true);
    }
    const extra = await createTestArgument(t.db, author.id);
    expect(await fileReport({ targetType: "argument", targetId: extra.id, reason: "spam" })).toMatchObject({ code: "RATE_LIMITED" });
  });
});

// ---------------------------------------------------------------------------------------------------

describe("authorisation of every staff action", () => {
  it("rejects signed-out and ordinary users with UNAUTHENTICATED / FORBIDDEN", async () => {
    const { comment, author, reporter } = await scene();
    const reportId = (await openAutomaticReport({ targetType: "comment", targetId: comment.id, reason: "spam" })).id;
    const calls = [
      () => moderateContent({ targetType: "comment", targetId: comment.id, action: "hide", reasonCode: "spam", idempotencyKey: key() }),
      () => warnUser({ userId: author.id, reasonCode: "spam", idempotencyKey: key() }),
      () => suspendUser({ userId: author.id, duration: "24h", reasonCode: "spam", note: "Spamming links", idempotencyKey: key() }),
      () => unsuspendUser({ userId: author.id, note: "Appeal accepted", idempotencyKey: key() }),
      () => dismissReport({ reportId, idempotencyKey: key() }),
      () => changeUserRole({ userId: author.id, role: "moderator", note: "Trusted member", idempotencyKey: key() }),
    ];
    actAsSignedOut();
    for (const call of calls) expect(await call()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    actAs(reporter.id);
    for (const call of calls) expect(await call()).toMatchObject({ ok: false, code: "FORBIDDEN" });

    // Nothing changed.
    expect((await t.db.select().from(comments).where(eq(comments.id, comment.id)))[0]?.status).toBe("visible");
    expect(await t.db.select().from(moderationActions)).toHaveLength(0);
    expect((await t.db.select().from(users).where(eq(users.id, author.id)))[0]).toMatchObject({ role: "user", status: "active" });
  });

  it("rejects a suspended moderator", async () => {
    const { comment, moderator } = await scene();
    await t.db.update(users).set({ status: "suspended", suspendedUntil: null }).where(eq(users.id, moderator.id));
    actAs(moderator.id);
    expect(
      await moderateContent({ targetType: "comment", targetId: comment.id, action: "hide", reasonCode: "spam", idempotencyKey: key() }),
    ).toMatchObject({ code: "SUSPENDED" });
  });

  it("moderators cannot change roles, suspend indefinitely, or act on staff", async () => {
    const { author, moderator, admin } = await scene();
    const otherModerator = await staff("moderator");
    const staffArgument = await createTestArgument(t.db, admin.id);
    actAs(moderator.id);
    expect(await changeUserRole({ userId: author.id, role: "moderator", note: "Trusted member", idempotencyKey: key() })).toMatchObject({
      code: "FORBIDDEN",
    });
    expect(
      await suspendUser({ userId: author.id, duration: "indefinite", reasonCode: "threats", note: "Threatened a user", idempotencyKey: key() }),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await suspendUser({ userId: otherModerator.id, duration: "24h", reasonCode: "spam", note: "Abusing tools", idempotencyKey: key() }),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await moderateContent({ targetType: "argument", targetId: staffArgument.id, action: "hide", reasonCode: "spam", idempotencyKey: key() }),
    ).toMatchObject({ code: "FORBIDDEN" });
  });

  it("nobody moderates their own content or account", async () => {
    const { moderator } = await scene();
    const ownArgument = await createTestArgument(t.db, moderator.id);
    actAs(moderator.id);
    expect(
      await moderateContent({ targetType: "argument", targetId: ownArgument.id, action: "hide", reasonCode: "spam", idempotencyKey: key() }),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(await unsuspendUser({ userId: moderator.id, note: "Lifting my own", idempotencyKey: key() })).toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

// ---------------------------------------------------------------------------------------------------

describe("content actions", () => {
  it("hide: changes status, records the action, audits, resolves open reports and tells the author", async () => {
    const { comment, author, reporter, moderator } = await scene();
    actAs(reporter.id);
    const filed = await fileReport({ targetType: "comment", targetId: comment.id, reason: "harassment" });
    if (!filed.ok) throw new Error(filed.error);
    await openAutomaticReport({ targetType: "comment", targetId: comment.id, reason: "spam" });

    actAs(moderator.id);
    const result = await moderateContent({
      targetType: "comment",
      targetId: comment.id,
      action: "hide",
      reasonCode: "harassment",
      note: "Personal insult",
      reportId: filed.data.reportId,
      idempotencyKey: key(),
    });
    expect(result).toMatchObject({ ok: true, data: { status: "hidden", reportsResolved: 2 } });

    expect((await t.db.select().from(comments).where(eq(comments.id, comment.id)))[0]?.status).toBe("hidden");
    const [action] = await t.db.select().from(moderationActions);
    expect(action).toMatchObject({
      moderatorId: moderator.id,
      action: "hide",
      targetType: "comment",
      targetId: comment.id,
      reasonCode: "harassment",
      note: "Personal insult",
      reportId: filed.data.reportId,
    });
    const [audit] = await auditRows("moderation.hide");
    expect(audit).toMatchObject({ actorId: moderator.id, targetType: "comment", targetId: comment.id, before: { status: "visible" } });
    expect(audit?.after).toMatchObject({ status: "hidden", reasonCode: "harassment" });
    const open = await t.db.select().from(reports).where(eq(reports.status, "open"));
    expect(open).toHaveLength(0);
    const [note] = await t.db.select().from(notifications).where(eq(notifications.userId, author.id));
    expect(note).toMatchObject({ type: "moderation_action", actorId: null, targetType: "comment", targetId: comment.id });
    expect(note?.data).toMatchObject({
      reason: "A moderator hid your comment for harassment or bullying.",
      reasonCode: "harassment",
      commentId: comment.id,
      argumentId: comment.argumentId,
    });
  });

  it("remove then restore; invalid transitions are conflicts", async () => {
    const { argument, moderator } = await scene();
    actAs(moderator.id);
    const base = { targetType: "argument" as const, targetId: argument.id, reasonCode: "spam" as const };
    expect(await moderateContent({ ...base, action: "remove", idempotencyKey: key() })).toMatchObject({ data: { status: "removed" } });
    expect(await moderateContent({ ...base, action: "hide", idempotencyKey: key() })).toMatchObject({ code: "CONFLICT" });
    expect(await moderateContent({ ...base, action: "restore", note: "Reviewed: fine", idempotencyKey: key() })).toMatchObject({
      data: { status: "visible" },
    });
    expect(await moderateContent({ ...base, action: "restore", idempotencyKey: key() })).toMatchObject({ code: "CONFLICT" });
    expect((await t.db.select().from(argumentsTable).where(eq(argumentsTable.id, argument.id)))[0]?.status).toBe("visible");
    expect(await auditRows("moderation.remove")).toHaveLength(1);
    expect(await auditRows("moderation.restore")).toHaveLength(1);
  });

  it("refuses to restore an argument or comment its author deleted", async () => {
    const { author, argument, comment, moderator } = await scene();
    actAs(author.id);
    const { deleteArgument } = await import("@domain/arguments/actions");
    const { deleteComment } = await import("@domain/social/actions");
    expect(await deleteArgument({ argumentId: argument.id })).toMatchObject({ ok: true });
    expect(await deleteComment({ commentId: comment.id })).toMatchObject({ ok: true });
    actAs(moderator.id);
    for (const target of [
      { targetType: "argument" as const, targetId: argument.id },
      { targetType: "comment" as const, targetId: comment.id },
    ]) {
      expect(await moderateContent({ ...target, reasonCode: "other", action: "restore", idempotencyKey: key() })).toMatchObject({
        ok: false,
        code: "CONFLICT",
      });
    }
    expect((await t.db.select().from(argumentsTable).where(eq(argumentsTable.id, argument.id)))[0]?.status).toBe("removed");
  });

  it("is idempotent: a double-tap with the same key acts once", async () => {
    const { comment, moderator } = await scene();
    actAs(moderator.id);
    const input = { targetType: "comment" as const, targetId: comment.id, action: "hide" as const, reasonCode: "spam" as const, idempotencyKey: key() };
    const [a, b] = [await moderateContent(input), await moderateContent(input)];
    expect(a).toEqual(b);
    expect(await t.db.select().from(moderationActions)).toHaveLength(1);
  });

  it("rejects a report id that belongs to different content", async () => {
    const { comment, argument, moderator } = await scene();
    const other = await openAutomaticReport({ targetType: "argument", targetId: argument.id, reason: "spam" });
    actAs(moderator.id);
    expect(
      await moderateContent({
        targetType: "comment",
        targetId: comment.id,
        action: "hide",
        reasonCode: "spam",
        reportId: other.id,
        idempotencyKey: key(),
      }),
    ).toMatchObject({ code: "VALIDATION" });
    expect((await t.db.select().from(comments).where(eq(comments.id, comment.id)))[0]?.status).toBe("visible");
  });

  it("profile 'remove' clears bio and photo and keeps the old values in the audit log", async () => {
    const { author, moderator } = await scene();
    await t.db.update(profiles).set({ bio: "Call 0803 123 4567 for fixed matches", avatarUrl: "https://img.example.com/a.png" }).where(eq(profiles.userId, author.id));
    actAs(moderator.id);
    expect(
      await moderateContent({ targetType: "profile", targetId: author.id, action: "remove", reasonCode: "spam", idempotencyKey: key() }),
    ).toMatchObject({ ok: true, data: { status: null } });
    expect((await t.db.select().from(profiles).where(eq(profiles.userId, author.id)))[0]).toMatchObject({ bio: null, avatarUrl: null });
    expect((await auditRows("moderation.remove"))[0]?.before).toEqual({
      bio: "Call 0803 123 4567 for fixed matches",
      avatarUrl: "https://img.example.com/a.png",
    });
    expect(
      await moderateContent({ targetType: "profile", targetId: author.id, action: "hide", reasonCode: "spam", idempotencyKey: key() }),
    ).toMatchObject({ code: "CONFLICT" });
  });

  it("hiding a debate submission never touches the competition, verdict or scores", async () => {
    const { author, argument, moderator } = await scene();
    const opponent = (await createTestUser(t.db)).user;
    const competition = await createTestCompetition(t.db, argument, author.id, opponent.id, { status: "completed", round: null });
    const opening = await createTestSubmission(t.db, competition.id, author.id, "FOR", "Abusive but persuasive opening text");
    const verdict = await createTestVerdict(t.db, competition.id, author.id);

    actAs(moderator.id);
    expect(
      await moderateContent({ targetType: "submission", targetId: opening.id, action: "hide", reasonCode: "harassment", idempotencyKey: key() }),
    ).toMatchObject({ ok: true, data: { status: "hidden" } });

    expect((await t.db.select().from(submissions).where(eq(submissions.id, opening.id)))[0]).toMatchObject({
      status: "hidden",
      body: "Abusive but persuasive opening text",
    });
    const [competitionAfter] = await t.db.select().from(competitions).where(eq(competitions.id, competition.id));
    expect(competitionAfter?.status).toBe("completed");
    const [verdictAfter] = await t.db.select().from(verdicts).where(eq(verdicts.id, verdict.id));
    expect(verdictAfter).toEqual(verdict);
  });
});

// ---------------------------------------------------------------------------------------------------

describe("account actions and suspension effects", () => {
  it("warn records an action, resolves the report's open reports and notifies", async () => {
    const { comment, author, moderator } = await scene();
    const report = await openAutomaticReport({ targetType: "comment", targetId: comment.id, reason: "harassment" });
    actAs(moderator.id);
    expect(
      await warnUser({ userId: author.id, reasonCode: "harassment", reportId: report.id, note: "First warning", idempotencyKey: key() }),
    ).toMatchObject({ ok: true, data: { reportsResolved: 1 } });
    expect(await t.db.select().from(moderationActions).where(eq(moderationActions.action, "warn"))).toHaveLength(1);
    expect(await auditRows("moderation.warn")).toHaveLength(1);
    const [note] = await t.db.select().from(notifications).where(eq(notifications.userId, author.id));
    expect(note?.type).toBe("moderation_warning");
  });

  it("a report about someone else cannot be used to warn this user", async () => {
    const { comment, reporter, moderator } = await scene();
    const report = await openAutomaticReport({ targetType: "comment", targetId: comment.id, reason: "harassment" });
    actAs(moderator.id);
    expect(await warnUser({ userId: reporter.id, reasonCode: "harassment", reportId: report.id, idempotencyKey: key() })).toMatchObject({
      code: "VALIDATION",
    });
  });

  it("suspension blocks writes until it lapses; suspended users can still read", async () => {
    const { author, reporter, moderator, comment } = await scene();
    actAs(moderator.id);
    const result = await suspendUser({ userId: author.id, duration: "72h", reasonCode: "harassment", note: "Repeated insults", idempotencyKey: key() });
    expect(result).toMatchObject({ ok: true, data: { suspendedUntil: "2026-11-03T12:00:00.000Z" } });

    const [row] = await t.db.select().from(users).where(eq(users.id, author.id));
    expect(row).toMatchObject({ status: "suspended" });
    const [action] = await t.db.select().from(moderationActions).where(eq(moderationActions.action, "suspend"));
    expect(action).toMatchObject({ durationHours: 72, expiresAt: new Date("2026-11-03T12:00:00Z") });
    const [audit] = await auditRows("moderation.suspend");
    expect(audit?.before).toMatchObject({ status: "active" });
    expect(audit?.after).toMatchObject({ status: "suspended", durationHours: 72, note: "Repeated insults" });

    actAs(author.id);
    await expect(requireUser()).rejects.toMatchObject({ code: "SUSPENDED" });
    expect((await requireUser({ allowSuspended: true })).id).toBe(author.id);
    const blocked = await fileReport({ targetType: "comment", targetId: comment.id, reason: "spam" });
    expect(blocked).toMatchObject({ code: "SUSPENDED" });
    expect(blocked.ok ? "" : blocked.error).toMatch(/until 3 Nov 2026/);

    advanceClock(72 * HOUR_MS);
    expect((await requireUser()).id).toBe(author.id);
    expect(await liftExpiredSuspensions()).toBe(1);
    expect((await t.db.select().from(users).where(eq(users.id, author.id)))[0]).toMatchObject({ status: "active", suspendedUntil: null });
    expect(await auditRows("moderation.suspension_expired")).toHaveLength(1);
    void reporter;
  });

  it("admins can suspend indefinitely and lift it; lifting audits and notifies", async () => {
    const { author, admin } = await scene();
    actAs(admin.id);
    expect(
      await suspendUser({ userId: author.id, duration: "indefinite", reasonCode: "threats", note: "Credible threat", idempotencyKey: key() }),
    ).toMatchObject({ ok: true, data: { suspendedUntil: null } });
    advanceClock(365 * DAY_MS);
    expect(await liftExpiredSuspensions()).toBe(0);
    actAs(author.id);
    await expect(requireUser()).rejects.toMatchObject({ code: "SUSPENDED" });

    actAs(admin.id);
    expect(await unsuspendUser({ userId: author.id, note: "Appeal reviewed", idempotencyKey: key() })).toMatchObject({ ok: true });
    expect(await unsuspendUser({ userId: author.id, note: "Again", idempotencyKey: key() })).toMatchObject({ code: "CONFLICT" });
    actAs(author.id);
    expect((await requireUser()).id).toBe(author.id);
    expect(await auditRows("moderation.unsuspend")).toHaveLength(1);
    const types = (await t.db.select().from(notifications).where(eq(notifications.userId, author.id))).map((n) => n.data.action);
    expect(types.sort()).toEqual(["suspend", "unsuspend"]);
  });

  it("suspend requires a written reason", async () => {
    const { author, moderator } = await scene();
    actAs(moderator.id);
    expect(await suspendUser({ userId: author.id, duration: "24h", reasonCode: "spam", note: "", idempotencyKey: key() })).toMatchObject({
      code: "VALIDATION",
    });
  });
});

// ---------------------------------------------------------------------------------------------------

describe("dismissReport", () => {
  it("dismisses one report without changing the content", async () => {
    const { comment, reporter, moderator } = await scene();
    actAs(reporter.id);
    const filed = await fileReport({ targetType: "comment", targetId: comment.id, reason: "spam" });
    if (!filed.ok) throw new Error(filed.error);
    actAs(moderator.id);
    expect(await dismissReport({ reportId: filed.data.reportId, note: "Banter, not abuse", idempotencyKey: key() })).toMatchObject({ ok: true });
    expect((await t.db.select().from(reports))[0]).toMatchObject({ status: "dismissed", resolvedBy: moderator.id, resolutionNote: "Banter, not abuse" });
    expect((await t.db.select().from(comments).where(eq(comments.id, comment.id)))[0]?.status).toBe("visible");
    expect(await auditRows("moderation.dismiss_report")).toHaveLength(1);
    expect(await dismissReport({ reportId: filed.data.reportId, idempotencyKey: key() })).toMatchObject({ code: "CONFLICT" });
  });

  it("a moderator cannot handle a report they filed", async () => {
    const { comment, moderator } = await scene();
    actAs(moderator.id);
    const filed = await fileReport({ targetType: "comment", targetId: comment.id, reason: "spam" });
    if (!filed.ok) throw new Error(filed.error);
    expect(await dismissReport({ reportId: filed.data.reportId, idempotencyKey: key() })).toMatchObject({ code: "FORBIDDEN" });
  });
});

// ---------------------------------------------------------------------------------------------------

describe("changeUserRole (admin only)", () => {
  it("promotes a user, audits before/after", async () => {
    const { author, admin } = await scene();
    actAs(admin.id);
    expect(await changeUserRole({ userId: author.id, role: "moderator", note: "Active, fair member", idempotencyKey: key() })).toMatchObject({
      ok: true,
      data: { role: "moderator" },
    });
    const [audit] = await auditRows("admin.role_change");
    expect(audit).toMatchObject({ actorId: admin.id, targetId: author.id, before: { role: "user" } });
    expect(audit?.after).toMatchObject({ role: "moderator" });
  });

  it("never changes your own role and protects the last admin", async () => {
    const { admin } = await scene();
    actAs(admin.id);
    expect(await changeUserRole({ userId: admin.id, role: "user", note: "Stepping down", idempotencyKey: key() })).toMatchObject({
      code: "FORBIDDEN",
    });
    const second = await staff("admin");
    expect(await changeUserRole({ userId: second.id, role: "moderator", note: "Reducing access", idempotencyKey: key() })).toMatchObject({
      ok: true,
    });
    const admins = await t.db.select().from(users).where(and(eq(users.role, "admin")));
    expect(admins).toHaveLength(1);
  });
});
