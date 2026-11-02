/**
 * Owner: moderation. Moderation domain operations shared by the server actions (actions.ts) and by
 * other modules / cron (automatic reports, suspension expiry). Authorisation of the *caller* is done in
 * actions.ts; the functions here enforce the object-level rules (policy.ts) and keep every write
 * (state change + moderation_actions + audit + report resolution + notification) in one transaction.
 *
 * Nothing in this file touches competitions, verdicts, scores or ratings — content moderation is
 * separate from AI judging (design §4.7, PRD §8.9).
 */
import "server-only";

import { and, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { ActionError } from "@domain/lib/action-result";
import { addHours, now } from "@domain/lib/time";
import { writeAudit } from "@domain/audit";
import { db, type DbOrTx, type Tx } from "@domain/db";
import { isUniqueViolation } from "@domain/db/errors";
import {
  auditLogs,
  moderationActions,
  reports,
  users,
  type ModerationActionType,
  type ReportReason,
  type ReportTarget,
  type TargetType,
} from "@domain/db/schema";
import type { NotificationData } from "@domain/db/json-types";
import { notify } from "@domain/notifications";
import {
  allowedContentActions,
  canModerate,
  canSuspendFor,
  describeActionForAuthor,
  nextStatus,
  suspensionHours,
  type Actor,
  type ContentAction,
  type SuspensionDurationKey,
} from "./policy";
import { clearProfileContent, loadTarget, setContentStatus, type TargetRef, type TargetSummary } from "./targets";

// ---------------------------------------------------------------------------------------------------
// Automatic reports (judge prompt-injection pre-scan, spam screening)
// ---------------------------------------------------------------------------------------------------

export interface AutomaticReportInput {
  targetType: ReportTarget;
  targetId: string;
  reason: ReportReason;
  /** Moderator-facing context (≤ 1,000 chars; longer is truncated). */
  details?: string | null;
}

export type AutomaticReportResult = { created: true; id: string } | { created: false; id: string };

/**
 * Open a system report (reporter = null, is_automatic = true). Idempotent per (target, reason): while an
 * automatic report for the same target and reason is open, the existing one is returned. Pass `tx` to
 * make it part of your transaction (e.g. the judge's evaluation run).
 */
export async function openAutomaticReport(input: AutomaticReportInput, conn: DbOrTx = db): Promise<AutomaticReportResult> {
  const [existing] = await conn
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.targetType, input.targetType),
        eq(reports.targetId, input.targetId),
        eq(reports.reason, input.reason),
        eq(reports.status, "open"),
        eq(reports.isAutomatic, true),
      ),
    )
    .limit(1);
  if (existing) return { created: false, id: existing.id };

  const [row] = await conn
    .insert(reports)
    .values({
      reporterId: null,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      details: input.details ? input.details.slice(0, 1000) : null,
      isAutomatic: true,
      createdAt: now(),
    })
    .returning({ id: reports.id });
  if (!row) throw new Error("openAutomaticReport: insert returned no row");
  return { created: true, id: row.id };
}

// ---------------------------------------------------------------------------------------------------
// User reports
// ---------------------------------------------------------------------------------------------------

export interface FileReportInput {
  reporterId: string;
  target: TargetRef;
  reason: ReportReason;
  details: string | null;
}

/**
 * Store a user's report. One open report per reporter per target (DB-enforced); a repeat returns the
 * existing report instead of failing — the person already did the right thing.
 */
