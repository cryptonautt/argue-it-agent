/**
 * Owner: moderation. Resolve report/moderation targets (argument, comment, profile, submission) to a
 * uniform summary: who wrote it, its visibility, and a text preview for moderators. Batch-loads so the
 * reports queue renders in a fixed number of queries.
 *
 * Profile targets are addressed by the USER id (profiles.user_id is the primary key).
 */
import "server-only";

import { and, eq, inArray, type AnyColumn, type SQL } from "drizzle-orm";
import { isRoundRevealed } from "@domain/competitions/visibility";
import { db, type DbOrTx } from "@domain/db";
import {
  argumentsTable,
  comments,
  competitions,
  profiles,
  submissions,
  users,
  type CompetitionRound,
  type CompetitionStatus,
  type ContentStatus,
  type ReportTarget,
  type UserRole,
  type UserStatus,
} from "@domain/db/schema";

export interface TargetRef {
  type: ReportTarget;
  id: string;
}

export interface TargetAuthor {
  id: string;
  handle: string | null;
  displayName: string | null;
  role: UserRole;
  status: UserStatus;
  suspendedUntil: Date | null;
}

export interface TargetSummary {
  type: ReportTarget;
  id: string;
  /** Null for profiles (no visibility column). */
  status: ContentStatus | null;
  author: TargetAuthor;
  /** Short heading: argument title, "Comment on …", profile display name, "FOR opening". */
  title: string;
  /** The user-written text (render as text, never HTML). */
  body: string;
  links: string[];
  /** Public page where the content lives. */
  href: string;
  createdAt: Date;
  /** Profiles: there is a bio/avatar a moderator could clear. */
  hasProfileContent: boolean;
  /** Submissions: competition state and the submission's round. */
  competition?: { id: string; status: CompetitionStatus; round: CompetitionRound | null; lockedAt: Date | null };
  submissionRound?: CompetitionRound;
  /**
   * Submissions: still sealed (its round hasn't closed). Sealed text is shown to NOBODY but its author —
   * not opponents, not spectators, not staff (challenges team's rule, design §4.2).
   */
  sealed: boolean;
  /** Comments/submissions: the argument they belong to. */
  argumentId?: string;
}

export const targetKey = (ref: TargetRef): string => `${ref.type}:${ref.id}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadAuthors(ids: readonly string[], conn: DbOrTx): Promise<Map<string, TargetAuthor>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await conn
    .select({
      id: users.id,
      role: users.role,
      status: users.status,
      suspendedUntil: users.suspendedUntil,
      handle: profiles.handle,
      displayName: profiles.displayName,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Load many targets at once. Missing targets are simply absent from the map. */
export async function loadTargets(refs: readonly TargetRef[], conn: DbOrTx = db): Promise<Map<string, TargetSummary>> {
  const idsOf = (type: ReportTarget) => [...new Set(refs.filter((r) => r.type === type && UUID.test(r.id)).map((r) => r.id))];
  const argumentIds = idsOf("argument");
  const commentIds = idsOf("comment");
  const profileIds = idsOf("profile");
  const submissionIds = idsOf("submission");

  const [argumentRows, commentRows, profileRows, submissionRows] = await Promise.all([
    argumentIds.length
      ? conn
          .select({
            id: argumentsTable.id,
            authorId: argumentsTable.authorId,
            title: argumentsTable.title,
            proposition: argumentsTable.proposition,
            body: argumentsTable.body,
            links: argumentsTable.links,
            status: argumentsTable.status,
            createdAt: argumentsTable.createdAt,
          })
          .from(argumentsTable)
          .where(inArray(argumentsTable.id, argumentIds))
      : [],
    commentIds.length
      ? conn
          .select({
            id: comments.id,
            authorId: comments.authorId,
            argumentId: comments.argumentId,
            argumentTitle: argumentsTable.title,
            body: comments.body,
            status: comments.status,
            createdAt: comments.createdAt,
          })
          .from(comments)
          .innerJoin(argumentsTable, eq(argumentsTable.id, comments.argumentId))
          .where(inArray(comments.id, commentIds))
      : [],
    profileIds.length
      ? conn
          .select({
            userId: profiles.userId,
            handle: profiles.handle,
            displayName: profiles.displayName,
            bio: profiles.bio,
            avatarUrl: profiles.avatarUrl,
            createdAt: profiles.createdAt,
          })
          .from(profiles)
          .where(inArray(profiles.userId, profileIds))
      : [],
    submissionIds.length
      ? conn
          .select({
            id: submissions.id,
            authorId: submissions.authorId,
            side: submissions.side,
            round: submissions.round,
            body: submissions.body,
            links: submissions.links,
            status: submissions.status,
            createdAt: submissions.createdAt,
            competitionId: competitions.id,
            competitionStatus: competitions.status,
            competitionRound: competitions.round,
            competitionLockedAt: competitions.lockedAt,
            argumentId: competitions.rootArgumentId,
            rulesSnapshot: competitions.rulesSnapshot,
          })
          .from(submissions)
          .innerJoin(competitions, eq(competitions.id, submissions.competitionId))
          .where(inArray(submissions.id, submissionIds))
      : [],
  ]);

  const authors = await loadAuthors(
    [
      ...argumentRows.map((r) => r.authorId),
      ...commentRows.map((r) => r.authorId),
      ...profileRows.map((r) => r.userId),
      ...submissionRows.map((r) => r.authorId),
    ],
    conn,
  );

  const out = new Map<string, TargetSummary>();
  const put = (summary: Omit<TargetSummary, "author"> & { authorId: string }) => {
    const author = authors.get(summary.authorId);
    if (!author) return;
    const { authorId, ...rest } = summary;
    void authorId;
    out.set(targetKey(rest), { ...rest, author });
  };

  for (const r of argumentRows) {
    put({
      type: "argument",
      id: r.id,
      authorId: r.authorId,
      status: r.status,
      title: r.title,
      body: `${r.proposition}\n\n${r.body}`,
      links: r.links,
      href: `/a/${r.id}`,
      createdAt: r.createdAt,
      hasProfileContent: false,
      sealed: false,
      argumentId: r.id,
    });
  }
  for (const r of commentRows) {
    put({
      type: "comment",
      id: r.id,
      authorId: r.authorId,
      status: r.status,
      title: `Comment on “${r.argumentTitle}”`,
      body: r.body,
      links: [],
      href: `/a/${r.argumentId}#comment-${r.id}`,
      createdAt: r.createdAt,
      hasProfileContent: false,
      sealed: false,
      argumentId: r.argumentId,
    });
  }
  for (const r of profileRows) {
    put({
      type: "profile",
      id: r.userId,
      authorId: r.userId,
      status: null,
      title: `${r.displayName} (@${r.handle})`,
      body: r.bio ?? "",
      links: r.avatarUrl ? [r.avatarUrl] : [],
      href: `/u/${r.handle}`,
      createdAt: r.createdAt,
      hasProfileContent: Boolean(r.bio) || Boolean(r.avatarUrl),
      sealed: false,
    });
  }
  for (const r of submissionRows) {
    put({
      type: "submission",
      id: r.id,
      authorId: r.authorId,
      status: r.status,
      title: `${r.side} ${r.round} · “${r.rulesSnapshot.proposition}”`,
      body: r.body,
      links: r.links,
      href: `/c/${r.competitionId}`,
      createdAt: r.createdAt,
      hasProfileContent: false,
      competition: { id: r.competitionId, status: r.competitionStatus, round: r.competitionRound, lockedAt: r.competitionLockedAt },
      submissionRound: r.round,
      sealed: !isRoundRevealed({ status: r.competitionStatus, round: r.competitionRound, lockedAt: r.competitionLockedAt }, r.round),
      argumentId: r.argumentId,
    });
  }
  return out;
}

