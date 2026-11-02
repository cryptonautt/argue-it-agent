/**
 * Owner: moderation. Pure helpers for the admin dashboards: rates, the AI cost estimate, queue health.
 * Kept free of DB/React so they are unit-tested in isolation.
 */

/** USD per million tokens. ESTIMATE only (list prices, 2026-09); unknown models are reported as unpriced. */
export const MODEL_PRICING_PER_MTOK: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

/** Models that cost nothing (the deterministic mock judge used in dev/tests). */
const FREE_MODEL = /^mock/i;

export interface ModelUsage {
  model: string;
  passes: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface CostEstimate {
  totalUsd: number;
  perModel: Array<ModelUsage & { usd: number | null }>;
  /** Models with usage but no known price (cost excluded from the total). */
  unpricedModels: string[];
}

export function estimateCost(usage: readonly ModelUsage[]): CostEstimate {
  const unpriced: string[] = [];
  let total = 0;
  const perModel = usage.map((u) => {
    if (FREE_MODEL.test(u.model)) return { ...u, usd: 0 };
    const price = MODEL_PRICING_PER_MTOK[u.model];
    if (!price) {
      unpriced.push(u.model);
      return { ...u, usd: null };
    }
    const usd =
      (u.inputTokens * price.input +
        u.outputTokens * price.output +
        u.cacheReadInputTokens * price.cacheRead +
        u.cacheCreationInputTokens * price.cacheWrite) /
      1_000_000;
    total += usd;
    return { ...u, usd };
  });
  return { totalUsd: total, perModel, unpricedModels: unpriced };
}

/** numerator / denominator, or null when there is nothing to divide by (render as "—"). */
export function rate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

export function formatPercent(value: number | null, digits = 0): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "< $0.01";
  return `$${value.toFixed(2)}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

export type HealthLevel = "healthy" | "attention" | "failing";

export interface QueueSnapshot {
  queued: number;
  /** Minutes the oldest due job has been waiting (0 when none). */
  oldestDueMinutes: number;
  /** Running jobs whose claim is older than the stuck threshold. */
  stuck: number;
  /** Jobs that exhausted retries in the window. */
  failed: number;
}

export const STUCK_JOB_MINUTES = 15;
const SLOW_QUEUE_MINUTES = 10;

/**
 * Plain-language health of the evaluation queue. "failing" when jobs are stuck or the queue is badly
 * backed up; "attention" for any failure or a slow queue.
 */
export function queueHealth(snapshot: QueueSnapshot): { level: HealthLevel; reasons: string[] } {
  const reasons: string[] = [];
  let level: HealthLevel = "healthy";
  const raise = (to: HealthLevel) => {
    if (to === "failing" || (to === "attention" && level === "healthy")) level = to;
  };
  if (snapshot.stuck > 0) {
    raise("failing");
    reasons.push(`${snapshot.stuck} job(s) running for over ${STUCK_JOB_MINUTES} minutes.`);
  }
  if (snapshot.oldestDueMinutes >= SLOW_QUEUE_MINUTES * 6) {
    raise("failing");
    reasons.push(`Oldest due job has waited ${Math.round(snapshot.oldestDueMinutes)} minutes. Is the cron running?`);
  } else if (snapshot.oldestDueMinutes >= SLOW_QUEUE_MINUTES) {
    raise("attention");
    reasons.push(`Oldest due job has waited ${Math.round(snapshot.oldestDueMinutes)} minutes.`);
  }
  if (snapshot.failed > 0) {
    raise("attention");
    reasons.push(`${snapshot.failed} job(s) failed after all retries. Their debates are waiting for a human.`);
  }
  if (reasons.length === 0) reasons.push("Jobs are being picked up and finishing normally.");
  return { level, reasons };
}

/** Nearest-rank percentile of a numeric list (null for empty input). */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? null;
}
