import "server-only";

import { and, asc, count, desc, eq, gt, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { ActionError } from "@domain/lib/action-result";
import { DAY_MS, addHours, addMs, now } from "@domain/lib/time";
import { db } from "@domain/db";
import {
  argumentPositions,
  argumentsTable,
  categories,
  comments,
  competitions,
  follows,
  profiles,
} from "@domain/db/schema";
import { activeRoundDeadline, loadCards } from "./cards";
import { decodeCursor, encodeCursor, type FeedCursor } from "./cursor";
import { affinityCase, engagementCtes, roundedScore } from "./engagement";
import type { FeedTab } from "./feed-params";
import { RANKING, affinityMultipliers, type CategorySignal } from "./ranking";
import type { FeedPage } from "./types";
import { listableArgument } from "./visibility";

export const FEED_PAGE_SIZE = 20;

export interface FeedRequest {
  tab: FeedTab;
  viewerId: string | null;
  categorySlug?: string | null;
  cursor?: string | null;
  limit?: number;
}

interface RankedRow {
  id: string;
  key: string;
}

interface RankContext {
  viewerId: string | null;
  categoryId: string | null;
  cursor: FeedCursor | null;
  limit: number;
  asOf: Date;
}

interface RankResult {
  rows: RankedRow[];
  asOf?: Date;
  affinity?: Map<string, number>;
}

const TIMESTAMP_KEY = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/;
const NUMERIC_KEY = /^-?\d{1,20}(\.\d{1,12})?$/;
const SCORE_TABS: ReadonlySet<FeedTab> = new Set(["for-you", "trending"]);

/**
 * One page of a feed tab (design §4.6). Ranking queries return ids + sort keys with keyset pagination;
 * `loadCards` then hydrates them, re-checking visibility. Hidden/removed arguments, deleted authors and
 * users blocked in either direction never appear.
 */
export async function getFeedPage(request: FeedRequest): Promise<FeedPage> {
  const limit = Math.min(Math.max(request.limit ?? FEED_PAGE_SIZE, 1), 50);
  const categorySlug = request.categorySlug ?? null;
  const cursor = request.cursor ? parseCursor(request.cursor, request.tab, categorySlug) : null;
  const categoryId = categorySlug ? await resolveCategoryId(categorySlug) : null;
  if (categorySlug && !categoryId) return { items: [], nextCursor: null };

  const context: RankContext = { viewerId: request.viewerId, categoryId, cursor, limit, asOf: cursor?.asOf ?? now() };
  const ranked = await RANKERS[request.tab](context);

  const pageRows = ranked.rows.slice(0, limit);
  const items = await loadCards(
    pageRows.map((r) => r.id),
    request.viewerId,
  );
  const last = pageRows.at(-1);
  const nextCursor =
    ranked.rows.length > limit && last
      ? encodeCursor({
          tab: request.tab,
          categorySlug,
          key: last.key,
          id: last.id,
          ...(ranked.asOf ? { asOf: ranked.asOf } : {}),
          ...(ranked.affinity ? { affinity: ranked.affinity } : {}),
        })
      : null;
  return { items, nextCursor };
}

function parseCursor(raw: string, tab: FeedTab, categorySlug: string | null): FeedCursor {
  const cursor = decodeCursor(raw);
  const keyPattern = cursor && SCORE_TABS.has(cursor.tab) ? NUMERIC_KEY : TIMESTAMP_KEY;
  if (!cursor || cursor.tab !== tab || cursor.categorySlug !== categorySlug || !keyPattern.test(cursor.key)) {
    throw new ActionError("VALIDATION", "This feed has changed since you opened it. Refresh to see the latest.");
  }
  if (SCORE_TABS.has(tab) && !cursor.asOf) {
    throw new ActionError("VALIDATION", "This feed has changed since you opened it. Refresh to see the latest.");
  }
  return cursor;
}

export async function resolveCategoryId(slug: string): Promise<string | null> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.slug, slug), eq(categories.active, true)))
    .limit(1);
  return row?.id ?? null;
}

