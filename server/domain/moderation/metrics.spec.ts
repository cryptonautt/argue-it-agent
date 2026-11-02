import { describe, expect, it } from "vitest";
import { estimateCost, formatPercent, formatUsd, percentile, queueHealth, rate } from "./metrics";

describe("estimateCost", () => {
  it("prices known models per million tokens and treats the mock judge as free", () => {
    const result = estimateCost([
      { model: "claude-opus-5-5", passes: 2, inputTokens: 1_000_000, outputTokens: 100_000, cacheReadInputTokens: 500_000, cacheCreationInputTokens: 0 },
      { model: "mock-judge-v1", passes: 10, inputTokens: 9_999, outputTokens: 9_999, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    ]);
    // 1M × $4 + 0.1M × $20 + 0.5M × $0.20 = 4 + 2 + 0.1
    expect(result.totalUsd).toBeCloseTo(6.1, 5);
    expect(result.perModel[1]?.usd).toBe(0);
    expect(result.unpricedModels).toEqual([]);
  });

  it("reports unknown models instead of guessing a price", () => {
    const result = estimateCost([
      { model: "some-new-model", passes: 1, inputTokens: 10, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    ]);
    expect(result.totalUsd).toBe(0);
    expect(result.unpricedModels).toEqual(["some-new-model"]);
    expect(result.perModel[0]?.usd).toBeNull();
  });
});

describe("rates and formatting", () => {
  it("returns null instead of dividing by zero", () => {
    expect(rate(1, 0)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0.256, 1)).toBe("25.6%");
    expect(formatUsd(0.004)).toBe("< $0.01");
    expect(formatUsd(3.5)).toBe("$3.50");
  });

  it("computes nearest-rank percentiles", () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
  });
});

describe("queueHealth", () => {
  it("is healthy with an idle queue", () => {
    expect(queueHealth({ queued: 0, oldestDueMinutes: 0, stuck: 0, failed: 0 }).level).toBe("healthy");
  });

  it("needs attention after failures or a slow queue", () => {
    expect(queueHealth({ queued: 1, oldestDueMinutes: 12, stuck: 0, failed: 0 }).level).toBe("attention");
    expect(queueHealth({ queued: 0, oldestDueMinutes: 0, stuck: 0, failed: 2 }).level).toBe("attention");
  });

  it("is failing when jobs are stuck or the cron looks dead", () => {
    expect(queueHealth({ queued: 0, oldestDueMinutes: 0, stuck: 1, failed: 0 }).level).toBe("failing");
    const dead = queueHealth({ queued: 9, oldestDueMinutes: 90, stuck: 0, failed: 1 });
    expect(dead.level).toBe("failing");
    expect(dead.reasons.join(" ")).toMatch(/cron/);
  });
});
