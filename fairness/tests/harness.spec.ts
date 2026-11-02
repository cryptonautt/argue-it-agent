/**
 * The whole suite end to end with fake judges (no network): real case files from the database, real
 * comparePasses, real metrics and gates. Proves the harness passes a fair judge and fails unfair ones.
 * Owner: fairness.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { MockJudgeProvider, PROMPT_VERSION, type JudgeProvider } from "@domain/judging";
import type { PreparedCase } from "../lib/case-source";
import type { FairnessCase } from "../lib/case-schema";
import { loadCases } from "../lib/load-cases";
import { judgePrepared, prepareCases, type SuiteResult } from "../lib/suite";
import { canonicalProvider } from "./helpers";

const cases = loadCases();
let prepared: PreparedCase[] = [];

beforeAll(async () => {
  prepared = await prepareCases(cases);
}, 120_000);

const expectedByHash = () => new Map(prepared.map((p) => [p.built.caseHash, p.fairnessCase]));
const gate = (r: SuiteResult, key: string) => r.gates.find((g) => g.key === key);
const judge = (provider: JudgeProvider) => judgePrepared(prepared, { provider, promptVersion: PROMPT_VERSION, concurrency: 8 });

/** Gives each case the answer a fair judge would ('either' → A), identically in both orders. */
function oracle(): JudgeProvider {
  const lookup = expectedByHash();
  return canonicalProvider((input) => {
    const hashFor = prepared.find((p) => p.built.caseFile === input.caseFile)?.built.caseHash;
    const c = hashFor ? lookup.get(hashFor) : undefined;
    const expected = c?.expected ?? "A";
    if (expected === "B") return { a: 3, b: 8, confidence: 0.9 };
    if (expected === "draw") return { a: 6, b: 6, confidence: 0.9 };
    return { a: 8, b: 3, confidence: 0.9 };
  }, "oracle");
}

describe("fairness suite with fake judges", () => {
  it("prepares every case with the production builder and no identity leaks", () => {
    expect(prepared).toHaveLength(cases.length);
    for (const p of prepared) expect(p.built.caseHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("a fair judge passes every judge-behaviour gate", async () => {
    const r = await judge(oracle());
    for (const key of [
      "clearAccuracy",
      "positionConsistency",
      "styleInvariance",
      "injectionResistance",
      "identityBaitResistance",
      "blindingIntegrity",
      "quoteIntegrity",
      "clearInconclusiveRate",
      "evaluationErrorRate",
    ]) {
      expect(gate(r, key)?.status, key).toBe("pass");
    }
    expect(r.metrics.accuracy.all.value).toBe(1);
  });

  it("a judge that obeys injections fails injection resistance", async () => {
    const injectors = new Map(prepared.filter((p) => p.fairnessCase.injection).map((p) => [p.built.caseHash, p.fairnessCase]));
    const fair = oracle();
    const gullible: JudgeProvider = {
      id: "gullible",
      model: "gullible",
      async runPass(input) {
        const hash = prepared.find((p) => p.built.caseFile === input.caseFile)?.built.caseHash ?? "";
        const c: FairnessCase | undefined = injectors.get(hash);
        if (!c?.injection) return fair.runPass(input);
        const winner = c.injection.side;
        return canonicalProvider(() => (winner === "A" ? { a: 9, b: 2, confidence: 0.95 } : { a: 2, b: 9, confidence: 0.95 })).runPass(input);
      },
    };
    const r = await judge(gullible);
    expect(gate(r, "injectionResistance")?.status).toBe("fail");
    expect(r.metrics.injection.resistance.value).toBe(0);
  });

  it("a judge that prefers polished English fails style invariance", async () => {
    const fair = oracle();
    const snob: JudgeProvider = {
      id: "snob",
      model: "snob",
      async runPass(input) {
        const p = prepared.find((x) => x.built.caseFile === input.caseFile);
        // Penalise any Pidgin variant by flipping the verdict.
        if (p?.fairnessCase.style?.variant === "pidgin") {
          const flipped = p.fairnessCase.expected === "A" ? { a: 3, b: 8, confidence: 0.9 } : { a: 8, b: 3, confidence: 0.9 };
          return canonicalProvider(() => flipped).runPass(input);
        }
        return fair.runPass(input);
      },
    };
    const r = await judge(snob);
    expect(gate(r, "styleInvariance")?.status).toBe("fail");
    expect(r.metrics.styleInvariance.value).toBe(0);
  });

  it("an unsure judge sends clear cases to human review and fails the inconclusive gate", async () => {
    const r = await judge(canonicalProvider(() => ({ a: 8, b: 3, confidence: 0.5 }), "unsure"));
    expect(r.metrics.inconclusive.clear.value).toBe(1);
    expect(gate(r, "clearInconclusiveRate")?.status).toBe("fail");
  });

  it("a failing provider is reported as errors, never as a verdict", async () => {
    const failing: JudgeProvider = {
      id: "down",
      model: "down",
      async runPass() {
        return { ok: false, kind: "provider_error", error: "503", latencyMs: 1, retryable: true };
      },
    };
    const r = await judge(failing);
    expect(r.metrics.outcomes.error).toBe(cases.length);
    expect(r.passed).toBe(false);
  });

  it("a throwing provider does not crash the suite", async () => {
    const throwing: JudgeProvider = {
      id: "throws",
      model: "throws",
      async runPass() {
        throw new Error("socket hang up");
      },
    };
    const r = await judge(throwing);
    expect(r.runs.every((x) => x.outcome === "error" && x.reason.includes("socket hang up"))).toBe(true);
  });

  it("the real mock provider runs the whole suite deterministically", async () => {
    const first = await judge(new MockJudgeProvider());
    const second = await judge(new MockJudgeProvider());
    expect(first.metrics.errors.value).toBe(0);
    expect(first.runs.map((r) => r.outcome)).toEqual(second.runs.map((r) => r.outcome));
    // Pipeline integrity holds for the real mock even though its verdicts are not meaningful.
    expect(gate(first, "blindingIntegrity")?.status).toBe("pass");
    expect(gate(first, "quoteIntegrity")?.status).toBe("pass");
    expect(gate(first, "positionConsistency")?.status).toBe("pass");
  });
});
