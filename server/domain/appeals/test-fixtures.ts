/**
 * Owner: verdict. Test-only fixtures: a judged competition between two users, with verdict rows and
 * (optionally) an evaluation run. Inserts directly so appeal logic is tested in isolation from the
 * lifecycle and the judge.
 */
import type { DbOrTx } from "@domain/db";
import type { VerdictExplanation, VerdictScores } from "@domain/db/json-types";
import {
  competitionParticipants,
  competitions,
  evaluationRuns,
  submissions,
  verdicts,
  type CompetitionStatus,
  type VerdictOutcome,
} from "@domain/db/schema";
import { createTestArgument, createTestUser, getCategory, type TestUser } from "@domain/test-helpers/factories";

export interface AppealFixture {
  competitionId: string;
  forUser: TestUser;
  againstUser: TestUser;
  reviewer: TestUser;
  verdictId: string;
}

export const SAMPLE_SCORES: VerdictScores = {
  rubric: { id: "sports", version: 1 },
  criteria: [
    { key: "evidence", label: "Evidence & accuracy", weight: 30, A: 8, B: 6 },
    { key: "reasoning", label: "Reasoning", weight: 25, A: 7, B: 6 },
    { key: "rebuttal", label: "Rebuttal", weight: 20, A: 7, B: 5 },
    { key: "clarity", label: "Clarity", weight: 15, A: 8, B: 7 },
    { key: "consistency", label: "Consistency", weight: 10, A: 7, B: 7 },
  ],
  totals: { A: 74.5, B: 61.5 },
  maxTotal: 100,
};

export function sampleExplanation(overrides: Partial<VerdictExplanation> = {}): VerdictExplanation {
  return {
    summary: "Side A backed its claims with specific records; Side B relied on assertion.",
    perCriterion: [
      {
        key: "evidence",
        A: { reason: "Specific trophies and stats.", quotes: ["eight Ballon d'Ors"] },
        B: { reason: "Mostly assertion.", quotes: ["everyone knows it"] },
      },
    ],
    strengths: { A: ["Specific evidence"], B: ["Clear writing"] },
    weaknesses: { A: ["Thin rebuttal"], B: ["Few facts"] },
    flaggedClaims: [{ side: "B", claim: "He never scored in a final", classification: "likely_false" }],
    confidenceLabel: "high",
    method: {
      blind: true,
      passCount: 2,
      orders: ["AB", "BA"],
      model: "claude-opus-5-5",
      promptVersion: "judge-v1",
      rubric: { id: "sports", version: 1 },
    },
    injectionDetected: false,
    ...overrides,
  };
}

