import "server-only";

import { and, count, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@domain/db";
import { follows } from "@domain/db/schema";
import type { FollowState } from "./types";

/** Follows. Follower counts are community signals only and never affect rating or judging (design §4.5). */

export async function isFollowing(followerId: string, followingId: string, conn: DbOrTx = db): Promise<boolean> {
  const [row] = await conn
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
    .limit(1);
  return row !== undefined;
}

export async function getFollowCounts(
  userId: string,
  conn: DbOrTx = db,
): Promise<{ followers: number; following: number }> {
  const [followers] = await conn.select({ n: count() }).from(follows).where(eq(follows.followingId, userId));
  const [following] = await conn.select({ n: count() }).from(follows).where(eq(follows.followerId, userId));
  return { followers: followers?.n ?? 0, following: following?.n ?? 0 };
}

export async function getFollowState(userId: string, viewerId: string | null, conn: DbOrTx = db): Promise<FollowState> {
  const [{ followers }, following] = await Promise.all([
    getFollowCounts(userId, conn),
    viewerId ? isFollowing(viewerId, userId, conn) : Promise.resolve(false),
  ]);
  return { userId, following, followerCount: followers };
}

/** Ids of everyone `userId` follows (Following feed). */
export async function getFollowingIds(userId: string, conn: DbOrTx = db): Promise<string[]> {
  const rows = await conn
    .select({ id: follows.followingId })
    .from(follows)
    .where(eq(follows.followerId, userId));
  return rows.map((row) => row.id);
}

/** Returns true when a new follow row was created (false: already following). */
export async function insertFollow(followerId: string, followingId: string, tx: DbOrTx): Promise<boolean> {
  const inserted = await tx
    .insert(follows)
    .values({ followerId, followingId })
    .onConflictDoNothing()
    .returning({ followerId: follows.followerId });
  return inserted.length > 0;
}

export async function deleteFollow(followerId: string, followingId: string, tx: DbOrTx): Promise<boolean> {
  const deleted = await tx
    .delete(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
    .returning({ followerId: follows.followerId });
  return deleted.length > 0;
}
