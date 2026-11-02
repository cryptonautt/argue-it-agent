"use server";

/**
 * Social server actions (design §4.1, §4.7, §5.4): positions, comments, reactions, follows, blocks.
 *
 * Every action: requireUser() (suspended users are rejected) → zod → rate limit → object-level
 * authorisation (visibility, ownership, blocks) → transaction → ActionResult. Positions, reactions,
 * follows and blocks are "set state" operations, so retries and double taps are naturally idempotent;
 * comment creation takes a client idempotency key.
 */

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, ok, type ActionResult } from "@domain/lib/action-result";
import { now } from "@domain/lib/time";
import { parseInput, runAction } from "@domain/action";
import { writeAudit } from "@domain/audit";
import { requireUser } from "@domain/auth";
import { onUsersBlocked } from "@domain/competitions/lifecycle";
import { db } from "@domain/db";
import {
  comments,
  positionSideEnum,
  reactionTargetEnum,
  reactionTypeEnum,
  type ReactionTarget,
} from "@domain/db/schema";
import { idempotencyKeySchema, withIdempotency } from "@domain/idempotency";
import { assertContentAllowed, assessContent, flagForReviewIfNeeded } from "@domain/moderation";
import { notify } from "@domain/notifications";
import { enforceRateLimit } from "@domain/rate-limit";
import { createBlock, removeBlock } from "./blocks";
import { notifyMentions, notifyNewComment } from "./comment-notifications";
import { COMMENT_MAX_LENGTH, getCommentView } from "./comments";
import { deleteFollow, getFollowState, insertFollow } from "./follows";
import { assertNotBlocked, loadArgument, loadComment, loadOpenArgument, loadTargetUser } from "./guards";
import { extractMentionHandles, withLeadingMention } from "./mentions";
import { deletePosition, getPositionSummary, getUserPosition, upsertPosition } from "./positions";
import { DEFAULT_REACTION, getReactionSummary, setReactionRow } from "./reactions";
import type { BlockState, CommentView, FollowState, PositionSummary, ReactionSummary } from "./types";

const BLOCKED_MESSAGE = "You can't interact with this account.";

// ---------------------------------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------------------------------

const setPositionSchema = z.object({
  argumentId: z.uuid(),
  side: z.enum(positionSideEnum.enumValues),
});

/** Take or change your free AGREE / AGAINST position. Returns fresh counts. */
export async function setPosition(input: z.input<typeof setPositionSchema>): Promise<ActionResult<PositionSummary>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(setPositionSchema, input);
    await enforceRateLimit(user.id, "position");
    const argument = await loadOpenArgument(data.argumentId);
    await assertNotBlocked(user.id, argument.authorId, "You can't take a position on this argument.");

    const summary = await db.transaction(async (tx) => {
      await upsertPosition(argument.id, user.id, data.side, tx);
      return getPositionSummary(argument.id, user.id, tx);
    });
    return ok(summary);
  });
}

const removePositionSchema = z.object({ argumentId: z.uuid() });

/** Remove your position (allowed even after an argument is closed — it's your data). */
export async function removePosition(
  input: z.input<typeof removePositionSchema>,
): Promise<ActionResult<PositionSummary>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(removePositionSchema, input);
    await enforceRateLimit(user.id, "position");
    const argument = await loadArgument(data.argumentId);

    const summary = await db.transaction(async (tx) => {
      await deletePosition(argument.id, user.id, tx);
      return getPositionSummary(argument.id, user.id, tx);
    });
    return ok(summary);
  });
}

// ---------------------------------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------------------------------

const commentBody = z
  .string()
  .trim()
  .min(1, "Write something first.")
  .max(COMMENT_MAX_LENGTH, "Keep comments under 2,000 characters.");

const createCommentSchema = z.object({
  argumentId: z.uuid(),
  /** The comment being answered: a top-level comment or a reply (which re-attaches to its top-level parent). */
  parentCommentId: z.uuid().optional(),
  body: commentBody,
  /** Tag the comment with your current AGREE/AGAINST position (default true). */
  showPosition: z.boolean().optional().default(true),
  idempotencyKey: idempotencyKeySchema,
});

