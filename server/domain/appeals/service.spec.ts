import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS, resetClock, setClock } from "@domain/lib/time";
import type { DbOrTx } from "@domain/db";
import { appeals, auditLogs, competitions, notifications, verdicts } from "@domain/db/schema";
import { setupTestDb } from "@domain/test-helpers/db";
import { decideAppeal, fileAppeal, resolveReview, retryFailedEvaluation } from "./service";
import { addFailedRun, createJudgedCompetition } from "./test-fixtures";

const mocks = vi.hoisted(() => ({
  enqueueEvaluation: vi.fn<(competitionId: string, reason: "close" | "appeal", tx?: DbOrTx) => Promise<void>>(),
  applyCompetitionResult: vi.fn<(competitionId: string) => Promise<void>>(),
}));
vi.mock("@domain/judging", () => ({ enqueueEvaluation: mocks.enqueueEvaluation }));
vi.mock("@domain/reputation", () => ({ applyCompetitionResult: mocks.applyCompetitionResult }));


const t = setupTestDb();
const VERDICT_AT = new Date("2026-10-05T10:00:00Z");
const hoursAfterVerdict = (h: number) => new Date(VERDICT_AT.getTime() + h * HOUR_MS);
const TEXT = "The verdict says I gave no evidence but my rebuttal cites three specific final results.";

beforeEach(() => {
  setClock(hoursAfterVerdict(2));
  mocks.enqueueEvaluation.mockReset().mockResolvedValue(undefined);
  mocks.applyCompetitionResult.mockReset().mockResolvedValue(undefined);
});
afterEach(() => resetClock());

async function competitionStatus(id: string) {
  const [row] = await t.db.select({ status: competitions.status }).from(competitions).where(eq(competitions.id, id));
  return row?.status;
}

async function auditActions(): Promise<string[]> {
  const rows = await t.db.select({ action: auditLogs.action }).from(auditLogs);
  return rows.map((r) => r.action);
}