export async function createJudgedCompetition(
  db: DbOrTx,
  opts: {
    status?: CompetitionStatus;
    outcome?: VerdictOutcome | null;
    verdictAt?: Date;
    reviewerRole?: "moderator" | "admin";
  } = {},
): Promise<AppealFixture> {
  const forUser = await createTestUser(db, { displayName: "Ada Obi" });
  const againstUser = await createTestUser(db, { displayName: "Bayo Eze" });
  const reviewer = await createTestUser(db, { displayName: "Rita Reviewer", role: opts.reviewerRole ?? "moderator" });
  const category = await getCategory(db, "sports");
  const argument = await createTestArgument(db, forUser.user.id);
  const sentAt = new Date("2026-10-01T10:00:00Z");
  const [competition] = await db
    .insert(competitions)
    .values({
      rootArgumentId: argument.id,
      creatorId: forUser.user.id,
      categoryId: category.id,
      status: opts.status ?? "completed",
      rulesSnapshot: {
        snapshotVersion: 1,
        format: "direct_v1",
        proposition: argument.proposition,
        argumentId: argument.id,
        sourceCommentId: null,
        category: { id: category.id, slug: category.slug, name: category.name },
        rubric: { id: category.rubricId, version: 1 },
        challengerId: forUser.user.id,
        recipientId: againstUser.user.id,
        challengerSide: "FOR",
        recipientSide: "AGAINST",
        roundDurationHours: 24,
        acceptWindowHours: 48,
        limits: { openingMaxChars: 4000, rebuttalMaxChars: 2500, maxLinksPerSubmission: 5 },
        rulesText: { noShow: "", late: "", cancellation: "", appeal: "" },
        sentAt: sentAt.toISOString(),
      },
      termsHash: "test-hash",
      rubricId: category.rubricId,
      rubricVersion: 1,
      sentAt,
      acceptDeadline: new Date("2026-10-03T10:00:00Z"),
      completedAt: opts.status && opts.status !== "completed" ? null : new Date("2026-10-05T10:00:00Z"),
    })
    .returning({ id: competitions.id });
  if (!competition) throw new Error("fixture: competition insert failed");
  await db.insert(competitionParticipants).values([
    {
      competitionId: competition.id,
      userId: forUser.user.id,
      side: "FOR",
      role: "challenger",
      acceptanceStatus: "accepted",
    },
    {
      competitionId: competition.id,
      userId: againstUser.user.id,
      side: "AGAINST",
      role: "recipient",
      acceptanceStatus: "accepted",
    },
  ]);

  let verdictId = "";
  const outcome = opts.outcome === undefined ? "A" : opts.outcome;
  if (outcome !== null) {
    const [run] = await db
      .insert(evaluationRuns)
      .values({
        competitionId: competition.id,
        reason: "close",
        status: outcome === "inconclusive" ? "needs_review" : "succeeded",
        rubricId: "sports",
        rubricVersion: 1,
        caseHash: "hash",
      })
      .returning({ id: evaluationRuns.id });
    const winnerUserId =
      outcome === "A" || outcome === "forfeit" ? forUser.user.id : outcome === "B" ? againstUser.user.id : null;
    const [verdict] = await db
      .insert(verdicts)
      .values({
        competitionId: competition.id,
        runId: outcome === "forfeit" ? null : (run?.id ?? null),
        version: 1,
        outcome,
        winnerUserId,
        scores: outcome === "forfeit" ? null : SAMPLE_SCORES,
        explanation: outcome === "forfeit" ? null : sampleExplanation(),
        confidence: outcome === "forfeit" ? null : 0.85,
        isCurrent: true,
        decidedBy: "ai",
        createdAt: opts.verdictAt ?? new Date("2026-10-05T10:00:00Z"),
      })
      .returning({ id: verdicts.id });
    verdictId = verdict?.id ?? "";
  }

  return { competitionId: competition.id, forUser, againstUser, reviewer, verdictId };
}

export async function addFailedRun(db: DbOrTx, competitionId: string): Promise<void> {
  await db.insert(evaluationRuns).values({
    competitionId,
    reason: "close",
    status: "failed",
    rubricId: "sports",
    rubricVersion: 1,
    caseHash: "hash",
    error: "provider_error: overloaded",
  });
}

/** Locked openings + rebuttals for both sides, so the real judge can build a case file. */
export async function addSubmissions(db: DbOrTx, f: AppealFixture): Promise<void> {
  const lockedAt = new Date("2026-10-04T10:00:00Z");
  await db.insert(submissions).values([
    {
      competitionId: f.competitionId,
      authorId: f.forUser.user.id,
      side: "FOR",
      round: "opening",
      body:
        "Messi has won eight Ballon d'Ors, more than any player in history. He won the 2022 World Cup and was " +
        "named player of the tournament, which shows he delivers on the biggest stage.",
      lockedAt,
    },
    {
      competitionId: f.competitionId,
      authorId: f.againstUser.user.id,
      side: "AGAINST",
      round: "opening",
      body:
        "Ronaldo has scored over 850 official goals and won the Champions League five times with two different " +
        "clubs, because he adapts to any league. That proves greater longevity.",
      lockedAt,
    },
    {
      competitionId: f.competitionId,
      authorId: f.forUser.user.id,
      side: "FOR",
      round: "rebuttal",
      body: "Goals alone ignore assists: Messi has far more assists, so his total contribution is higher.",
      lockedAt,
    },
    {
      competitionId: f.competitionId,
      authorId: f.againstUser.user.id,
      side: "AGAINST",
      round: "rebuttal",
      body: "Ballon d'Ors are votes, not proof. Ronaldo won in England, Spain and Italy, which shows range.",
      lockedAt,
    },
  ]);
}
