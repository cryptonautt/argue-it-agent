import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actAs, actAsSignedOut } from "@domain/test-helpers/auth";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestArgument, createTestUser } from "@domain/test-helpers/factories";
import { HOUR_MS, MINUTE_MS, advanceClock, resetClock, setClock } from "@domain/lib/time";
import { writeAudit } from "@domain/audit";
import { appeals, comments, evaluationJobs, reports, users, verdicts } from "@domain/db/schema";
import { estimateCost } from "./metrics";
import {
  getEvaluationStats,
  getOverviewStats,
  getReportDetail,
  getUserDetail,
  listAuditLogs,
  listCompetitions,
  listReports,
  searchUsers,
} from "./queries";
import { openAutomaticReport } from "./service";
import { assertContentAllowed, assessContent, flagForReviewIfNeeded } from "./spam";
import { createTestCompetition, createTestRun, createTestSubmission, createTestVerdict } from "./test-fixtures";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const t = setupTestDb();

beforeEach(() => setClock(new Date("2026-10-31T12:00:00Z")));
afterEach(() => resetClock());

describe("admin queries are guarded server-side", () => {
  it("reject signed-out users and ordinary users", async () => {
    const { user } = await createTestUser(t.db);
    const queries = [
      () => getOverviewStats(),
      () => listReports({ status: "open", page: 1 }),
      () => getReportDetail(crypto.randomUUID()),
      () => searchUsers({ page: 1 }),
      () => getUserDetail(user.id),
      () => listCompetitions({ page: 1 }),
      () => getEvaluationStats(),
      () => listAuditLogs({}),
    ];
    actAsSignedOut();
    for (const q of queries) await expect(q()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    actAs(user.id);
    for (const q of queries) await expect(q()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keep the AI evaluation dashboard and audit log admin-only", async () => {
    const moderator = (await createTestUser(t.db, { role: "moderator" })).user;
    actAs(moderator.id);
    await expect(getEvaluationStats()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAuditLogs({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listReports({ status: "open", page: 1 })).resolves.toMatchObject({ total: 0 });
  });
});

describe("reports queue", () => {
  it("orders open reports by severity, then age, with target previews and per-target counts", async () => {
    const moderator = (await createTestUser(t.db, { role: "moderator" })).user;
    const author = (await createTestUser(t.db, { handle: "loud_fan" })).user;
    const argument = await createTestArgument(t.db, author.id, { title: "Ronaldo is overrated" });
    const [comment] = await t.db.insert(comments).values({ argumentId: argument.id, authorId: author.id, body: "I know where you live" }).returning();
    if (!comment) throw new Error("insert failed");

    await openAutomaticReport({ targetType: "argument", targetId: argument.id, reason: "spam" });
    advanceClock(MINUTE_MS);
    await openAutomaticReport({ targetType: "comment", targetId: comment.id, reason: "threats" });
    await openAutomaticReport({ targetType: "comment", targetId: comment.id, reason: "harassment" });

    actAs(moderator.id);
    const { items, total } = await listReports({ status: "open", page: 1 });
    expect(total).toBe(3);
    expect(items.map((i) => i.reason)).toEqual(["threats", "harassment", "spam"]);
    expect(items[0]).toMatchObject({ openOnTarget: 2, target: { body: "I know where you live", author: { handle: "loud_fan" } } });
    expect((await listReports({ status: "open", reason: "spam", page: 1 })).total).toBe(1);
    expect((await listReports({ status: "open", targetType: "comment", source: "automatic", page: 1 })).total).toBe(2);
    expect((await listReports({ status: "open", source: "user", page: 1 })).total).toBe(0);

    const detail = await getReportDetail(items[0]!.id);
    expect(detail?.otherReports.map((r) => r.reason)).toEqual(["harassment"]);
    expect(detail?.target?.href).toBe(`/a/${argument.id}#comment-${comment.id}`);
  });
});

describe("users", () => {
  it("searches by handle, name or email and counts open reports about them", async () => {
    const moderator = (await createTestUser(t.db, { role: "moderator" })).user;
    const { user } = await createTestUser(t.db, { handle: "naija_striker", displayName: "Chidi O" });
    await createTestUser(t.db, { handle: "someone_else" });
    const argument = await createTestArgument(t.db, user.id);
    await openAutomaticReport({ targetType: "argument", targetId: argument.id, reason: "spam" });
    await openAutomaticReport({ targetType: "profile", targetId: user.id, reason: "impersonation" });

    actAs(moderator.id);
    for (const q of ["@naija", "chidi", "naija_striker@example"]) {
      const result = await searchUsers({ q, page: 1 });
      expect(result.items.map((u) => u.handle)).toEqual(["naija_striker"]);
      expect(result.items[0]?.openReports).toBe(2);
    }
    expect((await searchUsers({ q: "%", page: 1 })).total).toBe(0);

    const detail = await getUserDetail(user.id);
    expect(detail?.counts.arguments).toBe(1);
    expect(detail?.openReports).toHaveLength(2);
  });
});

describe("competitions monitor", () => {
  it("lists competitions with deadline, overdue flag, participants and submission counts", async () => {
    const admin = (await createTestUser(t.db, { role: "admin" })).user;
    const a = (await createTestUser(t.db, { handle: "side_for" })).user;
    const b = (await createTestUser(t.db, { handle: "side_against" })).user;
    const argument = await createTestArgument(t.db, a.id);
    const competition = await createTestCompetition(t.db, argument, a.id, b.id);
    await createTestSubmission(t.db, competition.id, a.id, "FOR");

    actAs(admin.id);
    let result = await listCompetitions({ page: 1 });
    expect(result.items[0]).toMatchObject({
      status: "active",
      round: "opening",
      overdue: false,
      submissions: { total: 1, locked: 1 },
      participants: [{ handle: "side_for", side: "FOR" }, { handle: "side_against", side: "AGAINST" }],
    });
    expect(result.statusCounts.active).toBe(1);
    expect((await listCompetitions({ overdue: true, page: 1 })).total).toBe(0);

    advanceClock(25 * HOUR_MS);
    result = await listCompetitions({ overdue: true, page: 1 });
    expect(result.items[0]?.overdue).toBe(true);
  });
});

describe("overview + evaluation stats", () => {
  it("computes queue counts, activation and judge health from real rows", async () => {
    const admin = (await createTestUser(t.db, { role: "admin" })).user;
    const a = (await createTestUser(t.db)).user;
    const b = (await createTestUser(t.db)).user;
    await createTestUser(t.db); // new but inactive
    const argument = await createTestArgument(t.db, a.id);
    const agreed = await createTestCompetition(t.db, argument, a.id, b.id, { status: "completed", round: null });
    const disputed = await createTestCompetition(t.db, argument, b.id, a.id, { status: "completed", round: null });
    await createTestRun(t.db, agreed.id, 2);
    await createTestRun(t.db, disputed.id, 3);
    const original = await createTestVerdict(t.db, disputed.id, b.id, "A");
    await createTestVerdict(t.db, agreed.id, null, "inconclusive");
    await t.db.insert(evaluationJobs).values({ competitionId: agreed.id, reason: "appeal", status: "failed", attempts: 3, lastError: "provider 529" });
    // Appeal on `disputed` that reversed the outcome (A → B).
    await t.db.insert(appeals).values({ competitionId: disputed.id, verdictId: original.id, appellantId: a.id, ground: "evidence_overlooked", text: "Missed my stats", status: "overturned" });
    await t.db.update(verdicts).set({ isCurrent: false }).where(eq(verdicts.id, original.id));
    await t.db.insert(verdicts).values({ competitionId: disputed.id, version: 2, outcome: "B", winnerUserId: a.id, decidedBy: "human", isCurrent: true });
    await t.db.update(users).set({ status: "suspended", suspendedUntil: null }).where(eq(users.id, b.id));

    actAs(admin.id);
    const overview = await getOverviewStats();
    expect(overview.queues.failedJobs).toBe(1);
    expect(overview.last7d.newUsers).toBe(4);
    // a (argument + competition) and b (competition creator) acted; the 4th new user and admin did not.
    expect(overview.last7d.activeUsers).toBe(2);
    expect(overview.last7d.newUsersWhoActed).toBe(2);
    expect(overview.totals.suspendedUsers).toBe(1);

    const stats = await getEvaluationStats(30);
    expect(stats.runs.withTwoPasses).toBe(2);
    expect(stats.runs.needingThirdPass).toBe(1);
    expect(stats.passes.total).toBe(5);
    expect(stats.passes.byPassNo.map((p) => p.passNo)).toEqual([1, 2, 3]);
    expect(stats.passes.usage[0]).toMatchObject({ model: "claude-opus-5-5", inputTokens: 5000, outputTokens: 1000 });
    expect(estimateCost(stats.passes.usage).totalUsd).toBeCloseTo((5000 * 4 + 1000 * 20) / 1e6, 8);
    expect(stats.verdicts.byOutcome).toMatchObject({ A: 1, inconclusive: 1 });
    expect(stats.verdicts.humanDecided).toBe(1);
    expect(stats.appeals).toMatchObject({ total: 1, decided: 1, reversed: 1 });
    expect(stats.jobs.byStatus.failed).toBe(1);
    expect(stats.jobs.recentFailures[0]?.lastError).toBe("provider 529");
  });
});

describe("audit log", () => {
  it("filters by action prefix, actor handle / system, and pages with a keyset cursor", async () => {
    const { user: admin } = await createTestUser(t.db, { role: "admin", handle: "auditor" });
    for (let i = 0; i < 30; i++) {
      advanceClock(1000);
      await writeAudit({ actorId: i % 2 === 0 ? admin.id : null, action: i % 3 === 0 ? "moderation.hide" : "competition.accept", targetType: "argument", targetId: `t${i}` });
    }
    actAs(admin.id);
    const page1 = await listAuditLogs({});
    expect(page1.items).toHaveLength(25);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listAuditLogs({ cursor: page1.nextCursor ?? undefined });
    expect(page2.items).toHaveLength(5);
    expect(new Set([...page1.items, ...page2.items].map((i) => i.id)).size).toBe(30);

    expect((await listAuditLogs({ action: "moderation." })).items).toHaveLength(10);
    expect((await listAuditLogs({ action: "competition.accept" })).items).toHaveLength(20);
    expect((await listAuditLogs({ actor: "@auditor" })).items.every((i) => i.actorHandle === "auditor")).toBe(true);
    expect((await listAuditLogs({ actor: "system" })).items.every((i) => i.actorId === null)).toBe(true);
  });
});

describe("assessContent (DB-backed spam screening)", () => {
  const TAKE = "Super Eagles will qualify for the World Cup because the new coach finally trusts young players.";

  it("allows a first post and blocks an immediate identical repost", async () => {
    const { user } = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, user.id);
    expect((await assessContent(user.id, TAKE)).decision).toBe("allow");
    await t.db.insert(comments).values({ argumentId: argument.id, authorId: user.id, body: TAKE });
    advanceClock(MINUTE_MS);
    const second = await assessContent(user.id, TAKE);
    expect(second.decision).toBe("block");
    expect(() => assertContentAllowed(second)).toThrowError(/already posted this/);
  });

  it("detects the same text from several accounts and opens one automatic report", async () => {
    const poster = (await createTestUser(t.db)).user;
    const argument = await createTestArgument(t.db, poster.id);
    for (let i = 0; i < 2; i++) {
      const other = (await createTestUser(t.db)).user;
      await t.db.insert(comments).values({ argumentId: argument.id, authorId: other.id, body: `  ${TAKE.toUpperCase()} ` });
    }
    const assessment = await assessContent(poster.id, TAKE);
    expect(assessment.decision).toBe("review");
    expect(assessment.signals[0]?.code).toBe("duplicate_cross_user");

    const [mine] = await t.db.insert(comments).values({ argumentId: argument.id, authorId: poster.id, body: TAKE }).returning();
    const first = await flagForReviewIfNeeded(assessment, { type: "comment", id: mine!.id });
    const again = await flagForReviewIfNeeded(assessment, { type: "comment", id: mine!.id });
    expect(first).toMatchObject({ created: true });
    expect(again).toEqual({ created: false, id: first?.id });
    const [report] = await t.db.select().from(reports);
    expect(report).toMatchObject({ reporterId: null, isAutomatic: true, reason: "spam" });
    expect(report?.details).toMatch(/other accounts posted the same text/);
  });

  it("blocks burst posting across arguments and comments", async () => {
    const { user } = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, user.id);
    for (let i = 0; i < 4; i++) {
      advanceClock(5000);
      await t.db.insert(comments).values({ argumentId: argument.id, authorId: user.id, body: `quick reply number ${i}` });
    }
    expect((await assessContent(user.id, "one more thought")).decision).toBe("block");
    expect(() => assertContentAllowed({ decision: "block", score: 0.9, signals: [{ code: "burst", weight: 0.9, detail: "" }], message: "slow down" })).toThrowError(
      expect.objectContaining({ code: "RATE_LIMITED" }),
    );
  });
});
