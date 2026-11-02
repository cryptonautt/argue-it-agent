/**
 * Judge provider backed by the Agent-Native framework's configured LLM engine (plan Task 4).
 * One call = one independent judging pass, exactly like AnthropicJudgeProvider:
 *
 *  - Same prompt: JUDGE_SYSTEM_PROMPT + rendered rubric as the system prompt, renderCaseMessage() as the
 *    only user turn. The engine API has no structured-output option, so the rubric's JSON schema (generated
 *    from the same zod schema the Anthropic provider sends as output_config.format) is appended to the
 *    system prompt and the reply must be that JSON object alone. No tools.
 *  - Same validation and relabelling: parseJudgeOutput() + finalizePass(), so a BA pass is mapped back to
 *    canonical labels and quotes are verified exactly as for every other provider.
 *  - A provider failure (engine cannot be resolved, no key, network, 5xx, early stop, bad JSON) is a typed
 *    `ok: false` result, never a verdict. The job queue retries it and finally sends the debate to
 *    needs_review.
 *
 * Runs inside the background tick, which has no request or signed-in user. resolveEngine() then falls
 * back to deployment-level settings/env; if that cannot produce a working engine, use
 * JUDGE_PROVIDER=anthropic (see docs/office-hours.md).
 */
import type { AgentEngine, EngineEvent } from "@agent-native/core/agent/engine";
import { z } from "zod";
import type { TokenUsage } from "@domain/db/json-types";
import { hashCaseFile } from "../case-file";
import {
  ENGINE_UNRESOLVED_MODEL,
  JUDGE_ENGINE_APP_ID,
  JUDGE_ENGINE_MODEL_ENV,
  JUDGE_MAX_TOKENS,
  JUDGE_PROVIDER_UNAVAILABLE,
  JUDGE_REQUEST_TIMEOUT_MS,
} from "../config";
import { finalizePass, judgeOutputSchema, parseJudgeOutput } from "../output-schema";
import { presentCase } from "../presentation";
import { JUDGE_SYSTEM_PROMPT, renderCaseMessage, renderRubric } from "../prompt";
import type { JudgePassInput, JudgePassResult, JudgeProvider, RubricDef } from "../types";

export type EngineResolver = () => Promise<AgentEngine>;
export type EngineModelResolver = (engine: AgentEngine) => Promise<string | undefined>;

export interface EngineJudgeProviderOptions {
  /** Defaults to the framework's resolveEngine() (deployment settings / env; no request needed). */
  resolveEngine?: EngineResolver;
  /** Fixed model id. Defaults to $JUDGE_MODEL, then the app's stored model for the engine, then its default. */
  model?: string;
  /** Looks up the stored model for an engine (defaults to the framework's getStoredModelForEngine). */
  resolveStoredModel?: EngineModelResolver;
  timeoutMs?: number;
}

/** The framework's engine resolution, loaded lazily so importing this module stays cheap. */
async function defaultResolveEngine(): Promise<AgentEngine> {
  const engines = await import("@agent-native/core/agent/engine");
  if (!engines.getAgentEngineEntry("anthropic")) engines.registerBuiltinEngines();
  return engines.resolveEngine({ appId: JUDGE_ENGINE_APP_ID });
}

async function defaultResolveStoredModel(engine: AgentEngine): Promise<string | undefined> {
  const engines = await import("@agent-native/core/agent/engine");
  return engines.getStoredModelForEngine(engine, { appId: JUDGE_ENGINE_APP_ID });
}

/** The output-format block appended to the system prompt (one per rubric version). */
const formatCache = new Map<string, string>();
export function renderOutputFormat(rubric: RubricDef): string {
  const key = `${rubric.id}@${rubric.version}`;
  let block = formatCache.get(key);
  if (!block) {
    const schema = z.toJSONSchema(judgeOutputSchema(rubric));
    block = [
      "Output format",
      "Reply with exactly one JSON object and nothing else: no prose before or after it, no markdown code fences.",
      "It must validate against this JSON Schema (every criterion key is required for both Side X and Side Y):",
      JSON.stringify(schema),
    ].join("\n");
    formatCache.set(key, block);
  }
  return block;
}

/** Exported for tests: the system prompt and user message for one pass. */
export function buildEngineJudgeRequest(input: JudgePassInput, caseHash: string) {
  const presentation = presentCase(input.caseFile, input.order);
  const systemPrompt = [JUDGE_SYSTEM_PROMPT, renderRubric(input.rubric), renderOutputFormat(input.rubric)].join("\n\n");
  const userText = renderCaseMessage(presentation, caseHash);
  return { presentation, systemPrompt, userText };
}

/** Strip one surrounding markdown code fence, if the model added one despite the instructions. */
function unfence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/u.exec(trimmed);
  return match?.[1] !== undefined ? match[1].trim() : trimmed;
}

interface UsageAccumulator {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  seen: boolean;
}

/**
 * Engine usage counts cache reads/writes INSIDE inputTokens; stored pass usage follows the Anthropic
 * convention used by the reference (inputTokens excludes cache tokens), so the two providers compare.
 */
function toTokenUsage(u: UsageAccumulator): TokenUsage | null {
  if (!u.seen) return null;
  return {
    inputTokens: Math.max(0, u.input - u.cacheRead - u.cacheWrite),
    outputTokens: u.output,
    cacheReadInputTokens: u.cacheRead,
    cacheCreationInputTokens: u.cacheWrite,
  };
}

type StopEvent = Extract<EngineEvent, { type: "stop" }>;

