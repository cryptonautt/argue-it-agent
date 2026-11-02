import "server-only";

import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@domain/db";
import type { NotificationData } from "@domain/db/json-types";
import {
  appeals,
  comments,
  notifications,
  profiles,
  submissions,
  users,
  verdicts,
  type NotificationType,
  type TargetType,
} from "@domain/db/schema";
import { notBlockedWith } from "@domain/social/blocks";
import { decodeCursor, encodeCursor } from "@domain/social/cursor";
import type { UserChip } from "@domain/social/types";

/**
 * Read side of in-app notifications (design §5.2, PRD §8.8). `notify()` (index.ts, Foundation) writes;
 * this module lists, counts and resolves where each notification should link to.
 * Notifications from accounts in a block relationship with the recipient are hidden (blocks work both ways).
 */

export const NOTIFICATIONS_PAGE_SIZE = 30;

/** Ids needed to build a link, resolved from the target row (falls back to hints in `data`). */
export interface NotificationLinkContext {
  argumentId?: string;
  commentId?: string;
  competitionId?: string;
  handle?: string;
}

export interface NotificationRecord {
  id: string;
  type: NotificationType;
  targetType: TargetType;
  targetId: string;
  data: NotificationData;
  read: boolean;
  createdAt: string;
  actor: UserChip | null;
  context: NotificationLinkContext;
}

export interface NotificationPage {
  items: NotificationRecord[];
  nextCursor: string | null;
}

export type NotificationFilter = "all" | "unread";

const createdAtMs = sql`date_trunc('milliseconds', ${notifications.createdAt})`;

function visibleTo(userId: string) {
  return and(eq(notifications.userId, userId), notBlockedWith(userId, notifications.actorId));
}

export async function countUnreadNotifications(userId: string, conn: DbOrTx = db): Promise<number> {
  const [row] = await conn
    .select({ n: count() })
    .from(notifications)
    .where(and(visibleTo(userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export async function listNotifications(
  userId: string,
  options: { filter?: NotificationFilter; cursor?: string | null; limit?: number } = {},
  conn: DbOrTx = db,
): Promise<NotificationPage> {
  const { filter = "all", limit = NOTIFICATIONS_PAGE_SIZE } = options;
  const after = decodeCursor(options.cursor);
  const pageSize = Math.min(Math.max(limit, 1), 100);

  const rows = await conn
    .select({
      id: notifications.id,
      type: notifications.type,
      targetType: notifications.targetType,
      targetId: notifications.targetId,
      data: notifications.data,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      actorId: notifications.actorId,
      actorStatus: users.status,
      actorHandle: profiles.handle,
      actorDisplayName: profiles.displayName,
      actorAvatarUrl: profiles.avatarUrl,
    })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.actorId))
    .leftJoin(profiles, eq(profiles.userId, notifications.actorId))
    .where(
      and(
        visibleTo(userId),
        filter === "unread" ? isNull(notifications.readAt) : undefined,
        after
          ? sql`(${createdAtMs}, ${notifications.id}) < (${after.createdAt.toISOString()}::timestamptz, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(createdAtMs), desc(notifications.id))
    .limit(pageSize + 1);

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const contexts = await resolveLinkContexts(page, conn);
  const last = page[page.length - 1];

  return {
    items: page.map((row) => ({
      id: row.id,
      type: row.type,
      targetType: row.targetType,
      targetId: row.targetId,
      data: row.data,
      read: row.readAt !== null,
      createdAt: row.createdAt.toISOString(),
      actor:
        row.actorId && row.actorHandle && row.actorDisplayName && row.actorStatus !== "deleted"
          ? { id: row.actorId, handle: row.actorHandle, displayName: row.actorDisplayName, avatarUrl: row.actorAvatarUrl }
          : null,
      context: contexts.get(row.id) ?? {},
    })),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

function dataString(data: NotificationData, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

interface ContextRow {
  id: string;
  targetType: TargetType;
  targetId: string;
  data: NotificationData;
}

/** Batch-resolve link ids for a page of notifications (one query per target table, not per row). */
async function resolveLinkContexts(
  rows: readonly ContextRow[],
  conn: DbOrTx,
): Promise<Map<string, NotificationLinkContext>> {
  const idsOf = (...types: TargetType[]) => [
    ...new Set(rows.filter((r) => types.includes(r.targetType)).map((r) => r.targetId)),
  ];

  const commentIds = idsOf("comment");
  const verdictIds = idsOf("verdict");
  const appealIds = idsOf("appeal");
  const submissionIds = idsOf("submission");
  const userIds = idsOf("user", "profile");

  const [commentRows, verdictRows, appealRows, submissionRows, profileRows] = await Promise.all([
    commentIds.length
      ? conn
          .select({ id: comments.id, argumentId: comments.argumentId })
          .from(comments)
          .where(inArray(comments.id, commentIds))
      : [],
    verdictIds.length
      ? conn
          .select({ id: verdicts.id, competitionId: verdicts.competitionId })
          .from(verdicts)
          .where(inArray(verdicts.id, verdictIds))
      : [],
    appealIds.length
      ? conn
          .select({ id: appeals.id, competitionId: appeals.competitionId })
          .from(appeals)
          .where(inArray(appeals.id, appealIds))
      : [],
    submissionIds.length
      ? conn
          .select({ id: submissions.id, competitionId: submissions.competitionId })
          .from(submissions)
          .where(inArray(submissions.id, submissionIds))
      : [],
    userIds.length
      ? conn
          .select({ id: profiles.userId, handle: profiles.handle })
          .from(profiles)
          .where(inArray(profiles.userId, userIds))
      : [],
  ]);

  const commentArgument = new Map(commentRows.map((r) => [r.id, r.argumentId]));
  const competitionOf = new Map<string, string>([
    ...verdictRows.map((r) => [r.id, r.competitionId] as const),
    ...appealRows.map((r) => [r.id, r.competitionId] as const),
    ...submissionRows.map((r) => [r.id, r.competitionId] as const),
  ]);
  const handleOf = new Map(profileRows.map((r) => [r.id, r.handle]));

  const result = new Map<string, NotificationLinkContext>();
  for (const row of rows) {
    const hints: NotificationLinkContext = {
      argumentId: dataString(row.data, "argumentId"),
      commentId: dataString(row.data, "commentId"),
      competitionId: dataString(row.data, "competitionId"),
      handle: dataString(row.data, "handle"),
    };
    let resolved: NotificationLinkContext = {};
    switch (row.targetType) {
      case "argument":
        resolved = { argumentId: row.targetId };
        break;
      case "comment":
        resolved = { argumentId: commentArgument.get(row.targetId), commentId: hints.commentId ?? row.targetId };
        break;
      case "competition":
        resolved = { competitionId: row.targetId };
        break;
      case "verdict":
      case "appeal":
      case "submission":
        resolved = { competitionId: competitionOf.get(row.targetId) };
        break;
      case "user":
      case "profile":
        resolved = { handle: handleOf.get(row.targetId) };
        break;
      default:
        break;
    }
    result.set(row.id, {
      argumentId: resolved.argumentId ?? hints.argumentId,
      commentId: resolved.commentId ?? hints.commentId,
      competitionId: resolved.competitionId ?? hints.competitionId,
      handle: resolved.handle ?? hints.handle,
    });
  }
  return result;
}
