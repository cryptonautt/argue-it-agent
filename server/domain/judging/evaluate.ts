/**
 * One full evaluation run (design §4.3): blind case file → Pass 1 (A first) + Pass 2 (B first) →
 * compare → on disagreement one more order-balanced pair (Pass 3 A first + Pass 4 B first) → verdict,
 * all persisted with audit fields.
 *
 * Fairness/safety invariants enforced here:
 *  - Every pass row records provider, served model, prompt version, rubric version, case sha256, raw output,
 *    usage, latency and stop reason — successful or not.
 *  - A failed or refused pass never becomes a verdict: the run fails and the job queue retries or sends the
 *    competition to human review. Nothing is ever fabricated.
 *  - The verdict, the run status, the competition status and the job completion commit in ONE transaction,
 *    guarded by a row lock and the job's claim token, so two workers can never both publish a verdict.
 */
import { and, desc, eq } from "drizzle-orm";
import { now } from "@domain/lib/time";
import { writeAudit } from "@domain/audit";
import { db, type DbOrTx, type Tx } from "@domain/db";
import type { InjectionFinding } from "@domain/db/json-types";
import {
  competitionParticipants,
  competitions,
  evaluationJobs,
  evaluationPasses,
  evaluationRuns,
  reports,
  verdicts,
  type CompetitionStatus,
} from "@domain/db/schema";
import { notifyMany } from "@domain/notifications";
import { applyCompetitionResult } from "@domain/reputation";
import { loadCaseFile, type AssembledCaseFile } from "./case-file";
import { comparePasses } from "./compare";
import { presentCase } from "./presentation";
import { PROMPT_VERSION } from "./prompt";
import { getJudgeProvider } from "./providers";
import { getRubric } from "./rubrics";
import type {
  ComparisonResult,
  JudgePassResult,
  JudgeProvider,
  PassOrder,
  PassOutput,
  RubricDef,
  RunEvaluationResult,
} from "./types";
import { buildVerdictDraft } from "./verdict";

/** Statuses in which a competition may be evaluated. Jobs only run on `evaluating`. */
export const EVALUABLE_STATUSES: readonly CompetitionStatus[] = ["evaluating", "locked"];

export const VERDICT_READY_MESSAGE = "The AI verdict is in";
export const NEEDS_REVIEW_MESSAGE = "Your debate is going to a human reviewer";

/** A run that could not produce a verdict. `retryable` tells the job queue whether trying again may help. */
export class EvaluationFailure extends Error {
  override readonly name = "EvaluationFailure";
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly runId: string | null = null,
  ) {
    super(message);
  }
}

/** The job this run belongs to was reclaimed by another worker; this worker must not publish anything. */
export class LeaseLostError extends Error {
  override readonly name = "LeaseLostError";
}

export interface EvaluationContext {
  reason: "close" | "appeal";
  /** Set when running from the job queue: the claimed job and its claim token. */
  job?: { id: string; claimedAt: Date };
  provider?: JudgeProvider;
}

/** What is stored in evaluation_passes.output: the provider's exact output plus its canonical mapping. */
export interface StoredPassOutput {
  /** Exactly as returned by the provider (presentation labels X/Y). */
  raw: unknown;
  /** Presentation label → canonical label for this pass. */
  labels: { X: "A" | "B"; Y: "A" | "B" };
  /** The validated, relabelled, quote-checked pass (canonical labels). */
  pass: PassOutput;
}

export function isStoredPassOutput(value: unknown): value is StoredPassOutput {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<StoredPassOutput>;
  return typeof v.pass === "object" && v.pass !== null && typeof v.labels === "object" && v.labels !== null;
}

// ---------------------------------------------------------------------------------------------------------

