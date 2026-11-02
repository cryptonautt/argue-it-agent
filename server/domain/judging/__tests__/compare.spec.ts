import { describe, expect, it } from "vitest";
import { comparePasses } from "../compare";
import { DRAW_MARGIN_POINTS, MIN_DECISION_CONFIDENCE } from "../config";
import { ALL_RUBRICS, getRubric, getRubricForCategory, rubricWeightTotal } from "../rubrics";
import { buildVerdictDraft, confidenceLabel } from "../verdict";
import { SPORTS, passOutput } from "./fixtures";

describe("rubrics", () => {
  it("every rubric's weights sum to 100 and keys are unique", () => {
    for (const rubric of ALL_RUBRICS) {
      expect(rubricWeightTotal(rubric)).toBe(100);
      expect(new Set(rubric.criteria.map((c) => c.key)).size).toBe(rubric.criteria.length);
    }
  });

  it("maps categories to the v1 rubrics (design §4.3.5)", () => {
    expect(getRubricForCategory("sports")?.id).toBe("sports");
    expect(getRubricForCategory("technology")?.id).toBe("technology");
    expect(getRubricForCategory("crypto")?.id).toBe("factual");
    expect(getRubricForCategory("entertainment")?.id).toBe("subjective");
    expect(getRubricForCategory("gaming")?.id).toBe("analytical");
    expect(getRubric("sports", 1)).toBe(SPORTS);
    expect(getRubric("sports", 2)).toBeUndefined();
  });

  it("the subjective rubric has no evidence-accuracy criterion and warns against taste-as-fact", () => {
    const subjective = getRubric("subjective", 1);
    expect(subjective?.criteria.map((c) => c.key)).not.toContain("evidence");
    expect(subjective?.criteria.find((c) => c.key === "justification")?.guidance).toMatch(/taste is not fact/i);
  });
});

