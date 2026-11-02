/**
 * runTick (plan Task 4): the background work of reference `src/app/api/cron/tick/route.ts`, minus HTTP.
 * Every step is isolated: one failing step is reported and the others still run.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@domain/competitions/lifecycle", () => ({ sweepDeadlines: vi.fn(async () => 3) }));
vi.mock("@domain/judging", () => ({ processEvaluationJobs: vi.fn(async () => 2) }));
vi.mock("@domain/moderation", () => ({ liftExpiredSuspensions: vi.fn(async () => 1) }));
vi.mock("@domain/rate-limit", () => ({ pruneRateLimitHits: vi.fn(async () => 7) }));
vi.mock("@domain/idempotency", () => ({ pruneIdempotencyKeys: vi.fn(async () => 5) }));

import { sweepDeadlines } from "@domain/competitions/lifecycle";
import { processEvaluationJobs } from "@domain/judging";
import { runTick, TICK_STEP_ORDER, type TickSteps } from "./tick";

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(sweepDeadlines).mockClear();
  vi.mocked(processEvaluationJobs).mockClear();
});

describe("runTick", () => {
  it("runTick isolates a failing step", async () => {
    const order: string[] = [];
    const ok = (name: string, count: number) => async () => {
      order.push(name);
      return count;
    };
    const steps: TickSteps = {
      deadlines: ok("deadlines", 1),
      judging: async () => {
        order.push("judging");
        throw new Error("judge provider unavailable: JUDGE_PROVIDER is not set");
      },
      suspensions: ok("suspensions", 0),
      rateLimits: ok("rateLimits", 4),
      idempotencyKeys: ok("idempotencyKeys", 2),
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const results = await runTick(steps);

    expect(results.judging).toEqual({ ok: false, error: "judge provider unavailable: JUDGE_PROVIDER is not set" });
    expect(results.deadlines).toEqual({ ok: true, count: 1 });
    expect(results.suspensions).toEqual({ ok: true, count: 0 });
    expect(results.rateLimits).toEqual({ ok: true, count: 4 });
    expect(results.idempotencyKeys).toEqual({ ok: true, count: 2 });
    for (const name of TICK_STEP_ORDER.filter((n) => n !== "judging")) expect(results[name]?.ok).toBe(true);
    // Same order as the reference cron route; steps after the failure still ran.
    expect(order).toEqual(["deadlines", "judging", "suspensions", "rateLimits", "idempotencyKeys"]);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("reports a non-Error throw as a string", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const results = await runTick({
      judging: async () => {
        throw "boom";
      },
    });
    expect(results.judging).toEqual({ ok: false, error: "boom" });
  });

  it("uses the domain functions for steps that are not overridden", async () => {
    const results = await runTick({ judging: async () => 9 });
    expect(results).toEqual({
      deadlines: { ok: true, count: 3 },
      judging: { ok: true, count: 9 },
      suspensions: { ok: true, count: 1 },
      rateLimits: { ok: true, count: 7 },
      idempotencyKeys: { ok: true, count: 5 },
    });
    expect(sweepDeadlines).toHaveBeenCalledTimes(1);
    expect(processEvaluationJobs).not.toHaveBeenCalled();

    await runTick();
    expect(processEvaluationJobs).toHaveBeenCalledTimes(1);
  });
});
