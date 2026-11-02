/**
 * Pure mapping from a competition's state + current verdict to rating results (design §4.5).
 *
 *   A / B (judged winner) → winner 1, loser 0, weight 1
 *   draw                  → 0.5 each, weight 1
 *   forfeit               → winner 1, loser 0, weight 0.5 (half weight — nobody was out-argued)
 *   inconclusive          → no rating change
 *   cancelled competition → no rating change (whatever verdict rows exist)
 *   no current verdict    → no rating change
 *
 * Side A is ALWAYS the FOR side and Side B the AGAINST side (json-types.ts).
 */
import type { CompetitionSide, CompetitionStatus, VerdictOutcome } from "@domain/db/schema";

export const FORFEIT_WEIGHT = 0.5;
export const JUDGED_WEIGHT = 1;

export interface OutcomeParticipant {
  userId: string;
  side: CompetitionSide;
}

export interface OutcomeVerdict {
  id: string;
  outcome: VerdictOutcome;
  winnerUserId: string | null;
}

export interface OutcomeInput {
  status: CompetitionStatus;
  participants: readonly OutcomeParticipant[];
  /** The verdict with is_current = true, if any. */
  verdict: OutcomeVerdict | null;
}

export interface PlayerResult {
  userId: string;
  opponentId: string;
  /** 1 win, 0.5 draw, 0 loss. */
  score: 0 | 0.5 | 1;
  weight: number;
}

export type UnratedReason =
  | "cancelled"
  | "no_verdict"
  | "inconclusive"
  | "invalid_participants"
  | "forfeit_without_winner"
  | "winner_mismatch";

export type ResolvedOutcome =
  | { kind: "rated"; verdictId: string; results: readonly [PlayerResult, PlayerResult] }
  | { kind: "unrated"; reason: UnratedReason; verdictId: string | null };

function pair(winnerId: string, loserId: string, weight: number): readonly [PlayerResult, PlayerResult] {
  return [
    { userId: winnerId, opponentId: loserId, score: 1, weight },
    { userId: loserId, opponentId: winnerId, score: 0, weight },
  ];
}

export function resolveCompetitionOutcome(input: OutcomeInput): ResolvedOutcome {
  const verdictId = input.verdict?.id ?? null;
  if (input.status === "cancelled") return { kind: "unrated", reason: "cancelled", verdictId };
  if (!input.verdict) return { kind: "unrated", reason: "no_verdict", verdictId };

  const forSide = input.participants.filter((p) => p.side === "FOR");
  const againstSide = input.participants.filter((p) => p.side === "AGAINST");
  const forUser = forSide[0];
  const againstUser = againstSide[0];
  if (
    input.participants.length !== 2 ||
    forSide.length !== 1 ||
    againstSide.length !== 1 ||
    !forUser ||
    !againstUser ||
    forUser.userId === againstUser.userId
  ) {
    return { kind: "unrated", reason: "invalid_participants", verdictId };
  }

  const { outcome, winnerUserId } = input.verdict;
  switch (outcome) {
    case "inconclusive":
      return { kind: "unrated", reason: "inconclusive", verdictId };
    case "draw":
      return {
        kind: "rated",
        verdictId: input.verdict.id,
        results: [
          { userId: forUser.userId, opponentId: againstUser.userId, score: 0.5, weight: JUDGED_WEIGHT },
          { userId: againstUser.userId, opponentId: forUser.userId, score: 0.5, weight: JUDGED_WEIGHT },
        ],
      };
    case "A":
    case "B": {
      const winner = outcome === "A" ? forUser : againstUser;
      const loser = outcome === "A" ? againstUser : forUser;
      // A verdict row that names a different winner than its side label is corrupt: refuse to rate it
      // rather than guess (fairness: never move a rating on ambiguous data).
      if (winnerUserId !== null && winnerUserId !== winner.userId) {
        return { kind: "unrated", reason: "winner_mismatch", verdictId };
      }
      return { kind: "rated", verdictId: input.verdict.id, results: pair(winner.userId, loser.userId, JUDGED_WEIGHT) };
    }
    case "forfeit": {
      if (winnerUserId === null) return { kind: "unrated", reason: "forfeit_without_winner", verdictId };
      const winner = [forUser, againstUser].find((p) => p.userId === winnerUserId);
      const loser = [forUser, againstUser].find((p) => p.userId !== winnerUserId);
      if (!winner || !loser) return { kind: "unrated", reason: "winner_mismatch", verdictId };
      return { kind: "rated", verdictId: input.verdict.id, results: pair(winner.userId, loser.userId, FORFEIT_WEIGHT) };
    }
    default: {
      const exhaustive: never = outcome;
      throw new Error(`reputation: unknown verdict outcome ${String(exhaustive)}`);
    }
  }
}

/** W/L/D column a score counts towards. */
export function recordColumn(score: number): "wins" | "losses" | "draws" {
  if (score >= 1) return "wins";
  if (score <= 0) return "losses";
  return "draws";
}
