/**
 * EngineJudgeProvider against a fake AgentEngine (plan Task 4). No network, no database.
 */
import type { AgentEngine, EngineEvent, EngineStreamOptions } from "@agent-native/core/agent/engine";
import { describe, expect, it } from "vitest";
import { hashCaseFile } from "../case-file";
import { finalizePass, parseJudgeOutput, type JudgeRawOutput } from "../output-schema";
import { presentCase } from "../presentation";
import { JUDGE_SYSTEM_PROMPT, PROMPT_VERSION, renderCaseMessage, renderRubric } from "../prompt";
import { getRubric } from "../rubrics";
import type { CaseFile, JudgePassInput, PassOrder, RubricDef } from "../types";
import { interpretJudgeMessage } from "./anthropic";
import { EngineJudgeProvider } from "./engine";
import { mockRawOutput } from "./mock";

const SPORTS = getRubric("sports", 1) as RubricDef;

const CASE_FILE: CaseFile = {
  schemaVersion: 1,
  proposition: "Lionel Messi is a better footballer than Cristiano Ronaldo.",
  category: { slug: "sports", name: "Sports & Football" },
  rubric: { id: SPORTS.id, version: SPORTS.version },
  sides: {
    A: {
      label: "A",
      stance: "FOR",
      opening: {
        text: "Messi has 8 Ballon d'Or awards because he creates and scores. He made 91 goals in 2012, which means no one matched his output.",
        links: ["https://example.com/ballon-dor"],
      },
      rebuttal: { text: "Ronaldo's international goals came from far more penalties, so the raw total hides the difference.", links: [] },
    },
    B: {
      label: "B",
      stance: "AGAINST",
      opening: { text: "Ronaldo scored 130 international goals and won the Champions League with two clubs. I think that is unmatched.", links: [] },
      rebuttal: null,
    },
  },
};

function passInput(order: PassOrder, passNo = order === "AB" ? 1 : 2): JudgePassInput {
  return { caseFile: CASE_FILE, rubric: SPORTS, passNo, order, promptVersion: PROMPT_VERSION };
}

interface FakeEngine extends AgentEngine {
  calls: EngineStreamOptions[];
}

/** A fake engine that replays `events` (and optionally throws after them). */
function fakeEngine(events: EngineEvent[], options: { throwAfter?: unknown; model?: string } = {}): FakeEngine {
  const calls: EngineStreamOptions[] = [];
  return {
    name: "fake",
    label: "Fake engine",
    defaultModel: options.model ?? "fake-model-1",
    supportedModels: [options.model ?? "fake-model-1"],
    capabilities: { thinking: false, promptCaching: false, vision: false, computerUse: false, parallelToolCalls: false },
    calls,
    async *stream(opts: EngineStreamOptions): AsyncIterable<EngineEvent> {
      calls.push(opts);
      for (const event of events) yield event;
      if (options.throwAfter !== undefined) throw options.throwAfter;
    },
  };
}

const textEvents = (text: string): EngineEvent[] => [
  { type: "text-delta", text: text.slice(0, 10) },
  { type: "text-delta", text: text.slice(10) },
  { type: "usage", inputTokens: 1200, outputTokens: 300, cacheReadTokens: 200, cacheWriteTokens: 0 },
  { type: "assistant-content", parts: [{ type: "text", text }] },
  { type: "stop", reason: "end_turn" },
];

const providerFor = (engine: AgentEngine) => new EngineJudgeProvider({ resolveEngine: async () => engine });

