import "server-only";

import { and, desc, eq, notExists, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, type DbOrTx } from "@domain/db";
import { blocks, follows, profiles } from "@domain/db/schema";
import type { BlockedUserView } from "./types";

/**
 * Blocks (design §4.1/§4.2/§4.6, PRD §8.1). A block works BOTH ways: neither user sees the other's
 * content, they cannot interact (comment/reply/react/follow), and neither can challenge the other.
 * Use these helpers from any team instead of querying `blocks` directly.
 */

/** True when either user has blocked the other. Use this for "can these two interact / compete?" checks. */
export async function isBlocked(userA: string, userB: string, conn: DbOrTx = db): Promise<boolean> {
  if (userA === userB) return false;
  const [row] = await conn
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, userA), eq(blocks.blockedId, userB)),
        and(eq(blocks.blockerId, userB), eq(blocks.blockedId, userA)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** True only when `blockerId` has blocked `blockedId` (one direction — e.g. to show "Unblock"). */
export async function hasBlocked(blockerId: string, blockedId: string, conn: DbOrTx = db): Promise<boolean> {
  const [row] = await conn
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
    .limit(1);
  return row !== undefined;
}

/** Every user in a block relationship with `userId`, in either direction. */
export async function getBlockedUserIds(userId: string, conn: DbOrTx = db): Promise<Set<string>> {
  const rows = await conn
    .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
    .from(blocks)
    .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));
  const ids = new Set<string>();
  for (const row of rows) ids.add(row.blockerId === userId ? row.blockedId : row.blockerId);
  return ids;
}

/**
 * SQL condition: "the user in `userIdColumn` is not in a block relationship with `viewerId`".
 * Drop it into any `where(...)` to hide blocked users' content (feeds, search, lists).
 * Signed-out viewers (null) see everything.
 *
 *   .where(and(eq(argumentsTable.status, "visible"), notBlockedWith(viewer?.id, argumentsTable.authorId)))
 */
export function notBlockedWith(viewerId: string | null | undefined, userIdColumn: AnyPgColumn | SQL): SQL {
  if (!viewerId) return sql`true`;
  return notExists(
    db
      .select({ one: sql`1` })
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, userIdColumn)),
          and(eq(blocks.blockerId, userIdColumn), eq(blocks.blockedId, viewerId)),
        ),
      ),
  );
}

/**
 * Create a block (idempotent). Also removes follows in both directions so the blocked user does not keep
 * seeing the blocker in their Following feed. Returns true when a new block row was created.
 */
export async function createBlock(blockerId: string, blockedId: string, tx: DbOrTx): Promise<boolean> {
  const inserted = await tx
    .insert(blocks)
    .values({ blockerId, blockedId })
    .onConflictDoNothing()
    .returning({ blockerId: blocks.blockerId });
  await tx
    .delete(follows)
    .where(
      or(
        and(eq(follows.followerId, blockerId), eq(follows.followingId, blockedId)),
        and(eq(follows.followerId, blockedId), eq(follows.followingId, blockerId)),
      ),
    );
  return inserted.length > 0;
}

/** Remove a block (idempotent). Returns true when a row was deleted. */
export async function removeBlock(blockerId: string, blockedId: string, tx: DbOrTx): Promise<boolean> {
  const deleted = await tx
    .delete(blocks)
    .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
    .returning({ blockerId: blocks.blockerId });
  return deleted.length > 0;
}

/** The users `blockerId` has blocked (newest first) — for Settings → Blocked users. */
export async function listBlockedUsers(blockerId: string, conn: DbOrTx = db): Promise<BlockedUserView[]> {
  const rows = await conn
    .select({
      id: blocks.blockedId,
      blockedAt: blocks.createdAt,
      handle: profiles.handle,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(blocks)
    .innerJoin(profiles, eq(profiles.userId, blocks.blockedId))
    .where(eq(blocks.blockerId, blockerId))
    .orderBy(desc(blocks.createdAt));
  return rows.map((row) => ({ ...row, blockedAt: row.blockedAt.toISOString() }));
}
