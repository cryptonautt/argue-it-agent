/**
 * Owner: challenges. Who may read which submission, and when (design §4.2 "sealed openings"). PURE.
 *
 * Rules:
 * - You always see your own submissions (including unlocked drafts).
 * - Nobody else — the opponent, spectators, staff — sees a side's opening until the opening round has
 *   closed (both locked, or the deadline). Rebuttals are likewise sealed until the rebuttal round closes,
 *   so neither side can tailor a rebuttal to the other's rebuttal.
 * - A round that never closed (cancelled mid-round) stays sealed forever.
 * - Moderated (hidden/removed) submissions show a placeholder to everyone but their author. Moderation
 *   never changes judging (design §4.7) — the judge reads the frozen text regardless.
 */
import type { CompetitionRound, CompetitionStatus, ContentStatus } from "@domain/db/schema";

export interface RevealState {
  status: CompetitionStatus;
  round: CompetitionRound | null;
  lockedAt: Date | string | null;
}

/** True once `round` has closed, so its submissions can be shown to everyone. */
export function isRoundRevealed(state: RevealState, round: CompetitionRound): boolean {
  // Entries were frozen (rebuttal close, forfeit, no-show): every round has closed.
  if (state.lockedAt !== null) return true;
  if (round === "rebuttal") return false;
  // The opening round has closed iff the competition reached (or was cancelled in) the rebuttal round.
  return (state.status === "active" || state.status === "cancelled") && state.round === "rebuttal";
}

export type SubmissionVisibility = "visible" | "sealed" | "moderated";

export function submissionVisibility(input: {
  state: RevealState;
  round: CompetitionRound;
  viewerIsAuthor: boolean;
  submissionStatus: ContentStatus;
}): SubmissionVisibility {
  if (input.viewerIsAuthor) return "visible";
  if (!isRoundRevealed(input.state, input.round)) return "sealed";
  return input.submissionStatus === "visible" ? "visible" : "moderated";
}
