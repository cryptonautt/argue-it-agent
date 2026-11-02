import "server-only";

import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@domain/db";
import { comments, profiles, users, type ContentStatus, type PositionSide } from "@domain/db/schema";
import { getBlockedUserIds } from "./blocks";
import { decodeCursor, encodeCursor } from "./cursor";
import { getReactionCounts, type ReactionCounts } from "./reactions";
import type { CommentPage, CommentState, CommentThreadView, CommentView } from "./types";

/**
 * Comments (design §4.1): free discussion, never judged. Top-level comments + ONE level of replies
 * (`parent_comment_id` always points at a top-level comment). Top-level comments are paginated newest
 * first; replies within a thread read oldest first, like a conversation.
 */

export const COMMENT_MAX_LENGTH = 2000;
export const COMMENTS_PAGE_SIZE = 20;
export const MAX_REPLIES_PER_THREAD = 100;

export interface CommentRow {
  id: string;
  argumentId: string;
  parentCommentId: string | null;
  authorId: string;
  body: string;
  positionTag: PositionSide | null;
  status: ContentStatus;
  createdAt: Date;
  editedAt: Date | null;
  authorStatus: "active" | "suspended" | "deleted" | null;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

const commentColumns = {
  id: comments.id,
  argumentId: comments.argumentId,
  parentCommentId: comments.parentCommentId,
  authorId: comments.authorId,
  body: comments.body,
  positionTag: comments.positionTag,
  status: comments.status,
  createdAt: comments.createdAt,
  editedAt: comments.editedAt,
  authorStatus: users.status,
  handle: profiles.handle,
  displayName: profiles.displayName,
  avatarUrl: profiles.avatarUrl,
};

async function selectCommentRows(where: SQL | undefined, conn: DbOrTx, orderBy: SQL[], limit?: number) {
  const query = conn
    .select(commentColumns)
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .leftJoin(profiles, eq(profiles.userId, comments.authorId))
    .where(where)
    .orderBy(...orderBy);
  return limit === undefined ? await query : await query.limit(limit);
}

/** Millisecond-truncated created_at: cursors carry JS (ms) precision while Postgres stores µs. */
const createdAtMs = sql`date_trunc('milliseconds', ${comments.createdAt})`;

/** Decide what a viewer may see of a comment (pure). */
export function resolveCommentState(
  status: ContentStatus,
  options: { isOwn: boolean; authorBlocked: boolean },
): CommentState {
  if (status === "removed") return "removed";
  if (!options.isOwn && options.authorBlocked) return "unavailable";
  if (status === "hidden") return "hidden";
  return "visible";
}

export interface CommentViewContext {
  viewerId: string | null;
  /** Users in a block relationship with the viewer (either direction). */
  blockedIds: ReadonlySet<string>;
  reactions: ReactionCounts;
}

/** Build the viewer-specific view of a comment row (pure). Placeholders carry no text and no author. */
export function toCommentView(row: CommentRow, ctx: CommentViewContext): CommentView {
  const isOwn = ctx.viewerId !== null && row.authorId === ctx.viewerId;
  const state = resolveCommentState(row.status, { isOwn, authorBlocked: ctx.blockedIds.has(row.authorId) });
  // Visible comments, and an author's own hidden comment, keep their content.
  const readable = state === "visible" || (state === "hidden" && isOwn);
  const authorKnown = row.handle !== null && row.displayName !== null && row.authorStatus !== "deleted";
  const reaction = ctx.reactions.get(row.id);
  return {
    id: row.id,
    argumentId: row.argumentId,
    parentCommentId: row.parentCommentId,
    state,
    body: readable ? row.body : null,
    author:
      readable && authorKnown
        ? { id: row.authorId, handle: row.handle ?? "", displayName: row.displayName ?? "", avatarUrl: row.avatarUrl }
        : null,
    positionTag: readable ? row.positionTag : null,
    createdAt: row.createdAt.toISOString(),
    editedAt: readable && row.editedAt ? row.editedAt.toISOString() : null,
    isOwn,
    reactions: { count: reaction?.count ?? 0, viewerReacted: reaction?.viewerReacted ?? false },
  };
}

/** A view is worth showing on its own when it has readable content. */
function hasContent(view: CommentView): boolean {
  return view.body !== null;
}

/**
 * Assemble threads (pure). Rules:
 *  - replies from blocked users are dropped entirely (blocks hide content both ways);
 *  - removed/hidden replies stay as placeholders so the conversation still makes sense;
 *  - a top-level placeholder is kept only while it has at least one reply with content.
 */
export function assembleThreads(topLevel: CommentView[], replies: CommentView[]): CommentThreadView[] {
  const byParent = new Map<string, CommentView[]>();
  for (const reply of replies) {
    if (reply.state === "unavailable" || reply.parentCommentId === null) continue;
    const list = byParent.get(reply.parentCommentId) ?? [];
    list.push(reply);
    byParent.set(reply.parentCommentId, list);
  }
  const threads: CommentThreadView[] = [];
  for (const comment of topLevel) {
    const threadReplies = byParent.get(comment.id) ?? [];
    if (!hasContent(comment) && !threadReplies.some(hasContent)) continue;
    threads.push({ comment, replies: threadReplies });
  }
  return threads;
}

export interface ListCommentThreadsInput {
  argumentId: string;
  viewerId: string | null;
  cursor?: string | null;
  limit?: number;
}

/** One page of top-level comments (newest first) with their replies, as seen by `viewerId`. */
export async function listCommentThreads(
  { argumentId, viewerId, cursor, limit = COMMENTS_PAGE_SIZE }: ListCommentThreadsInput,
  conn: DbOrTx = db,
): Promise<CommentPage> {
  const after = decodeCursor(cursor);
  const pageSize = Math.min(Math.max(limit, 1), 50);
  const topRows = await selectCommentRows(
    and(
      eq(comments.argumentId, argumentId),
      isNull(comments.parentCommentId),
      after
        ? sql`(${createdAtMs}, ${comments.id}) < (${after.createdAt.toISOString()}::timestamptz, ${after.id}::uuid)`
        : undefined,
    ),
    conn,
    [desc(createdAtMs), desc(comments.id)],
    pageSize + 1,
  );
  const hasMore = topRows.length > pageSize;
  const pageRows = hasMore ? topRows.slice(0, pageSize) : topRows;
  const last = pageRows[pageRows.length - 1];

  const replyRows =
    pageRows.length === 0
      ? []
      : await selectCommentRows(
          inArray(
            comments.parentCommentId,
            pageRows.map((r) => r.id),
          ),
          conn,
          [asc(createdAtMs), asc(comments.id)],
        );
  const repliesPerParent = new Map<string, number>();
  const cappedReplies = replyRows.filter((row) => {
    const key = row.parentCommentId ?? "";
    const n = (repliesPerParent.get(key) ?? 0) + 1;
    repliesPerParent.set(key, n);
    return n <= MAX_REPLIES_PER_THREAD;
  });

  const ctx: CommentViewContext = {
    viewerId,
    blockedIds: viewerId ? await getBlockedUserIds(viewerId, conn) : new Set(),
    reactions: await getReactionCounts(
      "comment",
      [...pageRows, ...cappedReplies].filter((r) => r.status === "visible").map((r) => r.id),
      viewerId,
      undefined,
      conn,
    ),
  };
  const threads = assembleThreads(
    pageRows.map((row) => toCommentView(row, ctx)),
    cappedReplies.map((row) => toCommentView(row, ctx)),
  );
  return {
    threads,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

/** A single comment as seen by `viewerId` (null if it doesn't exist). */
export async function getCommentView(
  commentId: string,
  viewerId: string | null,
  conn: DbOrTx = db,
): Promise<CommentView | null> {
  const [row] = await selectCommentRows(eq(comments.id, commentId), conn, [], 1);
  if (!row) return null;
  return toCommentView(row, {
    viewerId,
    blockedIds: viewerId ? await getBlockedUserIds(viewerId, conn) : new Set(),
    reactions: await getReactionCounts("comment", [row.id], viewerId, undefined, conn),
  });
}

/** Visible comment counts (top-level + replies) for many arguments (argument page / feed cards). */
export async function getCommentCounts(argumentIds: readonly string[], conn: DbOrTx = db): Promise<Map<string, number>> {
  const result = new Map<string, number>(argumentIds.map((id) => [id, 0]));
  if (argumentIds.length === 0) return result;
  const rows = await conn
    .select({ argumentId: comments.argumentId, n: count() })
    .from(comments)
    .where(and(inArray(comments.argumentId, [...new Set(argumentIds)]), eq(comments.status, "visible")))
    .groupBy(comments.argumentId);
  for (const row of rows) result.set(row.argumentId, row.n);
  return result;
}
