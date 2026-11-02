/**
 * Token cost accounting and the pre-flight estimate for `--live`. Owner: fairness. Pure.
 *
 * Prices are Anthropic first-party list prices per million tokens for claude-opus-5-5 (the judge model,
 * design §3) as of 2026-09. The cache-write price is an assumption (1.25x input, the usual 5-minute cache
 * write multiplier) — the estimate ignores caching anyway, so it errs high.
 */
import type { TokenUsage } from "@domain/db/json-types";

export interface ModelPricing {
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
}

export const OPUS_5_5_PRICING: ModelPricing = {
  model: "claude-opus-5-5",
  inputPerMTok: 4,
  outputPerMTok: 20,
  cacheReadPerMTok: 0.2,
  cacheWritePerMTok: 5,
};

/** Rough chars-per-token for mixed English / Pidgin prose plus JSON (conservative: overestimates tokens). */
export const CHARS_PER_TOKEN_ESTIMATE = 3.2;
/**
 * Output tokens per pass: the structured verdict (~1.5k) plus adaptive thinking at effort "high". Thinking
 * length varies a lot; 8k is a deliberately pessimistic planning number, not a measurement.
 */
export const OUTPUT_TOKENS_PER_PASS_ESTIMATE = 8_000;
/** Passes per case: 2 always, 3 when the first two disagree. The estimate assumes the worst case. */
export const MAX_PASSES_PER_CASE = 4;

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  passesWithUsage: number;
}

export function sumUsage(usages: ReadonlyArray<TokenUsage | null | undefined>): UsageTotals {
  const totals: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, passesWithUsage: 0 };
  for (const u of usages) {
    if (!u) continue;
    totals.inputTokens += u.inputTokens;
    totals.outputTokens += u.outputTokens;
    totals.cacheReadInputTokens += u.cacheReadInputTokens ?? 0;
    totals.cacheCreationInputTokens += u.cacheCreationInputTokens ?? 0;
    totals.passesWithUsage += 1;
  }
  return totals;
}

/** USD cost of the given usage. Anthropic reports input_tokens excluding cache reads/writes. */
export function costUsd(usage: Omit<UsageTotals, "passesWithUsage">, pricing: ModelPricing = OPUS_5_5_PRICING): number {
  const usd =
    (usage.inputTokens * pricing.inputPerMTok +
      usage.outputTokens * pricing.outputPerMTok +
      usage.cacheReadInputTokens * pricing.cacheReadPerMTok +
      usage.cacheCreationInputTokens * pricing.cacheWritePerMTok) /
    1_000_000;
  return Math.round(usd * 10_000) / 10_000;
}

export interface CostEstimate {
  cases: number;
  maxPasses: number;
  inputTokens: number;
  outputTokens: number;
  /** Two passes per case (the usual path). */
  typicalUsd: number;
  /** Four passes per case (every case needs the extra order-balanced pair). */
  worstCaseUsd: number;
}

/**
 * Estimate the spend of a live run from the exact prompt text each pass would send
 * (`promptCharsPerCase[i]` = characters of system prompt + rubric + case message for case i).
 */
export function estimateLiveCost(promptCharsPerCase: readonly number[], pricing: ModelPricing = OPUS_5_5_PRICING): CostEstimate {
  const inputPerPass = promptCharsPerCase.map((chars) => Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE));
  const perPassUsd = (input: number) => (input * pricing.inputPerMTok + OUTPUT_TOKENS_PER_PASS_ESTIMATE * pricing.outputPerMTok) / 1_000_000;
  const sumFor = (passes: number) => inputPerPass.reduce((sum, input) => sum + passes * perPassUsd(input), 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    cases: promptCharsPerCase.length,
    maxPasses: promptCharsPerCase.length * MAX_PASSES_PER_CASE,
    inputTokens: inputPerPass.reduce((s, n) => s + n * MAX_PASSES_PER_CASE, 0),
    outputTokens: promptCharsPerCase.length * MAX_PASSES_PER_CASE * OUTPUT_TOKENS_PER_PASS_ESTIMATE,
    typicalUsd: round2(sumFor(2)),
    worstCaseUsd: round2(sumFor(MAX_PASSES_PER_CASE)),
  };
}