export async function executeEvaluation(competitionId: string, context: EvaluationContext): Promise<RunEvaluationResult> {
  const [competition] = await db
    .select({ id: competitions.id, status: competitions.status, rubricId: competitions.rubricId, rubricVersion: competitions.rubricVersion })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .limit(1);
  if (!competition) throw new EvaluationFailure(`competition ${competitionId} not found`, false);
  if (!EVALUABLE_STATUSES.includes(competition.status)) {
    throw new EvaluationFailure(`competition is ${competition.status}, not awaiting evaluation`, false);
  }
  const rubric = getRubric(competition.rubricId, competition.rubricVersion);
  if (!rubric) {
    throw new EvaluationFailure(`unknown rubric ${competition.rubricId}@${competition.rubricVersion}`, false);
  }

  let built: AssembledCaseFile;
  try {
    built = await loadCaseFile(competitionId);
  } catch (error) {
    throw new EvaluationFailure(`could not build case file: ${errorMessage(error)}`, false);
  }

  const [run] = await db
    .insert(evaluationRuns)
    .values({
      competitionId,
      jobId: context.job?.id ?? null,
      reason: context.reason,
      status: "running",
      rubricId: rubric.id,
      rubricVersion: rubric.version,
      caseHash: built.caseHash,
      injectionFindings: built.injectionFindings,
      startedAt: now(),
    })
    .returning({ id: evaluationRuns.id });
  if (!run) throw new EvaluationFailure("could not create evaluation run", true);
  const runId = run.id;

  if (built.injectionFindings.length > 0) await openInjectionReports(competitionId, runId, built);

  const provider = context.provider ?? getJudgeProvider();
  const runPass = (passNo: number, order: PassOrder) => executePass(provider, { runId, competitionId, rubric, built, passNo, order });

  const firstTwo = await Promise.all([runPass(1, "AB"), runPass(2, "BA")]);
  const passes = await requireAllOk(firstTwo, runId);
  let comparison = comparePasses(passes, rubric);
  if (comparison.kind === "needs_another_pass") {
    // Order-balanced tiebreak: one more A-first and one more B-first pass, so no reading order gets an extra vote.
    const extraPair = await requireAllOk(await Promise.all([runPass(3, "AB"), runPass(4, "BA")]), runId);
    passes.push(...extraPair);
    comparison = comparePasses(passes, rubric);
  }
  if (comparison.kind === "needs_another_pass") {
    // Unreachable with four passes; fail safe rather than guess.
    await failRun(runId, "comparison did not converge");
    throw new EvaluationFailure("comparison did not converge", false, runId);
  }

  const servedModels = [...new Set(firstTwo.map((p) => p.servedModel))];
  const draft = buildVerdictDraft(passes, comparison, rubric, {
    model: servedModels.length === 1 && servedModels[0] ? servedModels[0] : provider.model,
    promptVersion: PROMPT_VERSION,
    injectionDetected: built.injectionFindings.length > 0,
  });

  let published: RunEvaluationResult;
  try {
    published = await db.transaction((tx) =>
      publishVerdict(tx, { competitionId, runId, comparison, draft, context, caseHash: built.caseHash }),
    );
  } catch (error) {
    await failRun(runId, `not published: ${errorMessage(error)}`);
    throw error;
  }

  try {
    await applyCompetitionResult(competitionId);
  } catch (error) {
    // The verdict stands; ratings are idempotent and can be re-applied. Record it for operators.
    console.error(`[judge] applyCompetitionResult failed for ${competitionId}:`, error);
    await writeAudit({
      actorId: null,
      action: "judge.reputation_failed",
      targetType: "competition",
      targetId: competitionId,
      after: { verdictId: published.verdictId, error: errorMessage(error) },
    }).catch(() => undefined);
  }

  return published;
}

// --- passes -------------------------------------------------------------------------------------------

interface PassContext {
  runId: string;
  competitionId: string;
  rubric: RubricDef;
  built: AssembledCaseFile;
  passNo: number;
  order: PassOrder;
}

interface ExecutedPass {
  result: JudgePassResult;
  servedModel: string;
}

async function executePass(provider: JudgeProvider, ctx: PassContext): Promise<ExecutedPass> {
  const startedAt = now();
  let result: JudgePassResult;
  try {
    result = await provider.runPass({
      caseFile: ctx.built.caseFile,
      rubric: ctx.rubric,
      passNo: ctx.passNo,
      order: ctx.order,
      promptVersion: PROMPT_VERSION,
    });
  } catch (error) {
    result = { ok: false, kind: "provider_error", error: errorMessage(error), retryable: true, latencyMs: 0 };
  }
  const servedModel = result.servedModel ?? provider.model;
  const labels = presentCase(ctx.built.caseFile, ctx.order).toCanonical;

  if (!result.ok && result.kind === "refusal") {
    console.warn(`[judge] pass ${ctx.passNo} refused for competition ${ctx.competitionId}: ${result.error}`);
  }

  await db.insert(evaluationPasses).values({
    competitionId: ctx.competitionId,
    evaluationRunId: ctx.runId,
    passNo: ctx.passNo,
    order: ctx.order,
    provider: provider.id,
    model: servedModel,
    promptVersion: PROMPT_VERSION,
    rubricId: ctx.rubric.id,
    rubricVersion: ctx.rubric.version,
    caseHash: ctx.built.caseHash,
    output: result.ok
      ? ({ raw: result.raw, labels, pass: result.output } satisfies StoredPassOutput)
      : (result.raw ?? null),
    confidence: result.ok ? result.output.confidence : null,
    invalidQuoteCount: result.ok ? result.output.invalidQuoteCount : 0,
    usage: result.usage ?? null,
    latencyMs: result.latencyMs,
    stopReason: result.stopReason ?? null,
    error: result.ok ? null : `${result.kind}: ${result.error}`,
    startedAt,
    finishedAt: now(),
  });
  return { result, servedModel };
}