function baseFilters(context: RankContext): SQL[] {
  const filters = [listableArgument(context.viewerId)];
  if (context.categoryId) filters.push(eq(argumentsTable.categoryId, context.categoryId));
  return filters;
}

const createdAtKey = sql<string>`${argumentsTable.createdAt}::text`;

/** Newest first: (created_at, id) desc. */
async function rankNew(context: RankContext, extra: SQL[] = []): Promise<RankResult> {
  const filters = [...baseFilters(context), ...extra];
  if (context.cursor) {
    filters.push(
      sql`(${argumentsTable.createdAt}, ${argumentsTable.id}) < (${context.cursor.key}::timestamptz, ${context.cursor.id}::uuid)`,
    );
  }
  const rows = await db
    .select({ id: argumentsTable.id, key: createdAtKey })
    .from(argumentsTable)
    .where(and(...filters))
    .orderBy(desc(argumentsTable.createdAt), desc(argumentsTable.id))
    .limit(context.limit + 1);
  return { rows };
}

/** Arguments by people the viewer follows, newest first. */
async function rankFollowing(context: RankContext): Promise<RankResult> {
  if (!context.viewerId) return { rows: [] };
  return rankNew(context, [
    sql`exists (select 1 from ${follows} where ${follows.followerId} = ${context.viewerId}::uuid and ${follows.followingId} = ${argumentsTable.authorId})`,
  ]);
}

/** Arguments with a debate in its rounds, most recently started debate first. */
async function rankActive(context: RankContext): Promise<RankResult> {
  const live = db.$with("live").as(
    db
      .select({
        argumentId: competitions.rootArgumentId,
        startedAt: sql<string>`max(coalesce(${competitions.acceptedAt}, ${competitions.sentAt}))`.as("started_at"),
      })
      .from(competitions)
      .where(eq(competitions.status, "active"))
      .groupBy(competitions.rootArgumentId),
  );
  const filters = baseFilters(context);
  if (context.cursor) {
    filters.push(sql`(${live.startedAt}, ${argumentsTable.id}) < (${context.cursor.key}::timestamptz, ${context.cursor.id}::uuid)`);
  }
  const rows = await db
    .with(live)
    .select({ id: argumentsTable.id, key: sql<string>`${live.startedAt}::text` })
    .from(argumentsTable)
    .innerJoin(live, eq(live.argumentId, argumentsTable.id))
    .where(and(...filters))
    .orderBy(desc(live.startedAt), desc(argumentsTable.id))
    .limit(context.limit + 1);
  return { rows };
}

/** Arguments whose live debate has the nearest upcoming round deadline first. */
async function rankEnding(context: RankContext): Promise<RankResult> {
  const nowIso = now().toISOString();
  const upcoming = db.$with("upcoming").as(
    db
      .select({
        argumentId: competitions.rootArgumentId,
        deadline: sql<string>`min(${activeRoundDeadline})`.as("deadline"),
      })
      .from(competitions)
      .where(and(eq(competitions.status, "active"), sql`${activeRoundDeadline} > ${nowIso}::timestamptz`))
      .groupBy(competitions.rootArgumentId),
  );
  const filters = baseFilters(context);
  if (context.cursor) {
    filters.push(sql`(${upcoming.deadline}, ${argumentsTable.id}) > (${context.cursor.key}::timestamptz, ${context.cursor.id}::uuid)`);
  }
  const rows = await db
    .with(upcoming)
    .select({ id: argumentsTable.id, key: sql<string>`${upcoming.deadline}::text` })
    .from(argumentsTable)
    .innerJoin(upcoming, eq(upcoming.argumentId, argumentsTable.id))
    .where(and(...filters))
    .orderBy(asc(upcoming.deadline), asc(argumentsTable.id))
    .limit(context.limit + 1);
  return { rows };
}

