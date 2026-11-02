/**
 * Owner: judge. Public API of the AI judge (design §4.3, §5.2).
 *
 * Fairness design in one paragraph: the judge sees a BLIND case file (no identities, engagement or
 * ratings; names inside the text redacted), judges it twice with the sides presented in swapped order
 * under position labels, cites verbatim quotes that are machine-checked, and only names a winner when
 * both readings agree with enough confidence — otherwise a third reading, then a draw or a human review.
 * Every pass is stored with model, prompt version, rubric version, case hash, usage and latency.
 */
import "server-only";

import { loadCaseFile } from "./case-file";
import { comparePasses as comparePassesImpl } from "./compare";
import { executeEvaluation } from "./evaluate";
import { scanForInjection as scanForInjectionImpl } from "./injection";
import { enqueueEvaluationJob, processEvaluationJobs as processJobs } from "./jobs";
import { validateQuotes as validateQuotesImpl } from "./quotes";
import { redactIdentities as redactIdentitiesImpl } from "./redact";
import { getRubric as getRubricImpl } from "./rubrics";
import type { DbOrTx } from "@domain/db";
import type {
  BuiltCaseFile,
  ComparisonResult,
  InjectionScanResult,
  PassOutput,
  QuoteValidation,
  RedactionResult,
  RedactionTarget,
  RubricDef,
  RunEvaluationResult,
} from "./types";

export type * from "./types";

// Extra exports (additive; the stub signatures below are unchanged).
export * from "./config";
export { PROMPT_VERSION } from "./prompt";
export {
  ALL_RUBRICS,
  getLatestRubric,
  getRubricForCategory,
  listCurrentRubrics,
  rubricWeightTotal,
  syncRubrics,
} from "./rubrics";
export { confidenceLabel } from "./verdict";
export { getJudgeProvider, setJudgeProviderForTests, MockJudgeProvider, AnthropicJudgeProvider } from "./providers";
export { isStoredPassOutput, type StoredPassOutput, VERDICT_READY_MESSAGE, NEEDS_REVIEW_MESSAGE } from "./evaluate";
export { EnqueueError } from "./jobs";

// --- Job pipeline (called by competitions lifecycle, appeals, and /api/cron/tick) -------------------

/**
 * Queue an evaluation for a competition that just locked (`close`) or had a re-evaluation ordered
 * on appeal (`appeal`). Idempotent: a closing evaluation is queued at most once ever; an appeal
 * re-evaluation at most once while one is live. Sets competition status to `evaluating`.
 * Pass `tx` to enqueue inside your own transaction (required with PGlite's single connection).
 */
export async function enqueueEvaluation(competitionId: string, reason: "close" | "appeal", tx?: DbOrTx): Promise<void> {
  await enqueueEvaluationJob(competitionId, reason, tx);
}

/** Claim and run up to `limit` due jobs (retry with backoff, max 3 attempts). Returns jobs processed. */
export async function processEvaluationJobs(limit?: number): Promise<number> {
  return processJobs(limit);
}

/**
 * Run one full blind dual-order evaluation now (outside the job queue). On success writes `verdicts`
 * (is_current; previous verdict kept as history), sets the competition `completed`, then calls
 * reputation.applyCompetitionResult(). Inconclusive → verdict "inconclusive" + `needs_review`.
 * Throws on provider failure (never fabricates a verdict) so a caller/job runner can retry.
 */
export async function runEvaluation(
  competitionId: string,
  options: { reason?: "close" | "appeal" } = {},
): Promise<RunEvaluationResult> {
  return executeEvaluation(competitionId, { reason: options.reason ?? "close" });
}

// --- Pure-ish building blocks (fairness team tests these directly) ---------------------------------

/** Build the blind, redacted case file from frozen submissions (design §4.3.1). */
export async function buildCaseFile(competitionId: string): Promise<BuiltCaseFile> {
  const { caseFile, caseHash, injectionFindings, redactionCount } = await loadCaseFile(competitionId);
  return { caseFile, caseHash, injectionFindings, redactionCount };
}

/** Replace participant handles/display names inside `text` with blind labels. Pure. */
export function redactIdentities(text: string, names: readonly RedactionTarget[]): RedactionResult {
  return redactIdentitiesImpl(text, names);
}

/** Heuristic prompt-injection pre-scan of one submission's text. Pure. */
export function scanForInjection(text: string): InjectionScanResult {
  return scanForInjectionImpl(text);
}

/** Keep only quotes that are verbatim substrings of `sourceText` (whitespace-normalised). Pure. */
export function validateQuotes(quotes: readonly string[], sourceText: string): QuoteValidation {
  return validateQuotesImpl(quotes, sourceText);
}

/** Decide from the passes so far: winner/draw, ask for the extra order-balanced pair (Passes 3+4), or inconclusive (design §4.3.3). Pure. */
export function comparePasses(passes: readonly PassOutput[], rubric: RubricDef): ComparisonResult {
  return comparePassesImpl(passes, rubric);
}

/** Look up a code rubric by id + version (e.g. getRubric("sports", 1)). Undefined if unknown. */
export function getRubric(id: string, version: number): RubricDef | undefined {
  return getRubricImpl(id, version);
}