describe("EngineJudgeProvider", () => {
  it("returns ok output when the engine returns valid JSON matching output-schema", async () => {
    const input = passInput("AB");
    const raw = mockRawOutput(input);
    const engine = fakeEngine(textEvents(JSON.stringify(raw)));
    const provider = providerFor(engine);

    const result = await provider.runPass(input);

    expect(provider.id).toBe("engine");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseJudgeOutput(raw, SPORTS);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(result.output).toEqual(finalizePass(parsed.output, presentCase(CASE_FILE, "AB"), SPORTS, 1));
    expect(result.raw).toEqual(raw);
    expect(result.servedModel).toBe("fake-model-1");
    expect(provider.model).toBe("fake-model-1");
    expect(result.stopReason).toBe("end_turn");
    // Engine usage counts cache reads inside inputTokens; stored usage follows the Anthropic convention.
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 300, cacheReadInputTokens: 200, cacheCreationInputTokens: 0 });

    // The request reuses the reference prompt: system prompt + rubric (+ output format), one user turn, no tools.
    const call = engine.calls[0];
    expect(engine.calls).toHaveLength(1);
    expect(call?.model).toBe("fake-model-1");
    expect(call?.tools).toEqual([]);
    expect(call?.systemPrompt.startsWith(JUDGE_SYSTEM_PROMPT)).toBe(true);
    expect(call?.systemPrompt).toContain(renderRubric(SPORTS));
    expect(call?.systemPrompt).toContain('"confidence"');
    expect(call?.messages).toEqual([
      { role: "user", content: [{ type: "text", text: renderCaseMessage(presentCase(CASE_FILE, "AB"), hashCaseFile(CASE_FILE)) }] },
    ]);
  });

  it("accepts JSON wrapped in a single markdown code fence", async () => {
    const input = passInput("AB");
    const raw = mockRawOutput(input);
    const result = await providerFor(fakeEngine(textEvents("```json\n" + JSON.stringify(raw) + "\n```"))).runPass(input);
    expect(result.ok).toBe(true);
  });

  it("uses the JUDGE_MODEL override when given", async () => {
    const input = passInput("AB");
    const engine = fakeEngine(textEvents(JSON.stringify(mockRawOutput(input))));
    const provider = new EngineJudgeProvider({ resolveEngine: async () => engine, model: "claude-override-1" });
    const result = await provider.runPass(input);
    expect(engine.calls[0]?.model).toBe("claude-override-1");
    expect(result.ok && result.servedModel).toBe("claude-override-1");
  });

  it("returns ok:false when the engine throws (provider down)", async () => {
    const engine = fakeEngine([], { throwAfter: new Error("connect ECONNREFUSED 127.0.0.1:443") });
    const result = await providerFor(engine).runPass(passInput("AB"));
    expect(result).toMatchObject({ ok: false, kind: "provider_error", retryable: true });
    expect(!result.ok && result.error).toMatch(/ECONNREFUSED/u);
  });

  it("returns ok:false when the engine reports a stop error (e.g. no API key configured)", async () => {
    const engine = fakeEngine([
      { type: "stop", reason: "error", error: "No LLM credentials configured", errorCode: "missing_api_key" },
    ]);
    const result = await providerFor(engine).runPass(passInput("AB"));
    expect(result).toMatchObject({ ok: false, kind: "provider_error", retryable: true });
    expect(!result.ok && result.error).toMatch(/No LLM credentials configured/u);
  });

  it("returns ok:false when the engine cannot be resolved at all", async () => {
    const provider = new EngineJudgeProvider({
      resolveEngine: async () => {
        throw new Error("[agent-engine] Default Anthropic engine is not registered.");
      },
    });
    const result = await provider.runPass(passInput("AB"));
    expect(result).toMatchObject({ ok: false, kind: "provider_error", retryable: true });
    expect(!result.ok && result.error).toMatch(/judge provider unavailable/u);
  });

  it("marks a non-retryable provider rejection (4xx) as not retryable", async () => {
    const engine = fakeEngine([{ type: "stop", reason: "error", error: "invalid request", statusCode: 400 }]);
    const result = await providerFor(engine).runPass(passInput("AB"));
    expect(result).toMatchObject({ ok: false, kind: "provider_error", retryable: false });
  });

  it("returns ok:false on malformed JSON", async () => {
    const result = await providerFor(fakeEngine(textEvents("Side X wins, clearly. {not json"))).runPass(passInput("AB"));
    expect(result).toMatchObject({ ok: false, kind: "invalid_output", retryable: true, error: "judge output was not valid JSON" });
  });

  it("returns ok:false on JSON that does not match the rubric's output schema", async () => {
    const input = passInput("AB");
    const raw = mockRawOutput(input) as JudgeRawOutput & { winner: string };
    const broken = { ...raw, winner: "A" };
    const result = await providerFor(fakeEngine(textEvents(JSON.stringify(broken)))).runPass(input);
    expect(result).toMatchObject({ ok: false, kind: "invalid_output", retryable: true });
    expect(!result.ok && result.error).toMatch(/failed validation/u);
  });

  it("returns ok:false when the engine stops early (max_tokens)", async () => {
    const engine = fakeEngine([{ type: "text-delta", text: '{"sides":' }, { type: "stop", reason: "max_tokens" }]);
    const result = await providerFor(engine).runPass(passInput("AB"));
    expect(result).toMatchObject({ ok: false, kind: "invalid_output", retryable: true, stopReason: "max_tokens" });
  });

  it("relabels sides for order BA exactly like AnthropicJudgeProvider", async () => {
    const input = passInput("BA");
    const raw = mockRawOutput(input);
    const text = JSON.stringify(raw);
    const presentation = presentCase(CASE_FILE, "BA");

    const engineResult = await providerFor(fakeEngine(textEvents(text))).runPass(input);
    const anthropicMessage = {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "fake-model-1",
      content: [{ type: "text", text, citations: null }],
      stop_reason: "end_turn",
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } as unknown as Parameters<typeof interpretJudgeMessage>[0];
    const anthropicResult = interpretJudgeMessage(anthropicMessage, input, presentation, 0);

    expect(engineResult.ok && anthropicResult.ok).toBe(true);
    if (!engineResult.ok || !anthropicResult.ok) return;
    expect(engineResult.output).toEqual(anthropicResult.output);
    // BA: Side X is canonical B, so B's scores are the raw X scores.
    expect(presentation.toCanonical).toEqual({ X: "B", Y: "A" });
    for (const c of SPORTS.criteria) {
      expect(engineResult.output.sides.B.criteria[c.key]?.score).toBe(raw.sides.X.criteria[c.key]?.score);
      expect(engineResult.output.sides.A.criteria[c.key]?.score).toBe(raw.sides.Y.criteria[c.key]?.score);
    }
    expect(engineResult.output.order).toBe("BA");
  });
});
