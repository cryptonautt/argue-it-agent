import "server-only";

import { and, count, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@domain/db";
import { reactions, type ReactionTarget, type ReactionType } from "@domain/db/schema";
import type { ReactionSummary } from "./types";

/**
 * Reactions. The schema supports four types; v1's UI uses a single "fire" reaction (one tap, nothing to
 * learn on a small screen). Uniqueness per (user, target, type) is enforced by
 * `reactions_user_target_type_uq`. Reactions are community engagement only — they never reach the judge
 * and never affect debate rating (design §4.3.1, §4.5).
 */
export const DEFAULT_REACTION: ReactionType = "fire";

export type ReactionCounts = Map<string, { count: number; viewerReacted: boolean }>;

/** Counts + "did the viewer react" for many targets of one type (e.g. all comments on a page). */
export async function getReactionCounts(
  targetType: ReactionTarget,
  targetIds: readonly string[],
  viewerId: string | null,
  type: ReactionType = DEFAULT_REACTION,
  conn: DbOrTx = db,
): Promise<ReactionCounts> {
  const result: ReactionCounts = new Map();
  for (const id of targetIds) result.set(id, { count: 0, viewerReacted: false });
  if (targetIds.length === 0) return result;
  const ids = [...new Set(targetIds)];
  const scope = and(eq(reactions.targetType, targetType), eq(reactions.type, type), inArray(reactions.targetId, ids));

  const totals = await conn
    .select({ targetId: reactions.targetId, n: count() })
    .from(reactions)
    .where(scope)
    .groupBy(reactions.targetId);
  for (const row of totals) {
    const entry = result.get(row.targetId);
    if (entry) entry.count = row.n;
  }

  if (viewerId) {
    const mine = await conn
      .select({ targetId: reactions.targetId })
      .from(reactions)
      .where(and(scope, eq(reactions.userId, viewerId)));
    for (const row of mine) {
      const entry = result.get(row.targetId);
      if (entry) entry.viewerReacted = true;
    }
  }
  return result;
}

export async function getReactionSummary(
  targetType: ReactionTarget,
  targetId: string,
  viewerId: string | null,
  type: ReactionType = DEFAULT_REACTION,
  conn: DbOrTx = db,
): Promise<ReactionSummary> {
  const entry = (await getReactionCounts(targetType, [targetId], viewerId, type, conn)).get(targetId);
  return { targetType, targetId, type, count: entry?.count ?? 0, viewerReacted: entry?.viewerReacted ?? false };
}

/** Set the viewer's reaction on or off (idempotent — safe against double taps and retries). */
export async function setReactionRow(
  userId: string,
  targetType: ReactionTarget,
  targetId: string,
  type: ReactionType,
  active: boolean,
  tx: DbOrTx,
): Promise<void> {
  if (active) {
    await tx.insert(reactions).values({ userId, targetType, targetId, type }).onConflictDoNothing();
    return;
  }
  await tx
    .delete(reactions)
    .where(
      and(
        eq(reactions.userId, userId),
        eq(reactions.targetType, targetType),
        eq(reactions.targetId, targetId),
        eq(reactions.type, type),
      ),
    );
}
