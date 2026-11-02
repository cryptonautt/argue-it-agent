/**
 * Owner: moderation. Read models for the admin screens. Every exported query re-checks the caller's
 * role server-side (defence in depth: pages are also guarded) so admin data can never be rendered for a
 * non-staff session, whatever route or component calls it.
 */
import "server-only";

import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  lte,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { alias, unionAll } from "drizzle-orm/pg-core";
import { ActionError } from "@domain/lib/action-result";
import { DAY_MS, MINUTE_MS, addMs, now } from "@domain/lib/time";
import { getSession, hasRole, isSuspended, type SessionUser } from "@domain/auth";
import { db } from "@domain/db";
import {
  appeals,
  argumentPositions,
  argumentsTable,
  auditLogs,
  categories,
  comments,
  competitionParticipants,
  competitions,
  evaluationJobs,
  evaluationPasses,
  evaluationRuns,
  moderationActions,
  profiles,
  reactions,
  reports,
  submissions,
  users,
  verdicts,
  TARGET_TYPES,
  type CompetitionStatus,
  type ModerationActionType,
  type TargetType,
  type ReportReason,
  type ReportTarget,
  type UserRole,
  type UserStatus,
} from "@domain/db/schema";
import { REASON_INFO } from "./policy";
import { STUCK_JOB_MINUTES, type ModelUsage } from "./metrics";
import { loadTargets, targetKey, type TargetSummary } from "./targets";

export const PAGE_SIZE = 25;

/** Staff guard for reads. Throws (rendered by the error boundary) — pages call requirePageRole first. */
export async function requireStaff(role: "moderator" | "admin" = "moderator"): Promise<SessionUser> {
  const user = await getSession();
  if (!user) throw new ActionError("UNAUTHENTICATED", "Sign in to do that.");
  if (!hasRole(user.role, role) || isSuspended(user)) throw new ActionError("FORBIDDEN", "You don't have permission to do that.");
  return user;
}

const severityRank = sql<number>`case ${reports.reason} ${sql.join(
  Object.entries(REASON_INFO).map(([reason, info]) => sql`when ${reason} then ${info.severity}`),
  sql` `,
)} else 9 end`;

// ---------------------------------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------------------------------

export interface OverviewStats {
  queues: {
    openReports: number;
    severeOpenReports: number;
    automaticOpenReports: number;
    openAppeals: number;
    needsReview: number;
    failedJobs: number;
    queuedJobs: number;
    stuckJobs: number;
  };
  last7d: {
    newUsers: number;
    activeUsers: number;
    newUsersWhoActed: number;
    arguments: number;
    comments: number;
    challengesSent: number;
    challengesAccepted: number;
    challengesCompleted: number;
  };
  totals: { users: number; suspendedUsers: number; activeCompetitions: number };
}

export async function getOverviewStats(): Promise<OverviewStats> {
  await requireStaff();
  const at = now();
  const since = addMs(at, -7 * DAY_MS);
  const stuckBefore = addMs(at, -STUCK_JOB_MINUTES * MINUTE_MS);

  const activity = unionAll(
    db.select({ userId: argumentsTable.authorId }).from(argumentsTable).where(gt(argumentsTable.createdAt, since)),
    db.select({ userId: comments.authorId }).from(comments).where(gt(comments.createdAt, since)),
    db.select({ userId: argumentPositions.userId }).from(argumentPositions).where(gt(argumentPositions.updatedAt, since)),
    db.select({ userId: reactions.userId }).from(reactions).where(gt(reactions.createdAt, since)),
    db.select({ userId: submissions.authorId }).from(submissions).where(gt(submissions.updatedAt, since)),
    db.select({ userId: competitions.creatorId }).from(competitions).where(gt(competitions.sentAt, since)),
  ).as("activity");

  const one = async (query: Promise<Array<{ n: number }>>) => (await query)[0]?.n ?? 0;

  const [
    openReports,
    severeOpenReports,
    automaticOpenReports,
    openAppeals,
    needsReview,
    failedJobs,
    queuedJobs,
    stuckJobs,
    newUsers,
    activeUsers,
    newUsersWhoActed,
    argumentsCount,
    commentsCount,
    challengesSent,
    challengesAccepted,
    challengesCompleted,
    totalUsers,
    suspendedUsers,
    activeCompetitions,
  ] = await Promise.all([
    one(db.select({ n: count() }).from(reports).where(eq(reports.status, "open"))),
    one(
      db
        .select({ n: count() })
        .from(reports)
        .where(and(eq(reports.status, "open"), inArray(reports.reason, ["threats", "doxxing", "hate", "harassment"]))),
    ),
    one(db.select({ n: count() }).from(reports).where(and(eq(reports.status, "open"), eq(reports.isAutomatic, true)))),
    one(db.select({ n: count() }).from(appeals).where(eq(appeals.status, "open"))),
    one(db.select({ n: count() }).from(competitions).where(eq(competitions.status, "needs_review"))),
    one(db.select({ n: count() }).from(evaluationJobs).where(eq(evaluationJobs.status, "failed"))),
    one(db.select({ n: count() }).from(evaluationJobs).where(eq(evaluationJobs.status, "queued"))),
    one(
      db
        .select({ n: count() })
        .from(evaluationJobs)
        .where(and(eq(evaluationJobs.status, "running"), lt(evaluationJobs.claimedAt, stuckBefore))),
    ),
    one(db.select({ n: count() }).from(users).where(gt(users.createdAt, since))),
    one(db.select({ n: countDistinct(activity.userId) }).from(activity)),
    one(
      db
        .select({ n: countDistinct(activity.userId) })
        .from(activity)
        .innerJoin(users, eq(users.id, activity.userId))
        .where(gt(users.createdAt, since)),
    ),
    one(db.select({ n: count() }).from(argumentsTable).where(gt(argumentsTable.createdAt, since))),
    one(db.select({ n: count() }).from(comments).where(gt(comments.createdAt, since))),
    one(db.select({ n: count() }).from(competitions).where(gt(competitions.sentAt, since))),
    one(db.select({ n: count() }).from(competitions).where(gt(competitions.acceptedAt, since))),
    one(db.select({ n: count() }).from(competitions).where(and(eq(competitions.status, "completed"), gt(competitions.completedAt, since)))),
    one(db.select({ n: count() }).from(users).where(sql`${users.status} <> 'deleted'`)),
    one(
      db
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.status, "suspended"), or(sql`${users.suspendedUntil} is null`, gt(users.suspendedUntil, at)))),
    ),
    one(db.select({ n: count() }).from(competitions).where(inArray(competitions.status, ["active", "locked", "evaluating"]))),
  ]);

  return {
    queues: { openReports, severeOpenReports, automaticOpenReports, openAppeals, needsReview, failedJobs, queuedJobs, stuckJobs },
    last7d: {
      newUsers,
      activeUsers,
      newUsersWhoActed,
      arguments: argumentsCount,
      comments: commentsCount,
      challengesSent,
      challengesAccepted,
      challengesCompleted,
    },
    totals: { users: totalUsers, suspendedUsers, activeCompetitions },
  };
}

