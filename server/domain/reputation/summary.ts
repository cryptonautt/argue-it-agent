import "server-only";

import { and, asc, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, type DbOrTx } from "@domain/db";
import {
  categories,
  competitionParticipants,
  competitions,
  userRatings,
  verdicts,
  type CompetitionStatus,
} from "@domain/db/schema";
import { averageCriterionScores, toAverageRecord, type CriterionAverage } from "./criteria";
import { RATING_DEFAULTS, isProvisional, type CategoryRatingLine, type RatingLine, type UserRatingSummary } from "./types";

/** Competitions whose result counts on a profile (an appeal does not suspend the standing verdict). */
export const FINISHED_STATUSES = ["completed", "under_appeal"] as const satisfies readonly CompetitionStatus[];

/** Upper bound on debates scanned for criterion averages (most recent first). */
const CRITERION_SAMPLE_LIMIT = 200;

function toLine(row: { rating: number; rd: number; wins: number; losses: number; draws: number }): RatingLine {
  return {
    rating: row.rating,
    rd: row.rd,
    provisional: isProvisional(row.rd),
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
  };
}

const DEFAULT_LINE: RatingLine = toLine({ rating: RATING_DEFAULTS.rating, rd: RATING_DEFAULTS.rd, wins: 0, losses: 0, draws: 0 });

/**
 * Per-criterion averages over the user's judged debates (judged = AI or human verdict with scores and a
 * winner/draw; forfeits and inconclusive results have no meaningful scores to average).
 */
export async function getCriterionAverages(userId: string, conn: DbOrTx = db): Promise<CriterionAverage[]> {
  const rows = await conn
    .select({ side: competitionParticipants.side, scores: verdicts.scores })
    .from(competitionParticipants)
    .innerJoin(competitions, eq(competitions.id, competitionParticipants.competitionId))
    .innerJoin(
      verdicts,
      and(eq(verdicts.competitionId, competitions.id), eq(verdicts.isCurrent, true)),
    )
    .where(
      and(
        eq(competitionParticipants.userId, userId),
        inArray(competitions.status, FINISHED_STATUSES),
        inArray(verdicts.outcome, ["A", "B", "draw"]),
        isNotNull(verdicts.scores),
      ),
    )
    .orderBy(desc(competitions.completedAt))
    .limit(CRITERION_SAMPLE_LIMIT);

  return averageCriterionScores(
    rows.flatMap((r) => (r.scores ? [{ side: r.side === "FOR" ? ("A" as const) : ("B" as const), scores: r.scores }] : [])),
  );
}

/** Rating summary for profiles. Users without games get the defaults (provisional). */
export async function getUserRatingSummary(userId: string, conn: DbOrTx = db): Promise<UserRatingSummary> {
  return (await getDebateRecord(userId, conn)).summary;
}

/** The summary plus labelled criterion averages (what the profile page renders), in one round of queries. */
export async function getDebateRecord(
  userId: string,
  conn: DbOrTx = db,
): Promise<{ summary: UserRatingSummary; criteria: CriterionAverage[] }> {
  const [ratingRows, averages, [finished]] = await Promise.all([
    conn
      .select({
        categoryId: userRatings.categoryId,
        rating: userRatings.rating,
        rd: userRatings.rd,
        wins: userRatings.wins,
        losses: userRatings.losses,
        draws: userRatings.draws,
        slug: categories.slug,
        name: categories.name,
      })
      .from(userRatings)
      .leftJoin(categories, eq(categories.id, userRatings.categoryId))
      .where(eq(userRatings.userId, userId))
      .orderBy(asc(categories.sort)),
    getCriterionAverages(userId, conn),
    conn
      .select({ n: count() })
      .from(competitionParticipants)
      .innerJoin(competitions, eq(competitions.id, competitionParticipants.competitionId))
      .where(and(eq(competitionParticipants.userId, userId), inArray(competitions.status, FINISHED_STATUSES))),
  ]);

  const overallRow = ratingRows.find((r) => r.categoryId === null);
  const categoryLines: CategoryRatingLine[] = ratingRows.flatMap((r) =>
    r.categoryId !== null && r.slug !== null && r.name !== null && r.wins + r.losses + r.draws > 0
      ? [{ ...toLine(r), categoryId: r.categoryId, slug: r.slug, name: r.name }]
      : [],
  );

  return {
    summary: {
      userId,
      overall: overallRow ? toLine(overallRow) : DEFAULT_LINE,
      categories: categoryLines,
      averageCriterionScores: toAverageRecord(averages),
      completedCompetitions: finished?.n ?? 0,
    },
    criteria: averages,
  };
}
