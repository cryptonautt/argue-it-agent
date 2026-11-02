import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJudgedCompetition, type AppealFixture } from "@domain/appeals/test-fixtures";
import type { SessionUser } from "@domain/auth";
import { evaluationPasses, verdicts } from "@domain/db/schema";
import { HOUR_MS, resetClock, setClock } from "@domain/lib/time";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestUser, type TestUser } from "@domain/test-helpers/factories";
import { judgedByLine } from "./rules";
import { getVerdictExplanation, prepareAppealDraft, prepareArgumentDraft } from "./service";

const t = setupTestDb();
const VERDICT_AT = new Date("2026-10-05T10:00:00Z");
const STATEMENT = "My rebuttal answered the assists point directly, but the verdict says I ignored it.";

beforeEach(() => setClock(new Date(VERDICT_AT.getTime() + 2 * HOUR_MS)));
afterEach(() => resetClock());

function session(u: TestUser): SessionUser {
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

/** A canonical-label stored pass ({ raw, labels, pass }) the way the judge writes it. */
function storedPass(scores: Record<string, [number, number]>, winner: "A" | "B" | "draw", confidence: number) {
  const side = (i: 0 | 1) =>
    Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, { score: v[i], reason: `r${i}`, quotes: [] }]));
  return {
    // `raw` is in presentation labels; a BA pass has them swapped. The service must never read it.
    raw: { sides: { A: { criteria: side(1) }, B: { criteria: side(0) } } },
    labels: { first: "A" },
    pass: { sides: { A: { criteria: side(0) }, B: { criteria: side(1) } }, winner, confidence, margin: 10, rationale: "x" },
  };
}

async function addPasses(f: AppealFixture, model = "claude-test-model") {
  const [v] = await t.db.select({ runId: verdicts.runId }).from(verdicts).where(eq(verdicts.id, f.verdictId));
  const runId = v?.runId;
  if (!runId) throw new Error("fixture verdict has no run");
  const base = {
    competitionId: f.competitionId,
    evaluationRunId: runId,
    provider: "engine",
    model,
    promptVersion: "judge-v1",
    rubricId: "sports",
    rubricVersion: 1,
    caseHash: "hash",
  };
  await t.db.insert(evaluationPasses).values([
    { ...base, passNo: 1, order: "AB", output: storedPass({ evidence: [8, 6], rebuttal: [7, 4] }, "A", 0.8), confidence: 0.8 },
    { ...base, passNo: 2, order: "BA", output: storedPass({ evidence: [6, 5], rebuttal: [6, 5] }, "A", 0.7), confidence: 0.7 },
  ]);
}

