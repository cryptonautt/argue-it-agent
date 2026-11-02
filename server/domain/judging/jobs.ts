/**
 * Evaluation job queue (design §3 "DB-backed job table + after() kick + cron", §4.3.7).
 *
 *  - enqueueEvaluation: idempotent per competition + reason; at most one live job per competition
 *    (enforced by a partial unique index as well).
 *  - processEvaluationJobs: claims due jobs with a single atomic UPDATE … WHERE id IN (SELECT … FOR UPDATE
 *    SKIP LOCKED), so concurrent workers never claim the same job; abandoned `running` jobs are reclaimable
 *    after a lease timeout, and the claim timestamp acts as a fencing token when publishing.
 *  - Retries with exponential backoff up to MAX_JOB_ATTEMPTS; then the competition goes to `needs_review`
 *    with "evaluation failed" and no verdict is written.
 */
import { and, asc, eq, inArray, lt, lte, ne, or, sql } from "drizzle-orm";
import { after } from "next/server";
import { addMs, now } from "@domain/lib/time";
import { writeAudit } from "@domain/audit";
import { db, type DbOrTx } from "@domain/db";
import { competitions, evaluationJobs, verdicts, type CompetitionStatus, type EvaluationJob } from "@domain/db/schema";
import { DEFAULT_JOBS_PER_TICK, JOB_LEASE_MS, JOB_RETRY_BASE_MS, MAX_JOB_ATTEMPTS } from "./config";
import { EvaluationFailure, LeaseLostError, executeEvaluation, markEvaluationFailed } from "./evaluate";
import { ensureRubricsMirrored } from "./rubric-mirror";
import type { JudgeProvider } from "./types";

export type EvaluationReason = "close" | "appeal";

/** Competition statuses from which an evaluation may be queued. */
export const ENQUEUEABLE_STATUSES: readonly CompetitionStatus[] = [
  "locked",
  "evaluating",
  "under_appeal",
  "completed",
  "needs_review",
];

export class EnqueueError extends Error {
  override readonly name = "EnqueueError";
}

export function retryDelayMs(attempt: number): number {
  return JOB_RETRY_BASE_MS * 4 ** Math.max(0, attempt - 1);
}

export interface EnqueueResult {
  jobId: string;
  created: boolean;
}

async function enqueueIn(tx: DbOrTx, competitionId: string, reason: EvaluationReason): Promise<EnqueueResult> {
  const [competition] = await tx
    .select({ id: competitions.id, status: competitions.status })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .for("update");
  if (!competition) throw new EnqueueError(`competition ${competitionId} not found`);

  // Idempotency: a closing evaluation succeeds at most once, ever; an appeal re-evaluation once per live
  // request. The one exception: when every closing job FAILED outright (provider outage after all retries)
  // and no verdict exists, a reviewer may queue it again from needs_review — the AI never assessed the debate,
  // so this is a retry, not a reroll. Inconclusive results are verdicts and are never re-queued here.
  const existingWhere =
    reason === "close"
      ? and(eq(evaluationJobs.competitionId, competitionId), eq(evaluationJobs.reason, "close"), ne(evaluationJobs.status, "failed"))
      : and(
          eq(evaluationJobs.competitionId, competitionId),
          eq(evaluationJobs.reason, "appeal"),
          inArray(evaluationJobs.status, ["queued", "running"]),
        );
  const [existing] = await tx.select({ id: evaluationJobs.id }).from(evaluationJobs).where(existingWhere).limit(1);
  if (existing) return { jobId: existing.id, created: false };
  if (reason === "close") {
    const [failed] = await tx
      .select({ id: evaluationJobs.id })
      .from(evaluationJobs)
      .where(and(eq(evaluationJobs.competitionId, competitionId), eq(evaluationJobs.reason, "close"), eq(evaluationJobs.status, "failed")))
      .limit(1);
    if (failed) {
      const [anyVerdict] = await tx.select({ id: verdicts.id }).from(verdicts).where(eq(verdicts.competitionId, competitionId)).limit(1);
      if (anyVerdict || competition.status !== "needs_review") return { jobId: failed.id, created: false };
    }
  }
  if (!ENQUEUEABLE_STATUSES.includes(competition.status)) {
    throw new EnqueueError(`cannot evaluate a competition that is ${competition.status}`);
  }

  const at = now();
  const [inserted] = await tx
    .insert(evaluationJobs)
    .values({ competitionId, reason, status: "queued", runAfter: at, createdAt: at, updatedAt: at })
    .onConflictDoNothing()
    .returning({ id: evaluationJobs.id });
  if (!inserted) {
    // Another live job (e.g. the closing evaluation is still running) already covers this competition.
    const [live] = await tx
      .select({ id: evaluationJobs.id })
      .from(evaluationJobs)
      .where(and(eq(evaluationJobs.competitionId, competitionId), inArray(evaluationJobs.status, ["queued", "running"])))
      .limit(1);
    if (!live) throw new EnqueueError("could not enqueue evaluation");
    return { jobId: live.id, created: false };
  }

  if (competition.status !== "evaluating") {
    await tx.update(competitions).set({ status: "evaluating", updatedAt: at }).where(eq(competitions.id, competitionId));
  }
  await writeAudit(
    {
      actorId: null,
      action: "judge.enqueue",
      targetType: "competition",
      targetId: competitionId,
      before: { status: competition.status },
      after: { status: "evaluating", jobId: inserted.id, reason },
    },
    tx,
  );
  return { jobId: inserted.id, created: true };
}

