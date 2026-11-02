"use server";
/**
 * Owner: challenges. Server actions for the direct-challenge lifecycle (design §4.2, §5.4).
 *
 * Every action: requireUser/requireRole → zod → idempotency key → (rate limit) → row-locked
 * transaction that first enforces deadlines, then authorises and applies the command through the pure
 * state machine → audit + notifications in the same transaction → ActionResult.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, ok, type ActionResult } from "@domain/lib/action-result";
import { validateLinks } from "@domain/lib/links";
import { now } from "@domain/lib/time";
import { parseInput, runAction } from "@domain/action";
import { requireRole, requireUser } from "@domain/auth";
import { db, type Tx } from "@domain/db";
import { submissions, type CompetitionRound, type CompetitionStatus } from "@domain/db/schema";
import { idempotencyKeySchema, withIdempotency } from "@domain/idempotency";
import { performCommand, type AdvanceResult } from "./lifecycle";
import type { LoadedCompetition } from "./repository";
import { createChallenge } from "./send";
import { roleOf, type Command } from "./state-machine";
import {
  CANCEL_REASON_MAX_CHARS,
  DECLINE_REASON_MAX_CHARS,
  OPENING_MAX_CHARS,
  PROPOSITION_MAX_CHARS,
  ROUND_DURATION_HOURS,
  roundCharLimit,
} from "./terms";
import { hashTerms, hashesEqual } from "./terms-hash";

export interface CompetitionStateResult {
  competitionId: string;
  status: CompetitionStatus;
  round: CompetitionRound | null;
}

const competitionIdSchema = z.uuid("That challenge link looks broken.");
const optionalReason = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `Keep the ${label} under ${max} characters.`)
    .nullish()
    .transform((value) => (value ? value : null));

function stateResult(competitionId: string, result: AdvanceResult): ActionResult<CompetitionStateResult> {
  return ok({ competitionId, status: result.status, round: result.round });
}

function refresh(competitionId: string, argumentId?: string): void {
  revalidatePath(`/c/${competitionId}`);
  if (argumentId) revalidatePath(`/a/${argumentId}`);
}

// ---------------------------------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------------------------------

const sendSchema = z.object({
  argumentId: z.uuid("Pick an argument to challenge."),
  commentId: z.uuid().nullish(),
  opponentId: z.uuid().nullish(),
  opponentHandle: z.string().trim().max(32).nullish(),
  proposition: z
    .string()
    .trim()
    .min(10, "Write the proposition as one clear statement both sides can argue.")
    .max(PROPOSITION_MAX_CHARS, `Keep the proposition under ${PROPOSITION_MAX_CHARS} characters.`),
  challengerSide: z.enum(["FOR", "AGAINST"], "Choose the side you will argue."),
  roundDurationHours: z
    .number()
    .int()
    .refine((value) => (ROUND_DURATION_HOURS as readonly number[]).includes(value), "Pick 24, 48 or 72 hours.")
    .default(24),
  idempotencyKey: idempotencyKeySchema,
});

export type SendChallengeInput = z.input<typeof sendSchema>;

/** Send a direct challenge. Freezes the full terms (rules_snapshot + terms_hash) at send time. */
export async function sendChallenge(input: SendChallengeInput): Promise<ActionResult<{ competitionId: string }>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(sendSchema, input);
    const roundDurationHours = data.roundDurationHours as 24 | 48 | 72;

    const result = await withIdempotency(data.idempotencyKey, user.id, "competition.send", async () => {
      const at = now();
      const competitionId = await db.transaction((tx) =>
        createChallenge(tx, user.id, { ...data, roundDurationHours }, at),
      );
      return ok({ competitionId });
    });

    if (result.ok) revalidatePath(`/a/${data.argumentId}`);
    return result;
  });
}

// ---------------------------------------------------------------------------------------------------
// Pending: accept / decline / withdraw
// ---------------------------------------------------------------------------------------------------

const acceptSchema = z.object({
  competitionId: competitionIdSchema,
  termsHash: z.string().regex(/^[0-9a-f]{64}$/, "These terms couldn't be verified. Refresh and review them again."),
  idempotencyKey: idempotencyKeySchema,
});

