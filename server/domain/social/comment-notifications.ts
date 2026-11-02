import "server-only";

import { inArray } from "drizzle-orm";
import type { DbOrTx } from "@domain/db";
import { profiles } from "@domain/db/schema";
import { notify } from "@domain/notifications";
import { getBlockedUserIds } from "./blocks";
import { extractMentionHandles } from "./mentions";

/**
 * Who hears about a new comment (design §4.1, PRD §8.8):
 *  - top-level comment → the argument author ("argument_comment", target = argument);
 *  - reply → the author of the comment being answered ("comment_reply", target = that comment);
 *  - every @mentioned user ("mention", target = the new comment).
 * Each person gets at most one notification per comment. Nobody in a block relationship with the
 * commenter (either direction) is notified. notify() itself skips self-notifications and dedupes
 * repeats of the same (recipient, type, target, actor) within 10 minutes.
 */

export const EXCERPT_LENGTH = 140;

export function excerpt(text: string, max = EXCERPT_LENGTH): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export interface CommentEvent {
  actorId: string;
  argument: { id: string; title: string; authorId: string };
  comment: { id: string; body: string };
  /** For replies: the comment being answered (top-level comment or a reply in the same thread). */
  repliedTo: { id: string; authorId: string } | null;
}

/** Resolve @handles to user ids (unknown handles are ignored). */
export async function resolveMentionedUserIds(handles: readonly string[], tx: DbOrTx): Promise<string[]> {
  if (handles.length === 0) return [];
  const rows = await tx
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(inArray(profiles.handle, [...handles]));
  return rows.map((row) => row.userId);
}

/** Everyone who must not hear about this comment: blocks with the commenter or with the argument author. */
async function excludedRecipients(actorId: string, argumentAuthorId: string, tx: DbOrTx): Promise<Set<string>> {
  // Sequential on purpose: `tx` is a single connection.
  const withActor = await getBlockedUserIds(actorId, tx);
  const withAuthor = await getBlockedUserIds(argumentAuthorId, tx);
  return new Set([...withActor, ...withAuthor]);
}

export async function notifyNewComment(event: CommentEvent, tx: DbOrTx): Promise<void> {
  const blocked = await excludedRecipients(event.actorId, event.argument.authorId, tx);
  const notified = new Set<string>([event.actorId]);
  const data = {
    argumentId: event.argument.id,
    argumentTitle: event.argument.title,
    commentId: event.comment.id,
    excerpt: excerpt(event.comment.body),
  };

  const send = async (userId: string, fn: () => Promise<unknown>) => {
    if (notified.has(userId) || blocked.has(userId)) return;
    notified.add(userId);
    await fn();
  };

  if (event.repliedTo) {
    const repliedTo = event.repliedTo;
    await send(repliedTo.authorId, () =>
      notify(
        {
          userId: repliedTo.authorId,
          actorId: event.actorId,
          type: "comment_reply",
          targetType: "comment",
          targetId: repliedTo.id,
          data: { ...data, parentCommentId: repliedTo.id },
        },
        tx,
      ),
    );
  } else {
    await send(event.argument.authorId, () =>
      notify(
        {
          userId: event.argument.authorId,
          actorId: event.actorId,
          type: "argument_comment",
          targetType: "argument",
          targetId: event.argument.id,
          data,
        },
        tx,
      ),
    );
  }

  await notifyMentions(event, extractMentionHandles(event.comment.body), tx, { blocked, notified });
}

/**
 * Notify `handles` mentioned in a comment. Used on create and on edit (pass only the newly added handles
 * so an edit never re-notifies people who were already mentioned).
 */
export async function notifyMentions(
  event: Pick<CommentEvent, "actorId" | "argument" | "comment">,
  handles: readonly string[],
  tx: DbOrTx,
  state?: { blocked: ReadonlySet<string>; notified: Set<string> },
): Promise<void> {
  if (handles.length === 0) return;
  // Never point anyone at content hidden from them by a block (with the commenter or the argument author).
  const blocked = state?.blocked ?? (await excludedRecipients(event.actorId, event.argument.authorId, tx));
  const notified = state?.notified ?? new Set<string>([event.actorId]);
  for (const userId of await resolveMentionedUserIds(handles, tx)) {
    if (notified.has(userId) || blocked.has(userId)) continue;
    notified.add(userId);
    await notify(
      {
        userId,
        actorId: event.actorId,
        type: "mention",
        targetType: "comment",
        targetId: event.comment.id,
        data: {
          argumentId: event.argument.id,
          argumentTitle: event.argument.title,
          commentId: event.comment.id,
          excerpt: excerpt(event.comment.body),
        },
      },
      tx,
    );
  }
}