describe("getVerdictExplanation", () => {
  it("explanation averages criterion scores across passes and labels the decision rule", async () => {
    const f = await createJudgedCompetition(t.db, { verdictAt: VERDICT_AT });
    await addPasses(f);

    const view = await getVerdictExplanation(session(f.againstUser), f.competitionId);

    const evidence = view.criteria.find((c) => c.key === "evidence");
    expect(evidence).toMatchObject({ weight: 30, passCount: 2, A: { score: 7 }, B: { score: 5.5 }, gap: 1.5 });
    expect(evidence?.A.quotes).toEqual(["eight Ballon d'Ors"]);
    expect(evidence?.B.quotes).toEqual(["everyone knows it"]);
    const rebuttal = view.criteria.find((c) => c.key === "rebuttal");
    expect(rebuttal).toMatchObject({ A: { score: 6.5 }, B: { score: 4.5 } });
    // A criterion no pass scored falls back to the verdict's stored score.
    expect(view.criteria.find((c) => c.key === "clarity")).toMatchObject({ passCount: 0, A: { score: 8 }, B: { score: 7 } });

    expect(view.passes).toEqual([
      { passNo: 1, order: "AB", winner: "A", confidence: 0.8, model: "claude-test-model" },
      { passNo: 2, order: "BA", winner: "A", confidence: 0.7, model: "claude-test-model" },
    ]);
    expect(view.rule.kind).toBe("agreed");
    expect(view.rule.label).toContain("60%");
    expect(view.winnerSide).toBe("A");
    expect(view.viewer).toEqual({ side: "B", isStaff: false });
    expect(view.rubric.criteria.map((c) => c.key)).toContain("rebuttal");
    expect(view.appeal).toMatchObject({ eligible: true, alreadyFiled: false, message: null });
    expect(view.appeal.grounds).toHaveLength(5);
    expect(view.appeal.deadline).toBe(new Date(VERDICT_AT.getTime() + 48 * HOUR_MS).toISOString());
  });

  it("labels draw, inconclusive and human decisions with their own rule", async () => {
    const draw = await createJudgedCompetition(t.db, { outcome: "draw" });
    expect((await getVerdictExplanation(session(draw.forUser), draw.competitionId)).rule.kind).toBe("draw");
    const inc = await createJudgedCompetition(t.db, { outcome: "inconclusive", status: "needs_review" });
    expect((await getVerdictExplanation(session(inc.forUser), inc.competitionId)).rule.kind).toBe("inconclusive");
    const human = await createJudgedCompetition(t.db);
    await t.db.update(verdicts).set({ decidedBy: "human", reviewNote: "Reviewer reason." }).where(eq(verdicts.id, human.verdictId));
    expect((await getVerdictExplanation(session(human.forUser), human.competitionId)).rule.kind).toBe("human");
  });

  it("explanation for a non-participant on a hidden verdict throws NOT_FOUND", async () => {
    const f = await createJudgedCompetition(t.db, { outcome: "inconclusive", status: "needs_review" });
    const stranger = await createTestUser(t.db);
    await expect(getVerdictExplanation(session(stranger), f.competitionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getVerdictExplanation(null, f.competitionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Debaters and staff still get it.
    await expect(getVerdictExplanation(session(f.forUser), f.competitionId)).resolves.toMatchObject({ outcome: "inconclusive" });
    await expect(getVerdictExplanation(session(f.reviewer), f.competitionId)).resolves.toMatchObject({ outcome: "inconclusive" });
  });

  it("throws NOT_FOUND when there is no verdict, or no such debate", async () => {
    const f = await createJudgedCompetition(t.db, { outcome: null, status: "evaluating" });
    await expect(getVerdictExplanation(session(f.forUser), f.competitionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getVerdictExplanation(null, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("verdict view shows the recorded pass model", async () => {
    const f = await createJudgedCompetition(t.db);
    await addPasses(f, "claude-sonnet-recorded");
    const view = await getVerdictExplanation(null, f.competitionId);
    expect(view.judgedBy).toBe("Judged by claude-sonnet-recorded · 2 passes");
    expect(judgedByLine([])).toBeNull();
    expect(judgedByLine([{ model: "m1" }])).toBe("Judged by m1 · 1 pass");
  });
});

describe("prepareAppealDraft (prefill-appeal)", () => {
  it("returns the draft for an eligible debater", async () => {
    const f = await createJudgedCompetition(t.db, { verdictAt: VERDICT_AT });
    const draft = await prepareAppealDraft(session(f.againstUser), {
      competitionId: f.competitionId,
      ground: "evidence_overlooked",
      statement: STATEMENT,
    });
    expect(draft).toMatchObject({ competitionId: f.competitionId, ground: "evidence_overlooked", statement: STATEMENT });
  });

  it("prefill-appeal throws CONFLICT after the 48h window", async () => {
    const f = await createJudgedCompetition(t.db, { verdictAt: VERDICT_AT });
    setClock(new Date(VERDICT_AT.getTime() + 49 * HOUR_MS));
    await expect(
      prepareAppealDraft(session(f.againstUser), { competitionId: f.competitionId, ground: "factual_error", statement: STATEMENT }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("prefill-appeal rejects a ground outside the five allowed", async () => {
    const f = await createJudgedCompetition(t.db, { verdictAt: VERDICT_AT });
    await expect(
      prepareAppealDraft(session(f.againstUser), {
        competitionId: f.competitionId,
        ground: "just_disagree" as never,
        statement: STATEMENT,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { ground: expect.any(Array) } });
  });

  it("rejects a non-participant with CONFLICT and a statement over 1000 characters with VALIDATION", async () => {
    const f = await createJudgedCompetition(t.db, { verdictAt: VERDICT_AT });
    const stranger = await createTestUser(t.db);
    await expect(
      prepareAppealDraft(session(stranger), { competitionId: f.competitionId, ground: "factual_error", statement: STATEMENT }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      prepareAppealDraft(session(f.againstUser), {
        competitionId: f.competitionId,
        ground: "factual_error",
        statement: "x".repeat(1001),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("prepareArgumentDraft (prefill-argument)", () => {
  it("returns a draft with the category's name and rubric", async () => {
    const draft = await prepareArgumentDraft({
      title: "Osimhen is a better striker than Lookman",
      proposition: "Victor Osimhen is a better striker than Ademola Lookman.",
      body: "Osimhen scores more often and leads the line better.",
      categorySlug: "sports",
    });
    expect(draft).toMatchObject({ categorySlug: "sports", rubricId: expect.any(String), categoryName: expect.any(String) });
  });

  it("rejects an unknown category with NOT_FOUND", async () => {
    await expect(
      prepareArgumentDraft({ title: "A fine title", body: "A body that is long enough.", categorySlug: "nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
