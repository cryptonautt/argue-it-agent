import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { assembleCaseFile } from "../case-file";
import { INCOHERENT_WINNER_CONFIDENCE_FACTOR, INVALID_QUOTE_CONFIDENCE_PENALTY, JUDGE_MODEL } from "../config";
import { finalizePass, parseJudgeOutput } from "../output-schema";
import { presentCase } from "../presentation";
import { buildJudgeRequest, classifyProviderError, interpretJudgeMessage } from "../providers/anthropic";
import { MockJudgeProvider, mockRawOutput } from "../providers/mock";
import { selectedProviderKind } from "../providers";
import { PROMPT_VERSION } from "../prompt";
import type { CaseFile, JudgePassInput } from "../types";
import { SPORTS, scriptedRaw } from "./fixtures";

const FOR_OPENING = "Messi has 8 Ballon d'Or awards and won the 2022 World Cup. @tunde_fc agrees with me.";
const AGAINST_OPENING = "Ronaldo scored over 130 international goals, which means he is the better finisher.";

function makeCase(): CaseFile {
  return assembleCaseFile({
    proposition: "Lionel Messi is a better footballer than Cristiano Ronaldo.",
    category: { slug: "sports", name: "Sports & Football" },
    rubric: { id: "sports", version: 1 },
    participants: [
      { side: "FOR", handle: "tunde_fc", displayName: "Tunde Bakare", accountName: "Tunde Bakare" },
      { side: "AGAINST", handle: "kemi99", displayName: "Kemi", accountName: "Kemi" },
    ],
    submissions: [
      { id: "s1", side: "FOR", round: "opening", body: FOR_OPENING, links: [] },
      { id: "s2", side: "AGAINST", round: "opening", body: AGAINST_OPENING, links: ["https://example.com/goals"] },
      { id: "s3", side: "AGAINST", round: "rebuttal", body: "Kemi thinks Ballon d'Or votes are popularity contests.", links: [] },
    ],
  }).caseFile;
}

const input = (order: "AB" | "BA", passNo = order === "AB" ? 1 : 2): JudgePassInput => ({
  caseFile: makeCase(),
  rubric: SPORTS,
  passNo,
  order,
  promptVersion: PROMPT_VERSION,
});

describe("order swap and relabelling", () => {
  it("presents B first under label X in the BA pass, and rewrites redaction tokens", () => {
    const presentation = presentCase(makeCase(), "BA");
    expect(presentation.toCanonical).toEqual({ X: "B", Y: "A" });
    const [first, second] = presentation.sides;
    expect(first.stance).toBe("AGAINST");
    expect(second.stance).toBe("FOR");
    // "[Side A]" (the FOR debater's own handle) becomes "[Side Y]" in this reading.
    expect(second.opening?.text).toContain("[Side Y] agrees with me.");
    expect(first.rebuttal?.text).toContain("[Side X] thinks");
  });

  it("maps a BA pass back to canonical labels: winner, scores, quotes and free text", () => {
    const baInput = input("BA");
    const raw = scriptedRaw(baInput, {
      A: { scores: 8, quotes: ["[Side Y] agrees with me."] },
      B: { scores: 4, quotes: ["Ronaldo scored over 130 international goals"] },
      winner: "A",
      confidence: 0.9,
    });
    // Sanity: in presentation terms the FOR side is Y and won.
    expect(raw.winner).toBe("Y");
    const pass = finalizePass(raw, presentCase(baInput.caseFile, "BA"), SPORTS, 2);
    expect(pass.winner).toBe("A");
    expect(pass.statedWinner).toBe("A");
    expect(pass.sides.A.criteria.evidence?.score).toBe(8);
    expect(pass.sides.B.criteria.evidence?.score).toBe(4);
    expect(pass.sides.A.criteria.evidence?.quotes).toEqual(["[Side A] agrees with me."]);
    expect(pass.sides.B.criteria.evidence?.quotes).toEqual(["Ronaldo scored over 130 international goals"]);
    expect(pass.sides.A.criteria.evidence?.reason).toBe("Side A reason for evidence.");
    expect(pass.rationale).toBe("Side A made the stronger case.");
    expect(pass.invalidQuoteCount).toBe(0);
    expect(pass.confidence).toBe(0.9);
  });

  it("AB and BA passes with the same canonical intent produce identical canonical outputs", () => {
    const script = { A: { scores: 7 }, B: { scores: 5 }, winner: "A" as const, confidence: 0.8 };
    const ab = finalizePass(scriptedRaw(input("AB"), script), presentCase(makeCase(), "AB"), SPORTS, 1);
    const ba = finalizePass(scriptedRaw(input("BA"), script), presentCase(makeCase(), "BA"), SPORTS, 2);
    expect(ba.sides).toEqual(ab.sides);
    expect(ba.winner).toBe(ab.winner);
  });
});

