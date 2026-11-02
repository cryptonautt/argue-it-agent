"use server";

/**
 * Owner: moderation. Server actions for reporting and moderation (design §4.7, §5.4).
 * Every action: role guard → zod → rate limit (reports) → object-level authorisation (policy.ts, in
 * service.ts) → one transaction (state + moderation_actions + audit + notification) → ActionResult.
 * State-changing staff actions take a client idempotency key so a double-tap can't act twice.
 */
import { count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, ok, type ActionResult } from "@domain/lib/action-result";
import { parseInput, runAction } from "@domain/action";
import { writeAudit } from "@domain/audit";
import { requireRole, requireUser } from "@domain/auth";
import { db } from "@domain/db";
import { reportTargetEnum, userRoleEnum, users, type UserRole } from "@domain/db/schema";
import { withIdempotency, idempotencyKeySchema } from "@domain/idempotency";
import { enforceRateLimit } from "@domain/rate-limit";
import {
  CONTENT_ACTIONS,
  MODERATION_NOTE_MAX,
  MODERATION_REASON_CODES,
  REPORT_DETAILS_MAX,
  SUSPENSION_DURATION_KEYS,
  USER_REPORT_REASONS,
  canChangeRole,
} from "./policy";
import {
  applyContentAction,
  dismissReportAs,
  fileReportFor,
  suspendAccount,
  unsuspendAccount,
  warnAccount,
} from "./service";
import { canViewerSeeTarget, loadTarget } from "./targets";

const optionalNote = z
  .string()
  .trim()
  .max(MODERATION_NOTE_MAX, `Keep the note under ${MODERATION_NOTE_MAX.toLocaleString("en-GB")} characters.`)
  .optional()
  .transform((v) => (v ? v : null));

const requiredNote = z
  .string()
  .trim()
  .min(5, "Write a short reason (it goes in the audit log).")
  .max(MODERATION_NOTE_MAX, `Keep the note under ${MODERATION_NOTE_MAX.toLocaleString("en-GB")} characters.`);

const reasonCode = z.enum(MODERATION_REASON_CODES, { error: "Pick a reason." });

function refreshAdmin(...paths: string[]): void {
  for (const path of ["/admin", "/admin/reports", "/admin/users", ...paths]) revalidatePath(path);
}

// ---------------------------------------------------------------------------------------------------
// Reporting (any signed-in, non-suspended user)
// ---------------------------------------------------------------------------------------------------

const fileReportSchema = z
  .object({
    targetType: z.enum(reportTargetEnum.enumValues),
    targetId: z.uuid("We couldn't tell what you're reporting."),
    reason: z.enum(USER_REPORT_REASONS, { error: "Pick a reason." }),
    details: z
      .string()
      .trim()
      .max(REPORT_DETAILS_MAX, `Keep it under ${REPORT_DETAILS_MAX.toLocaleString("en-GB")} characters.`)
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .refine((v) => v.reason !== "other" || (v.details !== null && v.details.length >= 5), {
    message: "Tell us briefly what's wrong.",
    path: ["details"],
  });

export async function fileReport(
  input: z.input<typeof fileReportSchema>,
): Promise<ActionResult<{ reportId: string; alreadyReported: boolean }>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(fileReportSchema, input);
    await enforceRateLimit(user.id, "report");

    const target = await loadTarget({ type: data.targetType, id: data.targetId });
    // Same answer for "missing" and "not visible to you": the endpoint must not reveal sealed content.
    if (!target || !canViewerSeeTarget(target, user.id)) {
      throw new ActionError("NOT_FOUND", "We couldn't find that. It may already have been removed.");
    }
    if (target.author.id === user.id) throw new ActionError("FORBIDDEN", "You can't report your own content.");

    const result = await fileReportFor({
      reporterId: user.id,
      target: { type: data.targetType, id: data.targetId },
      reason: data.reason,
      details: data.details,
    });
    revalidatePath("/admin/reports");
    return ok(result);
  });
}

// ---------------------------------------------------------------------------------------------------
// Content actions (moderator+)
// ---------------------------------------------------------------------------------------------------

const moderateContentSchema = z.object({
  targetType: z.enum(reportTargetEnum.enumValues),
  targetId: z.uuid(),
  action: z.enum(CONTENT_ACTIONS),
  reasonCode,
  note: optionalNote,
  reportId: z.uuid().optional(),
  idempotencyKey: idempotencyKeySchema,
});

export async function moderateContent(
  input: z.input<typeof moderateContentSchema>,
): Promise<ActionResult<{ actionId: string; status: "visible" | "hidden" | "removed" | null; reportsResolved: number }>> {
  return runAction(async () => {
    const actor = await requireRole("moderator");
    const data = parseInput(moderateContentSchema, input);
    return withIdempotency(data.idempotencyKey, actor.id, `moderation.${data.action}`, async () => {
      const result = await applyContentAction({
        actor,
        target: { type: data.targetType, id: data.targetId },
        action: data.action,
        reasonCode: data.reasonCode,
        note: data.note,
        reportId: data.reportId ?? null,
      });
      refreshAdmin(data.reportId ? `/admin/reports/${data.reportId}` : "/admin/reports");
      return ok(result);
    });
  });
}