/** 408 / 409 / 429 / 5xx / unknown status are transient; other 4xx are not (same rule as the Anthropic provider). */
function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined || status === 0) return true;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as { statusCode?: unknown; status?: unknown };
  if (typeof e.statusCode === "number") return e.statusCode;
  if (typeof e.status === "number") return e.status;
  return undefined;
}

function errorRetryable(error: unknown): boolean | undefined {
  if (!error || typeof error !== "object") return undefined;
  const flag = (error as { providerRetryable?: unknown }).providerRetryable;
  return typeof flag === "boolean" ? flag : undefined;
}

export class EngineJudgeProvider implements JudgeProvider {
  readonly id = "engine";
  private readonly resolveEngineFn: EngineResolver;
  private readonly resolveStoredModelFn: EngineModelResolver;
  private readonly fixedModel: string | undefined;
  private readonly timeoutMs: number;
  private lastModel: string | undefined;

  constructor(options: EngineJudgeProviderOptions = {}) {
    this.resolveEngineFn = options.resolveEngine ?? defaultResolveEngine;
    this.resolveStoredModelFn = options.resolveStoredModel ?? (options.resolveEngine ? async () => undefined : defaultResolveStoredModel);
    this.fixedModel = options.model?.trim() || process.env[JUDGE_ENGINE_MODEL_ENV]?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? JUDGE_REQUEST_TIMEOUT_MS;
  }

  /** Model recorded on passes: the model of the last resolved engine call (or the configured override). */
  get model(): string {
    return this.lastModel ?? this.fixedModel ?? ENGINE_UNRESOLVED_MODEL;
  }

  private async modelFor(engine: AgentEngine): Promise<string> {
    if (this.fixedModel) return this.fixedModel;
    try {
      const stored = (await this.resolveStoredModelFn(engine))?.trim();
      if (stored) return stored;
    } catch {
      // Settings store unavailable outside a request: use the engine default.
    }
    return engine.defaultModel;
  }

  async runPass(input: JudgePassInput): Promise<JudgePassResult> {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);

    let engine: AgentEngine;
    let model: string;
    try {
      engine = await this.resolveEngineFn();
      model = await this.modelFor(engine);
    } catch (error) {
      return {
        ok: false,
        kind: "provider_error",
        error: `${JUDGE_PROVIDER_UNAVAILABLE}: could not resolve the framework LLM engine: ${errorMessage(error)}`,
        retryable: true,
        latencyMs: elapsed(),
        usage: null,
        stopReason: null,
      };
    }
    this.lastModel = model;

    const { presentation, systemPrompt, userText } = buildEngineJudgeRequest(input, hashCaseFile(input.caseFile));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    (timer as { unref?: () => void }).unref?.();

    const usage: UsageAccumulator = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, seen: false };
    let deltas = "";
    let finalText: string | null = null;
    let stop: StopEvent | null = null;
    let thrown: unknown = undefined;
    let threw = false;

    try {
      const stream = engine.stream({
        model,
        systemPrompt,
        messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
        tools: [],
        abortSignal: controller.signal,
        maxOutputTokens: JUDGE_MAX_TOKENS,
        reasoningEffort: "high",
      });
      for await (const event of stream) {
        switch (event.type) {
          case "text-delta":
            deltas += event.text;
            break;
          case "assistant-content":
            finalText = event.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("");
            break;
          case "usage":
            usage.seen = true;
            usage.input += event.inputTokens;
            usage.output += event.outputTokens;
            usage.cacheRead += event.cacheReadTokens ?? 0;
            usage.cacheWrite += event.cacheWriteTokens ?? 0;
            break;
          case "stop":
            stop = event;
            break;
          default:
            break;
        }
      }
    } catch (error) {
      threw = true;
      thrown = error;
    } finally {
      clearTimeout(timer);
    }

    const base = { usage: toTokenUsage(usage), latencyMs: elapsed(), servedModel: model };
    const timedOut = controller.signal.aborted;

    if (timedOut) {
      return { ok: false, kind: "timeout", error: "judge request timed out", retryable: true, stopReason: null, ...base };
    }
    if (stop?.reason === "error") {
      const status = stop.statusCode;
      const code = stop.errorCode ? ` (${stop.errorCode})` : "";
      return {
        ok: false,
        kind: "provider_error",
        error: `AI engine error${status ? ` ${status}` : ""}${code}: ${stop.error ?? "unknown error"}`,
        retryable: stop.providerRetryable ?? isRetryableStatus(status),
        stopReason: "error",
        ...base,
      };
    }
    if (threw) {
      const status = errorStatus(thrown);
      return {
        ok: false,
        kind: "provider_error",
        error: `AI engine error${status ? ` ${status}` : ""}: ${errorMessage(thrown)}`,
        retryable: errorRetryable(thrown) ?? isRetryableStatus(status),
        stopReason: null,
        ...base,
      };
    }
    const stopReason = stop?.reason ?? null;
    if (stopReason !== "end_turn") {
      return {
        ok: false,
        kind: "invalid_output",
        error: `judge stopped early (stop_reason: ${stopReason ?? "null"})`,
        retryable: true,
        stopReason,
        ...base,
      };
    }

    const text = unfence(finalText ?? deltas);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, kind: "invalid_output", error: "judge output was not valid JSON", raw: text, retryable: true, stopReason, ...base };
    }
    const parsed = parseJudgeOutput(json, input.rubric);
    if (!parsed.ok) return { ok: false, kind: "invalid_output", error: parsed.error, raw: json, retryable: true, stopReason, ...base };

    return { ok: true, output: finalizePass(parsed.output, presentation, input.rubric, input.passNo), raw: json, stopReason, ...base };
  }
}
