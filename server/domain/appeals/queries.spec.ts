import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS, resetClock, setClock } from "@domain/lib/time";
import type { SessionUser } from "@domain/auth";
import { evaluationPasses, submissions } from "@domain/db/schema";
import { setupTestDb } from "@domain/test-helpers/db";
import { getAppealQueue, getReviewQueue, getVerdictPageData, getVerdictSummaryData } from "./queries";
import { listRubricsForRules } from "./rubrics";
import { decideAppeal, fileAppeal } from "./service";
import { addFailedRun, addSubmissions, createJudgedCompetition, type AppealFixture } from "./test-fixtures";

vi.mock("@domain/reputation", () => ({ applyCompetitionResult: vi.fn(async () => undefined) }));

const t = setupTestDb();
const TEXT = "The verdict says I cited nothing, but my opening lists two trophies and a record.";

beforeEach(() => setClock(new Date(new Date("2026-10-05T10:00:00Z").getTime() + 2 * HOUR_MS)));
afterEach(() => resetClock());

function asViewer(f: AppealFixture, who: "for" | "against" | "reviewer"): SessionUser {
  const u = who === "for" ? f.forUser : who === "against" ? f.againstUser : f.reviewer;
  return {
    id: u.user.id,
    email: u.user.email,
    role: u.user.role,
    status: "active",
    suspendedUntil: null,
    handle: u.profile.handle,
    displayName: u.profile.displayName,
    avatarUrl: null,
  };
}

describe("getVerdictPageData", () => {
  it("joins names to the blind result and offers the appeal only to participants", async () => {
    const f = await createJudgedCompetition(t.db);
    const spectator = await getVerdictPageData(f.competitionId, null);
    expect(spectator?.current?.outcomeView.headline).toBe("Ada Obi wins");
    expect(spectator?.sides.B.displayName).toBe("Bayo Eze");
    expect(spectator?.eligibility).toMatchObject({ eligible: false, reason: "signed_out" });

    const loser = await getVerdictPageData(f.competitionId, asViewer(f, "against"));
    expect(loser?.viewer.side).toBe("B");
    expect(loser?.eligibility.eligible).toBe(true);
  });

  it("shows appeal text only to participants and staff", async () => {
    const f = await createJudgedCompetition(t.db);
    await fileAppeal(f.againstUser.user, { competitionId: f.competitionId, ground: "evidence_overlooked", text: TEXT });
    const publicView = await getVerdictPageData(f.competitionId, null);
    expect(publicView?.appeals[0]).toMatchObject({ groundLabel: "Evidence overlooked", text: null, status: "open" });
    const staffView = await getVerdictPageData(f.competitionId, asViewer(f, "reviewer"));
    expect(staffView?.appeals[0]?.text).toBe(TEXT);
    expect(staffView?.status).toBe("under_appeal");
  });

  it("withholds quotes from submissions moderators removed, without touching scores", async () => {
    const f = await createJudgedCompetition(t.db);
    await t.db.insert(submissions).values({
      competitionId: f.competitionId,
      authorId: f.againstUser.user.id,
      side: "AGAINST",
      round: "opening",
      body: "Honestly everyone knows it, you clown.",
      status: "removed",
    });
    const data = await getVerdictPageData(f.competitionId, null);
    const evidence = data?.current?.explanation?.perCriterion.find((c) => c.key === "evidence");
    expect(evidence?.B.quotes).toEqual([]);
    expect(evidence?.A.quotes).toEqual(["eight Ballon d'Ors"]);
    expect(data?.current?.hiddenQuoteCount).toBe(1);
    expect(data?.current?.scores?.totals).toEqual({ A: 74.5, B: 61.5 });
  });

  it("keeps every version in history after an overturn", async () => {
    const f = await createJudgedCompetition(t.db);
    const { appealId } = await fileAppeal(f.againstUser.user, {
      competitionId: f.competitionId,
      ground: "factual_error",
      text: TEXT,
    });
    await decideAppeal(f.reviewer.user, { appealId, decision: "overturn", outcome: "B", note: "Misread key stat." });
    const data = await getVerdictPageData(f.competitionId, null);
    expect(data?.history.map((v) => v.version)).toEqual([2, 1]);
    expect(data?.current).toMatchObject({ decidedBy: "human", confidenceLabel: null, reviewNote: "Misread key stat." });
    expect(data?.current?.outcomeView.headline).toBe("Bayo Eze wins");
  });

  it("returns null for unknown debates", async () => {
    expect(await getVerdictPageData("00000000-0000-4000-8000-000000000000", null)).toBeNull();
  });
});

describe("summary + admin queues", () => {
  it("summarises a debate still being judged without inventing a verdict", async () => {
    const f = await createJudgedCompetition(t.db, { status: "evaluating", outcome: null });
    const summary = await getVerdictSummaryData(f.competitionId);
    expect(summary).toMatchObject({ status: "evaluating", verdict: null });
  });

  it("lists open appeals with blind submissions and flags a used re-evaluation", async () => {
    const f = await createJudgedCompetition(t.db);
    await addSubmissions(t.db, f);
    await fileAppeal(f.forUser.user, { competitionId: f.competitionId, ground: "technical_failure", text: TEXT });
    const queue = await getAppealQueue();
    expect(queue.open).toHaveLength(1);
    expect(queue.open[0]).toMatchObject({ reevaluationUsed: false, appeal: { appellantSide: "A", text: TEXT } });
    expect(queue.open[0]?.submissions.A.map((s) => s.round)).toEqual(["opening", "rebuttal"]);
  });

  it("lists needs-review debates with their passes side by side", async () => {
    const f = await createJudgedCompetition(t.db, { status: "needs_review", outcome: "inconclusive" });
    const queue = await getReviewQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ canRetry: false, current: { outcome: "inconclusive" } });

    const g = await createJudgedCompetition(t.db, { status: "needs_review", outcome: null });
    await addFailedRun(t.db, g.competitionId);
    const [run] = (await getReviewQueue()).filter((i) => i.header.competitionId === g.competitionId);
    expect(run?.canRetry).toBe(true);
    expect(run?.runs[0]?.status).toBe("failed");

    // Passes stored in the judge's { raw, labels, pass } shape are read in canonical labels.
    const runId = queue[0]?.runs[0]?.id ?? "";
    await t.db.insert(evaluationPasses).values({
      competitionId: f.competitionId,
      evaluationRunId: runId,
      passNo: 1,
      order: "BA",
      provider: "mock",
      model: "mock-judge-v1",
      promptVersion: "p1",
      rubricId: "sports",
      rubricVersion: 1,
      caseHash: "hash",
      output: {
        raw: {},
        labels: { X: "B", Y: "A" },
        pass: { winner: "A", sides: { A: { criteria: { evidence: { score: 7 } } }, B: { criteria: { evidence: { score: 5 } } } } },
      },
      confidence: 0.55,
    });
    const refreshed = (await getReviewQueue()).find((i) => i.header.competitionId === f.competitionId);
    expect(refreshed?.runs[0]?.passes[0]?.parsed).toMatchObject({ winner: "A", criteria: [{ key: "evidence", A: 7, B: 5 }] });
  });

  it("renders every current rubric for /rules with the categories that use it", async () => {
    const rubrics = await listRubricsForRules();
    expect(rubrics.map((r) => r.id)).toEqual(["sports", "subjective", "analytical", "technology", "factual"]);
    for (const r of rubrics) {
      expect(r.criteria.reduce((sum, c) => sum + c.weight, 0)).toBe(100);
      expect(r.categoryNames.length).toBeGreaterThan(0);
    }
  });
});
