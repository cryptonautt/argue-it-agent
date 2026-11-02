/**
 * comparePasses thresholds (design §4.3.3) and rubric parity (§4.3.5). Owner: fairness.
 *
 * The design numbers (0.6 confidence, 3% of max for a draw) are asserted literally so a silent change to
 * the judge's config constants fails here and gets reviewed.
 */
import { describe, expect, it } from "vitest";
import { CATEGORY_SEED } from "@domain/db/categories-seed";
import {
  comparePasses,
  DRAW_MARGIN_POINTS,
  getRubric,
  MAX_TOTAL,
  MIN_DECISION_CONFIDENCE,
  type PassOutput,
  type RubricDef,
} from "@domain/judging";
import { pass, rubricOrThrow } from "./helpers";

const sports = rubricOrThrow("sports");

/** Swap A and B everywhere in a pass (what the passes would look like if the sides traded places). */
function mirror(p: PassOutput): PassOutput {
  const flip = (w: PassOutput["winner"]) => (w === "A" ? "B" : w === "B" ? "A" : "draw");
  return { ...p, sides: { A: p.sides.B, B: p.sides.A }, winner: flip(p.winner) };
}

describe("design thresholds", () => {
  it("are the documented values", () => {
    expect(MIN_DECISION_CONFIDENCE).toBe(0.6);
    expect(MAX_TOTAL).toBe(100);
    expect(DRAW_MARGIN_POINTS).toBe(3);
  });
});

describe("comparePasses — two passes", () => {
  it("decides for a side when both passes agree with confidence >= 0.6", () => {
    const r = comparePasses([pass(sports, { passNo: 1, a: 8, b: 4, confidence: 0.8 }), pass(sports, { passNo: 2, a: 7, b: 4, confidence: 0.7 })], sports);
    expect(r).toMatchObject({ kind: "decided", outcome: "A" });
  });

  it("decides at exactly the 0.6 boundary", () => {
    const r = comparePasses([pass(sports, { passNo: 1, a: 3, b: 8, confidence: 0.6 }), pass(sports, { passNo: 2, a: 3, b: 8, confidence: 0.9 })], sports);
    expect(r).toMatchObject({ kind: "decided", outcome: "B" });
  });

  it("never forces a winner when either pass is unsure (min confidence < 0.6)", () => {
    const r = comparePasses([pass(sports, { passNo: 1, a: 8, b: 4, confidence: 0.95 }), pass(sports, { passNo: 2, a: 8, b: 4, confidence: 0.59 })], sports);
    expect(r.kind).not.toBe("decided");
  });

  it("calls a draw when both passes say draw", () => {
    const r = comparePasses([pass(sports, { passNo: 1, a: 6, b: 6, confidence: 0.7 }), pass(sports, { passNo: 2, a: 6, b: 6, confidence: 0.4 })], sports);
    expect(r).toMatchObject({ kind: "decided", outcome: "draw" });
  });

  it("calls a draw when one pass says draw and the averaged margin is below 3% of the maximum", () => {
    // Pass 1: 61-60 (draw band). Pass 2: 64-60 (A by 4). Averaged margin 2.5 < 3 → too close to name a winner.
    const p1 = pass(sports, { passNo: 1, a: 6.1, b: 6, confidence: 0.9 });
    const p2 = pass(sports, { passNo: 2, a: 6.4, b: 6, confidence: 0.9 });
    expect([p1.winner, p2.winner]).toEqual(["draw", "A"]);
    expect(comparePasses([p1, p2], sports)).toMatchObject({ kind: "decided", outcome: "draw" });
  });

  it("asks for a third pass when one pass says draw but the other has a clear winner", () => {
    const r = comparePasses([pass(sports, { passNo: 1, a: 6, b: 6, confidence: 0.9 }), pass(sports, { passNo: 2, a: 9, b: 4, confidence: 0.9 })], sports);
    expect(r.kind).toBe("needs_another_pass");
  });

  it("asks for a third pass when the passes pick different winners", () => {
    const r = comparePasses([pass(sports, { passNo: 1, a: 8, b: 4, confidence: 0.9 }), pass(sports, { passNo: 2, a: 4, b: 8, confidence: 0.9 })], sports);
    expect(r.kind).toBe("needs_another_pass");
  });

  it("needs two passes before deciding anything", () => {
    expect(comparePasses([pass(sports, { passNo: 1, a: 10, b: 0, confidence: 1 })], sports).kind).toBe("needs_another_pass");
  });

  it("reports weighted totals on a 0-100 scale for each pass", () => {
    const r = comparePasses([pass(sports, { passNo: 1, a: 10, b: 0, confidence: 0.9 }), pass(sports, { passNo: 2, a: 7, b: 2, confidence: 0.9 })], sports);
    expect(r.totals.map((t) => [t.A, t.B])).toEqual([
      [100, 0],
      [70, 20],
    ]);
  });
});