/** Post a comment or a reply ("Comment (free discussion — not judged)"). */
export async function createComment(input: z.input<typeof createCommentSchema>): Promise<ActionResult<CommentView>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(createCommentSchema, input);

    const result = await withIdempotency(data.idempotencyKey, user.id, "comment.create", async () => {
      await enforceRateLimit(user.id, "comment");
      const argument = await loadOpenArgument(data.argumentId);
      await assertNotBlocked(user.id, argument.authorId, "You can't comment on this argument.");

      let body = data.body;
      let topLevelId: string | null = null;
      let repliedTo: { id: string; authorId: string } | null = null;

      if (data.parentCommentId) {
        const parent = await loadComment(data.parentCommentId);
        if (parent.argumentId !== argument.id) throw new ActionError("VALIDATION", "That reply doesn't belong here.");
        if (parent.status !== "visible") throw new ActionError("FORBIDDEN", "You can't reply to this comment.");
        await assertNotBlocked(user.id, parent.authorId, "You can't reply to this comment.");

        // One level of nesting: a reply to a reply attaches to the top-level comment and names who it answers.
        topLevelId = parent.parentCommentId ?? parent.id;
        if (parent.parentCommentId) {
          const top = await loadComment(parent.parentCommentId);
          if (top.status !== "visible") throw new ActionError("FORBIDDEN", "This thread is closed to new replies.");
          const author = await loadTargetUser(parent.authorId).catch(() => null);
          if (author && parent.authorId !== user.id) body = withLeadingMention(body, author.handle);
        }
        repliedTo = { id: parent.id, authorId: parent.authorId };
      }
      if (body.length > COMMENT_MAX_LENGTH) {
        throw new ActionError("VALIDATION", "Keep comments under 2,000 characters.", {
          body: ["Keep comments under 2,000 characters (including the @mention)."],
        });
      }

      const positionTag = data.showPosition ? await getUserPosition(argument.id, user.id) : null;
      // Spam screening (moderation): "block" refuses the post, "review" posts it and opens an automatic report.
      const assessment = await assessContent(user.id, body);
      assertContentAllowed(assessment);

      const commentId = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(comments)
          .values({
            argumentId: argument.id,
            parentCommentId: topLevelId,
            authorId: user.id,
            body,
            positionTag,
            createdAt: now(),
          })
          .returning({ id: comments.id });
        if (!row) throw new Error("comment insert returned no row");
        await flagForReviewIfNeeded(assessment, { type: "comment", id: row.id }, tx);
        await notifyNewComment(
          {
            actorId: user.id,
            argument: { id: argument.id, title: argument.title, authorId: argument.authorId },
            comment: { id: row.id, body },
            repliedTo,
          },
          tx,
        );
        return row.id;
      });

      const view = await getCommentView(commentId, user.id);
      if (!view) throw new Error("created comment not found");
      return ok(view);
    });

    if (result.ok) revalidatePath(`/a/${data.argumentId}`);
    return result;
  });
}

const editCommentSchema = z.object({ commentId: z.uuid(), body: commentBody });

/** Edit your own visible comment. Newly added @mentions are notified; existing ones are not re-notified. */
export async function editComment(input: z.input<typeof editCommentSchema>): Promise<ActionResult<CommentView>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(editCommentSchema, input);
    await enforceRateLimit(user.id, "comment");
    const comment = await loadComment(data.commentId);
    if (comment.authorId !== user.id) throw new ActionError("FORBIDDEN", "You can only edit your own comments.");
    if (comment.status !== "visible") throw new ActionError("FORBIDDEN", "This comment can't be edited.");
    const argument = await loadOpenArgument(comment.argumentId);

    if (data.body !== comment.body) {
      const assessment = await assessContent(user.id, data.body, [], db, { excludeCommentId: comment.id });
      assertContentAllowed(assessment);
      const before = new Set(extractMentionHandles(comment.body));
      const added = extractMentionHandles(data.body).filter((handle) => !before.has(handle));
      await db.transaction(async (tx) => {
        await tx
          .update(comments)
          .set({ body: data.body, editedAt: now() })
          .where(and(eq(comments.id, comment.id), eq(comments.authorId, user.id)));
        await flagForReviewIfNeeded(assessment, { type: "comment", id: comment.id }, tx);
        await notifyMentions(
          {
            actorId: user.id,
            argument: { id: argument.id, title: argument.title, authorId: argument.authorId },
            comment: { id: comment.id, body: data.body },
          },
          added,
          tx,
        );
      });
    }

    const view = await getCommentView(comment.id, user.id);
    if (!view) throw new Error("edited comment not found");
    revalidatePath(`/a/${comment.argumentId}`);
    return ok(view);
  });
}

const deleteCommentSchema = z.object({ commentId: z.uuid() });

/**
 * Delete your own comment. It becomes a "removed" placeholder (replies and any challenge started from it
 * keep their context); the original text is kept in the audit log for moderation.
 */
export async function deleteComment(
  input: z.input<typeof deleteCommentSchema>,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(deleteCommentSchema, input);
    const comment = await loadComment(data.commentId);
    if (comment.authorId !== user.id) throw new ActionError("FORBIDDEN", "You can only delete your own comments.");

    if (comment.status !== "removed") {
      await db.transaction(async (tx) => {
        await tx.update(comments).set({ status: "removed" }).where(eq(comments.id, comment.id));
        await writeAudit(
          {
            actorId: user.id,
            action: "comment.delete_own",
            targetType: "comment",
            targetId: comment.id,
            before: { status: comment.status, body: comment.body },
            after: { status: "removed" },
          },
          tx,
        );
      });
    }
    revalidatePath(`/a/${comment.argumentId}`);
    return ok({ id: comment.id });
  });
}

// ---------------------------------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------------------------------

const setReactionSchema = z.object({
  targetType: z.enum(reactionTargetEnum.enumValues),
  targetId: z.uuid(),
  type: z.enum(reactionTypeEnum.enumValues).optional().default(DEFAULT_REACTION),
  /** true = react, false = take the reaction back. */
  active: z.boolean(),
});