async function requireAllOk(executed: readonly ExecutedPass[], runId: string): Promise<PassOutput[]> {
  const failures = executed.flatMap((e) => (e.result.ok ? [] : [e.result]));
  if (failures.length === 0) return executed.map((e) => (e.result.ok ? e.result.output : unreachable()));
  const message = failures.map((f) => `${f.kind}: ${f.error}`).join(" | ");
  await failRun(runId, message);
  throw new EvaluationFailure(message, failures.every((f) => f.retryable), runId);
}

function unreachable(): never {
  throw new Error("unreachable");
}

async function failRun(runId: string, error: string): Promise<void> {
  await db
    .update(evaluationRuns)
    .set({ status: "failed", error: error.slice(0, 2000), finishedAt: now() })
    .where(eq(evaluationRuns.id, runId));
}

// --- publishing ---------------------------------------------------------------------------------------

interface PublishInput {
  competitionId: string;
  runId: string;
  comparison: Exclude<ComparisonResult, { kind: "needs_another_pass" }>;
  draft: ReturnType<typeof buildVerdictDraft>;
  context: EvaluationContext;
  caseHash: string;
}

async function publishVerdict(tx: Tx, input: PublishInput): Promise<RunEvaluationResult> {
  const { competitionId, runId, comparison, draft, context } = input;

  // Double-processing guard 1: the job must still be ours (not reclaimed after a lease timeout).
  if (context.job) {
    const [job] = await tx
      .select({ status: evaluationJobs.status, claimedAt: evaluationJobs.claimedAt })
      .from(evaluationJobs)
      .where(eq(evaluationJobs.id, context.job.id))
      .for("update");
    if (!job || job.status !== "running" || job.claimedAt?.getTime() !== context.job.claimedAt.getTime()) {
      throw new LeaseLostError(`job ${context.job.id} is no longer held by this worker`);
    }
  }

  // Double-processing guard 2: the competition must still be awaiting a verdict.
  const [competition] = await tx
    .select({ status: competitions.status })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .for("update");
  if (!competition || !EVALUABLE_STATUSES.includes(competition.status)) {
    throw new EvaluationFailure(`competition is ${competition?.status ?? "missing"}, verdict not published`, false, runId);
  }

  const participants = await tx
    .select({ userId: competitionParticipants.userId, side: competitionParticipants.side })
    .from(competitionParticipants)
    .where(eq(competitionParticipants.competitionId, competitionId));
  const winnerSide = draft.outcome === "A" ? "FOR" : draft.outcome === "B" ? "AGAINST" : null;
  const winnerUserId = winnerSide ? (participants.find((p) => p.side === winnerSide)?.userId ?? null) : null;

  const [previous] = await tx
    .select({ id: verdicts.id, version: verdicts.version, outcome: verdicts.outcome, isCurrent: verdicts.isCurrent })
    .from(verdicts)
    .where(eq(verdicts.competitionId, competitionId))
    .orderBy(desc(verdicts.version))
    .limit(1);
  const version = (previous?.version ?? 0) + 1;
  await tx
    .update(verdicts)
    .set({ isCurrent: false })
    .where(and(eq(verdicts.competitionId, competitionId), eq(verdicts.isCurrent, true)));

  const at = now();
  const [verdict] = await tx
    .insert(verdicts)
    .values({
      competitionId,
      runId,
      version,
      outcome: draft.outcome,
      winnerUserId,
      scores: draft.scores,
      explanation: draft.explanation,
      confidence: draft.confidence,
      isCurrent: true,
      decidedBy: "ai",
      createdAt: at,
    })
    .returning({ id: verdicts.id });
  if (!verdict) throw new Error("verdict insert returned no row");

  const decided = draft.outcome !== "inconclusive";
  await tx
    .update(evaluationRuns)
    .set({ status: decided ? "succeeded" : "needs_review", comparison, finishedAt: at })
    .where(eq(evaluationRuns.id, runId));
  await tx
    .update(competitions)
    .set(decided ? { status: "completed", completedAt: at, updatedAt: at } : { status: "needs_review", updatedAt: at })
    .where(eq(competitions.id, competitionId));
  if (context.job) {
    await tx
      .update(evaluationJobs)
      .set({ status: "done", finishedAt: at, lastError: null, updatedAt: at })
      .where(eq(evaluationJobs.id, context.job.id));
  }

  await writeAudit(
    {
      actorId: null,
      action: decided ? "judge.verdict" : "judge.inconclusive",
      targetType: "competition",
      targetId: competitionId,
      before: { status: competition.status, previousVerdictId: previous?.id ?? null, previousOutcome: previous?.outcome ?? null },
      after: {
        status: decided ? "completed" : "needs_review",
        verdictId: verdict.id,
        version,
        outcome: draft.outcome,
        confidence: draft.confidence,
        runId,
        caseHash: input.caseHash,
        reason: context.reason,
      },
    },
    tx,
  );

  await notifyMany(
    participants.map((p) => p.userId),
    decided
      ? { type: "verdict_ready", targetType: "competition", targetId: competitionId, data: { message: VERDICT_READY_MESSAGE, outcome: draft.outcome, verdictId: verdict.id } }
      : { type: "needs_review", targetType: "competition", targetId: competitionId, data: { message: NEEDS_REVIEW_MESSAGE, reason: "inconclusive" } },
    tx,
  );

  return { status: decided ? "completed" : "needs_review", verdictId: verdict.id, runId };
}

