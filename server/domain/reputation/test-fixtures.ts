/**
 * Test-only fixtures for reputation tests: a finished competition between two users plus verdict rows.
 * Inserts directly (no lifecycle) so reputation logic is tested in isolation.
 */
import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@domain/db";
import type { VerdictScores } from "@domain/db/json-types";
import {
  competitionParticipants,
  competitions,
  verdicts,
  type CompetitionStatus,
  type VerdictOutcome,
} from "@domain/db/schema";
import { createTestArgument, getCategory } from "@domain/test-helpers/factories";

export interface FixtureCompetition {
  id: string;
  categoryId: string;
  forUserId: string;
  againstUserId: string;
}

export async function createFinishedCompetition(
  db: DbOrTx,
  opts: { forUserId: string; againstUserId: string; categorySlug?: string; status?: CompetitionStatus; completedAt?: Date },
): Promise<FixtureCompetition> {
  const category = await getCategory(db, opts.categorySlug ?? "sports");
  const argument = await createTestArgument(db, opts.forUserId, { categorySlug: category.slug });
  const sentAt = new Date("2026-10-01T10:00:00Z");
  const [competition] = await db
    .insert(competitions)
    .values({
      rootArgumentId: argument.id,
      creatorId: opts.forUserId,
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
        challengerId: opts.forUserId,
        recipientId: opts.againstUserId,
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
      completedAt: opts.completedAt ?? new Date("2026-10-05T10:00:00Z"),
    })
    .returning({ id: competitions.id });
  if (!competition) throw new Error("fixture: competition insert failed");
  await db.insert(competitionParticipants).values([
    { competitionId: competition.id, userId: opts.forUserId, side: "FOR", role: "challenger", acceptanceStatus: "accepted" },
    { competitionId: competition.id, userId: opts.againstUserId, side: "AGAINST", role: "recipient", acceptanceStatus: "accepted" },
  ]);
  return { id: competition.id, categoryId: category.id, forUserId: opts.forUserId, againstUserId: opts.againstUserId };
}

export function sampleScores(a: Record<string, number>, b: Record<string, number>): VerdictScores {
  const labels: Record<string, string> = {
    evidence: "Evidence",
    reasoning: "Reasoning",
    rebuttal: "Rebuttal",
    clarity: "Clarity",
    consistency: "Consistency",
  };
  const weights: Record<string, number> = { evidence: 30, reasoning: 25, rebuttal: 20, clarity: 15, consistency: 10 };
  const keys = Object.keys(a);
  const criteria = keys.map((key) => ({
    key,
    label: labels[key] ?? key,
    weight: weights[key] ?? 10,
    A: a[key] ?? 0,
    B: b[key] ?? 0,
  }));
  const total = (side: "A" | "B") => criteria.reduce((sum, c) => sum + (c[side] * c.weight) / 10, 0);
  return { rubric: { id: "sports", version: 1 }, criteria, totals: { A: total("A"), B: total("B") }, maxTotal: 100 };
}

/**
 * Insert a new current verdict (marking any previous current verdict as history), like the judge or an
 * appeal decision would.
 */
export async function setVerdict(
  db: DbOrTx,
  competition: FixtureCompetition,
  outcome: VerdictOutcome,
  opts: { winnerUserId?: string | null; scores?: VerdictScores | null } = {},
): Promise<string> {
  const existing = await db
    .select({ id: verdicts.id, version: verdicts.version })
    .from(verdicts)
    .where(eq(verdicts.competitionId, competition.id));
  await db
    .update(verdicts)
    .set({ isCurrent: false })
    .where(and(eq(verdicts.competitionId, competition.id), eq(verdicts.isCurrent, true)));
  const defaultWinner =
    outcome === "A" ? competition.forUserId : outcome === "B" ? competition.againstUserId : null;
  const [row] = await db
    .insert(verdicts)
    .values({
      competitionId: competition.id,
      version: existing.reduce((max, v) => Math.max(max, v.version), 0) + 1,
      outcome,
      winnerUserId: opts.winnerUserId === undefined ? defaultWinner : opts.winnerUserId,
      scores: opts.scores ?? null,
      confidence: outcome === "forfeit" ? null : 0.8,
      isCurrent: true,
    })
    .returning({ id: verdicts.id });
  if (!row) throw new Error("fixture: verdict insert failed");
  return row.id;
}