export async function loadTarget(ref: TargetRef, conn: DbOrTx = db): Promise<TargetSummary | null> {
  return (await loadTargets([ref], conn)).get(targetKey(ref)) ?? null;
}

/**
 * May `viewerId` see (and so report) this target? Hidden/removed content is not reportable, and a sealed
 * debate submission is visible only to its author — the report endpoint must not leak or probe it.
 */
export function canViewerSeeTarget(target: TargetSummary, viewerId: string): boolean {
  if (target.status !== null && target.status !== "visible") return false;
  return !target.sealed || target.author.id === viewerId;
}

/**
 * Set the visibility of an argument/comment/submission, only if it is still in `expected` state
 * (optimistic concurrency: two moderators acting at once cannot both win). Returns true if updated.
 */
export async function setContentStatus(
  ref: TargetRef,
  expected: ContentStatus,
  next: ContentStatus,
  conn: DbOrTx,
): Promise<boolean> {
  switch (ref.type) {
    case "argument": {
      const rows = await conn
        .update(argumentsTable)
        .set({ status: next })
        .where(eqBoth(argumentsTable.id, ref.id, argumentsTable.status, expected))
        .returning({ id: argumentsTable.id });
      return rows.length > 0;
    }
    case "comment": {
      const rows = await conn
        .update(comments)
        .set({ status: next })
        .where(eqBoth(comments.id, ref.id, comments.status, expected))
        .returning({ id: comments.id });
      return rows.length > 0;
    }
    case "submission": {
      const rows = await conn
        .update(submissions)
        .set({ status: next })
        .where(eqBoth(submissions.id, ref.id, submissions.status, expected))
        .returning({ id: submissions.id });
      return rows.length > 0;
    }
    case "profile":
      throw new Error("setContentStatus: profiles have no visibility status");
  }
}

function eqBoth(idCol: AnyColumn, id: string, statusCol: AnyColumn, status: ContentStatus): SQL | undefined {
  return and(eq(idCol, id), eq(statusCol, status));
}

/** Clear the user-written parts of a profile (bio + avatar). Returns the previous values for the audit log. */
export async function clearProfileContent(
  userId: string,
  conn: DbOrTx,
): Promise<{ bio: string | null; avatarUrl: string | null } | null> {
  const [before] = await conn
    .select({ bio: profiles.bio, avatarUrl: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (!before) return null;
  await conn.update(profiles).set({ bio: null, avatarUrl: null }).where(eq(profiles.userId, userId));
  return before;
}
