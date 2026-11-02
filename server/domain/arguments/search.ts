import "server-only";

import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { now } from "@domain/lib/time";
import { db } from "@domain/db";
import {
  argumentsTable,
  categories,
  competitionParticipants,
  competitions,
  follows,
  profiles,
  users,
  type CompetitionSide,
} from "@domain/db/schema";
import { activeRoundDeadline, loadCards } from "./cards";
import { engagementCtes } from "./engagement";
import { resolveCategoryId } from "./feed";
import type { ArgumentCardData } from "./types";
import { notBlockedWith } from "@domain/social/blocks";
import { listableArgument } from "./visibility";

export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_MAX_PAGE = 20;
export const SEARCH_QUERY_MAX = 100;

export const SEARCH_SORTS = ["relevance", "new", "trending"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const SEARCH_TYPES = ["arguments", "people", "debates"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** Trim, collapse whitespace and cap length. Empty string = browse mode. */
export function normalizeQuery(raw: string | undefined | null): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, SEARCH_QUERY_MAX);
}

/** Escape LIKE wildcards so user input is matched literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface ArgumentSearchRequest {
  q: string;
  sort: SearchSort;
  categorySlug?: string | null;
  page?: number;
  viewerId: string | null;
}

export interface ArgumentSearchResult {
  items: ArgumentCardData[];
  page: number;
  hasMore: boolean;
}

/**
 * Search arguments by title/proposition/body (Postgres full-text, GIN-indexed) plus a literal substring
 * match on title/proposition so partial words ("mess" → Messi) still hit. Sorts: relevance (text rank;
 * falls back to trending when browsing without a query), new, trending (same 48h engagement score as the feed).
 */
export async function searchArguments(request: ArgumentSearchRequest): Promise<ArgumentSearchResult> {
  const q = normalizeQuery(request.q);
  const page = Math.min(Math.max(Math.trunc(request.page ?? 1), 1), SEARCH_MAX_PAGE);
  const categoryId = request.categorySlug ? await resolveCategoryId(request.categorySlug) : null;
  if (request.categorySlug && !categoryId) return { items: [], page, hasMore: false };

  const filters: SQL[] = [listableArgument(request.viewerId)];
  if (categoryId) filters.push(eq(argumentsTable.categoryId, categoryId));

  let rank: SQL | null = null;
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    const tsQuery = sql`websearch_to_tsquery('english', ${q})`;
    filters.push(
      or(
        sql`${argumentsTable.searchVector} @@ ${tsQuery}`,
        ilike(argumentsTable.title, pattern),
        ilike(argumentsTable.proposition, pattern),
      ) as SQL,
    );
    rank = sql`(ts_rank_cd(${argumentsTable.searchVector}, ${tsQuery}) + case when ${argumentsTable.title} ilike ${pattern} then 0.5 else 0 end)`;
  }

  const sort: SearchSort = request.sort === "relevance" && !rank ? "trending" : request.sort;
  const offset = (page - 1) * SEARCH_PAGE_SIZE;
  let ids: string[];

  if (sort === "trending") {
    const e = engagementCtes(now());
    const rows = await db
      .with(e.positionEngagement, e.commentEngagement, e.reactionEngagement)
      .select({ id: argumentsTable.id })
      .from(argumentsTable)
      .leftJoin(e.positionEngagement, eq(e.positionEngagement.argumentId, argumentsTable.id))
      .leftJoin(e.commentEngagement, eq(e.commentEngagement.argumentId, argumentsTable.id))
      .leftJoin(e.reactionEngagement, eq(e.reactionEngagement.targetId, argumentsTable.id))
      .where(and(...filters))
      .orderBy(desc(e.rawScore), desc(argumentsTable.createdAt), desc(argumentsTable.id))
      .limit(SEARCH_PAGE_SIZE + 1)
      .offset(offset);
    ids = rows.map((r) => r.id);
  } else {
    const order =
      sort === "relevance" && rank
        ? [desc(rank), desc(argumentsTable.createdAt), desc(argumentsTable.id)]
        : [desc(argumentsTable.createdAt), desc(argumentsTable.id)];
    const rows = await db
      .select({ id: argumentsTable.id })
      .from(argumentsTable)
      .where(and(...filters))
      .orderBy(...order)
      .limit(SEARCH_PAGE_SIZE + 1)
      .offset(offset);
    ids = rows.map((r) => r.id);
  }

  const items = await loadCards(ids.slice(0, SEARCH_PAGE_SIZE), request.viewerId);
  return { items, page, hasMore: ids.length > SEARCH_PAGE_SIZE };
}

