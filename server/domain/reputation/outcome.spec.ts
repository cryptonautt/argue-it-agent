import { describe, expect, it } from "vitest";
import { averageCriterionScores, strongestCriterion, toAverageRecord } from "./criteria";
import { FORFEIT_WEIGHT, recordColumn, resolveCompetitionOutcome, type OutcomeParticipant } from "./outcome";
import { sampleScores } from "./test-fixtures";

const participants: OutcomeParticipant[] = [
  { userId: "for-user", side: "FOR" },
  { userId: "against-user", side: "AGAINST" },
];
const verdict = (outcome: "A" | "B" | "draw" | "inconclusive" | "forfeit", winnerUserId: string | null = null) => ({
  id: "v1",
  outcome,
  winnerUserId,
});

describe("resolveCompetitionOutcome", () => {
  it("maps A to the FOR side and B to the AGAINST side", () => {
    const a = resolveCompetitionOutcome({ status: "completed", participants, verdict: verdict("A", "for-user") });
    expect(a).toEqual({
      kind: "rated",
      verdictId: "v1",
      results: [
        { userId: "for-user", opponentId: "against-user", score: 1, weight: 1 },
        { userId: "against-user", opponentId: "for-user", score: 0, weight: 1 },
      ],
    });
    const b = resolveCompetitionOutcome({ status: "completed", participants, verdict: verdict("B") });
    expect(b.kind === "rated" && b.results[0].userId).toBe("against-user");
  });

  it("scores a draw 0.5 each", () => {
    const r = resolveCompetitionOutcome({ status: "completed", participants, verdict: verdict("draw") });
    expect(r.kind === "rated" && r.results.map((x) => x.score)).toEqual([0.5, 0.5]);
  });

  it("applies forfeits at half weight to the named winner", () => {
    const r = resolveCompetitionOutcome({ status: "completed", participants, verdict: verdict("forfeit", "against-user") });
    expect(r.kind).toBe("rated");
    if (r.kind !== "rated") return;
    expect(r.results[0]).toEqual({ userId: "against-user", opponentId: "for-user", score: 1, weight: FORFEIT_WEIGHT });
    expect(FORFEIT_WEIGHT).toBe(0.5);
  });

  it.each([
    ["inconclusive verdict", { status: "needs_review" as const, verdict: verdict("inconclusive") }, "inconclusive"],
    ["cancelled competition", { status: "cancelled" as const, verdict: verdict("A") }, "cancelled"],
    ["no verdict", { status: "completed" as const, verdict: null }, "no_verdict"],
    ["forfeit without winner", { status: "completed" as const, verdict: verdict("forfeit") }, "forfeit_without_winner"],
    ["winner not on the winning side", { status: "completed" as const, verdict: verdict("A", "against-user") }, "winner_mismatch"],
    ["forfeit winner not a participant", { status: "completed" as const, verdict: verdict("forfeit", "stranger") }, "winner_mismatch"],
  ])("does not rate: %s", (_label, input, reason) => {
    expect(resolveCompetitionOutcome({ ...input, participants })).toMatchObject({ kind: "unrated", reason });
  });

  it("refuses malformed participant sets", () => {
    for (const bad of [
      [participants[0]!],
      [participants[0]!, { userId: "x", side: "FOR" as const }],
      [participants[0]!, { userId: "for-user", side: "AGAINST" as const }],
    ]) {
      expect(resolveCompetitionOutcome({ status: "completed", participants: bad, verdict: verdict("A") })).toMatchObject({
        kind: "unrated",
        reason: "invalid_participants",
      });
    }
  });

  it("maps scores to record columns", () => {
    expect([recordColumn(1), recordColumn(0.5), recordColumn(0)]).toEqual(["wins", "draws", "losses"]);
  });
});

describe("criterion averages", () => {
  it("averages each criterion over the debates whose rubric had it, ordered by weight", () => {
    const averages = averageCriterionScores([
      { side: "A", scores: sampleScores({ evidence: 8, clarity: 6 }, { evidence: 2, clarity: 2 }) },
      { side: "B", scores: sampleScores({ evidence: 1, clarity: 1, reasoning: 1 }, { evidence: 5, clarity: 9, reasoning: 7 }) },
    ]);
    expect(averages).toEqual([
      { key: "evidence", label: "Evidence", average: 6.5, count: 2 },
      { key: "reasoning", label: "Reasoning", average: 7, count: 1 },
      { key: "clarity", label: "Clarity", average: 7.5, count: 2 },
    ]);
    expect(toAverageRecord(averages)).toEqual({ evidence: 6.5, reasoning: 7, clarity: 7.5 });
    expect(strongestCriterion(averages)?.key).toBe("clarity");
    // Reasoning (7.0) was scored once; requiring 2 debates leaves clarity vs evidence.
    expect(strongestCriterion(averages, { minDebates: 2 })?.key).toBe("clarity");
    expect(strongestCriterion(averages, { minDebates: 3 })).toBeNull();
  });

  it("names no strength when there is a tie at the top or no data", () => {
    expect(strongestCriterion([])).toBeNull();
    expect(
      strongestCriterion([
        { key: "evidence", label: "Evidence", average: 7, count: 1 },
        { key: "clarity", label: "Clarity", average: 7, count: 1 },
      ]),
    ).toBeNull();
  });
});