/**
 * Queue an evaluation. Pass `tx` when calling from inside your own transaction (required with PGlite,
 * which has a single connection: a second transaction would wait for yours forever).
 */
export async function enqueueEvaluationJob(competitionId: string, reason: EvaluationReason, tx?: DbOrTx): Promise<EnqueueResult> {
  await ensureRubricsMirrored(tx);
  const result = tx ? await enqueueIn(tx, competitionId, reason) : await db.transaction((t) => enqueueIn(t, competitionId, reason));
  if (result.created) kickWorker();
  return result;
}

/**
 * Best-effort: process the new job right after the current response (Next.js `after()`), so with the mock
 * judge (and usually the real one) a verdict appears without waiting for cron. `/api/cron/tick` is the
 * backstop. Disable with JUDGE_AUTO_KICK=0.
 */
function kickWorker(): void {
  if (process.env.JUDGE_AUTO_KICK === "0" || process.env.VITEST) return;
  try {
    after(async () => {
      try {
        await processEvaluationJobs(1);
      } catch (error) {
        console.error("[judge] after() kick failed; cron will retry:", error);
      }
    });
  } catch {
    // Outside a request scope (scripts, seed, fairness): the cron tick picks the job up.
  }
}

// --- worker ------------------------------------------------------------------------------------------

/** Atomically claim the next due job (queued and due, or running with an expired lease). */
export async function claimNextJob(): Promise<EvaluationJob | null> {
  const at = now();
  const leaseExpiredBefore = addMs(at, -JOB_LEASE_MS);
  const claimable = or(
    and(eq(evaluationJobs.status, "queued"), lte(evaluationJobs.runAfter, at)),
    and(eq(evaluationJobs.status, "running"), lt(evaluationJobs.claimedAt, leaseExpiredBefore)),
  );
  const candidate = db
    .select({ id: evaluationJobs.id })
    .from(evaluationJobs)
    .where(claimable)
    .orderBy(asc(evaluationJobs.runAfter), asc(evaluationJobs.createdAt))
    .limit(1)
    .for("update", { skipLocked: true });
  const [job] = await db
    .update(evaluationJobs)
    .set({ status: "running", claimedAt: at, attempts: sql`${evaluationJobs.attempts} + 1`, updatedAt: at })
    // The claim condition is re-checked on the locked row, so a racing worker's claim makes this a no-op.
    .where(and(inArray(evaluationJobs.id, candidate), claimable))
    .returning();
  return job ?? null;
}

export interface ProcessOptions {
  /** Override the provider (tests). */
  provider?: JudgeProvider;
}

export type JobOutcome = "done" | "retry_scheduled" | "failed" | "lease_lost";

/** Run one claimed job to an outcome. Never throws for evaluation failures. */
export async function runClaimedJob(job: EvaluationJob, options: ProcessOptions = {}): Promise<JobOutcome> {
  if (!job.claimedAt) throw new Error("runClaimedJob: job has not been claimed");
  const claim = { id: job.id, claimedAt: job.claimedAt };
  try {
    await executeEvaluation(job.competitionId, { reason: job.reason, job: claim, provider: options.provider });
    return "done";
  } catch (error) {
    if (error instanceof LeaseLostError) return "lease_lost";
    const failure =
      error instanceof EvaluationFailure ? error : new EvaluationFailure(error instanceof Error ? error.message : String(error), true);
    if (!(error instanceof EvaluationFailure)) console.error(`[judge] job ${job.id} crashed:`, error);
    return failure.retryable && job.attempts < MAX_JOB_ATTEMPTS
      ? scheduleRetry(job, claim.claimedAt, failure.message)
      : failJob(job, claim.claimedAt, failure.message);
  }
}

async function scheduleRetry(job: EvaluationJob, claimedAt: Date, error: string): Promise<JobOutcome> {
  const at = now();
  const updated = await db
    .update(evaluationJobs)
    .set({ status: "queued", runAfter: addMs(at, retryDelayMs(job.attempts)), lastError: error.slice(0, 2000), updatedAt: at })
    .where(and(eq(evaluationJobs.id, job.id), eq(evaluationJobs.status, "running"), eq(evaluationJobs.claimedAt, claimedAt)))
    .returning({ id: evaluationJobs.id });
  return updated.length > 0 ? "retry_scheduled" : "lease_lost";
}

async function failJob(job: EvaluationJob, claimedAt: Date, error: string): Promise<JobOutcome> {
  return db.transaction(async (tx) => {
    const at = now();
    const updated = await tx
      .update(evaluationJobs)
      .set({ status: "failed", lastError: error.slice(0, 2000), finishedAt: at, updatedAt: at })
      .where(and(eq(evaluationJobs.id, job.id), eq(evaluationJobs.status, "running"), eq(evaluationJobs.claimedAt, claimedAt)))
      .returning({ id: evaluationJobs.id });
    if (updated.length === 0) return "lease_lost";
    await markEvaluationFailed(job.competitionId, `evaluation failed after ${job.attempts} attempt(s): ${error}`, tx);
    return "failed";
  });
}

/** Claim and run up to `limit` due jobs. Returns the number of jobs processed. */
export async function processEvaluationJobs(limit: number = DEFAULT_JOBS_PER_TICK, options: ProcessOptions = {}): Promise<number> {
  let processed = 0;
  for (let i = 0; i < Math.max(0, limit); i++) {
    const job = await claimNextJob();
    if (!job) break;
    await runClaimedJob(job, options);
    processed += 1;
  }
  return processed;
}