/** Score-ranked page shared by Trending and For You. */
async function rankByScore(
  context: RankContext,
  creationWindowHours: number,
  affinity: Map<string, number>,
): Promise<RankResult> {
  const asOf = context.asOf;
  const e = engagementCtes(asOf);
  const creationStart = addHours(asOf, -creationWindowHours);
  const score = roundedScore(e.rawScore, affinityCase(affinity));

  const scored = db
    .select({ id: argumentsTable.id, score: score.as("score") })
    .from(argumentsTable)
    .leftJoin(e.positionEngagement, eq(e.positionEngagement.argumentId, argumentsTable.id))
    .leftJoin(e.commentEngagement, eq(e.commentEngagement.argumentId, argumentsTable.id))
    .leftJoin(e.reactionEngagement, eq(e.reactionEngagement.targetId, argumentsTable.id))
    .where(
      and(
        ...baseFilters(context),
        lte(argumentsTable.createdAt, asOf),
        or(e.hasEngagement, gt(argumentsTable.createdAt, creationStart)),
      ),
    )
    .as("scored");

  const rows = await db
    .with(e.positionEngagement, e.commentEngagement, e.reactionEngagement)
    .select({ id: scored.id, key: sql<string>`${scored.score}::text` })
    .from(scored)
    .where(
      context.cursor
        ? sql`(${scored.score}, ${scored.id}) < (${context.cursor.key}::numeric, ${context.cursor.id}::uuid)`
        : undefined,
    )
    .orderBy(desc(scored.score), desc(scored.id))
    .limit(context.limit + 1);
  return { rows, asOf, ...(affinity.size > 0 ? { affinity } : {}) };
}

function rankTrending(context: RankContext): Promise<RankResult> {
  return rankByScore(context, RANKING.trendingCreationWindowHours, new Map());
}

async function rankForYou(context: RankContext): Promise<RankResult> {
  const affinity = context.cursor
    ? (context.cursor.affinity ?? new Map<string, number>())
    : context.viewerId
      ? await viewerAffinity(context.viewerId)
      : new Map<string, number>();
  return rankByScore(context, RANKING.forYouCreationWindowHours, affinity);
}

const RANKERS: Record<FeedTab, (context: RankContext) => Promise<RankResult>> = {
  "for-you": rankForYou,
  trending: rankTrending,
  new: (context) => rankNew(context),
  following: rankFollowing,
  active: rankActive,
  ending: rankEnding,
};

/**
 * The viewer's category affinity: categories of arguments they posted, took a position on or commented on
 * in the last 30 days, plus the interests picked at onboarding.
 */
export async function viewerAffinity(viewerId: string): Promise<Map<string, number>> {
  const since = addMs(now(), -RANKING.affinityLookbackDays * DAY_MS);

  const [authored, positioned, commented, profile] = await Promise.all([
    db
      .select({ categoryId: argumentsTable.categoryId, count: count() })
      .from(argumentsTable)
      .where(and(eq(argumentsTable.authorId, viewerId), gt(argumentsTable.createdAt, since)))
      .groupBy(argumentsTable.categoryId),
    db
      .select({ categoryId: argumentsTable.categoryId, count: count() })
      .from(argumentPositions)
      .innerJoin(argumentsTable, eq(argumentsTable.id, argumentPositions.argumentId))
      .where(and(eq(argumentPositions.userId, viewerId), gt(argumentPositions.updatedAt, since)))
      .groupBy(argumentsTable.categoryId),
    db
      .select({ categoryId: argumentsTable.categoryId, count: count() })
      .from(comments)
      .innerJoin(argumentsTable, eq(argumentsTable.id, comments.argumentId))
      .where(and(eq(comments.authorId, viewerId), gt(comments.createdAt, since)))
      .groupBy(argumentsTable.categoryId),
    db.select({ interests: profiles.interests }).from(profiles).where(eq(profiles.userId, viewerId)).limit(1),
  ]);

  const signals: CategorySignal[] = [...authored, ...positioned, ...commented].map((row) => ({
    categoryId: row.categoryId,
    count: Number(row.count),
  }));
  const interestSlugs = (profile[0]?.interests ?? []).filter((s): s is string => typeof s === "string").slice(0, 20);
  const interestIds =
    interestSlugs.length > 0
      ? (
          await db
            .select({ id: categories.id })
            .from(categories)
            .where(inArray(categories.slug, interestSlugs))
        ).map((row) => row.id)
      : [];
  return affinityMultipliers(signals, interestIds);
}
