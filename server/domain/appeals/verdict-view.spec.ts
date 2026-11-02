import { describe, expect, it } from "vitest";
import { readComparison, readPassOutput } from "./pass-output";
import {
  confidenceLabelFor,
  describeOutcome,
  hideModeratedQuotes,
  personalOutcomeLabel,
  winnerSideOf,
  winnerUserIdFor,
  type SidePair,
} from "./verdict-view";

const sides: SidePair = {
  A: { userId: "u-ada", side: "A", stance: "FOR", handle: "ada", displayName: "Ada", avatarUrl: null },
  B: { userId: "u-bayo", side: "B", stance: "AGAINST", handle: "bayo", displayName: "Bayo", avatarUrl: null },
};

describe("describeOutcome", () => {
  it("names the winner and their stance", () => {
    expect(describeOutcome("A", "u-ada", sides)).toMatchObject({ kind: "win", winnerSide: "A", headline: "Ada wins" });
    const b = describeOutcome("B", "u-bayo", sides);
    expect(b).toMatchObject({ kind: "win", winnerSide: "B", headline: "Bayo wins" });
    expect(b.subline).toContain("AGAINST");
  });

  it("names the forfeit winner from winner_user_id and the side that didn't show", () => {
    const view = describeOutcome("forfeit", "u-bayo", sides);
    expect(view).toMatchObject({ kind: "forfeit", winnerSide: "B", headline: "Bayo wins by forfeit" });
    expect(view.subline).toContain("Ada didn't submit an opening");
  });

  it("never names a winner for draw or inconclusive", () => {
    expect(describeOutcome("draw", null, sides)).toMatchObject({ kind: "draw", winnerSide: null });
    const inconclusive = describeOutcome("inconclusive", null, sides);
    expect(inconclusive).toMatchObject({ kind: "inconclusive", winnerSide: null });
    expect(inconclusive.subline).toContain("no winner was forced");
  });
});

describe("winner mapping", () => {
  it("maps outcomes to sides and users", () => {
    expect(winnerSideOf("A", null, sides)).toBe("A");
    expect(winnerSideOf("forfeit", "u-ada", sides)).toBe("A");
    expect(winnerSideOf("forfeit", "stranger", sides)).toBeNull();
    expect(winnerSideOf("draw", "u-ada", sides)).toBeNull();
    expect(winnerUserIdFor("A", { A: "a", B: "b" })).toBe("a");
    expect(winnerUserIdFor("B", { A: "a", B: "b" })).toBe("b");
    expect(winnerUserIdFor("draw", { A: "a", B: "b" })).toBeNull();
    expect(winnerUserIdFor("inconclusive", { A: "a", B: "b" })).toBeNull();
  });
});

describe("personalOutcomeLabel", () => {
  it("speaks to each debater", () => {
    expect(personalOutcomeLabel("A", "u-ada", "u-ada")).toBe("You won");
    expect(personalOutcomeLabel("A", "u-ada", "u-bayo")).toBe("You lost");
    expect(personalOutcomeLabel("forfeit", "u-bayo", "u-bayo")).toBe("You won by forfeit");
    expect(personalOutcomeLabel("draw", null, "u-ada")).toBe("Draw");
    expect(personalOutcomeLabel("inconclusive", null, "u-ada")).toBe("No winner (inconclusive)");
  });
});

describe("confidenceLabelFor", () => {
  it("prefers the judge's label and falls back to thresholds", () => {
    expect(confidenceLabelFor(0.2, "high")).toBe("high");
    expect(confidenceLabelFor(0.9)).toBe("high");
    expect(confidenceLabelFor(0.8)).toBe("high");
    expect(confidenceLabelFor(0.65)).toBe("medium");
    expect(confidenceLabelFor(0.4)).toBe("low");
    expect(confidenceLabelFor(null)).toBeNull();
  });
});

describe("hideModeratedQuotes", () => {
  it("withholds quotes that come from a hidden submission, whitespace- and case-insensitively", () => {
    const hidden = ["You are an idiot and   everyone\nknows it. Messi has 8 Ballon d'Ors."];
    const result = hideModeratedQuotes(["everyone knows it", "Ronaldo scored 140 UCL goals"], hidden);
    expect(result).toEqual({ visible: ["Ronaldo scored 140 UCL goals"], hiddenCount: 1 });
  });

  it("keeps everything when nothing is hidden", () => {
    expect(hideModeratedQuotes(["a", "b"], [])).toEqual({ visible: ["a", "b"], hiddenCount: 0 });
  });
});

describe("pass readers", () => {
  it("reads a canonical pass output and tolerates junk", () => {
    const parsed = readPassOutput({
      winner: "A",
      margin: 12,
      confidence: 0.8,
      rationale: "A had evidence",
      sides: {
        A: { criteria: { evidence: { score: 8, reason: "stats", quotes: [] } } },
        B: { criteria: { evidence: { score: 5, reason: "assertion", quotes: [] } } },
      },
    });
    expect(parsed).toMatchObject({ winner: "A", confidence: 0.8, criteria: [{ key: "evidence", A: 8, B: 5 }] });
    const stored = readPassOutput({
      raw: { sides: { X: {}, Y: {} } },
      labels: { X: "B", Y: "A" },
      pass: { winner: "B", sides: { A: { criteria: { evidence: { score: 4 } } }, B: { criteria: { evidence: { score: 9 } } } } },
    });
    expect(stored).toMatchObject({ winner: "B", criteria: [{ key: "evidence", A: 4, B: 9 }] });
    expect(readPassOutput(null)).toBeNull();
    expect(readPassOutput({ sides: "nope" })).toBeNull();
    expect(readPassOutput("string")).toBeNull();
  });

  it("reads comparison totals and skips malformed rows", () => {
    const view = readComparison({
      kind: "needs_another_pass",
      reason: "passes disagree",
      totals: [{ passNo: 1, A: 70, B: 60, winner: "A", confidence: 0.7 }, { passNo: "x" }, null],
    });
    expect(view).toEqual({
      kind: "needs_another_pass",
      reason: "passes disagree",
      totals: [{ passNo: 1, A: 70, B: 60, winner: "A", confidence: 0.7 }],
    });
    expect(readComparison(undefined)).toBeNull();
  });
});
