import "server-only";

import { and, count, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@domain/db";
import { argumentPositions, type PositionSide } from "@domain/db/schema";
import { now } from "@domain/lib/time";
import type { PositionSummary } from "./types";

/**
 * Free AGREE / AGAINST positions (design §4.1). One row per (argument, user), enforced by the
 * `argument_positions_argument_user_uq` constraint. Counts are always derived from rows — there is no
 * counter column to drift. A position is never a competition entry.
 */

export interface PositionCounts {
  agree: number;
  against: number;
}

/** AGREE/AGAINST counts for many arguments at once (feed cards). Missing ids → zeros. */
export async function getPositionCounts(
  argumentIds: readonly string[],
  conn: DbOrTx = db,
): Promise<Map<string, PositionCounts>> {
  const result = new Map<string, PositionCounts>();
  for (const id of argumentIds) result.set(id, { agree: 0, against: 0 });
  if (argumentIds.length === 0) return result;
  const rows = await conn
    .select({ argumentId: argumentPositions.argumentId, side: argumentPositions.side, n: count() })
    .from(argumentPositions)
    .where(inArray(argumentPositions.argumentId, [...new Set(argumentIds)]))
    .groupBy(argumentPositions.argumentId, argumentPositions.side);
  for (const row of rows) {
    const entry = result.get(row.argumentId) ?? { agree: 0, against: 0 };
    if (row.side === "AGREE") entry.agree = row.n;
    else entry.against = row.n;
    result.set(row.argumentId, entry);
  }
  return result;
}

/** The viewer's current position on an argument (null when none). */
export async function getUserPosition(
  argumentId: string,
  userId: string,
  conn: DbOrTx = db,
): Promise<PositionSide | null> {
  const [row] = await conn
    .select({ side: argumentPositions.side })
    .from(argumentPositions)
    .where(and(eq(argumentPositions.argumentId, argumentId), eq(argumentPositions.userId, userId)))
    .limit(1);
  return row?.side ?? null;
}

export async function getPositionSummary(
  argumentId: string,
  viewerId: string | null,
  conn: DbOrTx = db,
): Promise<PositionSummary> {
  const counts = (await getPositionCounts([argumentId], conn)).get(argumentId) ?? { agree: 0, against: 0 };
  const viewerSide = viewerId ? await getUserPosition(argumentId, viewerId, conn) : null;
  return { argumentId, ...counts, viewerSide };
}

/**
 * Take or change a position. Single atomic upsert on the unique (argument, user) constraint, so
 * concurrent double-taps can never create two rows. Returns the previous side (null if new).
 */
export async function upsertPosition(
  argumentId: string,
  userId: string,
  side: PositionSide,
  tx: DbOrTx,
): Promise<{ previous: PositionSide | null }> {
  const previous = await getUserPosition(argumentId, userId, tx);
  if (previous === side) return { previous };
  await tx
    .insert(argumentPositions)
    .values({ argumentId, userId, side })
    .onConflictDoUpdate({
      target: [argumentPositions.argumentId, argumentPositions.userId],
      set: { side, updatedAt: now() },
    });
  return { previous };
}

/** Remove a position (idempotent). Returns the side that was removed, or null if there was none. */
export async function deletePosition(
  argumentId: string,
  userId: string,
  tx: DbOrTx,
): Promise<{ previous: PositionSide | null }> {
  const [deleted] = await tx
    .delete(argumentPositions)
    .where(and(eq(argumentPositions.argumentId, argumentId), eq(argumentPositions.userId, userId)))
    .returning({ side: argumentPositions.side });
  return { previous: deleted?.side ?? null };
}
