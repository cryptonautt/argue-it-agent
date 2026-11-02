/**
 * Judge provider selection (plan Task 4). `JUDGE_PROVIDER` is REQUIRED, with no default and no inference:
 *
 *   engine     the Agent-Native framework's configured LLM engine (EngineJudgeProvider)
 *   anthropic  the reference AnthropicJudgeProvider with a deployment-level ANTHROPIC_API_KEY
 *   mock       the deterministic offline heuristic. Only when set explicitly AND NODE_ENV !== "production".
 *
 * Unset, unknown, `anthropic` without a key, or `mock` in production → EvaluationFailure("judge provider
 * unavailable: …", retryable). Thrown inside a judging job, that takes the queue's normal retry →
 * needs_review path, so a misconfigured deployment never produces a verdict and never silently uses the
 * mock. Tests install scripted providers with `setJudgeProviderForTests()`.
 */
import { JUDGE_PROVIDER_KINDS, JUDGE_PROVIDER_UNAVAILABLE } from "../config";
import { EvaluationFailure } from "../evaluate";
import type { JudgeProvider } from "../types";
import { AnthropicJudgeProvider } from "./anthropic";
import { EngineJudgeProvider } from "./engine";
import { MockJudgeProvider } from "./mock";

export { AnthropicJudgeProvider } from "./anthropic";
export { EngineJudgeProvider, type EngineJudgeProviderOptions, type EngineResolver } from "./engine";
export { MockJudgeProvider, mockRawOutput } from "./mock";

const globalForJudge = globalThis as unknown as {
  __argueItJudgeProvider?: JudgeProvider;
  __argueItJudgeProviderOverride?: JudgeProvider | null;
};

export type JudgeProviderKind = (typeof JUDGE_PROVIDER_KINDS)[number];

function unavailable(detail: string): EvaluationFailure {
  return new EvaluationFailure(`${JUDGE_PROVIDER_UNAVAILABLE}: ${detail}`, true);
}

function isKind(value: string): value is JudgeProviderKind {
  return (JUDGE_PROVIDER_KINDS as readonly string[]).includes(value);
}

/** Read and check JUDGE_PROVIDER. Throws EvaluationFailure("judge provider unavailable: …") when unusable. */
export function selectedProviderKind(env: Readonly<Record<string, string | undefined>> = process.env): JudgeProviderKind {
  const raw = env.JUDGE_PROVIDER?.trim() ?? "";
  if (raw === "") {
    throw unavailable(`JUDGE_PROVIDER is not set (expected one of: ${JUDGE_PROVIDER_KINDS.join(", ")})`);
  }
  const kind = raw.toLowerCase();
  if (!isKind(kind)) {
    throw unavailable(`JUDGE_PROVIDER="${raw}" is not one of: ${JUDGE_PROVIDER_KINDS.join(", ")}`);
  }
  if (kind === "mock" && env.NODE_ENV === "production") {
    throw unavailable("JUDGE_PROVIDER=mock is not allowed in production");
  }
  if (kind === "anthropic" && !env.ANTHROPIC_API_KEY?.trim()) {
    throw unavailable("JUDGE_PROVIDER=anthropic needs a deployment-level ANTHROPIC_API_KEY");
  }
  return kind;
}

function createProvider(kind: JudgeProviderKind): JudgeProvider {
  switch (kind) {
    case "engine":
      return new EngineJudgeProvider();
    case "anthropic":
      return new AnthropicJudgeProvider();
    case "mock":
      return new MockJudgeProvider();
  }
}

export function getJudgeProvider(): JudgeProvider {
  const override = globalForJudge.__argueItJudgeProviderOverride;
  if (override) return override;
  const kind = selectedProviderKind();
  const cached = globalForJudge.__argueItJudgeProvider;
  if (cached && cached.id === kind) return cached;
  const provider = createProvider(kind);
  globalForJudge.__argueItJudgeProvider = provider;
  return provider;
}

/** Test hook: route every judging pass to `provider` (or back to env-based selection with `null`). */
export function setJudgeProviderForTests(provider: JudgeProvider | null): void {
  globalForJudge.__argueItJudgeProviderOverride = provider;
}
