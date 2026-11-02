/**
 * Cross-team contract test: appeals against the REAL judge (offline mock provider) and the REAL
 * reputation module. Proves that "order re-evaluation" runs one fresh dual-order evaluation that replaces
 * the verdict (old one kept), and that every outcome change re-applies ratings from scratch.
 */
import { and, asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS, resetClock, setClock } from "@domain/lib/time";
import { appeals, competitions, evaluationPasses, reputationEvents, verdicts } from "@domain/db/schema";
import { processEvaluationJobs } from "@domain/judging";
import { applyCompetitionResult } from "@domain/reputation";
import { setupTestDb } from "@domain/test-helpers/db";
import { decideAppeal, fileAppeal } from "./service";
import { addSubmissions, createJudgedCompetition } from "./test-fixtures";

const t = setupTestDb();
const VERDICT_AT = new Date("2026-10-05T10:00:00Z");
const TEXT = "The verdict ignored that my rebuttal answered the assists point with specific league titles.";

beforeAll(() => {
  vi.stubEnv("JUDGE_PROVIDER", "mock");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => setClock(new Date(VERDICT_AT.getTime() + 2 * HOUR_MS)));
afterEach(() => resetClock());

async function liveEvents(competitionId: string) {
  return t.db
    .select()
    .from(reputationEvents)
    .where(and(eq(reputationEvents.competitionId, competitionId)))
    .orderBy(asc(reputationEvents.createdAt));
}

describe("appeals with the real judge and reputation", () => {
  it("re-evaluation runs a fresh dual-order evaluation, keeps the old verdict and re-applies ratings", async () => {
    const f = await createJudgedCompetition(t.db);
    await addSubmissions(t.db, f);
    await applyCompetitionResult(f.competitionId);
    const before = await liveEvents(f.competitionId);
    expect(before.length).toBeGreaterThan(0);

    const { appealId } = await fileAppeal(f.againstUser.user, {
      competitionId: f.competitionId,
      ground: "evidence_overlooked",
      text: TEXT,
    });
    await decideAppeal(f.reviewer.user, { appealId, decision: "reevaluate", note: "The rebuttal may have been missed." });

    const [queued] = await t.db.select({ status: competitions.status }).from(competitions).where(eq(competitions.id, f.competitionId));
    expect(queued?.status).toBe("evaluating");

    const processed = await processEvaluationJobs(5);
    expect(processed).toBeGreaterThanOrEqual(1);

    const rows = await t.db.select().from(verdicts).where(eq(verdicts.competitionId, f.competitionId));
    const current = rows.filter((v) => v.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0]?.version).toBe(2);
    expect(current[0]?.decidedBy).toBe("ai");
    expect(rows.find((v) => v.id === f.verdictId)?.isCurrent).toBe(false);

    const passes = await t.db.select().from(evaluationPasses).where(eq(evaluationPasses.competitionId, f.competitionId));
    expect(passes.map((p) => p.order)).toEqual(expect.arrayContaining(["AB", "BA"]));

    const [comp] = await t.db.select({ status: competitions.status }).from(competitions).where(eq(competitions.id, f.competitionId));
    expect(["completed", "needs_review"]).toContain(comp?.status);
    const [appeal] = await t.db.select().from(appeals).where(eq(appeals.id, appealId));
    expect(appeal?.status).toBe("reevaluated");

    // Ratings were recomputed against the new verdict: the original events were reversed.
    const after = await liveEvents(f.competitionId);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.some((e) => e.kind === "reversal")).toBe(true);
  });

  it("overturn reverses the old rating events and applies the human outcome", async () => {
    const f = await createJudgedCompetition(t.db);
    await applyCompetitionResult(f.competitionId);
    const { appealId } = await fileAppeal(f.againstUser.user, {
      competitionId: f.competitionId,
      ground: "factual_error",
      text: TEXT,
    });
    const result = await decideAppeal(f.reviewer.user, {
      appealId,
      decision: "overturn",
      outcome: "B",
      note: "The verdict misread Side B's key statistic.",
    });
    expect(result.ratingsUpdated).toBe(true);

    const events = await liveEvents(f.competitionId);
    const reversals = events.filter((e) => e.kind === "reversal");
    expect(reversals.length).toBeGreaterThan(0);
    const latestAgainst = events.filter((e) => e.kind === "result" && e.userId === f.againstUser.user.id && e.verdictId === result.verdictId);
    expect(latestAgainst.length).toBeGreaterThan(0);
    expect(latestAgainst.every((e) => e.score === 1)).toBe(true);
  });
});
