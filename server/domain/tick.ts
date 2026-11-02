/**
 * The background tick (design §3, §5.2): the logic of reference `src/app/api/cron/tick/route.ts` without
 * the HTTP and secret handling. `server/plugins/jobs.ts` calls it every 60 s.
 *
 *   1. deadlines        sweepDeadlines()          close rounds, expire challenges, no-show rule, re-queue `locked`
 *   2. judging          processEvaluationJobs()   run due AI judging jobs (retry → needs_review lives in the queue)
 *   3. suspensions      liftExpiredSuspensions()  keep users.status accurate once a suspension lapses
 *   4. rateLimits       pruneRateLimitHits()      housekeeping
 *   5. idempotencyKeys  pruneIdempotencyKeys()    housekeeping
 *
 * Each step is isolated: one failing step is reported and the others still run. Deadlines are also enforced
 * lazily on every read/write of a competition, so a late tick never lets a late submission in.
 *
 * The domain modules are imported lazily, only for steps the caller did not override, so this module is
 * cheap to import (and testable without a database).
 */

export type StepResult = { ok: true; count: number } | { ok: false; error: string };

export type TickStep = () => Promise<number>;

export interface TickSteps {
  deadlines: TickStep;
  judging: TickStep;
  suspensions: TickStep;
  rateLimits: TickStep;
  idempotencyKeys: TickStep;
}

export type TickStepName = keyof TickSteps;

/** Run order (same as the reference cron route). */
export const TICK_STEP_ORDER: readonly TickStepName[] = ["deadlines", "judging", "suspensions", "rateLimits", "idempotencyKeys"];

const DEFAULT_STEPS: Record<TickStepName, TickStep> = {
  deadlines: async () => (await import("@domain/competitions/lifecycle")).sweepDeadlines(),
  judging: async () => (await import("@domain/judging")).processEvaluationJobs(),
  suspensions: async () => (await import("@domain/moderation")).liftExpiredSuspensions(),
  rateLimits: async () => (await import("@domain/rate-limit")).pruneRateLimitHits(),
  idempotencyKeys: async () => (await import("@domain/idempotency")).pruneIdempotencyKeys(),
};

async function step(name: TickStepName, run: TickStep): Promise<StepResult> {
  try {
    return { ok: true, count: await run() };
  } catch (error) {
    console.error(`[tick] ${name} failed:`, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Run every step once, in order. Never throws; failures are reported per step. */
export async function runTick(steps: Partial<TickSteps> = {}): Promise<Record<TickStepName, StepResult>> {
  const results = {} as Record<TickStepName, StepResult>;
  for (const name of TICK_STEP_ORDER) {
    results[name] = await step(name, steps[name] ?? DEFAULT_STEPS[name]);
  }
  return results;
}