export async function fileReportFor(input: FileReportInput, conn: DbOrTx = db): Promise<{ reportId: string; alreadyReported: boolean }> {
  const findOpen = async () =>
    (
      await conn
        .select({ id: reports.id })
        .from(reports)
        .where(
          and(
            eq(reports.reporterId, input.reporterId),
            eq(reports.targetType, input.target.type),
            eq(reports.targetId, input.target.id),
            eq(reports.status, "open"),
          ),
        )
        .limit(1)
    )[0];

  const existing = await findOpen();
  if (existing) return { reportId: existing.id, alreadyReported: true };
  try {
    const [row] = await conn
      .insert(reports)
      .values({
        reporterId: input.reporterId,
        targetType: input.target.type,
        targetId: input.target.id,
        reason: input.reason,
        details: input.details,
        createdAt: now(),
      })
      .returning({ id: reports.id });
    if (!row) throw new Error("fileReport: insert returned no row");
    return { reportId: row.id, alreadyReported: false };
  } catch (error) {
    if (isUniqueViolation(error, "reports_one_open_per_reporter_target")) {
      const raced = await findOpen();
      if (raced) return { reportId: raced.id, alreadyReported: true };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------
// Shared write helpers
// ---------------------------------------------------------------------------------------------------

interface RecordActionInput {
  actor: Actor;
  action: ModerationActionType;
  targetType: ReportTarget | "user";
  targetId: string;
  reasonCode: ReportReason;
  note: string | null;
  reportId: string | null;
  durationHours?: number | null;
  expiresAt?: Date | null;
}

async function recordModerationAction(input: RecordActionInput, tx: Tx): Promise<string> {
  const [row] = await tx
    .insert(moderationActions)
    .values({
      moderatorId: input.actor.id,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      reportId: input.reportId,
      reasonCode: input.reasonCode,
      note: input.note,
      durationHours: input.durationHours ?? null,
      expiresAt: input.expiresAt ?? null,
      createdAt: now(),
    })
    .returning({ id: moderationActions.id });
  if (!row) throw new Error("recordModerationAction: insert returned no row");
  return row.id;
}

/** Close every open report on a target (the action answers all of them). Returns how many. */
async function resolveOpenReports(
  target: TargetRef,
  status: "actioned" | "dismissed",
  actorId: string,
  note: string | null,
  tx: Tx,
): Promise<number> {
  const rows = await tx
    .update(reports)
    .set({ status, resolvedBy: actorId, resolvedAt: now(), resolutionNote: note })
    .where(and(eq(reports.targetType, target.type), eq(reports.targetId, target.id), eq(reports.status, "open")))
    .returning({ id: reports.id });
  return rows.length;
}

/** Link hints the inbox uses to send the person to the right place (social's notification-format). */
function linkHints(target: TargetSummary | null): NotificationData {
  if (!target) return {};
  switch (target.type) {
    case "argument":
      return { argumentId: target.id };
    case "comment":
      return { argumentId: target.argumentId ?? null, commentId: target.id };
    case "submission":
      return { competitionId: target.competition?.id ?? null };
    case "profile":
      return {};
  }
}

async function notifyAffected(
  userId: string,
  action: ModerationActionType,
  targetType: ReportTarget | "user",
  targetId: string,
  reason: ReportReason,
  tx: Tx,
  hints: NotificationData = {},
): Promise<void> {
  // actorId stays null: the person sees "the moderators", never which one.
  // `reason` is the readable sentence the inbox shows as detail; `reasonCode` is the machine value.
  await notify(
    {
      userId,
      type: action === "warn" ? "moderation_warning" : "moderation_action",
      targetType: targetType satisfies TargetType,
      targetId,
      actorId: null,
      data: { ...hints, action, reasonCode: reason, targetType, reason: describeActionForAuthor(action, targetType, reason) },
    },
    tx,
  );
}

function assertAllowed(permission: { allowed: true } | { allowed: false; reason: string }): void {
  if (!permission.allowed) throw new ActionError("FORBIDDEN", permission.reason);
}

/** Load the report (if any) and check it concerns `target`. */
async function loadReportFor(reportId: string | null, target: TargetRef, tx: Tx): Promise<void> {
  if (!reportId) return;
  const [report] = await tx
    .select({ targetType: reports.targetType, targetId: reports.targetId })
    .from(reports)
    .where(eq(reports.id, reportId))
    .limit(1);
  if (!report) throw new ActionError("NOT_FOUND", "That report no longer exists.");
  if (report.targetType !== target.type || report.targetId !== target.id) {
    throw new ActionError("VALIDATION", "That report is about something else.");
  }
}

// ---------------------------------------------------------------------------------------------------
// Content actions: hide / remove / restore
// ---------------------------------------------------------------------------------------------------

export interface ContentActionInput {
  actor: Actor;
  target: TargetRef;
  action: ContentAction;
  reasonCode: ReportReason;
  note: string | null;
  reportId: string | null;
}

export interface ContentActionResult {
  actionId: string;
  status: "visible" | "hidden" | "removed" | null;
  reportsResolved: number;
}

export async function applyContentAction(input: ContentActionInput): Promise<ContentActionResult> {
  return db.transaction(async (tx) => {
    const target = await loadTarget(input.target, tx);
    if (!target) throw new ActionError("NOT_FOUND", "That content no longer exists.");
    assertAllowed(canModerate(input.actor, target.author));
    if (!allowedContentActions(target).includes(input.action)) {
      throw new ActionError("CONFLICT", describeInvalidContentAction(target, input.action));
    }
    if (input.action === "restore" && (await wasDeletedByAuthor(target, tx))) {
      throw new ActionError("CONFLICT", "The author deleted this themselves, so moderators can't bring it back.");
    }
    await loadReportFor(input.reportId, input.target, tx);

    let before: unknown;
    let after: unknown;
    let status: ContentActionResult["status"] = null;
    if (target.type === "profile") {
      const previous = await clearProfileContent(target.id, tx);
      before = previous;
      after = { bio: null, avatarUrl: null };
    } else {
      if (target.status === null) throw new Error("content target without status");
      status = nextStatus(input.action);
      const updated = await setContentStatus(input.target, target.status, status, tx);
      if (!updated) throw new ActionError("CONFLICT", "Someone else changed this just now. Refresh and check again.");
      before = { status: target.status };
      after = { status };
    }

    const actionId = await recordModerationAction(
      {
        actor: input.actor,
        action: input.action,
        targetType: target.type,
        targetId: target.id,
        reasonCode: input.reasonCode,
        note: input.note,
        reportId: input.reportId,
      },
      tx,
    );
    // Restoring answers nothing: reports stay as they were. Hide/remove close all open reports on it.
    const reportsResolved =
      input.action === "restore" ? 0 : await resolveOpenReports(input.target, "actioned", input.actor.id, input.note, tx);

    await writeAudit(
      {
        actorId: input.actor.id,
        action: `moderation.${input.action}`,
        targetType: target.type,
        targetId: target.id,
        before,
        after: { ...(after as object), reasonCode: input.reasonCode, note: input.note, reportId: input.reportId, moderationActionId: actionId },
      },
      tx,
    );
    await notifyAffected(target.author.id, input.action, target.type, target.id, input.reasonCode, tx, linkHints(target));
    return { actionId, status, reportsResolved };
  });
}

/** Audit verbs written when an author deletes their own argument/comment (arguments-feed, social). */
const AUTHOR_DELETE_ACTIONS = ["argument.delete", "comment.delete_own"] as const;
const STATUS_CHANGE_ACTIONS = [...AUTHOR_DELETE_ACTIONS, "moderation.hide", "moderation.remove", "moderation.restore"];

/**
 * True when the latest status change on this argument/comment was its author deleting it. Restoring that would
 * resurrect something the author chose to delete (docs/requests.md, arguments-feed helpers note).
 */
async function wasDeletedByAuthor(target: TargetSummary, tx: DbOrTx): Promise<boolean> {
  if ((target.type !== "argument" && target.type !== "comment") || target.status !== "removed") return false;
  const [latest] = await tx
    .select({ action: auditLogs.action, actorId: auditLogs.actorId })
    .from(auditLogs)
    .where(and(eq(auditLogs.targetId, target.id), inArray(auditLogs.action, STATUS_CHANGE_ACTIONS)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);
  return Boolean(latest && (AUTHOR_DELETE_ACTIONS as readonly string[]).includes(latest.action) && latest.actorId === target.author.id);
}

function describeInvalidContentAction(target: TargetSummary, action: ContentAction): string {
  if (target.type === "profile") {
    return action === "remove" ? "This profile has no bio or photo to clear." : "Profiles can't be hidden. Clear the bio or suspend the account instead.";
  }
  if (action === "restore") return "This is already visible.";
  return target.status === "removed" ? "This was already removed." : `This is already ${target.status}.`;
}

// ---------------------------------------------------------------------------------------------------
// Account actions: warn / suspend / unsuspend
// ---------------------------------------------------------------------------------------------------

export interface AccountActionBase {
  actor: Actor;
  userId: string;
  reasonCode: ReportReason;
  note: string | null;
  /** When acting from a report: the report's content target (its open reports get resolved). */
  reportId: string | null;
}

async function loadSubject(userId: string, tx: Tx) {
  const [subject] = await tx
    .select({ id: users.id, role: users.role, status: users.status, suspendedUntil: users.suspendedUntil })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!subject || subject.status === "deleted") throw new ActionError("NOT_FOUND", "That account no longer exists.");
  return subject;
}

/** If acting from a report, the report must be about this user (their content or profile). */
async function reportTargetForUser(reportId: string | null, userId: string, tx: Tx): Promise<TargetRef | null> {
  if (!reportId) return null;
  const [report] = await tx
    .select({ targetType: reports.targetType, targetId: reports.targetId })
    .from(reports)
    .where(eq(reports.id, reportId))
    .limit(1);
  if (!report) throw new ActionError("NOT_FOUND", "That report no longer exists.");
  const ref: TargetRef = { type: report.targetType, id: report.targetId };
  const target = await loadTarget(ref, tx);
  if (!target || target.author.id !== userId) throw new ActionError("VALIDATION", "That report is about someone else.");
  return ref;
}

export async function warnAccount(input: AccountActionBase): Promise<{ actionId: string; reportsResolved: number }> {
  return db.transaction(async (tx) => {
    const subject = await loadSubject(input.userId, tx);
    assertAllowed(canModerate(input.actor, subject));
    const reportTarget = await reportTargetForUser(input.reportId, subject.id, tx);

    const actionId = await recordModerationAction(
      { ...input, action: "warn", targetType: "user", targetId: subject.id },
      tx,
    );
    const reportsResolved = reportTarget ? await resolveOpenReports(reportTarget, "actioned", input.actor.id, input.note, tx) : 0;
    await writeAudit(
      {
        actorId: input.actor.id,
        action: "moderation.warn",
        targetType: "user",
        targetId: subject.id,
        after: { reasonCode: input.reasonCode, note: input.note, reportId: input.reportId, moderationActionId: actionId },
      },
      tx,
    );
    await notifyAffected(subject.id, "warn", "user", subject.id, input.reasonCode, tx);
    return { actionId, reportsResolved };
  });
}

export interface SuspendInput extends AccountActionBase {
  duration: SuspensionDurationKey;
}

export async function suspendAccount(
  input: SuspendInput,
): Promise<{ actionId: string; suspendedUntil: string | null; reportsResolved: number }> {
  assertAllowed(canSuspendFor(input.actor, input.duration));
  return db.transaction(async (tx) => {
    const subject = await loadSubject(input.userId, tx);
    assertAllowed(canModerate(input.actor, subject));
    const reportTarget = await reportTargetForUser(input.reportId, subject.id, tx);

    const hours = suspensionHours(input.duration);
    const at = now();
    const until = hours === null ? null : addHours(at, hours);
    await tx.update(users).set({ status: "suspended", suspendedUntil: until }).where(eq(users.id, subject.id));

    const actionId = await recordModerationAction(
      { ...input, action: "suspend", targetType: "user", targetId: subject.id, durationHours: hours, expiresAt: until },
      tx,
    );
    const reportsResolved = reportTarget ? await resolveOpenReports(reportTarget, "actioned", input.actor.id, input.note, tx) : 0;
    await writeAudit(
      {
        actorId: input.actor.id,
        action: "moderation.suspend",
        targetType: "user",
        targetId: subject.id,
        before: { status: subject.status, suspendedUntil: subject.suspendedUntil?.toISOString() ?? null },
        after: {
          status: "suspended",
          suspendedUntil: until?.toISOString() ?? null,
          durationHours: hours,
          reasonCode: input.reasonCode,
          note: input.note,
          reportId: input.reportId,
          moderationActionId: actionId,
        },
      },
      tx,
    );
    await notifyAffected(subject.id, "suspend", "user", subject.id, input.reasonCode, tx);
    return { actionId, suspendedUntil: until?.toISOString() ?? null, reportsResolved };
  });
}

export async function unsuspendAccount(input: Omit<AccountActionBase, "reportId">): Promise<{ actionId: string }> {
  return db.transaction(async (tx) => {
    const subject = await loadSubject(input.userId, tx);
    assertAllowed(canModerate(input.actor, subject));
    if (subject.status !== "suspended") throw new ActionError("CONFLICT", "This account isn't suspended.");

    await tx.update(users).set({ status: "active", suspendedUntil: null }).where(eq(users.id, subject.id));
    const actionId = await recordModerationAction(
      { ...input, reportId: null, action: "unsuspend", targetType: "user", targetId: subject.id },
      tx,
    );
    await writeAudit(
      {
        actorId: input.actor.id,
        action: "moderation.unsuspend",
        targetType: "user",
        targetId: subject.id,
        before: { status: subject.status, suspendedUntil: subject.suspendedUntil?.toISOString() ?? null },
        after: { status: "active", suspendedUntil: null, reasonCode: input.reasonCode, note: input.note, moderationActionId: actionId },
      },
      tx,
    );
    await notifyAffected(subject.id, "unsuspend", "user", subject.id, input.reasonCode, tx);
    return { actionId };
  });
}

// ---------------------------------------------------------------------------------------------------
// Dismiss
// ---------------------------------------------------------------------------------------------------

export async function dismissReportAs(actor: Actor, reportId: string, note: string | null): Promise<{ actionId: string }> {
  return db.transaction(async (tx) => {
    const [report] = await tx.select().from(reports).where(eq(reports.id, reportId)).limit(1);
    if (!report) throw new ActionError("NOT_FOUND", "That report no longer exists.");
    if (report.status !== "open") throw new ActionError("CONFLICT", "This report was already handled.");
    if (report.reporterId === actor.id) throw new ActionError("FORBIDDEN", "You can't handle a report you filed yourself.");
    const target = await loadTarget({ type: report.targetType, id: report.targetId }, tx);
    if (target) assertAllowed(canModerate(actor, target.author));

    const updated = await tx
      .update(reports)
      .set({ status: "dismissed", resolvedBy: actor.id, resolvedAt: now(), resolutionNote: note })
      .where(and(eq(reports.id, report.id), eq(reports.status, "open")))
      .returning({ id: reports.id });
    if (updated.length === 0) throw new ActionError("CONFLICT", "This report was already handled.");

    const actionId = await recordModerationAction(
      {
        actor,
        action: "dismiss_report",
        targetType: report.targetType,
        targetId: report.targetId,
        reasonCode: report.reason,
        note,
        reportId: report.id,
      },
      tx,
    );
    await writeAudit(
      {
        actorId: actor.id,
        action: "moderation.dismiss_report",
        targetType: "report",
        targetId: report.id,
        before: { status: "open" },
        after: { status: "dismissed", note, moderationActionId: actionId },
      },
      tx,
    );
    return { actionId };
  });
}

// ---------------------------------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------------------------------

/**
 * Tidy lapsed suspensions: status 'suspended' with suspended_until in the past → 'active'.
 * (isSuspended() already ignores lapsed suspensions, so this is bookkeeping, not enforcement.)
 * Integration: call from /api/cron/tick. Returns how many accounts were reactivated.
 */
export async function liftExpiredSuspensions(conn: DbOrTx = db): Promise<number> {
  const at = now();
  const lifted = await conn
    .update(users)
    .set({ status: "active", suspendedUntil: null })
    .where(and(eq(users.status, "suspended"), isNotNull(users.suspendedUntil), lte(users.suspendedUntil, at)))
    .returning({ id: users.id });
  for (const row of lifted) {
    await writeAudit(
      { actorId: null, action: "moderation.suspension_expired", targetType: "user", targetId: row.id, after: { status: "active" } },
      conn,
    );
  }
  return lifted.length;
}
