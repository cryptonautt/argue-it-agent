/**
 * Owner: moderation. Spam screening for user-written content — the public entry point other teams call.
 *
 *   import { assessContent, assertContentAllowed, flagForReviewIfNeeded } from "@domain/moderation";
 *
 *   const assessment = await assessContent(user.id, data.body, data.links);   // before the insert
 *   assertContentAllowed(assessment);                                          // throws on "block"
 *   const row = await tx.insert(comments)…;
 *   await flagForReviewIfNeeded(assessment, { type: "comment", id: row.id }, tx); // "review" → auto report
 *
 * For arguments pass `${title}\n${proposition}\n${body}` as `text`. The heuristics live in
 * spam-rules.ts (pure, unit-tested); this file only gathers the user's recent activity.
 */
import "server-only";

import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import { ActionError } from "@domain/lib/action-result";
import { addMs, now } from "@domain/lib/time";
import { db, type DbOrTx } from "@domain/db";
import { argumentsTable, comments } from "@domain/db/schema";
import { openAutomaticReport, type AutomaticReportResult } from "./service";
import type { TargetRef } from "./targets";
import {
  DUPLICATE_WINDOW_MS,
  MIN_CROSS_USER_DUPLICATE_LENGTH,
  evaluateSpam,
  normalizeForDuplicate,
  summarizeAssessment,
  type ContentAssessment,
  type RecentItem,
} from "./spam-rules";

export type { ContentAssessment, ContentDecision, SpamSignal, SpamSignalCode } from "./spam-rules";

const RECENT_LIMIT = 50;

/** SQL twin of normalizeForDuplicate(). */
const normalizedSql = (column: typeof comments.body | typeof argumentsTable.body) =>
  sql<string>`lower(btrim(regexp_replace(${column}, '\\s+', ' ', 'g')))`;

/** When screening an EDIT, the item being edited must not count as the user's own earlier copy of it. */
export interface AssessOptions {
  excludeArgumentId?: string;
  excludeCommentId?: string;
}

async function recentOwnContent(userId: string, since: Date, conn: DbOrTx, options: AssessOptions): Promise<RecentItem[]> {
  const [ownArguments, ownComments] = await Promise.all([
    conn
      .select({
        title: argumentsTable.title,
        proposition: argumentsTable.proposition,
        body: argumentsTable.body,
        links: argumentsTable.links,
        createdAt: argumentsTable.createdAt,
      })
      .from(argumentsTable)
      .where(
        and(
          eq(argumentsTable.authorId, userId),
          gt(argumentsTable.createdAt, since),
          options.excludeArgumentId ? ne(argumentsTable.id, options.excludeArgumentId) : undefined,
        ),
      )
      .orderBy(desc(argumentsTable.createdAt))
      .limit(RECENT_LIMIT),
    conn
      .select({ body: comments.body, createdAt: comments.createdAt })
      .from(comments)
      .where(
        and(
          eq(comments.authorId, userId),
          gt(comments.createdAt, since),
          options.excludeCommentId ? ne(comments.id, options.excludeCommentId) : undefined,
        ),
      )
      .orderBy(desc(comments.createdAt))
      .limit(RECENT_LIMIT),
  ]);
  const items: RecentItem[] = [
    ...ownArguments.map((a) => ({
      text: `${a.title}\n${a.proposition}\n${a.body}`,
      links: a.links,
      createdAt: a.createdAt,
    })),
    // Arguments are also compared on the body alone (a copy-pasted body under a new title is still a copy).
    ...ownArguments.map((a) => ({ text: a.body, links: [], createdAt: a.createdAt })),
    ...ownComments.map((c) => ({ text: c.body, links: [], createdAt: c.createdAt })),
  ];
  return items.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
}

async function crossUserDuplicateAuthors(userId: string, text: string, since: Date, conn: DbOrTx): Promise<number> {
  const normalized = normalizeForDuplicate(text);
  if (normalized.length < MIN_CROSS_USER_DUPLICATE_LENGTH) return 0;
  const [fromComments, fromArguments] = await Promise.all([
    conn
      .selectDistinct({ authorId: comments.authorId })
      .from(comments)
      .where(and(ne(comments.authorId, userId), gt(comments.createdAt, since), eq(normalizedSql(comments.body), normalized)))
      .limit(20),
    conn
      .selectDistinct({ authorId: argumentsTable.authorId })
      .from(argumentsTable)
      .where(
        and(
          ne(argumentsTable.authorId, userId),
          gt(argumentsTable.createdAt, since),
          eq(normalizedSql(argumentsTable.body), normalized),
        ),
      )
      .limit(20),
  ]);
  return new Set([...fromComments, ...fromArguments].map((r) => r.authorId)).size;
}

/**
 * Score a piece of content the user is about to post. Read-only; call it BEFORE inserting so the new
 * row is not compared with itself. Cheap: 4 indexed queries.
 *
 * Bursts are counted across arguments and comments only. Burst/duplicate windows use the server clock.
 */
export async function assessContent(
  userId: string,
  text: string,
  links: readonly string[] = [],
  conn: DbOrTx = db,
  options: AssessOptions = {},
): Promise<ContentAssessment> {
  const at = now();
  const since = addMs(at, -DUPLICATE_WINDOW_MS);
  const [recentOwn, crossUser] = await Promise.all([
    recentOwnContent(userId, since, conn, options),
    crossUserDuplicateAuthors(userId, text, since, conn),
  ]);
  return evaluateSpam({ text, links, recentOwn, crossUserDuplicateAuthors: crossUser, now: at });
}

/** Throw a user-facing ActionError when the assessment says "block". */
export function assertContentAllowed(assessment: ContentAssessment): void {
  if (assessment.decision !== "block") return;
  const burst = assessment.signals.some((s) => s.code === "burst");
  throw new ActionError(burst ? "RATE_LIMITED" : "VALIDATION", assessment.message ?? "We couldn't post that.");
}

/**
 * After inserting content that was assessed as "review", open an automatic spam report so a moderator
 * looks at it. No-op for "allow". Pass the caller's transaction.
 */
export async function flagForReviewIfNeeded(
  assessment: ContentAssessment,
  target: TargetRef,
  conn: DbOrTx = db,
): Promise<AutomaticReportResult | null> {
  if (assessment.decision !== "review") return null;
  return openAutomaticReport(
    { targetType: target.type, targetId: target.id, reason: "spam", details: summarizeAssessment(assessment) },
    conn,
  );
}
