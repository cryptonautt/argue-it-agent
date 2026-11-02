/**
 * Owner: challenges. Who and what a new challenge is about (design §4.2): resolves the argument,
 * optional source comment and opponent, and enforces eligibility (no self-challenges, no blocks in
 * either direction, visible content, an opponent who can actually respond). Shared by the setup page
 * (to explain problems before the form) and `sendChallenge` (authoritative).
 */
import "server-only";

import { and, eq, gt, inArray, or } from "drizzle-orm";
import { ActionError } from "@domain/lib/action-result";
import { normalizeHandle } from "@domain/lib/handles";
import { isSuspended } from "@domain/auth/roles";
import { db, type DbOrTx } from "@domain/db";
import {
  argumentsTable,
  blocks,
  categories,
  comments,
  competitionParticipants,
  competitions,
  profiles,
  users,
  type Category,
} from "@domain/db/schema";

export interface TargetInput {
  argumentId: string;
  commentId?: string | null;
  opponentId?: string | null;
  opponentHandle?: string | null;
}

export interface OpponentSummary {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface ChallengeTarget {
  argument: { id: string; title: string; proposition: string; authorId: string };
  category: Pick<Category, "id" | "slug" | "name" | "rubricId">;
  comment: { id: string; body: string; authorId: string } | null;
  /** Null only when the challenger is the argument author and has not picked anyone yet. */
  opponent: OpponentSummary | null;
}

export async function resolveChallengeTarget(
  challengerId: string,
  input: TargetInput,
  conn: DbOrTx = db,
): Promise<ChallengeTarget> {
  const [found] = await conn
    .select({ argument: argumentsTable, category: categories })
    .from(argumentsTable)
    .innerJoin(categories, eq(categories.id, argumentsTable.categoryId))
    .where(eq(argumentsTable.id, input.argumentId))
    .limit(1);
  if (!found || found.argument.status === "removed") {
    throw new ActionError("NOT_FOUND", "That argument no longer exists.");
  }
  if (found.argument.status !== "visible") {
    throw new ActionError("FORBIDDEN", "This argument is hidden, so it can't be challenged right now.");
  }
  if (!found.category.active) {
    throw new ActionError("FORBIDDEN", "Challenges are paused in this category.");
  }

  let comment: ChallengeTarget["comment"] = null;
  if (input.commentId) {
    const [row] = await conn
      .select({ id: comments.id, body: comments.body, authorId: comments.authorId, argumentId: comments.argumentId, status: comments.status })
      .from(comments)
      .where(eq(comments.id, input.commentId))
      .limit(1);
    if (!row || row.argumentId !== found.argument.id || row.status !== "visible") {
      throw new ActionError("NOT_FOUND", "That comment is no longer available to challenge.");
    }
    comment = { id: row.id, body: row.body, authorId: row.authorId };
  }

  const opponent = await resolveOpponent(conn, challengerId, input, found.argument.authorId, comment);
  return {
    argument: {
      id: found.argument.id,
      title: found.argument.title,
      proposition: found.argument.proposition,
      authorId: found.argument.authorId,
    },
    category: {
      id: found.category.id,
      slug: found.category.slug,
      name: found.category.name,
      rubricId: found.category.rubricId,
    },
    comment,
    opponent,
  };
}

async function resolveOpponent(
  conn: DbOrTx,
  challengerId: string,
  input: TargetInput,
  argumentAuthorId: string,
  comment: ChallengeTarget["comment"],
): Promise<OpponentSummary | null> {
  const handle = input.opponentHandle ? normalizeHandle(input.opponentHandle) : "";
  let opponentId: string | null = null;

  if (comment) {
    // From a comment the opponent is always the commenter (design §4.2).
    opponentId = comment.authorId;
  } else if (handle) {
    const [byHandle] = await conn
      .select({ userId: profiles.userId })
      .from(profiles)
      .where(eq(profiles.handle, handle))
      .limit(1);
    if (!byHandle) {
      throw new ActionError("NOT_FOUND", `We couldn't find anyone with the handle @${handle}.`, {
        opponentHandle: [`No user called @${handle}.`],
      });
    }
    opponentId = byHandle.userId;
  } else if (input.opponentId) {
    opponentId = input.opponentId;
  } else if (argumentAuthorId !== challengerId) {
    opponentId = argumentAuthorId;
  }

  if (opponentId === null) return null;
  if (opponentId === challengerId) {
    throw new ActionError("FORBIDDEN", "You can't challenge yourself. Pick someone who disagrees with you.");
  }

  const [row] = await conn
    .select({
      userId: users.id,
      status: users.status,
      suspendedUntil: users.suspendedUntil,
      handle: profiles.handle,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, opponentId))
    .limit(1);
  if (!row || row.status === "deleted") throw new ActionError("NOT_FOUND", "That person's account is no longer active.");
  if (isSuspended(row)) throw new ActionError("FORBIDDEN", "That person can't take on challenges right now.");

  const [block] = await conn
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, challengerId), eq(blocks.blockedId, opponentId)),
        and(eq(blocks.blockerId, opponentId), eq(blocks.blockedId, challengerId)),
      ),
    )
    .limit(1);
  if (block) {
    throw new ActionError(
      "FORBIDDEN",
      block.blockerId === challengerId
        ? "You've blocked this person. Unblock them in settings to challenge them."
        : "You can't challenge this person.",
    );
  }

  return { userId: row.userId, handle: row.handle, displayName: row.displayName, avatarUrl: row.avatarUrl };
}

/**
 * An open challenge between these two people on this argument, if any: active, or pending and still
 * inside its acceptance window (an overdue pending one is about to expire and doesn't count).
 */
export async function findOpenChallenge(
  argumentId: string,
  userA: string,
  userB: string,
  at: Date,
  conn: DbOrTx = db,
): Promise<string | null> {
  const open = await conn
    .select({ id: competitions.id, userId: competitionParticipants.userId })
    .from(competitions)
    .innerJoin(competitionParticipants, eq(competitionParticipants.competitionId, competitions.id))
    .where(
      and(
        eq(competitions.rootArgumentId, argumentId),
        or(
          eq(competitions.status, "active"),
          and(eq(competitions.status, "pending_acceptance"), gt(competitions.acceptDeadline, at)),
        ),
        inArray(competitionParticipants.userId, [userA, userB]),
      ),
    );
  const byCompetition = new Map<string, Set<string>>();
  for (const row of open) {
    const users = byCompetition.get(row.id) ?? new Set<string>();
    users.add(row.userId);
    byCompetition.set(row.id, users);
  }
  for (const [id, members] of byCompetition) if (members.size === 2) return id;
  return null;
}