export interface PersonResult {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  followers: number;
}

/** Creators by handle (prefix) or display name (substring). Exact handle first, then most followed. */
export async function searchPeople(rawQuery: string, viewerId: string | null): Promise<PersonResult[]> {
  const q = normalizeQuery(rawQuery).replace(/^@+/, "");
  if (!q) return [];
  const escaped = escapeLike(q);
  const handleQuery = q.toLowerCase();
  const followers = sql<number>`(select count(*)::int from ${follows} where ${follows.followingId} = ${profiles.userId})`.mapWith(
    Number,
  );

  const filters: SQL[] = [
    ne(users.status, "deleted"),
    or(ilike(profiles.handle, `${escapeLike(handleQuery)}%`), ilike(profiles.displayName, `%${escaped}%`)) as SQL,
  ];
  if (viewerId) filters.push(notBlockedWith(viewerId, profiles.userId));

  return db
    .select({
      userId: profiles.userId,
      handle: profiles.handle,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
      bio: profiles.bio,
      followers,
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(and(...filters))
    .orderBy(
      sql`case when ${profiles.handle} = ${handleQuery} then 0 when ${profiles.handle} like ${`${escapeLike(handleQuery)}%`} then 1 else 2 end`,
      desc(followers),
      asc(profiles.handle),
    )
    .limit(SEARCH_PAGE_SIZE);
}

export interface DebateParticipant {
  side: CompetitionSide;
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
}

export interface DebateResult {
  id: string;
  argumentId: string;
  proposition: string;
  category: { slug: string; name: string };
  round: "opening" | "rebuttal" | null;
  /** Current round's closing time (ISO). */
  deadline: string | null;
  participants: DebateParticipant[];
}

/**
 * Debates currently in their rounds, matching the debate proposition or the argument it came from.
 * Without a query: all live debates, nearest deadline first. Debates whose argument is hidden/removed, or
 * that involve someone blocked with the viewer, are not listed.
 */
export async function searchDebates(rawQuery: string, viewerId: string | null): Promise<DebateResult[]> {
  const q = normalizeQuery(rawQuery);
  const filters: SQL[] = [eq(competitions.status, "active"), listableArgument(viewerId)];
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    filters.push(
      or(
        sql`${competitions.rulesSnapshot}->>'proposition' ilike ${pattern}`,
        ilike(argumentsTable.title, pattern),
        sql`${argumentsTable.searchVector} @@ websearch_to_tsquery('english', ${q})`,
      ) as SQL,
    );
  }
  if (viewerId) {
    filters.push(sql`not exists (
      select 1 from ${competitionParticipants}
      where ${competitionParticipants.competitionId} = ${competitions.id}
        and not ${notBlockedWith(viewerId, competitionParticipants.userId)}
    )`);
  }

  const rows = await db
    .select({
      id: competitions.id,
      argumentId: competitions.rootArgumentId,
      proposition: sql<string>`coalesce(${competitions.rulesSnapshot}->>'proposition', ${argumentsTable.proposition})`,
      round: competitions.round,
      deadline: sql<Date | null>`${activeRoundDeadline}`.mapWith(competitions.openingClosesAt),
      categorySlug: categories.slug,
      categoryName: categories.name,
    })
    .from(competitions)
    .innerJoin(argumentsTable, eq(argumentsTable.id, competitions.rootArgumentId))
    .innerJoin(categories, eq(categories.id, competitions.categoryId))
    .where(and(...filters))
    .orderBy(asc(activeRoundDeadline), asc(competitions.id))
    .limit(SEARCH_PAGE_SIZE);
  if (rows.length === 0) return [];

  const participantRows = await db
    .select({
      competitionId: competitionParticipants.competitionId,
      side: competitionParticipants.side,
      handle: profiles.handle,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(competitionParticipants)
    .leftJoin(profiles, eq(profiles.userId, competitionParticipants.userId))
    .where(
      inArray(
        competitionParticipants.competitionId,
        rows.map((r) => r.id),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    argumentId: row.argumentId,
    proposition: row.proposition,
    category: { slug: row.categorySlug, name: row.categoryName },
    round: row.round,
    deadline: row.deadline ? new Date(row.deadline).toISOString() : null,
    participants: participantRows
      .filter((p) => p.competitionId === row.id)
      .sort((a, b) => (a.side === b.side ? 0 : a.side === "FOR" ? -1 : 1))
      .map((p) => ({
        side: p.side,
        handle: p.handle,
        displayName: p.displayName ?? "Deleted user",
        avatarUrl: p.avatarUrl,
      })),
  }));
}