describe("fileAppeal", () => {
  it("opens an appeal, puts the competition under appeal, audits and notifies the opponent", async () => {
    const f = await createJudgedCompetition(t.db);
    const { appealId } = await fileAppeal(f.againstUser.user, {
      competitionId: f.competitionId,
      ground: "evidence_overlooked",
      text: TEXT,
    });

    const [appeal] = await t.db.select().from(appeals).where(eq(appeals.id, appealId));
    expect(appeal).toMatchObject({ status: "open", verdictId: f.verdictId, appellantId: f.againstUser.user.id });
    expect(await competitionStatus(f.competitionId)).toBe("under_appeal");
    expect(await auditActions()).toContain("appeal.file");
    const notes = await t.db.select().from(notifications).where(eq(notifications.type, "appeal_filed"));
    expect(notes.map((n) => n.userId)).toEqual([f.forUser.user.id]);
  });

  it("rejects people who weren't in the debate", async () => {
    const f = await createJudgedCompetition(t.db);
    await expect(
      fileAppeal(f.reviewer.user, { competitionId: f.competitionId, ground: "factual_error", text: TEXT }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects appeals after the 48h window", async () => {
    const f = await createJudgedCompetition(t.db);
    setClock(hoursAfterVerdict(48));
    await expect(
      fileAppeal(f.forUser.user, { competitionId: f.competitionId, ground: "factual_error", text: TEXT }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("closed") });
  });

  it("rejects a second appeal while one is open", async () => {
    const f = await createJudgedCompetition(t.db);
    await fileAppeal(f.againstUser.user, { competitionId: f.competitionId, ground: "factual_error", text: TEXT });
    await expect(
      fileAppeal(f.forUser.user, { competitionId: f.competitionId, ground: "factual_error", text: TEXT }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects appeals on debates still being judged or reviewed", async () => {
    const f = await createJudgedCompetition(t.db, { status: "needs_review", outcome: "inconclusive" });
    await expect(
      fileAppeal(f.forUser.user, { competitionId: f.competitionId, ground: "technical_failure", text: TEXT }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("decideAppeal", () => {
  async function filed(opts: Parameters<typeof createJudgedCompetition>[1] = {}) {
    const f = await createJudgedCompetition(t.db, opts);
    const { appealId } = await fileAppeal(f.againstUser.user, {
      competitionId: f.competitionId,
      ground: "evidence_overlooked",
      text: TEXT,
    });
    return { ...f, appealId };
  }

  it("uphold: the verdict stands, competition completes, both sides are told, ratings untouched", async () => {
    const f = await filed();
    const result = await decideAppeal(f.reviewer.user, { appealId: f.appealId, decision: "uphold", note: "The stats were considered." });

    expect(result).toMatchObject({ status: "upheld", ratingsUpdated: null });
    const [appeal] = await t.db.select().from(appeals).where(eq(appeals.id, f.appealId));
    expect(appeal).toMatchObject({ status: "upheld", reviewerId: f.reviewer.user.id, decisionNote: "The stats were considered." });
    expect(await competitionStatus(f.competitionId)).toBe("completed");
    const current = await t.db.select().from(verdicts).where(eq(verdicts.isCurrent, true));
    expect(current.map((v) => v.id)).toEqual([f.verdictId]);
    const decided = await t.db.select().from(notifications).where(eq(notifications.type, "appeal_decided"));
    expect(decided.map((n) => n.userId).sort()).toEqual([f.forUser.user.id, f.againstUser.user.id].sort());
    expect(mocks.applyCompetitionResult).not.toHaveBeenCalled();
    expect(await auditActions()).toContain("appeal.uphold");
  });

  it("after an uphold the opponent still gets a full 48h to use their own appeal", async () => {
    const f = await filed();
    setClock(hoursAfterVerdict(40));
    await decideAppeal(f.reviewer.user, { appealId: f.appealId, decision: "uphold", note: "Considered properly." });
    setClock(hoursAfterVerdict(70)); // 70h after the verdict, 30h after the uphold
    await expect(
      fileAppeal(f.forUser.user, { competitionId: f.competitionId, ground: "factual_error", text: TEXT }),
    ).resolves.toMatchObject({ appealId: expect.any(String) });
  });

  it("one appeal per participant: the same person can't appeal twice", async () => {
    const f = await filed();
    await decideAppeal(f.reviewer.user, { appealId: f.appealId, decision: "uphold", note: "Considered properly." });
    await expect(
      fileAppeal(f.againstUser.user, { competitionId: f.competitionId, ground: "technical_failure", text: TEXT }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("one appeal") });
  });

  it("reevaluate: queues a fresh appeal evaluation and keeps the old verdict until the judge replaces it", async () => {
    const f = await filed();
    const result = await decideAppeal(f.reviewer.user, {
      appealId: f.appealId,
      decision: "reevaluate",
      note: "Rebuttal stats may have been missed.",
    });
    expect(result.status).toBe("reevaluated");
    // Enqueued inside the decision's transaction, so the two commit together.
    expect(mocks.enqueueEvaluation).toHaveBeenCalledWith(f.competitionId, "appeal", expect.anything());
    const [verdict] = await t.db.select().from(verdicts).where(eq(verdicts.id, f.verdictId));
    expect(verdict?.isCurrent).toBe(true);
    expect(await auditActions()).toContain("appeal.reevaluate");
  });

  it("reevaluate: allowed only once per competition (no rerolls)", async () => {
    const f = await filed();
    await decideAppeal(f.reviewer.user, { appealId: f.appealId, decision: "reevaluate", note: "Possible miss here." });
    // Simulate the judge finishing: new current verdict, competition completed.
    await t.db.update(verdicts).set({ isCurrent: false }).where(eq(verdicts.id, f.verdictId));
    const [v2] = await t.db
      .insert(verdicts)
      .values({ competitionId: f.competitionId, version: 2, outcome: "B", winnerUserId: f.againstUser.user.id, createdAt: hoursAfterVerdict(3) })
      .returning();
    await t.db.update(competitions).set({ status: "completed" }).where(eq(competitions.id, f.competitionId));
    setClock(hoursAfterVerdict(4));

    const second = await fileAppeal(f.forUser.user, { competitionId: f.competitionId, ground: "factual_error", text: TEXT });
    const [secondAppeal] = await t.db.select().from(appeals).where(eq(appeals.id, second.appealId));
    expect(secondAppeal?.verdictId).toBe(v2?.id);
    await expect(
      decideAppeal(f.reviewer.user, { appealId: second.appealId, decision: "reevaluate", note: "Run it again please." }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("one appeal re-evaluation") });
    expect(mocks.enqueueEvaluation).toHaveBeenCalledTimes(1);
  });

  it("reevaluate: refused for forfeits (nothing was judged)", async () => {
    const f = await filed({ outcome: "forfeit" });
    await expect(
      decideAppeal(f.reviewer.user, { appealId: f.appealId, decision: "reevaluate", note: "Please re-run this." }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.enqueueEvaluation).not.toHaveBeenCalled();
  });

  it("reevaluate: if the job can't be queued the decision is rolled back", async () => {
    const f = await filed();
    mocks.enqueueEvaluation.mockRejectedValueOnce(new Error("db down"));
    await expect(
      decideAppeal(f.reviewer.user, { appealId: f.appealId, decision: "reevaluate", note: "Possible miss here." }),
    ).rejects.toThrow("db down");
    expect(await auditActions()).not.toContain("appeal.reevaluate");
    const [appeal] = await t.db.select().from(appeals).where(eq(appeals.id, f.appealId));
    expect(appeal).toMatchObject({ status: "open", reviewerId: null, decidedAt: null });
    expect(await competitionStatus(f.competitionId)).toBe("under_appeal");
  });

  it("overturn: writes a human verdict, keeps the old one in history and re-applies ratings", async () => {
    const f = await filed();
    const result = await decideAppeal(f.reviewer.user, {
      appealId: f.appealId,
      decision: "overturn",
      outcome: "B",
      note: "Side B's rebuttal was ignored entirely.",
    });

    expect(result).toMatchObject({ status: "overturned", ratingsUpdated: true });
    const rows = await t.db.select().from(verdicts).where(eq(verdicts.competitionId, f.competitionId));
    const old = rows.find((v) => v.id === f.verdictId);
    const next = rows.find((v) => v.id === result.verdictId);
    expect(old?.isCurrent).toBe(false);
    expect(next).toMatchObject({
      isCurrent: true,
      version: 2,
      outcome: "B",
      winnerUserId: f.againstUser.user.id,
      decidedBy: "human",
      reviewerId: f.reviewer.user.id,
      reviewNote: "Side B's rebuttal was ignored entirely.",
      confidence: null,
    });
    expect(next?.explanation?.note).toBe("Side B's rebuttal was ignored entirely.");
    expect(await competitionStatus(f.competitionId)).toBe("completed");
    expect(mocks.applyCompetitionResult).toHaveBeenCalledWith(f.competitionId);
    expect(await auditActions()).toEqual(expect.arrayContaining(["appeal.overturn", "verdict.override"]));
    const decided = await t.db.select().from(notifications).where(eq(notifications.type, "appeal_decided"));
    const labelFor = (userId: string) => decided.find((n) => n.userId === userId)?.data.outcomeLabel;
    expect(labelFor(f.againstUser.user.id)).toBe("You won");
    expect(labelFor(f.forUser.user.id)).toBe("You lost");
  });

  it("overturn: to draw or inconclusive records no winner", async () => {
    const f = await filed();
    const result = await decideAppeal(f.reviewer.user, {
      appealId: f.appealId,
      decision: "overturn",
      outcome: "draw",
      note: "Too close to separate fairly.",
    });
    const [next] = await t.db.select().from(verdicts).where(eq(verdicts.id, result.verdictId ?? ""));
    expect(next).toMatchObject({ outcome: "draw", winnerUserId: null });
  });

  it("overturn: refuses the outcome that's already in place", async () => {
    const f = await filed();
    await expect(
      decideAppeal(f.reviewer.user, { appealId: f.appealId, decision: "overturn", outcome: "A", note: "Same result here." }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("overturn: a failed rating update never undoes the decision", async () => {
    const f = await filed();
    mocks.applyCompetitionResult.mockRejectedValueOnce(new Error("ratings exploded"));
    const result = await decideAppeal(f.reviewer.user, {
      appealId: f.appealId,
      decision: "overturn",
      outcome: "B",
      note: "Side B's rebuttal was ignored.",
    });
    expect(result).toMatchObject({ status: "overturned", ratingsUpdated: false });
    const [appeal] = await t.db.select().from(appeals).where(eq(appeals.id, f.appealId));
    expect(appeal?.status).toBe("overturned");
  });

  it("reviewers can't decide a debate they took part in", async () => {
    const f = await filed();
    await t.db.update(competitions).set({ status: "under_appeal" }).where(eq(competitions.id, f.competitionId));
    await expect(
      decideAppeal(f.forUser.user, { appealId: f.appealId, decision: "uphold", note: "I am obviously right." }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("an appeal can only be decided once", async () => {
    const f = await filed();
    await decideAppeal(f.reviewer.user, { appealId: f.appealId, decision: "uphold", note: "Considered properly." });
    await expect(
      decideAppeal(f.reviewer.user, { appealId: f.appealId, decision: "overturn", outcome: "B", note: "Changed my mind." }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("resolveReview", () => {
  it("confirming inconclusive completes the debate with a human verdict and keeps the AI's in history", async () => {
    const f = await createJudgedCompetition(t.db, { status: "needs_review", outcome: "inconclusive" });
    const result = await resolveReview(f.reviewer.user, {
      competitionId: f.competitionId,
      outcome: "inconclusive",
      note: "Both sides were evenly matched; no fair winner.",
    });

    const rows = await t.db.select().from(verdicts).where(eq(verdicts.competitionId, f.competitionId));
    expect(rows).toHaveLength(2);
    expect(rows.find((v) => v.id === f.verdictId)?.isCurrent).toBe(false);
    expect(rows.find((v) => v.id === result.verdictId)).toMatchObject({
      outcome: "inconclusive",
      decidedBy: "human",
      isCurrent: true,
      version: 2,
    });
    expect(await competitionStatus(f.competitionId)).toBe("completed");
    expect(mocks.applyCompetitionResult).toHaveBeenCalledWith(f.competitionId);
    expect(await auditActions()).toContain("review.confirm_inconclusive");
    const ready = await t.db.select().from(notifications).where(eq(notifications.type, "verdict_ready"));
    expect(ready).toHaveLength(2);
  });

  it("picking a winner after a failed evaluation creates the first verdict", async () => {
    const f = await createJudgedCompetition(t.db, { status: "needs_review", outcome: null });
    const result = await resolveReview(f.reviewer.user, {
      competitionId: f.competitionId,
      outcome: "A",
      note: "Side A answered every point; Side B's rebuttal was empty.",
    });
    const [verdict] = await t.db.select().from(verdicts).where(eq(verdicts.id, result.verdictId));
    expect(verdict).toMatchObject({ version: 1, outcome: "A", winnerUserId: f.forUser.user.id, decidedBy: "human", scores: null });
    expect(verdict?.explanation?.method).toBeNull();
    expect(await auditActions()).toContain("review.decide");
  });

  it("only works on debates waiting for review, and never by a participant", async () => {
    const done = await createJudgedCompetition(t.db);
    await expect(
      resolveReview(done.reviewer.user, { competitionId: done.competitionId, outcome: "B", note: "Overrule the AI here." }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const pending = await createJudgedCompetition(t.db, { status: "needs_review", outcome: "inconclusive" });
    await expect(
      resolveReview(pending.againstUser.user, { competitionId: pending.competitionId, outcome: "B", note: "I clearly won it." }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("retryFailedEvaluation", () => {
  it("re-queues the AI when the last run failed outright", async () => {
    const f = await createJudgedCompetition(t.db, { status: "needs_review", outcome: null });
    await addFailedRun(t.db, f.competitionId);
    mocks.enqueueEvaluation.mockImplementationOnce(async (id, _reason, tx) => {
      await (tx ?? t.db).update(competitions).set({ status: "evaluating" }).where(eq(competitions.id, id));
    });
    await retryFailedEvaluation(f.reviewer.user, f.competitionId);
    expect(mocks.enqueueEvaluation).toHaveBeenCalledWith(f.competitionId, "close", expect.anything());
    expect(await competitionStatus(f.competitionId)).toBe("evaluating");
    const audits = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "review.retry_evaluation"), eq(auditLogs.targetId, f.competitionId)));
    expect(audits).toHaveLength(1);
  });

  it("says so honestly when the judge declines to queue anything", async () => {
    const f = await createJudgedCompetition(t.db, { status: "needs_review", outcome: null });
    await addFailedRun(t.db, f.competitionId);
    await expect(retryFailedEvaluation(f.reviewer.user, f.competitionId)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await competitionStatus(f.competitionId)).toBe("needs_review");
    const audits = await t.db.select().from(auditLogs).where(eq(auditLogs.action, "review.retry_evaluation"));
    expect(audits).toHaveLength(0);
  });

  it("refuses to re-run an inconclusive result (no rerolling for a winner)", async () => {
    const f = await createJudgedCompetition(t.db, { status: "needs_review", outcome: "inconclusive" });
    await expect(retryFailedEvaluation(f.reviewer.user, f.competitionId)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.enqueueEvaluation).not.toHaveBeenCalled();
  });
});
