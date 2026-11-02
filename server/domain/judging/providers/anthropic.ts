/**
 * Claude judge provider (design §3, §4.3). One call = one independent judging pass.
 *
 * Request shape: claude-opus-5-5, adaptive thinking, effort "high", structured output via
 * output_config.format (JSON schema generated from the rubric's zod schema), server-side refusal fallback
 * (`fallbacks: "default"`). No temperature, budget_tokens, prefill or forced tool_choice. The stable system
 * prompt and rubric are sent as cacheable system blocks; only the case varies per request.
 *
 * `stop_reason` is checked BEFORE content is read; the JSON is validated with zod ourselves (rather than
 * the SDK's auto-parse) so refusals, truncation and schema violations are reported as typed failures
 * instead of thrown parse errors.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { TokenUsage } from "@domain/db/json-types";
import {
  JUDGE_FALLBACK_BETA,
  JUDGE_MAX_TOKENS,
  JUDGE_MODEL,
  JUDGE_REQUEST_TIMEOUT_MS,
  JUDGE_SDK_MAX_RETRIES,
} from "../config";
import { finalizePass, judgeOutputSchema, parseJudgeOutput } from "../output-schema";
import { presentCase } from "../presentation";
import { JUDGE_SYSTEM_PROMPT, renderCaseMessage, renderRubric } from "../prompt";
import { hashCaseFile } from "../case-file";
import type { JudgePassInput, JudgePassResult, JudgeProvider, RubricDef } from "../types";

type BetaMessage = Anthropic.Beta.BetaMessage;
type BetaJSONOutputFormat = Anthropic.Beta.BetaJSONOutputFormat;

/** JSON schema per rubric, built once (identical schemas also hit the API's 24h schema cache). */
const formatCache = new Map<string, BetaJSONOutputFormat>();
function outputFormatFor(rubric: RubricDef): BetaJSONOutputFormat {
  const key = `${rubric.id}@${rubric.version}`;
  let format = formatCache.get(key);
  if (!format) {
    // Strip the SDK's auto-`parse` hook: we parse ourselves after checking stop_reason.
    const { type, schema } = betaZodOutputFormat(judgeOutputSchema(rubric));
    format = { type, schema };
    formatCache.set(key, format);
  }
  return format;
}

export function usageFromMessage(message: Pick<BetaMessage, "usage">): TokenUsage {
  const u = message.usage;
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/** Exported for tests: build the exact request body for a pass. */
export function buildJudgeRequest(input: JudgePassInput, caseHash: string) {
  const presentation = presentCase(input.caseFile, input.order);
  const params = {
    model: JUDGE_MODEL,
    max_tokens: JUDGE_MAX_TOKENS,
    thinking: { type: "adaptive" as const },
    output_config: { effort: "high" as const, format: outputFormatFor(input.rubric) },
    betas: [JUDGE_FALLBACK_BETA],
    fallbacks: "default" as const,
    system: [
      { type: "text" as const, text: JUDGE_SYSTEM_PROMPT },
      { type: "text" as const, text: renderRubric(input.rubric), cache_control: { type: "ephemeral" as const } },
    ],
    messages: [{ role: "user" as const, content: renderCaseMessage(presentation, caseHash) }],
  } satisfies Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
  return { params, presentation };
}

/** Map an SDK error to a pass failure. Transient (429 / 5xx / network / timeout) failures are retryable. */
export function classifyProviderError(error: unknown): { kind: "provider_error" | "timeout"; retryable: boolean; message: string } {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return { kind: "timeout", retryable: true, message: "judge request timed out" };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { kind: "provider_error", retryable: true, message: `connection error: ${error.message}` };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { kind: "provider_error", retryable: true, message: "rate limited by the AI provider" };
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    const retryable = status === 408 || status === 409 || status >= 500 || status === 0;
    return { kind: "provider_error", retryable, message: `AI provider error ${status}: ${error.message}` };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: "provider_error", retryable: true, message };
}

/** Interpret a finished message. Pure (exported for tests with scripted messages). */
export function interpretJudgeMessage(
  message: BetaMessage,
  input: JudgePassInput,
  presentation: ReturnType<typeof presentCase>,
  latencyMs: number,
): JudgePassResult {
  const usage = usageFromMessage(message);
  const base = { usage, latencyMs, stopReason: message.stop_reason, servedModel: message.model };

  if (message.stop_reason === "refusal") {
    const details = message.stop_details;
    const category = details && details.type === "refusal" ? (details.category ?? "unspecified") : "unspecified";
    return {
      ok: false,
      kind: "refusal",
      error: `the AI judge declined to evaluate this debate (category: ${category})`,
      raw: { stop_details: details ?? null },
      retryable: false,
      ...base,
    };
  }
  if (message.stop_reason !== "end_turn") {
    return {
      ok: false,
      kind: "invalid_output",
      error: `judge stopped early (stop_reason: ${message.stop_reason ?? "null"})`,
      retryable: true,
      ...base,
    };
  }

  const text = message.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, kind: "invalid_output", error: "judge output was not valid JSON", raw: text, retryable: true, ...base };
  }
  const parsed = parseJudgeOutput(json, input.rubric);
  if (!parsed.ok) return { ok: false, kind: "invalid_output", error: parsed.error, raw: json, retryable: true, ...base };

  return { ok: true, output: finalizePass(parsed.output, presentation, input.rubric, input.passNo), raw: json, ...base };
}

export interface AnthropicJudgeProviderOptions {
  client?: Anthropic;
}

export class AnthropicJudgeProvider implements JudgeProvider {
  readonly id = "anthropic";
  readonly model = JUDGE_MODEL;
  private readonly client: Anthropic;

  constructor(options: AnthropicJudgeProviderOptions = {}) {
    this.client = options.client ?? new Anthropic({ maxRetries: JUDGE_SDK_MAX_RETRIES, timeout: JUDGE_REQUEST_TIMEOUT_MS });
  }

  async runPass(input: JudgePassInput): Promise<JudgePassResult> {
    const { params, presentation } = buildJudgeRequest(input, hashCaseFile(input.caseFile));
    const started = performance.now();
    try {
      // Streamed (long adaptive-thinking turns must not hit HTTP timeouts); we only need the final message.
      const message = await this.client.beta.messages.stream(params, { timeout: JUDGE_REQUEST_TIMEOUT_MS }).finalMessage();
      return interpretJudgeMessage(message, input, presentation, Math.round(performance.now() - started));
    } catch (error) {
      const { kind, retryable, message } = classifyProviderError(error);
      return { ok: false, kind, error: message, retryable, latencyMs: Math.round(performance.now() - started), usage: null, stopReason: null };
    }
  }
}
