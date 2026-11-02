/**
 * Review Focus #5 (plan Task 4): the model provider is down, or no judge is configured, during judging.
 * Expected: the job retries up to MAX_JOB_ATTEMPTS (3), then the debate goes to `needs_review` with
 * "evaluation failed", and no verdict row is ever written.
 */
import type { AgentEngine, EngineEvent } from "@agent-native/core/agent/engine";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MINUTE_MS, advanceClock, resetClock, setClock } from "@domain/lib/time";
import { competitions, evaluationJobs, evaluationPasses, notifications, verdicts } from "@domain/db/schema";
import { applyCompetitionResult } from "@domain/reputation";
import { setupTestDb } from "@domain/test-helpers/db";
import { MAX_JOB_ATTEMPTS } from "../config";
import { enqueueEvaluation, processEvaluationJobs } from "../index";
import { EngineJudgeProvider, setJudgeProviderForTests } from "../providers";
import { createJudgedCompetition } from "./fixtures";

vi.mock("@domain/reputation", () => ({ applyCompetitionResult: vi.fn(async () => undefined) }));

const t = setupTestDb();

beforeEach(() => {
  setClock(new Date("2026-10-31T12:00:00Z"));
  vi.mocked(applyCompetitionResult).mockClear();
});
afterEach(() => {
  resetClock();
  setJudgeProviderForTests(null);
  vi.unstubAllEnvs();
});

/** An engine whose every call fails the way a down provider does (yields a stop error, then throws). */
function throwingEngine(): AgentEngine & { calls: number } {
  const engine = {
    name: "fake-down",
    label: "Fake engine (provider down)",
    defaultModel: "fake-model-1",
    supportedModels: ["fake-model-1"],
    capabilities: { thinking: false, promptCaching: false, vision: false, computerUse: false, parallelToolCalls: false },
    calls: 0,
    async *stream(): AsyncIterable<EngineEvent> {
      engine.calls += 1;
      yield { type: "stop", reason: "error", error: "upstream 529 overloaded", statusCode: 529 };
      throw new Error("upstream 529 overloaded");
    },
  };
  return engine;
}

const competitionStatus = async (competitionId: string) =>
  (await t.db.select({ status: competitions.status }).from(competitions).where(eq(competitions.id, competitionId)))[0]?.status;

/** Drive the queue through every attempt, honouring the 1 min / 4 min backoff. */
async function runAllAttempts(): Promise<void> {
  expect(await processEvaluationJobs()).toBe(1);
  expect(await processEvaluationJobs()).toBe(0); // backoff: not due yet
  advanceClock(1 * MINUTE_MS + 1);
  expect(await processEvaluationJobs()).toBe(1);
  advanceClock(4 * MINUTE_MS + 1);
  expect(await processEvaluationJobs()).toBe(1);
  advanceClock(60 * MINUTE_MS);
  expect(await processEvaluationJobs()).toBe(0); // nothing left to retry
}

describe("judge provider failure", () => {
  it("provider failure after 3 attempts moves competition to needs_review with no verdict", async () => {
    const engine = throwingEngine();
    setJudgeProviderForTests(new EngineJudgeProvider({ resolveEngine: async () => engine }));
    const fixture = await createJudgedCompetition(t.db);
    await enqueueEvaluation(fixture.competitionId, "close");

    await runAllAttempts();

    const [job] = await t.db.select().from(evaluationJobs).where(eq(evaluationJobs.competitionId, fixture.competitionId));
    expect(MAX_JOB_ATTEMPTS).toBe(3);
    expect(job).toMatchObject({ status: "failed", attempts: 3 });
    expect(job?.lastError).toMatch(/provider_error: AI engine error 529/u);
    expect(await competitionStatus(fixture.competitionId)).toBe("needs_review");
    expect(await t.db.select().from(verdicts).where(eq(verdicts.competitionId, fixture.competitionId))).toHaveLength(0);

    // Every attempt ran both order passes against the engine and recorded the failure on the pass rows.
    expect(engine.calls).toBe(3 * 2);
    const passes = await t.db.select().from(evaluationPasses).where(eq(evaluationPasses.competitionId, fixture.competitionId));
    expect(passes).toHaveLength(6);
    expect(passes.every((p) => p.provider === "engine" && p.model === "fake-model-1" && p.confidence === null)).toBe(true);
    expect(passes.every((p) => p.error?.startsWith("provider_error:"))).toBe(true);

    const notes = await t.db.select().from(notifications).where(eq(notifications.targetId, fixture.competitionId));
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.type === "needs_review" && n.data.reason === "evaluation_failed")).toBe(true);
  });

  it("with JUDGE_PROVIDER unset the job retries 3 times, then needs_review with no verdict (never the mock)", async () => {
    vi.stubEnv("JUDGE_PROVIDER", undefined);
    const fixture = await createJudgedCompetition(t.db);
    await enqueueEvaluation(fixture.competitionId, "close");

    await runAllAttempts();

    const [job] = await t.db.select().from(evaluationJobs).where(eq(evaluationJobs.competitionId, fixture.competitionId));
    expect(job).toMatchObject({ status: "failed", attempts: 3 });
    expect(job?.lastError).toMatch(/judge provider unavailable: JUDGE_PROVIDER is not set/u);
    expect(await competitionStatus(fixture.competitionId)).toBe("needs_review");
    expect(await t.db.select().from(verdicts).where(eq(verdicts.competitionId, fixture.competitionId))).toHaveLength(0);
    // No pass ever ran, so nothing was judged by any provider (in particular not the mock).
    expect(await t.db.select().from(evaluationPasses).where(eq(evaluationPasses.competitionId, fixture.competitionId))).toHaveLength(0);
  });
});