// ---------------------------------------------------------------------------------------------------
// Account actions (moderator+; staff accounts admin-only via policy.canModerate)
// ---------------------------------------------------------------------------------------------------

const warnSchema = z.object({
  userId: z.uuid(),
  reasonCode,
  note: optionalNote,
  reportId: z.uuid().optional(),
  idempotencyKey: idempotencyKeySchema,
});

export async function warnUser(
  input: z.input<typeof warnSchema>,
): Promise<ActionResult<{ actionId: string; reportsResolved: number }>> {
  return runAction(async () => {
    const actor = await requireRole("moderator");
    const data = parseInput(warnSchema, input);
    return withIdempotency(data.idempotencyKey, actor.id, "moderation.warn", async () => {
      const result = await warnAccount({ actor, ...data, reportId: data.reportId ?? null });
      refreshAdmin(`/admin/users/${data.userId}`);
      return ok(result);
    });
  });
}

const suspendSchema = z.object({
  userId: z.uuid(),
  duration: z.enum(SUSPENSION_DURATION_KEYS, { error: "Pick how long." }),
  reasonCode,
  note: requiredNote,
  reportId: z.uuid().optional(),
  idempotencyKey: idempotencyKeySchema,
});

export async function suspendUser(
  input: z.input<typeof suspendSchema>,
): Promise<ActionResult<{ actionId: string; suspendedUntil: string | null; reportsResolved: number }>> {
  return runAction(async () => {
    const actor = await requireRole("moderator");
    const data = parseInput(suspendSchema, input);
    return withIdempotency(data.idempotencyKey, actor.id, "moderation.suspend", async () => {
      const result = await suspendAccount({ actor, ...data, reportId: data.reportId ?? null });
      refreshAdmin(`/admin/users/${data.userId}`);
      return ok(result);
    });
  });
}

const unsuspendSchema = z.object({
  userId: z.uuid(),
  note: requiredNote,
  idempotencyKey: idempotencyKeySchema,
});

export async function unsuspendUser(input: z.input<typeof unsuspendSchema>): Promise<ActionResult<{ actionId: string }>> {
  return runAction(async () => {
    const actor = await requireRole("moderator");
    const data = parseInput(unsuspendSchema, input);
    return withIdempotency(data.idempotencyKey, actor.id, "moderation.unsuspend", async () => {
      const result = await unsuspendAccount({ actor, userId: data.userId, reasonCode: "other", note: data.note });
      refreshAdmin(`/admin/users/${data.userId}`);
      return ok(result);
    });
  });
}

// ---------------------------------------------------------------------------------------------------
// Dismiss (moderator+)
// ---------------------------------------------------------------------------------------------------

const dismissSchema = z.object({
  reportId: z.uuid(),
  note: optionalNote,
  idempotencyKey: idempotencyKeySchema,
});

export async function dismissReport(input: z.input<typeof dismissSchema>): Promise<ActionResult<{ actionId: string }>> {
  return runAction(async () => {
    const actor = await requireRole("moderator");
    const data = parseInput(dismissSchema, input);
    return withIdempotency(data.idempotencyKey, actor.id, "moderation.dismiss_report", async () => {
      const result = await dismissReportAs(actor, data.reportId, data.note);
      refreshAdmin(`/admin/reports/${data.reportId}`);
      return ok(result);
    });
  });
}

// ---------------------------------------------------------------------------------------------------
// Role changes (admin only)
// ---------------------------------------------------------------------------------------------------

const changeRoleSchema = z.object({
  userId: z.uuid(),
  role: z.enum(userRoleEnum.enumValues),
  note: requiredNote,
  idempotencyKey: idempotencyKeySchema,
});

export async function changeUserRole(
  input: z.input<typeof changeRoleSchema>,
): Promise<ActionResult<{ role: UserRole }>> {
  return runAction(async () => {
    const actor = await requireRole("admin");
    const data = parseInput(changeRoleSchema, input);
    return withIdempotency(data.idempotencyKey, actor.id, "admin.role_change", async () => {
      const role = await db.transaction(async (tx) => {
        const [subject] = await tx
          .select({ id: users.id, role: users.role, status: users.status })
          .from(users)
          .where(eq(users.id, data.userId))
          .limit(1);
        if (!subject || subject.status === "deleted") throw new ActionError("NOT_FOUND", "That account no longer exists.");
        const [admins] = await tx.select({ n: count() }).from(users).where(eq(users.role, "admin"));
        const permission = canChangeRole(actor, subject, data.role, admins?.n ?? 0);
        if (!permission.allowed) throw new ActionError("FORBIDDEN", permission.reason);

        await tx.update(users).set({ role: data.role }).where(eq(users.id, subject.id));
        await writeAudit(
          {
            actorId: actor.id,
            action: "admin.role_change",
            targetType: "user",
            targetId: subject.id,
            before: { role: subject.role },
            after: { role: data.role, note: data.note },
          },
          tx,
        );
        return data.role;
      });
      refreshAdmin(`/admin/users/${data.userId}`);
      return ok({ role });
    });
  });
}
