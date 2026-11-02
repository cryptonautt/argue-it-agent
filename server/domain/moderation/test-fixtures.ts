/**
 * Owner: moderation. Test-only fixtures (competitions, submissions, verdicts, judge passes) inserted
 * directly so moderation tests don't depend on other teams' in-progress code.
 */
import { addHours, now } from "@domain/lib/time";
import type { DbOrTx } from "@domain/db";
import type { RulesSnapshot } from "@domain/db/json-types";
import {
  competitionParticipants,
  competitions,
  evaluationJobs,
  evaluationPasses,
  evaluationRuns,
  submissions,
  verdicts,
  type Argument,
  type CompetitionRound,
  type CompetitionStatus,
} from "@domain/db/schema";

export async function createTestCompetition(
  db: DbOrTx,
  argument: Argument,
  challengerId: string,
  recipientId: string,
  overrides: { status?: CompetitionStatus; round?: CompetitionRound | null } = {},
) {
  const sentAt = now();
  const snapshot: RulesSnapshot = {
    snapshotVersion: 1,
    format: "direct_v1",
    proposition: argument.proposition,
    argumentId: argument.id,
    sourceCommentId: null,
    category: { id: argument.categoryId, slug: "sports", name: "Sports" },
    rubric: { id: "sports", version: 1 },
    challengerId,
    recipientId,
    challengerSide: "FOR",
    recipientSide: "AGAINST",
    roundDurationHours: 24,
    acceptWindowHours: 48,
    limits: { openingMaxChars: 4000, rebuttalMaxChars: 2500, maxLinksPerSubmission: 5 },
    rulesText: { noShow: "", late: "", cancellation: "", appeal: "" },
    sentAt: sentAt.toISOString(),
  };
  const status = overrides.status ?? "active";
  const [competition] = await db
    .insert(competitions)
    .values({
      rootArgumentId: argument.id,
      creatorId: challengerId,
      categoryId: argument.categoryId,
      status,
      round: overrides.round === undefined ? (status === "active" ? "opening" : null) : overrides.round,
      rulesSnapshot: snapshot,
      termsHash: "test-hash",
      rubricId: "sports",
      rubricVersion: 1,
      sentAt,
      acceptDeadline: addHours(sentAt, 48),
      acceptedAt: sentAt,
      openingClosesAt: addHours(sentAt, 24),
      rebuttalClosesAt: addHours(sentAt, 48),
    })
    .returning();
  if (!competition) throw new Error("createTestCompetition failed");
  await db.insert(competitionParticipants).values([
    { competitionId: competition.id, userId: challengerId, side: "FOR", role: "challenger", acceptanceStatus: "accepted" },
    { competitionId: competition.id, userId: recipientId, side: "AGAINST", role: "recipient", acceptanceStatus: "accepted" },
  ]);
  return competition;
}

export async function createTestSubmission(
  db: DbOrTx,
  competitionId: string,
  authorId: string,
  side: "FOR" | "AGAINST",
  body = "My opening argument with plenty of reasoning.",
) {
  const [row] = await db
    .insert(submissions)
    .values({ competitionId, authorId, side, round: "opening", body, lockedAt: now() })
    .returning();
  if (!row) throw new Error("createTestSubmission failed");
  return row;
}

export async function createTestVerdict(db: DbOrTx, competitionId: string, winnerUserId: string | null, outcome: "A" | "B" | "draw" | "inconclusive" = "A") {
  const [row] = await db
    .insert(verdicts)
    .values({
      competitionId,
      outcome,
      winnerUserId,
      confidence: 0.8,
      scores: {
        rubric: { id: "sports", version: 1 },
        criteria: [{ key: "evidence", label: "Evidence", weight: 100, A: 8, B: 5 }],
        totals: { A: 80, B: 50 },
        maxTotal: 100,
      },
    })
    .returning();
  if (!row) throw new Error("createTestVerdict failed");
  return row;
}

/** One evaluation run with `passCount` passes (passes 3+4 = the first pair disagreed). */
export async function createTestRun(db: DbOrTx, competitionId: string, passCount: 2 | 3, model = "claude-opus-5-5") {
  const [job] = await db
    .insert(evaluationJobs)
    .values({ competitionId, reason: "close", status: "done", attempts: 1, finishedAt: now() })
    .returning();
  const [run] = await db
    .insert(evaluationRuns)
    .values({
      competitionId,
      jobId: job?.id,
      reason: "close",
      status: "succeeded",
      rubricId: "sports",
      rubricVersion: 1,
      caseHash: "hash",
      finishedAt: now(),
    })
    .returning();
  if (!run) throw new Error("createTestRun failed");
  for (let passNo = 1; passNo <= passCount; passNo++) {
    await db.insert(evaluationPasses).values({
      competitionId,
      evaluationRunId: run.id,
      passNo,
      order: passNo === 2 ? "BA" : "AB",
      provider: "anthropic",
      model,
      promptVersion: "v1",
      rubricId: "sports",
      rubricVersion: 1,
      caseHash: "hash",
      output: {},
      confidence: 0.5 + passNo / 10,
      usage: { inputTokens: 1000, outputTokens: 200 },
      latencyMs: 1000 * passNo,
      finishedAt: now(),
    });
  }
  return run;
}