describe("finalizePass safeguards", () => {
  it("drops quotes that are not in that side's own text and lowers confidence", () => {
    const abInput = input("AB");
    const raw = scriptedRaw(abInput, {
      // An invented quote and a quote from the OTHER side are both invalid for Side A.
      A: { scores: 8, quotes: ["Messi has 8 Ballon d'Or awards", "Messi scored 900 goals", "Ronaldo scored over 130"] },
      B: { scores: 5, quotes: ["Ronaldo scored over 130 international goals"] },
      winner: "A",
      confidence: 0.9,
    });
    const pass = finalizePass(raw, presentCase(abInput.caseFile, "AB"), SPORTS, 1);
    const criteriaCount = SPORTS.criteria.length;
    expect(pass.sides.A.criteria.evidence?.quotes).toEqual(["Messi has 8 Ballon d'Or awards"]);
    expect(pass.invalidQuoteCount).toBe(2 * criteriaCount);
    expect(pass.confidence).toBe(Math.round((0.9 - 0.3) * 1000) / 1000); // penalty capped at 0.3
    expect(INVALID_QUOTE_CONFIDENCE_PENALTY * 2 * criteriaCount).toBeGreaterThan(0.3);
  });

  it("a stated winner that contradicts the pass's own scores is overridden and confidence cut", () => {
    const abInput = input("AB");
    const raw = scriptedRaw(abInput, { A: { scores: 4 }, B: { scores: 8 }, winner: "A", confidence: 0.9 });
    const pass = finalizePass(raw, presentCase(abInput.caseFile, "AB"), SPORTS, 1);
    expect(pass.statedWinner).toBe("A");
    expect(pass.winner).toBe("B");
    expect(pass.confidence).toBeCloseTo(0.9 * INCOHERENT_WINNER_CONFIDENCE_FACTOR);
  });

  it("rejects output that misses a rubric criterion or has an out-of-range score", () => {
    const raw = scriptedRaw(input("AB"), { A: { scores: 7 }, B: { scores: 5 }, winner: "A", confidence: 0.8 });
    const missing = structuredClone(raw) as { sides: { X: { criteria: Record<string, unknown> } } };
    delete missing.sides.X.criteria.rebuttal;
    expect(parseJudgeOutput(missing, SPORTS).ok).toBe(false);
    const outOfRange = structuredClone(raw);
    const evidence = outOfRange.sides.X.criteria.evidence;
    if (evidence) evidence.score = 11;
    expect(parseJudgeOutput(outOfRange, SPORTS).ok).toBe(false);
    expect(parseJudgeOutput(raw, SPORTS).ok).toBe(true);
  });
});

describe("MockJudgeProvider", () => {
  it("is deterministic, schema-valid and order-independent", async () => {
    const mock = new MockJudgeProvider();
    const ab1 = await mock.runPass(input("AB"));
    const ab2 = await mock.runPass(input("AB"));
    const ba = await mock.runPass(input("BA"));
    if (!ab1.ok || !ab2.ok || !ba.ok) throw new Error("mock failed");
    expect(ab1.output).toEqual(ab2.output);
    expect(parseJudgeOutput(mockRawOutput(input("BA")), SPORTS).ok).toBe(true);
    expect(ba.output.sides).toEqual(ab1.output.sides);
    expect(ba.output.winner).toBe(ab1.output.winner);
    expect(ab1.output.invalidQuoteCount).toBe(0);
  });

  it("is selected when no API key is set or JUDGE_PROVIDER=mock", () => {
    expect(selectedProviderKind({})).toBe("mock");
    expect(selectedProviderKind({ ANTHROPIC_API_KEY: "k", JUDGE_PROVIDER: "mock" })).toBe("mock");
    expect(selectedProviderKind({ ANTHROPIC_API_KEY: "k" })).toBe("anthropic");
  });
});