/** Accept the exact frozen terms. The submitted hash must match the stored snapshot's hash. */
export async function acceptChallenge(input: z.input<typeof acceptSchema>): Promise<ActionResult<CompetitionStateResult>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(acceptSchema, input);
    return withIdempotency(data.idempotencyKey, user.id, "competition.accept", async () => {
      const result = await performCommand(
        data.competitionId,
        { type: "accept", actorId: user.id },
        { check: (loaded) => verifyTerms(loaded, data.termsHash) },
      );
      refresh(data.competitionId, result.argumentId);
      return stateResult(data.competitionId, result);
    });
  });
}

function verifyTerms({ row }: LoadedCompetition, submittedHash: string): void {
  if (!hashesEqual(hashTerms(row.rulesSnapshot), row.termsHash)) {
    // Stored terms no longer match their hash: never start a debate on terms nobody agreed to.
    console.error("[competitions] terms hash integrity failure", row.id);
    throw new ActionError("CONFLICT", "These terms can't be verified, so this challenge can't start. Please report it.");
  }
  if (!hashesEqual(submittedHash, row.termsHash)) {
    throw new ActionError("CONFLICT", "The terms you reviewed don't match this challenge. Refresh and review them again.");
  }
}

const declineSchema = z.object({
  competitionId: competitionIdSchema,
  reason: optionalReason(DECLINE_REASON_MAX_CHARS, "reason"),
  idempotencyKey: idempotencyKeySchema,
});

export async function declineChallenge(input: z.input<typeof declineSchema>): Promise<ActionResult<CompetitionStateResult>> {
  return simpleCommand(input, declineSchema, "competition.decline", (userId, data) => ({
    type: "decline",
    actorId: userId,
    reason: data.reason,
  }));
}

const idOnlySchema = z.object({ competitionId: competitionIdSchema, idempotencyKey: idempotencyKeySchema });

export async function withdrawChallenge(input: z.input<typeof idOnlySchema>): Promise<ActionResult<CompetitionStateResult>> {
  return simpleCommand(input, idOnlySchema, "competition.withdraw", (userId) => ({ type: "withdraw", actorId: userId }));
}

// ---------------------------------------------------------------------------------------------------
// Active: submissions
// ---------------------------------------------------------------------------------------------------

const submissionSchema = z.object({
  competitionId: competitionIdSchema,
  round: z.enum(["opening", "rebuttal"]),
  body: z
    .string()
    .trim()
    .min(1, "Write your argument first.")
    .max(OPENING_MAX_CHARS, `Keep it under ${OPENING_MAX_CHARS.toLocaleString("en-GB")} characters.`),
  links: z.array(z.string().max(2_048)).max(20).default([]),
  idempotencyKey: idempotencyKeySchema,
});

export type SubmissionInput = z.input<typeof submissionSchema>;
type ParsedSubmission = z.output<typeof submissionSchema>;

/** Save (or overwrite) your draft for the current round. Drafts are sealed from the opponent. */
export async function saveSubmission(input: SubmissionInput): Promise<ActionResult<CompetitionStateResult & { savedAt: string }>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(submissionSchema, input);
    return withIdempotency(data.idempotencyKey, user.id, "competition.submission.save", async () => {
      const savedAt = now();
      const result = await performCommand(
        data.competitionId,
        { type: "save_submission", actorId: user.id, round: data.round },
        submissionHooks(user.id, data, savedAt),
      );
      refresh(data.competitionId, result.argumentId);
      return ok({ competitionId: data.competitionId, status: result.status, round: result.round, savedAt: savedAt.toISOString() });
    });
  });
}

/**
 * Lock in your entry for the current round: saves exactly this text and makes it final. When both
 * sides have locked, the round closes immediately.
 */
export async function lockSubmission(input: SubmissionInput): Promise<ActionResult<CompetitionStateResult>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(submissionSchema, input);
    return withIdempotency(data.idempotencyKey, user.id, "competition.submission.lock", async () => {
      const result = await performCommand(
        data.competitionId,
        { type: "lock_submission", actorId: user.id, round: data.round },
        submissionHooks(user.id, data, now()),
      );
      refresh(data.competitionId, result.argumentId);
      return stateResult(data.competitionId, result);
    });
  });
}