// ---------------------------------------------------------------------------------------------------
// Reports queue
// ---------------------------------------------------------------------------------------------------

export interface ReportFilters {
  status: "open" | "actioned" | "dismissed";
  reason?: ReportReason;
  targetType?: ReportTarget;
  source?: "user" | "automatic";
  page: number;
}

export interface ReportListItem {
  id: string;
  reason: ReportReason;
  details: string | null;
  isAutomatic: boolean;
  status: "open" | "actioned" | "dismissed";
  createdAt: Date;
  resolvedAt: Date | null;
  reporterHandle: string | null;
  targetType: ReportTarget;
  targetId: string;
  target: TargetSummary | null;
  /** Open reports on the same target (including this one). */
  openOnTarget: number;
}

export async function listReports(filters: ReportFilters): Promise<{ items: ReportListItem[]; total: number; hasMore: boolean }> {
  await requireStaff();
  const where = and(
    eq(reports.status, filters.status),
    filters.reason ? eq(reports.reason, filters.reason) : undefined,
    filters.targetType ? eq(reports.targetType, filters.targetType) : undefined,
    filters.source ? eq(reports.isAutomatic, filters.source === "automatic") : undefined,
  );
  const page = Math.max(1, filters.page);
  const order =
    filters.status === "open"
      ? [asc(severityRank), asc(reports.createdAt)]
      : [desc(reports.resolvedAt), desc(reports.createdAt)];

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: reports.id,
        reason: reports.reason,
        details: reports.details,
        isAutomatic: reports.isAutomatic,
        status: reports.status,
        createdAt: reports.createdAt,
        resolvedAt: reports.resolvedAt,
        targetType: reports.targetType,
        targetId: reports.targetId,
        reporterHandle: profiles.handle,
      })
      .from(reports)
      .leftJoin(profiles, eq(profiles.userId, reports.reporterId))
      .where(where)
      .orderBy(...order)
      .limit(PAGE_SIZE + 1)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(reports).where(where),
  ]);

  const pageRows = rows.slice(0, PAGE_SIZE);
  const refs = pageRows.map((r) => ({ type: r.targetType, id: r.targetId }));
  const [targets, openCounts] = await Promise.all([
    loadTargets(refs),
    pageRows.length
      ? db
          .select({ targetType: reports.targetType, targetId: reports.targetId, n: count() })
          .from(reports)
          .where(and(eq(reports.status, "open"), inArray(reports.targetId, [...new Set(pageRows.map((r) => r.targetId))])))
          .groupBy(reports.targetType, reports.targetId)
      : [],
  ]);
  const openMap = new Map(openCounts.map((c) => [targetKey({ type: c.targetType, id: c.targetId }), c.n]));

  return {
    items: pageRows.map((r) => {
      const key = targetKey({ type: r.targetType, id: r.targetId });
      return { ...r, target: targets.get(key) ?? null, openOnTarget: openMap.get(key) ?? 0 };
    }),
    total: totalRow[0]?.n ?? 0,
    hasMore: rows.length > PAGE_SIZE,
  };
}