describe("Anthropic request", () => {
  it("uses the required model/thinking/effort/fallback shape and no forbidden parameters", () => {
    const { params } = buildJudgeRequest(input("AB"), "abcdef0123456789ffff");
    expect(params.model).toBe(JUDGE_MODEL);
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config.effort).toBe("high");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
    const body = params as Record<string, unknown>;
    for (const forbidden of ["temperature", "top_p", "top_k", "tool_choice", "tools"]) expect(body).not.toHaveProperty(forbidden);
    expect(params.messages).toHaveLength(1);
    expect(params.messages[0]?.role).toBe("user");
    // Stable prefix first; rubric block carries the cache breakpoint.
    expect(params.system[1]?.cache_control).toEqual({ type: "ephemeral" });
    expect(params.system[0]).not.toHaveProperty("cache_control");
  });

  it("sends a structured-output schema the API accepts: closed objects, every criterion required, no numeric bounds", () => {
    const { params } = buildJudgeRequest(input("AB"), "abcdef0123456789ffff");
    const schema = JSON.stringify(params.output_config.format.schema);
    expect(schema).not.toMatch(/"(?:minimum|maximum|exclusiveMinimum|exclusiveMaximum|minLength|maxLength)"/u);
    const objects: Array<Record<string, unknown>> = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (obj.type === "object") objects.push(obj);
      Object.values(obj).forEach(walk);
    };
    walk(params.output_config.format.schema);
    expect(objects.length).toBeGreaterThan(3);
    for (const obj of objects) expect(obj.additionalProperties).toBe(false);
    expect(schema).toContain('"rebuttal"');
  });

  it("puts submissions in delimited data blocks and never shows canonical side labels or identities", () => {
    const { params } = buildJudgeRequest(input("BA"), "abcdef0123456789ffff");
    const message = params.messages[0]?.content ?? "";
    expect(message).toContain("<<<DATA-ABCDEF0123456789 BEGIN side=\"Side X\" round=\"opening\">>>");
    expect(message).toContain("<<<DATA-ABCDEF0123456789 END>>>");
    expect(message).not.toMatch(/Side [AB]\b/u);
    expect(message.toLowerCase()).not.toContain("tunde");
    expect(message.toLowerCase()).not.toContain("kemi");
    expect(message.indexOf("argues AGAINST")).toBeLessThan(message.indexOf("argues FOR"));
  });

  const message = (overrides: Partial<Anthropic.Beta.BetaMessage>): Anthropic.Beta.BetaMessage =>
    ({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: JUDGE_MODEL,
      content: [],
      stop_reason: "end_turn",
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 },
      ...overrides,
    }) as unknown as Anthropic.Beta.BetaMessage;

  it("checks stop_reason first: a refusal is a non-retryable failed pass", () => {
    const passInput = input("AB");
    const result = interpretJudgeMessage(
      message({
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "general_harms", explanation: null } as unknown as Anthropic.Beta.BetaMessage["stop_details"],
        content: [{ type: "text", text: "not json", citations: null } as Anthropic.Beta.BetaTextBlock],
      }),
      passInput,
      presentCase(passInput.caseFile, "AB"),
      12,
    );
    expect(result).toMatchObject({ ok: false, kind: "refusal", retryable: false, stopReason: "refusal" });
  });

  it("truncated or malformed output is a retryable invalid_output, valid JSON becomes a pass", () => {
    const passInput = input("AB");
    const presentation = presentCase(passInput.caseFile, "AB");
    expect(interpretJudgeMessage(message({ stop_reason: "max_tokens" }), passInput, presentation, 1)).toMatchObject({
      ok: false,
      kind: "invalid_output",
      retryable: true,
    });
    const text = (t: string) => [{ type: "text", text: t, citations: null } as Anthropic.Beta.BetaTextBlock];
    expect(interpretJudgeMessage(message({ content: text("{oops") }), passInput, presentation, 1)).toMatchObject({
      ok: false,
      kind: "invalid_output",
    });
    const raw = scriptedRaw(passInput, { A: { scores: 7 }, B: { scores: 5 }, winner: "A", confidence: 0.8 });
    const ok = interpretJudgeMessage(message({ content: text(JSON.stringify(raw)) }), passInput, presentation, 42);
    expect(ok).toMatchObject({ ok: true, latencyMs: 42, usage: { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 5 } });
  });

  it("classifies transient provider errors as retryable", () => {
    expect(classifyProviderError(new Anthropic.APIConnectionTimeoutError())).toMatchObject({ kind: "timeout", retryable: true });
    expect(classifyProviderError(new Error("boom")).retryable).toBe(true);
  });
});
