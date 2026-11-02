import "server-only";

import { eq } from "drizzle-orm";
import { ActionError } from "@domain/lib/action-result";
import { assertFound } from "@domain/action";
import { db, type DbOrTx } from "@domain/db";
import { argumentsTable, comments, profiles, users, type Argument, type Comment } from "@domain/db/schema";
import { isBlocked } from "./blocks";

/** Shared authorisation checks for social actions. All throw ActionError (converted by runAction). */

export async function loadArgument(argumentId: string, conn: DbOrTx = db): Promise<Argument> {
  return assertFound(
    await conn.query.argumentsTable.findFirst({ where: eq(argumentsTable.id, argumentId) }),
    "That argument no longer exists.",
  );
}

/** The argument must exist and be visible (hidden/removed arguments are closed to new engagement). */
export async function loadOpenArgument(argumentId: string, conn: DbOrTx = db): Promise<Argument> {
  const argument = await loadArgument(argumentId, conn);
  if (argument.status !== "visible") {
    throw new ActionError("FORBIDDEN", "This argument is closed to new activity.");
  }
  return argument;
}

export async function loadComment(commentId: string, conn: DbOrTx = db): Promise<Comment> {
  return assertFound(
    await conn.query.comments.findFirst({ where: eq(comments.id, commentId) }),
    "That comment no longer exists.",
  );
}

/** Reject interaction between two users when either has blocked the other. */
export async function assertNotBlocked(
  userId: string,
  otherUserId: string,
  message: string,
  conn: DbOrTx = db,
): Promise<void> {
  if (await isBlocked(userId, otherUserId, conn)) throw new ActionError("FORBIDDEN", message);
}

export interface TargetUser {
  id: string;
  handle: string;
  displayName: string;
}

/** An existing, non-deleted user with a profile. */
export async function loadTargetUser(userId: string, conn: DbOrTx = db): Promise<TargetUser> {
  const [row] = await conn
    .select({ id: users.id, status: users.status, handle: profiles.handle, displayName: profiles.displayName })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || row.status === "deleted") throw new ActionError("NOT_FOUND", "We couldn't find that account.");
  return { id: row.id, handle: row.handle, displayName: row.displayName };
}