describe("comparePasses", () => {
  it("needs two passes", () => {
    expect(comparePasses([passOutput(1, "AB", 8, 5, "A", 0.9)], SPORTS).kind).toBe("needs_another_pass");
  });

  it("agreeing passes with enough confidence decide the winner", () => {
    const result = comparePasses([passOutput(1, "AB", 8, 5, "A", 0.9), passOutput(2, "BA", 7, 5, "A", 0.7)], SPORTS);
    expect(result).toMatchObject({ kind: "decided", outcome: "A", confidence: 0.8 });
    if (result.kind !== "decided") throw new Error("expected decided");
    expect(result.totals.map((t) => [t.A, t.B])).toEqual([
      [80, 50],
      [70, 50],
    ]);
  });

  it("disagreeing passes ask for the extra order-balanced pair", () => {
    const result = comparePasses([passOutput(1, "AB", 8, 5, "A", 0.9), passOutput(2, "BA", 5, 8, "B", 0.9)], SPORTS);
    expect(result.kind).toBe("needs_another_pass");
  });

  it("agreement with low confidence is inconclusive, never a forced winner", () => {
    const result = comparePasses(
      [passOutput(1, "AB", 8, 5, "A", 0.9), passOutput(2, "BA", 7, 5, "A", MIN_DECISION_CONFIDENCE - 0.01)],
      SPORTS,
    );
    expect(result.kind).toBe("inconclusive");
  });

  it("confidence exactly at the threshold decides", () => {
    const result = comparePasses(
      [passOutput(1, "AB", 8, 5, "A", MIN_DECISION_CONFIDENCE), passOutput(2, "BA", 8, 5, "A", MIN_DECISION_CONFIDENCE)],
      SPORTS,
    );
    expect(result).toMatchObject({ kind: "decided", outcome: "A" });
  });

  it("both passes calling a draw is a draw", () => {
    const result = comparePasses([passOutput(1, "AB", 6, 6, "draw", 0.4), passOutput(2, "BA", 6, 6, "draw", 0.5)], SPORTS);
    expect(result).toMatchObject({ kind: "decided", outcome: "draw" });
  });

  it("an averaged margin under 3% of max is a draw even if both passes lean the same way", () => {
    // Per-pass totals 62 vs 60 and 63 vs 60 → winner fields say A, but the averaged margin is 2.5 < 3.
    const p1 = passOutput(1, "AB", 6.2, 6, "A", 0.9);
    const p2 = passOutput(2, "BA", 6.3, 6, "A", 0.9);
    expect(DRAW_MARGIN_POINTS).toBe(3);
    expect(comparePasses([p1, p2], SPORTS)).toMatchObject({ kind: "decided", outcome: "draw" });
  });

  it("draw + clear winner disagree → Pass 3; draw + slight lean → draw", () => {
    expect(comparePasses([passOutput(1, "AB", 6, 6, "draw", 0.8), passOutput(2, "BA", 9, 5, "A", 0.8)], SPORTS).kind).toBe(
      "needs_another_pass",
    );
    expect(comparePasses([passOutput(1, "AB", 6, 6, "draw", 0.8), passOutput(2, "BA", 6.5, 6, "A", 0.8)], SPORTS)).toMatchObject({
      kind: "decided",
      outcome: "draw",
    });
  });

  it("three passes are never enough: the extra pass must come as an order-balanced pair", () => {
    const result = comparePasses(
      [passOutput(1, "AB", 8, 5, "A", 0.9), passOutput(2, "BA", 5, 8, "B", 0.9), passOutput(3, "AB", 8, 6, "A", 0.7)],
      SPORTS,
    );
    expect(result.kind).toBe("needs_another_pass");
  });

  it("four passes: 3 of 4 agreeing with the summed totals, confidently, decides", () => {
    const result = comparePasses(
      [
        passOutput(1, "AB", 8, 5, "A", 0.9),
        passOutput(2, "BA", 5, 8, "B", 0.9),
        passOutput(3, "AB", 8, 6, "A", 0.7),
        passOutput(4, "BA", 8, 5, "A", 0.8),
      ],
      SPORTS,
    );
    expect(result).toMatchObject({ kind: "decided", outcome: "A", confidence: 0.8 });
  });

  it("four passes: a 2-2 split is inconclusive, never a forced winner", () => {
    expect(
      comparePasses(
        [
          passOutput(1, "AB", 8, 5, "A", 0.9),
          passOutput(2, "BA", 5, 8, "B", 0.9),
          passOutput(3, "AB", 9, 5, "A", 0.9),
          passOutput(4, "BA", 5, 8, "B", 0.9),
        ],
        SPORTS,
      ).kind,
    ).toBe("inconclusive");
  });

  it("four passes: an unsure majority, or a majority the summed totals contradict, is inconclusive", () => {
    expect(
      comparePasses(
        [
          passOutput(1, "AB", 8, 5, "A", 0.5),
          passOutput(2, "BA", 5, 8, "B", 0.9),
          passOutput(3, "AB", 8, 6, "A", 0.6),
          passOutput(4, "BA", 8, 6, "A", 0.6),
        ],
        SPORTS,
      ).kind,
    ).toBe("inconclusive");
    // Three narrow A wins, one crushing B win: the summed totals favour B, which only one pass chose.
    expect(
      comparePasses(
        [
          passOutput(1, "AB", 6.4, 6, "A", 0.9),
          passOutput(2, "BA", 0, 10, "B", 0.9),
          passOutput(3, "AB", 6.4, 6, "A", 0.9),
          passOutput(4, "BA", 6.4, 6, "A", 0.9),
        ],
        SPORTS,
      ).kind,
    ).toBe("inconclusive");
  });
});

describe("buildVerdictDraft", () => {
  it("averages the deciding passes and keeps totals consistent with the bars", () => {
    const passes = [
      passOutput(1, "AB", 8, 5, "A", 0.9),
      passOutput(2, "BA", 5, 8, "B", 0.9),
      passOutput(3, "AB", 6, 4, "A", 0.7),
      passOutput(4, "BA", 7, 4.5, "A", 0.8),
    ];
    const result = comparePasses(passes, SPORTS);
    const draft = buildVerdictDraft(passes, result, SPORTS, { model: "m", promptVersion: "p", injectionDetected: false });
    expect(draft.outcome).toBe("A");
    expect(draft.scores.criteria.every((c) => c.A === 7 && c.B === 4.5)).toBe(true);
    expect(draft.scores.totals).toEqual({ A: 70, B: 45 });
    expect(draft.explanation.method).toMatchObject({ blind: true, passCount: 4, orders: ["AB", "BA", "AB", "BA"] });
    expect(draft.explanation.summary).toMatch(/four independent readings/);
    expect(draft.explanation.confidenceLabel).toBe("high"); // agreeing passes average 0.8
  });

  it("labels confidence high / medium / low", () => {
    expect(confidenceLabel(0.85)).toBe("high");
    expect(confidenceLabel(0.6)).toBe("medium");
    expect(confidenceLabel(0.59)).toBe("low");
  });
});