function submissionHooks(userId: string, data: ParsedSubmission, at: Date) {
  let links: string[] = [];
  return {
    check: ({ row }: LoadedCompetition) => {
      // Limits come from the frozen terms both sides agreed to, not from today's constants.
      const limit = roundCharLimit(row.rulesSnapshot, data.round);
      if (data.body.length > limit) {
        const message = `Your ${data.round} can be at most ${limit.toLocaleString("en-GB")} characters.`;
        throw new ActionError("VALIDATION", message, { body: [message] });
      }
      const checked = validateLinks(data.links, row.rulesSnapshot.limits.maxLinksPerSubmission);
      if (!checked.ok) throw new ActionError("VALIDATION", checked.error, { links: [checked.error] });
      links = checked.links;
    },
    write: async (tx: Tx, { row, state }: LoadedCompetition) => {
      const role = roleOf(state, userId);
      if (!role) throw new ActionError("FORBIDDEN", "Only the two people in this debate can submit.");
      await tx
        .insert(submissions)
        .values({
          competitionId: row.id,
          authorId: userId,
          side: state[role].side,
          round: data.round,
          body: data.body,
          links,
          createdAt: at,
          updatedAt: at,
        })
        .onConflictDoUpdate({
          target: [submissions.competitionId, submissions.authorId, submissions.round],
          set: { body: data.body, links, updatedAt: at },
        });
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Active: cancellation (mutual) and admin cancel
// ---------------------------------------------------------------------------------------------------

const cancelRequestSchema = z.object({
  competitionId: competitionIdSchema,
  reason: optionalReason(CANCEL_REASON_MAX_CHARS, "reason"),
  idempotencyKey: idempotencyKeySchema,
});

/** Ask to cancel an active challenge. It is cancelled once both sides have asked. */
export async function requestCancel(input: z.input<typeof cancelRequestSchema>): Promise<ActionResult<CompetitionStateResult>> {
  return simpleCommand(input, cancelRequestSchema, "competition.cancel.request", (userId, data) => ({
    type: "request_cancel",
    actorId: userId,
    reason: data.reason,
  }));
}

export async function retractCancel(input: z.input<typeof idOnlySchema>): Promise<ActionResult<CompetitionStateResult>> {
  return simpleCommand(input, idOnlySchema, "competition.cancel.retract", (userId) => ({
    type: "retract_cancel",
    actorId: userId,
  }));
}

const adminCancelSchema = z.object({
  competitionId: competitionIdSchema,
  reason: z
    .string()
    .trim()
    .min(5, "Give a reason both participants will see.")
    .max(CANCEL_REASON_MAX_CHARS, `Keep the reason under ${CANCEL_REASON_MAX_CHARS} characters.`),
  idempotencyKey: idempotencyKeySchema,
});

/** Admin-only cancellation with a recorded reason (audited; both participants are notified). */
export async function adminCancelCompetition(
  input: z.input<typeof adminCancelSchema>,
): Promise<ActionResult<CompetitionStateResult>> {
  return runAction(async () => {
    const admin = await requireRole("admin");
    const data = parseInput(adminCancelSchema, input);
    return withIdempotency(data.idempotencyKey, admin.id, "competition.admin_cancel", async () => {
      const result = await performCommand(
        data.competitionId,
        { type: "admin_cancel", actorId: admin.id, reason: data.reason },
        {
          // Same conflict-of-interest rule as appeals and moderation: staff never act on their own debate.
          check: ({ state }) => {
            if (roleOf(state, admin.id)) {
              throw new ActionError("FORBIDDEN", "You took part in this debate, so another admin has to cancel it.");
            }
          },
        },
      );
      refresh(data.competitionId, result.argumentId);
      revalidatePath("/admin/competitions");
      return stateResult(data.competitionId, result);
    });
  });
}

// ---------------------------------------------------------------------------------------------------

async function simpleCommand<S extends z.ZodType<{ competitionId: string; idempotencyKey: string }>>(
  input: z.input<S>,
  schema: S,
  action: string,
  toCommand: (userId: string, data: z.output<S>) => Command,
): Promise<ActionResult<CompetitionStateResult>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(schema, input);
    return withIdempotency(data.idempotencyKey, user.id, action, async () => {
      const result = await performCommand(data.competitionId, toCommand(user.id, data));
      refresh(data.competitionId, result.argumentId);
      return stateResult(data.competitionId, result);
    });
  });
}