describe("comparePasses — four passes (order-balanced extra pair)", () => {
  const split = [pass(sports, { passNo: 1, a: 8, b: 4, confidence: 0.9 }), pass(sports, { passNo: 2, a: 4, b: 8, confidence: 0.9 })];

  it("lets a confident 3-of-4 majority that matches the summed totals decide", () => {
    const r = comparePasses(
      [...split, pass(sports, { passNo: 3, a: 8, b: 3, confidence: 0.8 }), pass(sports, { passNo: 4, a: 8, b: 4, confidence: 0.8 })],
      sports,
    );
    expect(r).toMatchObject({ kind: "decided", outcome: "A" });
  });

  it("goes to human review when the majority's average confidence is below 0.6", () => {
    const weak = [pass(sports, { passNo: 1, a: 8, b: 4, confidence: 0.5 }), pass(sports, { passNo: 2, a: 4, b: 8, confidence: 0.9 })];
    const r = comparePasses(
      [...weak, pass(sports, { passNo: 3, a: 8, b: 4, confidence: 0.6 }), pass(sports, { passNo: 4, a: 8, b: 4, confidence: 0.6 })],
      sports,
    );
    expect(r.kind).toBe("inconclusive");
  });

  it("goes to human review on a 2-2 split", () => {
    const r = comparePasses(
      [...split, pass(sports, { passNo: 3, a: 8, b: 4, confidence: 0.9 }), pass(sports, { passNo: 4, a: 4, b: 8, confidence: 0.9 })],
      sports,
    );
    expect(r.kind).toBe("inconclusive");
  });

  it("asks for Pass 4 after three passes, and never asks again after four", () => {
    for (const third of [
      { a: 8, b: 3, confidence: 0.9 },
      { a: 3, b: 8, confidence: 0.2 },
      { a: 5, b: 5, confidence: 0.9 },
    ]) {
      const three = [...split, pass(sports, { passNo: 3, ...third })];
      expect(comparePasses(three, sports).kind).toBe("needs_another_pass");
      expect(comparePasses([...three, pass(sports, { passNo: 4, ...third })], sports).kind).not.toBe("needs_another_pass");
    }
  });
});

describe("comparePasses — fairness properties", () => {
  const scenarios: PassOutput[][] = [
    [pass(sports, { passNo: 1, a: 8, b: 4, confidence: 0.8 }), pass(sports, { passNo: 2, a: 7, b: 5, confidence: 0.7 })],
    [
      pass(sports, { passNo: 1, a: 8, b: 4, confidence: 0.9 }),
      pass(sports, { passNo: 2, a: 4, b: 8, confidence: 0.9 }),
      pass(sports, { passNo: 3, a: 3, b: 8, confidence: 0.8 }),
      pass(sports, { passNo: 4, a: 4, b: 8, confidence: 0.7 }),
    ],
    [pass(sports, { passNo: 1, a: 6, b: 6, confidence: 0.9 }), pass(sports, { passNo: 2, a: 6, b: 6, confidence: 0.9 })],
    [pass(sports, { passNo: 1, a: 9, b: 2, confidence: 0.55 }), pass(sports, { passNo: 2, a: 9, b: 2, confidence: 0.9 })],
  ];

  it.each(scenarios.map((s, i) => [i, s] as const))("scenario %i: swapping the sides swaps the outcome (no label favouritism)", (_i, passes) => {
    const original = comparePasses(passes, sports);
    const swapped = comparePasses(passes.map(mirror), sports);
    expect(swapped.kind).toBe(original.kind);
    if (original.kind === "decided" && swapped.kind === "decided") {
      const flipped = original.outcome === "A" ? "B" : original.outcome === "B" ? "A" : "draw";
      expect(swapped.outcome).toBe(flipped);
      expect(swapped.confidence).toBe(original.confidence);
    }
  });

  it.each(scenarios.map((s, i) => [i, s] as const))("scenario %i: the order passes are supplied in does not matter", (_i, passes) => {
    expect(comparePasses([...passes].reverse(), sports)).toEqual(comparePasses(passes, sports));
  });
});

describe("rubrics", () => {
  const all: RubricDef[] = CATEGORY_SEED.map((c) => {
    const rubric = getRubric(c.rubricId, 1);
    if (!rubric) throw new Error(`category ${c.slug} has no rubric ${c.rubricId}@1`);
    return rubric;
  });

  it("every launch category maps to a v1 rubric that lists it", () => {
    for (const [i, c] of CATEGORY_SEED.entries()) expect(all[i]?.categorySlugs).toContain(c.slug);
  });

  it.each(all.map((r) => [`${r.id}@${r.version}`, r] as const))("%s weights sum to 100 with unique keys and guidance", (_k, rubric) => {
    expect(rubric.criteria.reduce((s, c) => s + c.weight, 0)).toBe(100);
    expect(new Set(rubric.criteria.map((c) => c.key)).size).toBe(rubric.criteria.length);
    for (const c of rubric.criteria) {
      expect(c.weight).toBeGreaterThan(0);
      expect(c.guidance.length).toBeGreaterThan(10);
    }
  });

  it("the subjective rubric does not score evidence accuracy (taste is not fact)", () => {
    const subjective = getRubric("subjective", 1);
    expect(subjective?.criteria.map((c) => c.key)).not.toContain("evidence");
  });

  it("unknown rubric versions are not silently substituted", () => {
    expect(getRubric("sports", 999)).toBeUndefined();
    expect(getRubric("nope", 1)).toBeUndefined();
  });
});