export interface ModerationHistoryItem {
  id: string;
  action: ModerationActionType;
  targetType: string;
  targetId: string;
  reasonCode: ReportReason;
  note: string | null;
  durationHours: number | null;
  expiresAt: Date | null;
  createdAt: Date;
  moderatorHandle: string | null;
}

async function moderationHistory(where: SQL | undefined, limit = 50): Promise<ModerationHistoryItem[]> {
  return db
    .select({
      id: moderationActions.id,
      action: moderationActions.action,
      targetType: moderationActions.targetType,
      targetId: moderationActions.targetId,
      reasonCode: moderationActions.reasonCode,
      note: moderationActions.note,
      durationHours: moderationActions.durationHours,
      expiresAt: moderationActions.expiresAt,
      createdAt: moderationActions.createdAt,
      moderatorHandle: profiles.handle,
    })
    .from(moderationActions)
    .leftJoin(profiles, eq(profiles.userId, moderationActions.moderatorId))
    .where(where)
    .orderBy(desc(moderationActions.createdAt))
    .limit(limit);
}

export interface ReportDetail {
  report: {
    id: string;
    reason: ReportReason;
    details: string | null;
    isAutomatic: boolean;
    status: "open" | "actioned" | "dismissed";
    createdAt: Date;
    resolvedAt: Date | null;
    resolutionNote: string | null;
    reporterId: string | null;
    reporterHandle: string | null;
    resolverHandle: string | null;
    targetType: ReportTarget;
    targetId: string;
  };
  target: TargetSummary | null;
  otherReports: Array<{ id: string; reason: ReportReason; status: string; createdAt: Date; reporterHandle: string | null; details: string | null; isAutomatic: boolean }>;
  /** Actions on this content and on the author's account, newest first. */
  history: ModerationHistoryItem[];
  /** Earlier actions against the author (warnings/suspensions) — context for proportionate decisions. */
  authorPriorActions: number;
}

export async function getReportDetail(reportId: string): Promise<ReportDetail | null> {
  await requireStaff();
  const resolver = alias(profiles, "resolver");
  const [report] = await db
    .select({
      id: reports.id,
      reason: reports.reason,
      details: reports.details,
      isAutomatic: reports.isAutomatic,
      status: reports.status,
      createdAt: reports.createdAt,
      resolvedAt: reports.resolvedAt,
      resolutionNote: reports.resolutionNote,
      reporterId: reports.reporterId,
      reporterHandle: profiles.handle,
      resolverHandle: resolver.handle,
      targetType: reports.targetType,
      targetId: reports.targetId,
    })
    .from(reports)
    .leftJoin(profiles, eq(profiles.userId, reports.reporterId))
    .leftJoin(resolver, eq(resolver.userId, reports.resolvedBy))
    .where(eq(reports.id, reportId))
    .limit(1);
  if (!report) return null;

  const targets = await loadTargets([{ type: report.targetType, id: report.targetId }]);
  const target = targets.get(targetKey({ type: report.targetType, id: report.targetId })) ?? null;

  const [otherReports, history, priorRow] = await Promise.all([
    db
      .select({
        id: reports.id,
        reason: reports.reason,
        status: reports.status,
        createdAt: reports.createdAt,
        reporterHandle: profiles.handle,
        details: reports.details,
        isAutomatic: reports.isAutomatic,
      })
      .from(reports)
      .leftJoin(profiles, eq(profiles.userId, reports.reporterId))
      .where(and(eq(reports.targetType, report.targetType), eq(reports.targetId, report.targetId), sql`${reports.id} <> ${report.id}`))
      .orderBy(desc(reports.createdAt))
      .limit(50),
    moderationHistory(
      or(
        and(eq(moderationActions.targetType, report.targetType), eq(moderationActions.targetId, report.targetId)),
        target ? and(eq(moderationActions.targetType, "user"), eq(moderationActions.targetId, target.author.id)) : undefined,
      ),
    ),
    target
      ? db
          .select({ n: count() })
          .from(moderationActions)
          .where(
            and(
              eq(moderationActions.targetType, "user"),
              eq(moderationActions.targetId, target.author.id),
              inArray(moderationActions.action, ["warn", "suspend"]),
            ),
          )
      : Promise.resolve([{ n: 0 }]),
  ]);

  return { report, target, otherReports, history, authorPriorActions: priorRow[0]?.n ?? 0 };
}

// ---------------------------------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------------------------------

export interface UserFilters {
  q?: string;
  role?: UserRole;
  status?: UserStatus;
  page: number;
}

export interface UserListItem {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  suspendedUntil: Date | null;
  createdAt: Date;
  handle: string | null;
  displayName: string | null;
  openReports: number;
}

