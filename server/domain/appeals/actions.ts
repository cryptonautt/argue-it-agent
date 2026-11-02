"use server";

/**
 * Owner: verdict. Server actions for appeals and the needs-review queue (design §4.4, §5.4).
 * Thin wrappers: auth → zod → rate limit → idempotency → service (authorisation + transaction + audit).
 */
import { revalidatePath } from "next/cache";
import { ok, type ActionResult } from "@domain/lib/action-result";
import { parseInput, runAction } from "@domain/action";
import { requireRole, requireUser } from "@domain/auth";
import { withIdempotency } from "@domain/idempotency";
import { enforceRateLimit } from "@domain/rate-limit";
import {
  competitionOnlySchema,
  decideAppealSchema,
  fileAppealSchema,
  resolveReviewSchema,
  type DecideAppealInput,
  type FileAppealInput,
  type ResolveReviewInput,
} from "./schemas";
import {
  decideAppeal as decideAppealService,
  fileAppeal as fileAppealService,
  resolveReview as resolveReviewService,
  retryFailedEvaluation as retryFailedEvaluationService,
  retryReputation as retryReputationService,
  type AppealDecisionResult,
  type ResolveReviewResult,
} from "./service";

function revalidateCompetition(competitionId: string): void {
  revalidatePath(`/c/${competitionId}`);
  revalidatePath(`/c/${competitionId}/verdict`);
}

export async function fileAppeal(input: FileAppealInput): Promise<ActionResult<{ appealId: string }>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(fileAppealSchema, input);
    return withIdempotency(data.idempotencyKey, user.id, "appeal.file", async () => {
      await enforceRateLimit(user.id, "appeal");
      const result = await fileAppealService(user, data);
      revalidateCompetition(data.competitionId);
      revalidatePath("/admin/appeals");
      return ok(result);
    });
  });
}

export async function decideAppeal(input: DecideAppealInput): Promise<ActionResult<AppealDecisionResult>> {
  return runAction(async () => {
    const user = await requireRole("moderator");
    const data = parseInput(decideAppealSchema, input);
    return withIdempotency(data.idempotencyKey, user.id, "appeal.decide", async () => {
      const result = await decideAppealService(
        user,
        data.decision === "overturn"
          ? { appealId: data.appealId, decision: "overturn", note: data.note, outcome: data.outcome }
          : { appealId: data.appealId, decision: data.decision, note: data.note },
      );
      revalidateCompetition(result.competitionId);
      revalidatePath("/admin/appeals");
      return ok(result);
    });
  });
}

export async function resolveReview(input: ResolveReviewInput): Promise<ActionResult<ResolveReviewResult>> {
  return runAction(async () => {
    const user = await requireRole("moderator");
    const data = parseInput(resolveReviewSchema, input);
    return withIdempotency(data.idempotencyKey, user.id, "review.resolve", async () => {
      const result = await resolveReviewService(user, data);
      revalidateCompetition(data.competitionId);
      revalidatePath("/admin/review");
      return ok(result);
    });
  });
}

export async function retryFailedEvaluation(input: {
  competitionId: string;
  idempotencyKey: string;
}): Promise<ActionResult<{ competitionId: string }>> {
  return runAction(async () => {
    const user = await requireRole("moderator");
    const data = parseInput(competitionOnlySchema, input);
    return withIdempotency(data.idempotencyKey, user.id, "review.retry_evaluation", async () => {
      const result = await retryFailedEvaluationService(user, data.competitionId);
      revalidateCompetition(data.competitionId);
      revalidatePath("/admin/review");
      return ok(result);
    });
  });
}

export async function retryReputation(input: {
  competitionId: string;
  idempotencyKey: string;
}): Promise<ActionResult<{ ratingsUpdated: boolean }>> {
  return runAction(async () => {
    const user = await requireRole("moderator");
    const data = parseInput(competitionOnlySchema, input);
    return withIdempotency(data.idempotencyKey, user.id, "reputation.reapply", async () => {
      const result = await retryReputationService(user, data.competitionId);
      revalidateCompetition(data.competitionId);
      return ok(result);
    });
  });
}
