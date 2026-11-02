import "server-only";

import { and, eq, gt, lte, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { addHours } from "@domain/lib/time";
import { db } from "@domain/db";
import { argumentPositions, argumentsTable, comments, reactions } from "@domain/db/schema";
import { RANKING } from "./ranking";

/** A trusted numeric constant inlined into SQL (never user input). */
function lit(value: number): SQL {
  if (!Number.isFinite(value)) throw new Error(`lit(): non-finite ${value}`);
  return sql.raw(String(value));
}

/** ½^(age_hours / halfLife) evaluated at `asOf`, in SQL. Mirrors `decayFactor()` in ranking.ts. */
function decaySql(asOfIso: string, at: SQLWrapper, halfLifeHours: number): SQL {
  return sql`power(0.5::float8, greatest(extract(epoch from (${asOfIso}::timestamptz - ${at}))::float8, 0) / ${lit(halfLifeHours * 3600)})`;
}

/**
 * The three engagement CTEs for trending at instant `asOf`: decayed sums per argument of position
 * activity, visible comments and reactions inside the 48h window. Only events at or before `asOf` count,
 * which keeps later pages of a feed scored against the same snapshot as page one.
 */
export function engagementCtes(asOf: Date) {
  const asOfIso = asOf.toISOString();
  const windowStart = addHours(asOf, -RANKING.windowHours);

  const positionEngagement = db.$with("pos_eng").as(
    db
      .select({
        argumentId: argumentPositions.argumentId,
        score: sql<number>`sum(${decaySql(asOfIso, argumentPositions.updatedAt, RANKING.halfLifeHours)})`.as("pos_score"),
      })
      .from(argumentPositions)
      .where(and(gt(argumentPositions.updatedAt, windowStart), lte(argumentPositions.updatedAt, asOf)))
      .groupBy(argumentPositions.argumentId),
  );

  const commentEngagement = db.$with("com_eng").as(
    db
      .select({
        argumentId: comments.argumentId,
        score: sql<number>`sum(${decaySql(asOfIso, comments.createdAt, RANKING.halfLifeHours)})`.as("com_score"),
      })
      .from(comments)
      .where(and(eq(comments.status, "visible"), gt(comments.createdAt, windowStart), lte(comments.createdAt, asOf)))
      .groupBy(comments.argumentId),
  );

  const reactionEngagement = db.$with("rx_eng").as(
    db
      .select({
        targetId: reactions.targetId,
        score: sql<number>`sum(${decaySql(asOfIso, reactions.createdAt, RANKING.halfLifeHours)})`.as("rx_score"),
      })
      .from(reactions)
      .where(
        and(eq(reactions.targetType, "argument"), gt(reactions.createdAt, windowStart), lte(reactions.createdAt, asOf)),
      )
      .groupBy(reactions.targetId),
  );

  const { weights } = RANKING;
  /** Weighted engagement + freshness, unrounded float8. Requires the three CTEs left-joined on arguments.id. */
  const rawScore = sql`(
    coalesce(${positionEngagement.score}, 0) * ${lit(weights.position)}
    + coalesce(${commentEngagement.score}, 0) * ${lit(weights.comment)}
    + coalesce(${reactionEngagement.score}, 0) * ${lit(weights.reaction)}
    + ${lit(RANKING.freshnessWeight)} * ${decaySql(asOfIso, argumentsTable.createdAt, RANKING.freshnessHalfLifeHours)}
  )`;

  /** True when the argument had any engagement in the window. */
  const hasEngagement = sql`(${positionEngagement.argumentId} is not null or ${commentEngagement.argumentId} is not null or ${reactionEngagement.targetId} is not null)`;

  return { positionEngagement, commentEngagement, reactionEngagement, rawScore, hasEngagement, asOfIso };
}

export type EngagementCtes = ReturnType<typeof engagementCtes>;

/**
 * `case category_id when … then multiplier … else 1 end` for For You. Category ids and multipliers may come
 * from a client cursor: ids are bound as uuid parameters and multipliers are clamped numbers.
 */
export function affinityCase(affinity: ReadonlyMap<string, number>): SQL {
  if (affinity.size === 0) return sql`1`;
  const branches = [...affinity.entries()].map(
    ([categoryId, multiplier]) => sql`when ${categoryId}::uuid then ${lit(multiplier)}`,
  );
  return sql`(case ${argumentsTable.categoryId} ${sql.join(branches, sql` `)} else 1 end)`;
}

/** Final sortable score: rounded numeric so keyset comparisons on its text form are exact. */
export function roundedScore(raw: SQL, multiplier: SQL = sql`1`): SQL<string> {
  return sql<string>`round((${raw} * ${multiplier})::numeric, 6)`;
}