/** Open reports about a user's profile or anything they wrote (correlated subquery, page-sized). */
const openReportsAboutUser = sql<number>`(
  select count(*)::int from ${reports} r
  where r.status = 'open' and (
    (r.target_type = 'profile' and r.target_id = ${users.id})
    or (r.target_type = 'argument' and r.target_id in (select a.id from ${argumentsTable} a where a.author_id = ${users.id}))
    or (r.target_type = 'comment' and r.target_id in (select c.id from ${comments} c where c.author_id = ${users.id}))
    or (r.target_type = 'submission' and r.target_id in (select s.id from ${submissions} s where s.author_id = ${users.id}))
  )
)`;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function searchUsers(filters: UserFilters): Promise<{ items: UserListItem[]; total: number; hasMore: boolean }> {
  await requireStaff();
  const q = filters.q?.trim().replace(/^@/, "");
  const pattern = q ? `%${escapeLike(q)}%` : null;
  const where = and(
    sql`${users.status} <> 'deleted'`,
    filters.role ? eq(users.role, filters.role) : undefined,
    filters.status ? eq(users.status, filters.status) : undefined,
    pattern ? or(ilike(profiles.handle, pattern), ilike(profiles.displayName, pattern), ilike(users.email, pattern)) : undefined,
  );
  const page = Math.max(1, filters.page);
  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        status: users.status,
        suspendedUntil: users.suspendedUntil,
        createdAt: users.createdAt,
        handle: profiles.handle,
        displayName: profiles.displayName,
        openReports: openReportsAboutUser,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(PAGE_SIZE + 1)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(users).leftJoin(profiles, eq(profiles.userId, users.id)).where(where),
  ]);
  return { items: rows.slice(0, PAGE_SIZE), total: totalRow[0]?.n ?? 0, hasMore: rows.length > PAGE_SIZE };
}

export interface UserDetail {
  user: UserListItem & { bio: string | null; avatarUrl: string | null };
  counts: { arguments: number; comments: number; competitions: number; reportsFiled: number; activeCompetitions: number };
  recentContent: Array<{ type: "argument" | "comment"; id: string; text: string; status: string; createdAt: Date; href: string }>;
  openReports: Array<{ id: string; reason: ReportReason; targetType: ReportTarget; createdAt: Date; isAutomatic: boolean }>;
  history: ModerationHistoryItem[];
  appeals: Array<{ id: string; competitionId: string; ground: string; status: string; createdAt: Date }>;
}

