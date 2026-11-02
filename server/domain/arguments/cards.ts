import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { now } from "@domain/lib/time";
import { db, type DbOrTx } from "@domain/db";
import {
  argumentPositions,
  argumentsTable,
  categories,
  comments,
  competitions,
  profiles,
  type PositionSide,
} from "@domain/db/schema";
import type { ArgumentCardData } from "./types";
import { listableArgument } from "./visibility";

/** Round deadline of an active competition: openings close first, then rebuttals. */
export const activeRoundDeadline = sql`case when ${competitions.round} = 'opening' then ${competitions.openingClosesAt} else ${competitions.rebuttalClosesAt} end`;

function positionCount(side: PositionSide) {
  return sql<number>`(select count(*)::int from ${argumentPositions} where ${argumentPositions.argumentId} = ${argumentsTable.id} and ${argumentPositions.side} = ${side})`.mapWith(
    Number,
  );
}

/** Columns for an argument card. Correlated subqueries keep counts derived from rows (design §4.1). */
function cardColumns(viewerId: string | null) {
  const nowIso = now().toISOString();
  return {
    id: argumentsTable.id,
    title: argumentsTable.title,
    proposition: argumentsTable.proposition,
    createdAt: argumentsTable.createdAt,
    editedAt: argumentsTable.editedAt,
    authorId: argumentsTable.authorId,
    categorySlug: categories.slug,
    categoryName: categories.name,
    handle: profiles.handle,
    displayName: profiles.displayName,
    avatarUrl: profiles.avatarUrl,
    agree: positionCount("AGREE"),
    against: positionCount("AGAINST"),
    comments: sql<number>`(select count(*)::int from ${comments} where ${comments.argumentId} = ${argumentsTable.id} and ${comments.status} = 'visible')`.mapWith(
      Number,
    ),
    liveDebates: sql<number>`(select count(*)::int from ${competitions} where ${competitions.rootArgumentId} = ${argumentsTable.id} and ${competitions.status} = 'active')`.mapWith(
      Number,
    ),
    nextDeadline: sql<Date | null>`(select min(${activeRoundDeadline}) from ${competitions} where ${competitions.rootArgumentId} = ${argumentsTable.id} and ${competitions.status} = 'active' and ${activeRoundDeadline} > ${nowIso}::timestamptz)`.mapWith(
      competitions.openingClosesAt,
    ),
    viewerSide: viewerId
      ? sql<PositionSide | null>`(select ${argumentPositions.side} from ${argumentPositions} where ${argumentPositions.argumentId} = ${argumentsTable.id} and ${argumentPositions.userId} = ${viewerId}::uuid)`
      : sql<PositionSide | null>`null`,
  };
}

function selectCards(conn: DbOrTx, viewerId: string | null, ids: readonly string[]) {
  return conn
    .select(cardColumns(viewerId))
    .from(argumentsTable)
    .innerJoin(categories, eq(categories.id, argumentsTable.categoryId))
    .leftJoin(profiles, eq(profiles.userId, argumentsTable.authorId))
    .where(and(inArray(argumentsTable.id, [...ids]), listableArgument(viewerId)));
}

type CardRow = Awaited<ReturnType<typeof selectCards>>[number];

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function toCard(row: CardRow): ArgumentCardData {
  return {
    id: row.id,
    title: row.title,
    proposition: row.proposition,
    createdAt: toIso(row.createdAt) ?? "",
    editedAt: toIso(row.editedAt),
    category: { slug: row.categorySlug, name: row.categoryName },
    author: {
      id: row.authorId,
      handle: row.handle,
      displayName: row.displayName ?? "Deleted user",
      avatarUrl: row.avatarUrl,
    },
    counts: { agree: row.agree, against: row.against, comments: row.comments, liveDebates: row.liveDebates },
    nextDeadline: toIso(row.nextDeadline),
    viewerSide: row.viewerSide,
  };
}

/**
 * Load cards for `ids` in the given order, re-applying the listing visibility rules (so a stale id from a
 * ranking query can never leak hidden content). Missing/hidden ids are dropped.
 */
export async function loadCards(ids: readonly string[], viewerId: string | null, conn: DbOrTx = db): Promise<ArgumentCardData[]> {
  if (ids.length === 0) return [];
  const rows = await selectCards(conn, viewerId, ids);
  const byId = new Map(rows.map((row) => [row.id, toCard(row)]));
  return ids.flatMap((id) => {
    const card = byId.get(id);
    return card ? [card] : [];
  });
}