async function assertCanReact(userId: string, targetType: ReactionTarget, targetId: string): Promise<void> {
  if (targetType === "argument") {
    const argument = await loadOpenArgument(targetId);
    if (argument.authorId === userId) throw new ActionError("FORBIDDEN", "You can't react to your own post.");
    await assertNotBlocked(userId, argument.authorId, BLOCKED_MESSAGE);
    return;
  }
  const comment = await loadComment(targetId);
  if (comment.status !== "visible") throw new ActionError("FORBIDDEN", "This comment isn't available.");
  if (comment.authorId === userId) throw new ActionError("FORBIDDEN", "You can't react to your own comment.");
  await loadOpenArgument(comment.argumentId);
  await assertNotBlocked(userId, comment.authorId, BLOCKED_MESSAGE);
}

/** Set your reaction on an argument or comment on/off (idempotent). Taking a reaction back always works. */
export async function setReaction(input: z.input<typeof setReactionSchema>): Promise<ActionResult<ReactionSummary>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(setReactionSchema, input);
    await enforceRateLimit(user.id, "reaction");
    if (data.active) await assertCanReact(user.id, data.targetType, data.targetId);

    await setReactionRow(user.id, data.targetType, data.targetId, data.type, data.active, db);
    return ok(await getReactionSummary(data.targetType, data.targetId, user.id, data.type));
  });
}

// ---------------------------------------------------------------------------------------------------
// Follows
// ---------------------------------------------------------------------------------------------------

const userTargetSchema = z.object({ userId: z.uuid() });

export async function followUser(input: z.input<typeof userTargetSchema>): Promise<ActionResult<FollowState>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(userTargetSchema, input);
    if (data.userId === user.id) throw new ActionError("VALIDATION", "You can't follow yourself.");
    await enforceRateLimit(user.id, "follow");
    const target = await loadTargetUser(data.userId);
    await assertNotBlocked(user.id, target.id, BLOCKED_MESSAGE);

    const state = await db.transaction(async (tx) => {
      const created = await insertFollow(user.id, target.id, tx);
      if (created) {
        await notify(
          {
            userId: target.id,
            actorId: user.id,
            type: "follow",
            targetType: "user",
            targetId: user.id,
            data: { handle: user.handle, displayName: user.displayName },
          },
          tx,
        );
      }
      return getFollowState(target.id, user.id, tx);
    });
    revalidatePath(`/u/${target.handle}`);
    return ok(state);
  });
}

export async function unfollowUser(input: z.input<typeof userTargetSchema>): Promise<ActionResult<FollowState>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(userTargetSchema, input);
    await enforceRateLimit(user.id, "follow");
    const target = await loadTargetUser(data.userId);

    const state = await db.transaction(async (tx) => {
      await deleteFollow(user.id, target.id, tx);
      return getFollowState(target.id, user.id, tx);
    });
    revalidatePath(`/u/${target.handle}`);
    return ok(state);
  });
}

// ---------------------------------------------------------------------------------------------------
// Blocks — never rate limited: a safety tool must always work.
// ---------------------------------------------------------------------------------------------------

/**
 * Block a user: both of you stop seeing each other's content, you can't interact or challenge each other,
 * and existing follows between you are removed. They are not told.
 */
export async function blockUser(input: z.input<typeof userTargetSchema>): Promise<ActionResult<BlockState>> {
  return runAction(async () => {
    const user = await requireUser({ allowSuspended: true });
    const data = parseInput(userTargetSchema, input);
    if (data.userId === user.id) throw new ActionError("VALIDATION", "You can't block yourself.");
    const target = await loadTargetUser(data.userId);

    await db.transaction(async (tx) => {
      const created = await createBlock(user.id, target.id, tx);
      if (created) {
        // A block also ends any PENDING challenge between the two (active debates are untouched, design §4.2).
        const challengesClosed = await onUsersBlocked(user.id, target.id, tx);
        await writeAudit(
          { actorId: user.id, action: "social.block", targetType: "user", targetId: target.id, after: { challengesClosed } },
          tx,
        );
      }
    });
    revalidatePath("/settings");
    revalidatePath(`/u/${target.handle}`);
    return ok({ userId: target.id, blocked: true });
  });
}

export async function unblockUser(input: z.input<typeof userTargetSchema>): Promise<ActionResult<BlockState>> {
  return runAction(async () => {
    const user = await requireUser({ allowSuspended: true });
    const data = parseInput(userTargetSchema, input);
    const target = await loadTargetUser(data.userId);

    await db.transaction(async (tx) => {
      const removed = await removeBlock(user.id, target.id, tx);
      if (removed) {
        await writeAudit({ actorId: user.id, action: "social.unblock", targetType: "user", targetId: target.id }, tx);
      }
    });
    revalidatePath("/settings");
    revalidatePath(`/u/${target.handle}`);
    return ok({ userId: target.id, blocked: false });
  });
}