// --- failure path (called by the job queue when retries are exhausted) ---------------------------------

/**
 * Send a competition whose evaluation failed to human review (design §4.3.7). Writes NO verdict.
 * Only moves competitions that are still `evaluating` (a cancelled one stays cancelled).
 */
export async function markEvaluationFailed(competitionId: string, error: string, tx: DbOrTx): Promise<boolean> {
  const at = now();
  const moved = await tx
    .update(competitions)
    .set({ status: "needs_review", updatedAt: at })
    .where(and(eq(competitions.id, competitionId), eq(competitions.status, "evaluating")))
    .returning({ id: competitions.id });
  await writeAudit(
    {
      actorId: null,
      action: "judge.evaluation_failed",
      targetType: "competition",
      targetId: competitionId,
      after: { status: moved.length > 0 ? "needs_review" : "unchanged", error: error.slice(0, 1000) },
    },
    tx,
  );
  if (moved.length === 0) return false;
  const participants = await tx
    .select({ userId: competitionParticipants.userId })
    .from(competitionParticipants)
    .where(eq(competitionParticipants.competitionId, competitionId));
  await notifyMany(
    participants.map((p) => p.userId),
    { type: "needs_review", targetType: "competition", targetId: competitionId, data: { message: NEEDS_REVIEW_MESSAGE, reason: "evaluation_failed" } },
    tx,
  );
  return true;
}

// --- injection reports -------------------------------------------------------------------------------

async function openInjectionReports(competitionId: string, runId: string, built: AssembledCaseFile): Promise<void> {
  const byTarget = new Map<string, InjectionFinding[]>();
  for (const finding of built.injectionFindings) {
    if (!finding.side || !finding.round) continue; // proposition findings are recorded on the run only
    const submissionId = built.submissionIds[`${finding.side}:${finding.round}`];
    if (!submissionId) continue;
    byTarget.set(submissionId, [...(byTarget.get(submissionId) ?? []), finding]);
  }
  for (const [submissionId, findings] of byTarget) {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: reports.id })
        .from(reports)
        .where(
          and(
            eq(reports.targetType, "submission"),
            eq(reports.targetId, submissionId),
            eq(reports.reason, "prompt_injection"),
            eq(reports.isAutomatic, true),
            eq(reports.status, "open"),
          ),
        )
        .limit(1);
      if (existing) return;
      const details = `Automatic: possible prompt injection (${findings.map((f) => f.pattern).join(", ")}). ${findings
        .map((f) => `"${f.excerpt}"`)
        .join(" ")}`.slice(0, 1000);
      const [report] = await tx
        .insert(reports)
        .values({ reporterId: null, targetType: "submission", targetId: submissionId, reason: "prompt_injection", details, isAutomatic: true })
        .returning({ id: reports.id });
      await writeAudit(
        {
          actorId: null,
          action: "judge.injection_flagged",
          targetType: "submission",
          targetId: submissionId,
          after: { competitionId, runId, reportId: report?.id ?? null, patterns: findings.map((f) => f.pattern) },
        },
        tx,
      );
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
