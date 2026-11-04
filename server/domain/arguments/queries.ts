import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@domain/db";
import {
  argumentsTable,
  auditLogs,
  categories,
  competitions,
  profiles,
  users,
  type ContentStatus,
} from "@domain/db/schema";
import { hasBlocked } from "@domain/social/blocks";
import { loadCards } from "./cards";
import type { ArgumentAuthorSummary, ArgumentCardData, CategoryOption } from "./types";

export const ARGUMENT_DELETE_AUDIT_ACTION = "argument.delete";

export async function listActiveCategories(conn: DbOrTx = db): Promise<CategoryOption[]> {
  return conn
    .select({ id: categories.id, slug: categories.slug, name: categories.name, description: categories.description })
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.sort), asc(categories.name));
}

/** True once any challenge on the argument has been accepted (design §2: editing locks at that point). */
export async function hasAcceptedChallenge(argumentId: string, conn: DbOrTx = db): Promise<boolean> {
  const [row] = await conn
    .select({ id: competitions.id })
    .from(competitions)
    .where(and(eq(competitions.rootArgumentId, argumentId), isNotNull(competitions.acceptedAt)))
    .limit(1);
  return row !== undefined;
}

/** Debates on the argument that are pending, running, being judged or under review (not finished/cancelled). */
export async function hasOpenDebates(argumentId: string, conn: DbOrTx = db): Promise<boolean> {
  const [row] = await conn
    .select({ id: competitions.id })
    .from(competitions)
    .where(
      and(
        eq(competitions.rootArgumentId, argumentId),
        inArray(competitions.status, ["pending_acceptance", "active", "locked", "evaluating", "under_appeal", "needs_review"]),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export interface ArgumentDetail {
  id: string;
  title: string;
  proposition: string;
  body: string;
  links: string[];
  /** Polymarket event this argument was posted from (`/new?market=`); links back to `/markets/<slug>`. */
  polymarketEventSlug: string | null;
  status: ContentStatus;
  createdAt: Date;
  editedAt: Date | null;
  lockedAt: Date | null;
  authorId: string;
  category: { id: string; slug: string; name: string };
  author: ArgumentAuthorSummary;
  /** Editing is closed: `locked_at` set or a challenge was accepted. */
  locked: boolean;
  /** For removed arguments: who removed it (drives the §4.7 placeholder copy). */
  removedBy: "author" | "moderators" | null;
  /** Block relationship between the viewer and the author. */
  viewerBlockedAuthor: boolean;
  authorBlockedViewer: boolean;
}

/**
 * Everything the argument page needs, regardless of status — the page decides what to reveal
 * (hidden/removed placeholders, block notices). Null when the id does not exist.
 */
export async function getArgumentDetail(id: string, viewerId: string | null): Promise<ArgumentDetail | null> {
  const [row] = await db
    .select({
      argument: argumentsTable,
      categorySlug: categories.slug,
      categoryName: categories.name,
      handle: profiles.handle,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
      authorStatus: users.status,
    })
    .from(argumentsTable)
    .innerJoin(categories, eq(categories.id, argumentsTable.categoryId))
    .innerJoin(users, eq(users.id, argumentsTable.authorId))
    .leftJoin(profiles, eq(profiles.userId, argumentsTable.authorId))
    .where(eq(argumentsTable.id, id))
    .limit(1);
  if (!row) return null;
  const { argument } = row;

  const otherViewer = viewerId && viewerId !== argument.authorId ? viewerId : null;
  const [accepted, viewerBlockedAuthor, authorBlockedViewer, removedBy] = await Promise.all([
    argument.lockedAt ? Promise.resolve(true) : hasAcceptedChallenge(argument.id),
    otherViewer ? hasBlocked(otherViewer, argument.authorId) : Promise.resolve(false),
    otherViewer ? hasBlocked(argument.authorId, otherViewer) : Promise.resolve(false),
    argument.status === "removed" ? whoRemoved(argument.id, argument.authorId) : Promise.resolve(null),
  ]);

  const authorGone = row.authorStatus === "deleted" || row.handle === null;
  return {
    id: argument.id,
    title: argument.title,
    proposition: argument.proposition,
    body: argument.body,
    links: argument.links,
    polymarketEventSlug: argument.polymarketEventSlug,
    status: argument.status,
    createdAt: argument.createdAt,
    editedAt: argument.editedAt,
    lockedAt: argument.lockedAt,
    authorId: argument.authorId,
    category: { id: argument.categoryId, slug: row.categorySlug, name: row.categoryName },
    author: {
      id: argument.authorId,
      handle: authorGone ? null : row.handle,
      displayName: authorGone ? "Deleted user" : (row.displayName ?? "Deleted user"),
      avatarUrl: authorGone ? null : row.avatarUrl,
    },
    locked: accepted,
    removedBy,
    viewerBlockedAuthor,
    authorBlockedViewer,
  };
}

/** The author's own delete is audited as `argument.delete`; any other removal came from moderators. */
async function whoRemoved(argumentId: string, authorId: string): Promise<"author" | "moderators"> {
  const [latest] = await db
    .select({ actorId: auditLogs.actorId, action: auditLogs.action })
    .from(auditLogs)
    .where(and(eq(auditLogs.targetType, "argument"), eq(auditLogs.targetId, argumentId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);
  return latest?.action === ARGUMENT_DELETE_AUDIT_ACTION && latest.actorId === authorId ? "author" : "moderators";
}

/** Cards for one argument (e.g. landing "happening now"); empty when not listable for the viewer. */
export async function getArgumentCard(id: string, viewerId: string | null): Promise<ArgumentCardData | null> {
  const [card] = await loadCards([id], viewerId);
  return card ?? null;
}

/** Light data for the share card: only listable (visible) arguments get a real card. */
export async function getArgumentShareData(id: string) {
  const [card] = await loadCards([id], null);
  return card ?? null;
}

/** Number of visible arguments (landing page social proof); cheap enough for v1 scale. */
export async function countVisibleArguments(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
    .from(argumentsTable)
    .where(eq(argumentsTable.status, "visible"));
  return row?.n ?? 0;
}