export async function getUserDetail(userId: string): Promise<UserDetail | null> {
  await requireStaff();
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
      suspendedUntil: users.suspendedUntil,
      createdAt: users.createdAt,
      handle: profiles.handle,
      displayName: profiles.displayName,
      bio: profiles.bio,
      avatarUrl: profiles.avatarUrl,
      openReports: openReportsAboutUser,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || user.status === "deleted") return null;

  /** Rows (reports / moderation actions) about this user's profile or anything they wrote. */
  const aboutUser = (typeCol: AnyColumn, idCol: AnyColumn): SQL => sql`(
    (${typeCol} = 'profile' and ${idCol} = ${userId})
    or (${typeCol} = 'argument' and ${idCol} in (select a.id from ${argumentsTable} a where a.author_id = ${userId}))
    or (${typeCol} = 'comment' and ${idCol} in (select c.id from ${comments} c where c.author_id = ${userId}))
    or (${typeCol} = 'submission' and ${idCol} in (select s.id from ${submissions} s where s.author_id = ${userId}))
  )`;

  const one = async (query: Promise<Array<{ n: number }>>) => (await query)[0]?.n ?? 0;
  const [argumentCount, commentCount, competitionCount, reportsFiled, activeCompetitions, recentArguments, recentComments, openReports, history, userAppeals] =
    await Promise.all([
      one(db.select({ n: count() }).from(argumentsTable).where(eq(argumentsTable.authorId, userId))),
      one(db.select({ n: count() }).from(comments).where(eq(comments.authorId, userId))),
      one(db.select({ n: count() }).from(competitionParticipants).where(eq(competitionParticipants.userId, userId))),
      one(db.select({ n: count() }).from(reports).where(eq(reports.reporterId, userId))),
      one(
        db
          .select({ n: count() })
          .from(competitionParticipants)
          .innerJoin(competitions, eq(competitions.id, competitionParticipants.competitionId))
          .where(and(eq(competitionParticipants.userId, userId), inArray(competitions.status, ["pending_acceptance", "active"]))),
      ),
      db
        .select({ id: argumentsTable.id, title: argumentsTable.title, status: argumentsTable.status, createdAt: argumentsTable.createdAt })
        .from(argumentsTable)
        .where(eq(argumentsTable.authorId, userId))
        .orderBy(desc(argumentsTable.createdAt))
        .limit(10),
      db
        .select({
          id: comments.id,
          argumentId: comments.argumentId,
          body: comments.body,
          status: comments.status,
          createdAt: comments.createdAt,
        })
        .from(comments)
        .where(eq(comments.authorId, userId))
        .orderBy(desc(comments.createdAt))
        .limit(10),
      db
        .select({
          id: reports.id,
          reason: reports.reason,
          targetType: reports.targetType,
          createdAt: reports.createdAt,
          isAutomatic: reports.isAutomatic,
        })
        .from(reports)
        .where(and(eq(reports.status, "open"), aboutUser(reports.targetType, reports.targetId)))
        .orderBy(asc(severityRank), asc(reports.createdAt))
        .limit(50),
      moderationHistory(
        or(
          and(eq(moderationActions.targetType, "user"), eq(moderationActions.targetId, userId)),
          aboutUser(moderationActions.targetType, moderationActions.targetId),
        ),
      ),
      db
        .select({
          id: appeals.id,
          competitionId: appeals.competitionId,
          ground: appeals.ground,
          status: appeals.status,
          createdAt: appeals.createdAt,
        })
        .from(appeals)
        .where(eq(appeals.appellantId, userId))
        .orderBy(desc(appeals.createdAt))
        .limit(20),
    ]);

  const recentContent: UserDetail["recentContent"] = [
    ...recentArguments.map((a) => ({
      type: "argument" as const,
      id: a.id,
      text: a.title,
      status: a.status,
      createdAt: a.createdAt,
      href: `/a/${a.id}`,
    })),
    ...recentComments.map((c) => ({
      type: "comment" as const,
      id: c.id,
      text: c.body,
      status: c.status,
      createdAt: c.createdAt,
      href: `/a/${c.argumentId}#comment-${c.id}`,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 12);

  return {
    user,
    counts: { arguments: argumentCount, comments: commentCount, competitions: competitionCount, reportsFiled, activeCompetitions },
    recentContent,
    openReports,
    history,
    appeals: userAppeals,
  };
}

// ---------------------------------------------------------------------------------------------------
// Competitions monitor
// ---------------------------------------------------------------------------------------------------

export interface CompetitionFilters {
  status?: CompetitionStatus;
  /** Only competitions whose current deadline has passed without the lifecycle advancing them. */
  overdue?: boolean;
  page: number;
}

export interface CompetitionListItem {
  id: string;
  status: CompetitionStatus;
  round: "opening" | "rebuttal" | null;
  proposition: string;
  categoryName: string;
  sentAt: Date;
  deadline: Date | null;
  deadlineLabel: string | null;
  overdue: boolean;
  participants: Array<{ userId: string; handle: string | null; side: "FOR" | "AGAINST"; role: "challenger" | "recipient" }>;
  submissions: { total: number; locked: number };
  jobStatus: string | null;
  cancelReason: string | null;
}

/** The deadline that drives the competition's next automatic transition. */
const currentDeadline = sql<Date | null>`case
  when ${competitions.status} = 'pending_acceptance' then ${competitions.acceptDeadline}
  when ${competitions.status} = 'active' and ${competitions.round} = 'opening' then ${competitions.openingClosesAt}
  when ${competitions.status} = 'active' and ${competitions.round} = 'rebuttal' then ${competitions.rebuttalClosesAt}
  else null end`;

export async function listCompetitions(
  filters: CompetitionFilters,
): Promise<{ items: CompetitionListItem[]; total: number; hasMore: boolean; statusCounts: Partial<Record<CompetitionStatus, number>> }> {
  await requireStaff();
  const at = now();
  const where = and(
    filters.status ? eq(competitions.status, filters.status) : undefined,
    filters.overdue ? sql`${currentDeadline} <= ${at}` : undefined,
  );
  const page = Math.max(1, filters.page);
  const [rows, totalRow, statusRows] = await Promise.all([
    db
      .select({
        id: competitions.id,
        status: competitions.status,
        round: competitions.round,
        rulesSnapshot: competitions.rulesSnapshot,
        categoryName: categories.name,
        sentAt: competitions.sentAt,
        deadline: currentDeadline,
        cancelReason: competitions.cancelReason,
      })
      .from(competitions)
      .innerJoin(categories, eq(categories.id, competitions.categoryId))
      .where(where)
      .orderBy(sql`${currentDeadline} asc nulls last`, desc(competitions.sentAt))
      .limit(PAGE_SIZE + 1)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(competitions).where(where),
    db.select({ status: competitions.status, n: count() }).from(competitions).groupBy(competitions.status),
  ]);
  const pageRows = rows.slice(0, PAGE_SIZE);
  const ids = pageRows.map((r) => r.id);

  const [participantRows, submissionRows, jobRows] = ids.length
    ? await Promise.all([
        db
          .select({
            competitionId: competitionParticipants.competitionId,
            userId: competitionParticipants.userId,
            side: competitionParticipants.side,
            role: competitionParticipants.role,
            handle: profiles.handle,
          })
          .from(competitionParticipants)
          .leftJoin(profiles, eq(profiles.userId, competitionParticipants.userId))
          .where(inArray(competitionParticipants.competitionId, ids)),
        db
          .select({
            competitionId: submissions.competitionId,
            total: count(),
            locked: sql<number>`count(${submissions.lockedAt})::int`,
          })
          .from(submissions)
          .where(inArray(submissions.competitionId, ids))
          .groupBy(submissions.competitionId),
        db
          .selectDistinctOn([evaluationJobs.competitionId], {
            competitionId: evaluationJobs.competitionId,
            status: evaluationJobs.status,
          })
          .from(evaluationJobs)
          .where(inArray(evaluationJobs.competitionId, ids))
          .orderBy(evaluationJobs.competitionId, desc(evaluationJobs.createdAt)),
      ])
    : [[], [], []];

  const deadlineLabels: Partial<Record<CompetitionStatus, string>> = { pending_acceptance: "Accept by", active: "Round closes" };
  return {
    items: pageRows.map((r) => {
      const deadline = r.deadline ? new Date(r.deadline) : null;
      const subs = submissionRows.find((s) => s.competitionId === r.id);
      return {
        id: r.id,
        status: r.status,
        round: r.round,
        proposition: r.rulesSnapshot.proposition,
        categoryName: r.categoryName,
        sentAt: r.sentAt,
        deadline,
        deadlineLabel: deadline ? (deadlineLabels[r.status] ?? null) : null,
        overdue: deadline !== null && deadline.getTime() <= at.getTime(),
        participants: participantRows.filter((p) => p.competitionId === r.id).sort((a) => (a.side === "FOR" ? -1 : 1)),
        submissions: { total: subs?.total ?? 0, locked: subs?.locked ?? 0 },
        jobStatus: jobRows.find((j) => j.competitionId === r.id)?.status ?? null,
        cancelReason: r.cancelReason,
      };
    }),
    total: totalRow[0]?.n ?? 0,
    hasMore: rows.length > PAGE_SIZE,
    statusCounts: Object.fromEntries(statusRows.map((s) => [s.status, s.n])),
  };
}

// ---------------------------------------------------------------------------------------------------
// AI evaluations dashboard
// ---------------------------------------------------------------------------------------------------

export interface EvaluationStats {
  windowDays: number;
  jobs: {
    byStatus: Record<"queued" | "running" | "done" | "failed", number>;
    oldestDueMinutes: number;
    stuck: number;
    retried: number;
    recentFailures: Array<{ id: string; competitionId: string; attempts: number; lastError: string | null; updatedAt: Date }>;
  };
  runs: { total: number; byStatus: Record<string, number>; needingThirdPass: number; withTwoPasses: number };
  passes: {
    total: number;
    failed: number;
    refusals: number;
    byPassNo: Array<{ passNo: number; count: number; avgConfidence: number | null; avgInvalidQuotes: number | null }>;
    latencyMs: { avg: number | null; p50: number | null; p95: number | null };
    usage: ModelUsage[];
  };
  verdicts: {
    aiDecided: number;
    byOutcome: Record<string, number>;
    avgConfidence: number | null;
    humanDecided: number;
  };
  appeals: { total: number; competitionsAppealed: number; decided: number; reversed: number; byStatus: Record<string, number> };
  needsReviewNow: number;
}

export async function getEvaluationStats(windowDays = 30): Promise<EvaluationStats> {
  await requireStaff("admin");
  const at = now();
  const since = addMs(at, -windowDays * DAY_MS);
  const stuckBefore = addMs(at, -STUCK_JOB_MINUTES * MINUTE_MS);

  const usageInt = (key: string) => sql<number>`coalesce(sum((${evaluationPasses.usage} ->> ${key})::bigint), 0)::bigint`;
  const passTable = alias(evaluationPasses, "p3");

  const appealedVerdict = alias(verdicts, "appealed_verdict");
  const currentVerdict = alias(verdicts, "current_verdict");

  const [
    jobStatusRows,
    oldestDue,
    stuckRow,
    retriedRow,
    recentFailures,
    runStatusRows,
    thirdPassRow,
    twoPassRow,
    passTotals,
    byPassNo,
    latencyRows,
    usageRows,
    verdictRows,
    humanRow,
    appealStatusRows,
    appealCompetitionsRow,
    reversedRow,
    needsReviewRow,
  ] = await Promise.all([
    db.select({ status: evaluationJobs.status, n: count() }).from(evaluationJobs).groupBy(evaluationJobs.status),
    db
      .select({ runAfter: sql<Date | null>`min(${evaluationJobs.runAfter})` })
      .from(evaluationJobs)
      .where(and(eq(evaluationJobs.status, "queued"), lte(evaluationJobs.runAfter, at))),
    db
      .select({ n: count() })
      .from(evaluationJobs)
      .where(and(eq(evaluationJobs.status, "running"), lt(evaluationJobs.claimedAt, stuckBefore))),
    db.select({ n: count() }).from(evaluationJobs).where(and(gt(evaluationJobs.attempts, 1), gt(evaluationJobs.createdAt, since))),
    db
      .select({
        id: evaluationJobs.id,
        competitionId: evaluationJobs.competitionId,
        attempts: evaluationJobs.attempts,
        lastError: evaluationJobs.lastError,
        updatedAt: evaluationJobs.updatedAt,
      })
      .from(evaluationJobs)
      .where(or(eq(evaluationJobs.status, "failed"), and(isNotNull(evaluationJobs.lastError), gt(evaluationJobs.updatedAt, since))))
      .orderBy(desc(evaluationJobs.updatedAt))
      .limit(10),
    db
      .select({ status: evaluationRuns.status, n: count() })
      .from(evaluationRuns)
      .where(gt(evaluationRuns.startedAt, since))
      .groupBy(evaluationRuns.status),
    // Passes 3+4 only run when passes 1 and 2 disagree (design §4.3.3) → their presence = disagreement.
    db
      .select({ n: countDistinct(evaluationPasses.evaluationRunId) })
      .from(evaluationPasses)
      .innerJoin(evaluationRuns, eq(evaluationRuns.id, evaluationPasses.evaluationRunId))
      .where(and(eq(evaluationPasses.passNo, 3), gt(evaluationRuns.startedAt, since))),
    db
      .select({ n: countDistinct(evaluationPasses.evaluationRunId) })
      .from(evaluationPasses)
      .innerJoin(evaluationRuns, eq(evaluationRuns.id, evaluationPasses.evaluationRunId))
      .innerJoin(
        passTable,
        and(eq(passTable.evaluationRunId, evaluationPasses.evaluationRunId), eq(passTable.passNo, 2), sql`${passTable.error} is null`),
      )
      .where(and(eq(evaluationPasses.passNo, 1), sql`${evaluationPasses.error} is null`, gt(evaluationRuns.startedAt, since))),
    db
      .select({
        total: count(),
        failed: sql<number>`count(*) filter (where ${evaluationPasses.error} is not null)::int`,
        refusals: sql<number>`count(*) filter (where ${evaluationPasses.stopReason} = 'refusal')::int`,
      })
      .from(evaluationPasses)
      .where(gt(evaluationPasses.startedAt, since)),
    db
      .select({
        passNo: evaluationPasses.passNo,
        count: count(),
        avgConfidence: sql<number | null>`avg(${evaluationPasses.confidence})::float8`,
        avgInvalidQuotes: sql<number | null>`avg(${evaluationPasses.invalidQuoteCount})::float8`,
      })
      .from(evaluationPasses)
      .where(and(gt(evaluationPasses.startedAt, since), sql`${evaluationPasses.error} is null`))
      .groupBy(evaluationPasses.passNo)
      .orderBy(evaluationPasses.passNo),
    db
      .select({
        avg: sql<number | null>`avg(${evaluationPasses.latencyMs})::float8`,
        p50: sql<number | null>`percentile_cont(0.5) within group (order by ${evaluationPasses.latencyMs})::float8`,
        p95: sql<number | null>`percentile_cont(0.95) within group (order by ${evaluationPasses.latencyMs})::float8`,
      })
      .from(evaluationPasses)
      .where(and(gt(evaluationPasses.startedAt, since), isNotNull(evaluationPasses.latencyMs))),
    db
      .select({
        model: evaluationPasses.model,
        passes: count(),
        inputTokens: usageInt("inputTokens"),
        outputTokens: usageInt("outputTokens"),
        cacheReadInputTokens: usageInt("cacheReadInputTokens"),
        cacheCreationInputTokens: usageInt("cacheCreationInputTokens"),
      })
      .from(evaluationPasses)
      .where(gt(evaluationPasses.startedAt, since))
      .groupBy(evaluationPasses.model),
    db
      .select({
        outcome: verdicts.outcome,
        n: count(),
        avgConfidence: sql<number | null>`avg(${verdicts.confidence})::float8`,
      })
      .from(verdicts)
      .where(and(eq(verdicts.decidedBy, "ai"), gt(verdicts.createdAt, since)))
      .groupBy(verdicts.outcome),
    db.select({ n: count() }).from(verdicts).where(and(eq(verdicts.decidedBy, "human"), gt(verdicts.createdAt, since))),
    db.select({ status: appeals.status, n: count() }).from(appeals).where(gt(appeals.createdAt, since)).groupBy(appeals.status),
    db.select({ n: countDistinct(appeals.competitionId) }).from(appeals).where(gt(appeals.createdAt, since)),
    // Reversal = the competition's current verdict outcome differs from the verdict that was appealed.
    db
      .select({ n: countDistinct(appeals.id) })
      .from(appeals)
      .innerJoin(appealedVerdict, eq(appealedVerdict.id, appeals.verdictId))
      .innerJoin(currentVerdict, and(eq(currentVerdict.competitionId, appeals.competitionId), eq(currentVerdict.isCurrent, true)))
      .where(
        and(
          gt(appeals.createdAt, since),
          inArray(appeals.status, ["reevaluated", "overturned"]),
          sql`${currentVerdict.outcome} <> ${appealedVerdict.outcome}`,
        ),
      ),
    db.select({ n: count() }).from(competitions).where(eq(competitions.status, "needs_review")),
  ]);

  const jobsByStatus = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const row of jobStatusRows) jobsByStatus[row.status] = row.n;
  const oldest = oldestDue[0]?.runAfter ? new Date(oldestDue[0].runAfter) : null;

  const verdictByOutcome: Record<string, number> = {};
  let aiDecided = 0;
  let confidenceSum = 0;
  let confidenceN = 0;
  for (const row of verdictRows) {
    verdictByOutcome[row.outcome] = row.n;
    aiDecided += row.n;
    if (row.avgConfidence !== null && row.outcome !== "forfeit") {
      confidenceSum += row.avgConfidence * row.n;
      confidenceN += row.n;
    }
  }
  const appealByStatus = Object.fromEntries(appealStatusRows.map((r) => [r.status, r.n]));
  const appealTotal = appealStatusRows.reduce((sum, r) => sum + r.n, 0);
  const runsByStatus = Object.fromEntries(runStatusRows.map((r) => [r.status, r.n]));

  return {
    windowDays,
    jobs: {
      byStatus: jobsByStatus,
      oldestDueMinutes: oldest ? Math.max(0, (at.getTime() - oldest.getTime()) / MINUTE_MS) : 0,
      stuck: stuckRow[0]?.n ?? 0,
      retried: retriedRow[0]?.n ?? 0,
      recentFailures,
    },
    runs: {
      total: runStatusRows.reduce((sum, r) => sum + r.n, 0),
      byStatus: runsByStatus,
      needingThirdPass: thirdPassRow[0]?.n ?? 0,
      withTwoPasses: twoPassRow[0]?.n ?? 0,
    },
    passes: {
      total: passTotals[0]?.total ?? 0,
      failed: passTotals[0]?.failed ?? 0,
      refusals: passTotals[0]?.refusals ?? 0,
      byPassNo,
      latencyMs: { avg: latencyRows[0]?.avg ?? null, p50: latencyRows[0]?.p50 ?? null, p95: latencyRows[0]?.p95 ?? null },
      usage: usageRows.map((u) => ({
        model: u.model,
        passes: u.passes,
        inputTokens: Number(u.inputTokens),
        outputTokens: Number(u.outputTokens),
        cacheReadInputTokens: Number(u.cacheReadInputTokens),
        cacheCreationInputTokens: Number(u.cacheCreationInputTokens),
      })),
    },
    verdicts: {
      aiDecided,
      byOutcome: verdictByOutcome,
      avgConfidence: confidenceN > 0 ? confidenceSum / confidenceN : null,
      humanDecided: humanRow[0]?.n ?? 0,
    },
    appeals: {
      total: appealTotal,
      competitionsAppealed: appealCompetitionsRow[0]?.n ?? 0,
      decided: appealTotal - (appealByStatus.open ?? 0),
      reversed: reversedRow[0]?.n ?? 0,
      byStatus: appealByStatus,
    },
    needsReviewNow: needsReviewRow[0]?.n ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------------------------------

export interface AuditFilters {
  /** Exact action ("moderation.suspend") or a prefix ending in "." ("moderation."). */
  action?: string;
  targetType?: string;
  targetId?: string;
  /** Actor handle; "system" for automatic entries. */
  actor?: string;
  from?: Date;
  to?: Date;
  /** Keyset cursor from the previous page. */
  cursor?: string;
}

export interface AuditItem {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
  createdAt: Date;
  actorId: string | null;
  actorHandle: string | null;
}

function isTargetType(value: string): value is TargetType {
  return (TARGET_TYPES as readonly string[]).includes(value);
}

export function encodeAuditCursor(item: { createdAt: Date; id: string }): string {
  return `${item.createdAt.toISOString()}_${item.id}`;
}

export function decodeAuditCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [iso, id] = cursor.split("_");
  if (!iso || !id) return null;
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { createdAt, id };
}

export async function listAuditLogs(filters: AuditFilters): Promise<{ items: AuditItem[]; nextCursor: string | null }> {
  await requireStaff("admin");
  const cursor = filters.cursor ? decodeAuditCursor(filters.cursor) : null;
  const action = filters.action?.trim();
  const actor = filters.actor?.trim().replace(/^@/, "").toLowerCase();
  const where = and(
    action ? (action.endsWith(".") ? ilike(auditLogs.action, `${escapeLike(action)}%`) : eq(auditLogs.action, action)) : undefined,
    filters.targetType && isTargetType(filters.targetType) ? eq(auditLogs.targetType, filters.targetType) : undefined,
    filters.targetId ? eq(auditLogs.targetId, filters.targetId.trim()) : undefined,
    actor === "system" ? sql`${auditLogs.actorId} is null` : actor ? eq(profiles.handle, actor) : undefined,
    filters.from ? gte(auditLogs.createdAt, filters.from) : undefined,
    filters.to ? lte(auditLogs.createdAt, filters.to) : undefined,
    cursor
      ? or(lt(auditLogs.createdAt, cursor.createdAt), and(eq(auditLogs.createdAt, cursor.createdAt), lt(auditLogs.id, cursor.id)))
      : undefined,
  );
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      before: auditLogs.before,
      after: auditLogs.after,
      createdAt: auditLogs.createdAt,
      actorId: auditLogs.actorId,
      actorHandle: profiles.handle,
    })
    .from(auditLogs)
    .leftJoin(profiles, eq(profiles.userId, auditLogs.actorId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(PAGE_SIZE + 1);
  const items = rows.slice(0, PAGE_SIZE);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > PAGE_SIZE && last ? encodeAuditCursor(last) : null };
}

/** Distinct audit action names (for the filter dropdown). */
export async function listAuditActions(): Promise<string[]> {
  await requireStaff("admin");
  const rows = await db.selectDistinct({ action: auditLogs.action }).from(auditLogs).orderBy(auditLogs.action).limit(200);
  return rows.map((r) => r.action);
}
