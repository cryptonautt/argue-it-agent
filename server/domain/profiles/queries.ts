import "server-only";

import { and, asc, count, desc, eq, inArray, lt, ne, or, type SQL } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import { normalizeHandle, HANDLE_PATTERN } from "@domain/lib/handles";
import type { NotificationPrefs } from "@domain/lib/notification-prefs";
import { db, type DbOrTx } from "@domain/db";
import {
  argumentsTable,
  categories,
  comments,
  competitionParticipants,
  competitions,
  profiles,
  users,
  verdicts,
  type CompetitionSide,
  type CompetitionStatus,
  type UserStatus,
} from "@domain/db/schema";
import { HISTORY_STATUSES, debateResultFor, type DebateResult } from "./history";

/**
 * Read models for /u/[handle], /settings and /welcome. Returned shapes are plain JSON (ISO date strings)
 * so they can be passed straight to client components.
 */

export const HISTORY_PAGE_SIZE = 20;
export const ARGUMENTS_PAGE_SIZE = 20;

export interface PublicProfile {
  userId: string;
  handle: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  joinedAt: string;
  status: UserStatus;
  interests: string[];
}

/** Look a profile up by handle (case-insensitive, "@" optional). Deleted accounts are returned with status "deleted". */
export async function getProfileByHandle(rawHandle: string, conn: DbOrTx = db): Promise<PublicProfile | null> {
  const handle = normalizeHandle(rawHandle);
  if (!HANDLE_PATTERN.test(handle)) return null;
  const [row] = await conn
    .select({
      userId: profiles.userId,
      handle: profiles.handle,
      displayName: profiles.displayName,
      bio: profiles.bio,
      avatarUrl: profiles.avatarUrl,
      interests: profiles.interests,
      joinedAt: users.createdAt,
      status: users.status,
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.handle, handle))
    .limit(1);
  return row ? { ...row, joinedAt: row.joinedAt.toISOString() } : null;
}

export async function getProfileByUserId(userId: string, conn: DbOrTx = db): Promise<PublicProfile | null> {
  const [row] = await conn
    .select({
      userId: profiles.userId,
      handle: profiles.handle,
      displayName: profiles.displayName,
      bio: profiles.bio,
      avatarUrl: profiles.avatarUrl,
      interests: profiles.interests,
      joinedAt: users.createdAt,
      status: users.status,
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.userId, userId))
    .limit(1);
  return row ? { ...row, joinedAt: row.joinedAt.toISOString() } : null;
}

/** Visible comments written by the user (community signal — never part of the rating). */
export async function getCommentCount(userId: string, conn: DbOrTx = db): Promise<number> {
  const [row] = await conn
    .select({ n: count() })
    .from(comments)
    .where(and(eq(comments.authorId, userId), eq(comments.status, "visible")));
  return row?.n ?? 0;
}

export async function getArgumentCount(userId: string, conn: DbOrTx = db): Promise<number> {
  const [row] = await conn
    .select({ n: count() })
    .from(argumentsTable)
    .where(and(eq(argumentsTable.authorId, userId), eq(argumentsTable.status, "visible")));
  return row?.n ?? 0;
}

// --- Cursors ------------------------------------------------------------------------------------------

