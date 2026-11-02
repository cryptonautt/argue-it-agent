/**
 * Judge provider selection (plan Task 4): JUDGE_PROVIDER is required, with no default and no inference,
 * and the offline mock is never chosen unless asked for by name outside production.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvaluationFailure } from "../evaluate";
import { AnthropicJudgeProvider } from "./anthropic";
import { EngineJudgeProvider } from "./engine";
import { getJudgeProvider, selectedProviderKind, setJudgeProviderForTests } from "./index";
import { MockJudgeProvider } from "./mock";

afterEach(() => {
  vi.unstubAllEnvs();
  setJudgeProviderForTests(null);
});

function expectUnavailable(fn: () => unknown, detail?: RegExp) {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(EvaluationFailure);
  const failure = caught as EvaluationFailure;
  expect(failure.message).toMatch(/^judge provider unavailable/u);
  expect(failure.retryable).toBe(true);
  if (detail) expect(failure.message).toMatch(detail);
}

describe("getJudgeProvider", () => {
  it("getJudgeProvider throws when JUDGE_PROVIDER is unset", () => {
    vi.stubEnv("JUDGE_PROVIDER", undefined);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-not-used");
    expectUnavailable(() => getJudgeProvider(), /JUDGE_PROVIDER is not set/u);
    vi.stubEnv("JUDGE_PROVIDER", "  ");
    expectUnavailable(() => getJudgeProvider(), /JUDGE_PROVIDER is not set/u);
  });

  it("getJudgeProvider never returns mock unless JUDGE_PROVIDER=mock", () => {
    vi.stubEnv("NODE_ENV", "test");
    // No key anywhere: the reference silently fell back to the mock here. Now nothing does.
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    for (const value of [undefined, "", "anthropic", "bogus", "Mock-ish", "auto"]) {
      vi.stubEnv("JUDGE_PROVIDER", value);
      let provider: unknown = null;
      try {
        provider = getJudgeProvider();
      } catch (error) {
        expect(error).toBeInstanceOf(EvaluationFailure);
      }
      expect(provider).not.toBeInstanceOf(MockJudgeProvider);
    }

    vi.stubEnv("JUDGE_PROVIDER", "engine");
    expect(getJudgeProvider()).toBeInstanceOf(EngineJudgeProvider);

    vi.stubEnv("JUDGE_PROVIDER", "mock");
    expect(getJudgeProvider()).toBeInstanceOf(MockJudgeProvider);
    vi.stubEnv("JUDGE_PROVIDER", " MOCK ");
    expect(getJudgeProvider().id).toBe("mock");
  });

  it("refuses the mock in production even when JUDGE_PROVIDER=mock", () => {
    vi.stubEnv("JUDGE_PROVIDER", "mock");
    vi.stubEnv("NODE_ENV", "production");
    expectUnavailable(() => getJudgeProvider(), /production/u);
  });

  it("anthropic needs a deployment ANTHROPIC_API_KEY", () => {
    vi.stubEnv("JUDGE_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    expectUnavailable(() => getJudgeProvider(), /ANTHROPIC_API_KEY/u);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-not-used");
    expect(getJudgeProvider()).toBeInstanceOf(AnthropicJudgeProvider);
  });

  it("rejects an unknown JUDGE_PROVIDER value by name", () => {
    vi.stubEnv("JUDGE_PROVIDER", "openai");
    expectUnavailable(() => getJudgeProvider(), /"openai"/u);
  });

  it("selectedProviderKind reads the env it is given", () => {
    expect(selectedProviderKind({ JUDGE_PROVIDER: "engine" })).toBe("engine");
    expect(selectedProviderKind({ JUDGE_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" })).toBe("anthropic");
    expect(selectedProviderKind({ JUDGE_PROVIDER: "mock", NODE_ENV: "test" })).toBe("mock");
    expectUnavailable(() => selectedProviderKind({}));
    expectUnavailable(() => selectedProviderKind({ ANTHROPIC_API_KEY: "k" }));
  });

  it("a test override wins over the environment", () => {
    vi.stubEnv("JUDGE_PROVIDER", undefined);
    const mock = new MockJudgeProvider();
    setJudgeProviderForTests(mock);
    expect(getJudgeProvider()).toBe(mock);
  });
});