/** Opaque keyset cursor "<iso timestamp>~<uuid>". */
export function encodeCursor(at: Date, id: string): string {
  return `${at.toISOString()}~${id}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeCursor(raw: string | null | undefined): { at: Date; id: string } | null {
  if (!raw) return null;
  const [iso, id] = raw.split("~");
  if (!iso || !id || !UUID_RE.test(id)) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : { at, id };
}

function keysetBefore(atColumn: AnyPgColumn, idColumn: AnyPgColumn, cursor: { at: Date; id: string } | null): SQL | undefined {
  if (!cursor) return undefined;
  return or(lt(atColumn, cursor.at), and(eq(atColumn, cursor.at), lt(idColumn, cursor.id)));
}

// --- Debate history -----------------------------------------------------------------------------------

export interface DebateHistoryItem {
  competitionId: string;
  proposition: string;
  argumentId: string;
  /** The root argument was hidden or removed by moderators: show a placeholder, not its text. */
  argumentUnavailable: boolean;
  category: { slug: string; name: string };
  side: CompetitionSide;
  status: CompetitionStatus;
  result: DebateResult;
  underAppeal: boolean;
  opponent: { userId: string; handle: string; displayName: string; avatarUrl: string | null; deleted: boolean };
  /** When the debate started (accepted) or was sent. */
  startedAt: string;
  completedAt: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Started challenges the user took part in, newest first, with this user's result. */
export async function getDebateHistory(
  userId: string,
  options: { cursor?: string | null; limit?: number } = {},
  conn: DbOrTx = db,
): Promise<Page<DebateHistoryItem>> {
  const limit = Math.min(Math.max(options.limit ?? HISTORY_PAGE_SIZE, 1), 50);
  const cursor = decodeCursor(options.cursor);
  const me = competitionParticipants;
  const opp = alias(competitionParticipants, "opp");
  const oppProfile = alias(profiles, "opp_profile");
  const oppUser = alias(users, "opp_user");

  const rows = await conn
    .select({
      competitionId: competitions.id,
      status: competitions.status,
      snapshot: competitions.rulesSnapshot,
      sentAt: competitions.sentAt,
      acceptedAt: competitions.acceptedAt,
      completedAt: competitions.completedAt,
      side: me.side,
      argumentId: argumentsTable.id,
      argumentStatus: argumentsTable.status,
      categorySlug: categories.slug,
      categoryName: categories.name,
      opponentId: opp.userId,
      opponentHandle: oppProfile.handle,
      opponentName: oppProfile.displayName,
      opponentAvatar: oppProfile.avatarUrl,
      opponentStatus: oppUser.status,
      verdictOutcome: verdicts.outcome,
      verdictWinner: verdicts.winnerUserId,
    })
    .from(me)
    .innerJoin(competitions, eq(competitions.id, me.competitionId))
    .innerJoin(opp, and(eq(opp.competitionId, competitions.id), ne(opp.userId, me.userId)))
    .innerJoin(oppUser, eq(oppUser.id, opp.userId))
    .leftJoin(oppProfile, eq(oppProfile.userId, opp.userId))
    .innerJoin(argumentsTable, eq(argumentsTable.id, competitions.rootArgumentId))
    .innerJoin(categories, eq(categories.id, competitions.categoryId))
    .leftJoin(verdicts, and(eq(verdicts.competitionId, competitions.id), eq(verdicts.isCurrent, true)))
    .where(
      and(
        eq(me.userId, userId),
        inArray(competitions.status, HISTORY_STATUSES),
        keysetBefore(competitions.sentAt, competitions.id, cursor),
      ),
    )
    .orderBy(desc(competitions.sentAt), desc(competitions.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      competitionId: r.competitionId,
      proposition: r.snapshot.proposition,
      argumentId: r.argumentId,
      argumentUnavailable: r.argumentStatus !== "visible",
      category: { slug: r.categorySlug, name: r.categoryName },
      side: r.side,
      status: r.status,
      result: debateResultFor({
        status: r.status,
        side: r.side,
        userId,
        verdict: r.verdictOutcome ? { outcome: r.verdictOutcome, winnerUserId: r.verdictWinner } : null,
      }),
      underAppeal: r.status === "under_appeal",
      opponent: {
        userId: r.opponentId,
        handle: r.opponentHandle ?? "unknown",
        displayName: r.opponentName ?? "Unknown user",
        avatarUrl: r.opponentAvatar,
        deleted: r.opponentStatus === "deleted",
      },
      startedAt: (r.acceptedAt ?? r.sentAt).toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.sentAt, last.competitionId) : null,
  };
}

// --- Arguments posted ---------------------------------------------------------------------------------

export interface PostedArgument {
  id: string;
  title: string;
  proposition: string;
  category: { slug: string; name: string };
  createdAt: string;
}

export async function getPostedArguments(
  userId: string,
  options: { cursor?: string | null; limit?: number } = {},
  conn: DbOrTx = db,
): Promise<Page<PostedArgument>> {
  const limit = Math.min(Math.max(options.limit ?? ARGUMENTS_PAGE_SIZE, 1), 50);
  const cursor = decodeCursor(options.cursor);
  const rows = await conn
    .select({
      id: argumentsTable.id,
      title: argumentsTable.title,
      proposition: argumentsTable.proposition,
      createdAt: argumentsTable.createdAt,
      slug: categories.slug,
      name: categories.name,
    })
    .from(argumentsTable)
    .innerJoin(categories, eq(categories.id, argumentsTable.categoryId))
    .where(
      and(
        eq(argumentsTable.authorId, userId),
        eq(argumentsTable.status, "visible"),
        keysetBefore(argumentsTable.createdAt, argumentsTable.id, cursor),
      ),
    )
    .orderBy(desc(argumentsTable.createdAt), desc(argumentsTable.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.id,
      title: r.title,
      proposition: r.proposition,
      category: { slug: r.slug, name: r.name },
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

// --- Categories (onboarding / settings) ---------------------------------------------------------------

export interface CategoryOption {
  slug: string;
  name: string;
  description: string;
}

export async function getActiveCategories(conn: DbOrTx = db): Promise<CategoryOption[]> {
  return conn
    .select({ slug: categories.slug, name: categories.name, description: categories.description })
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.sort), asc(categories.name));
}

/** Competitions that block account deletion: the user still owes the other side a fair contest. */
export const DELETE_BLOCKING_STATUSES = ["pending_acceptance", "active"] as const satisfies readonly CompetitionStatus[];

export async function countBlockingCompetitions(userId: string, conn: DbOrTx = db): Promise<number> {
  const [row] = await conn
    .select({ n: count() })
    .from(competitionParticipants)
    .innerJoin(competitions, eq(competitions.id, competitionParticipants.competitionId))
    .where(and(eq(competitionParticipants.userId, userId), inArray(competitions.status, DELETE_BLOCKING_STATUSES)));
  return row?.n ?? 0;
}

/** The user's stored notification opt-outs (Settings → Notifications). */
export async function getNotificationPrefs(userId: string, conn: DbOrTx = db): Promise<NotificationPrefs> {
  const [row] = await conn
    .select({ prefs: profiles.notificationPrefs })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return row?.prefs ?? {};
}
