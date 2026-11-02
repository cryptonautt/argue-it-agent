/**
 * Pure helpers for a profile's debate history: what a competition's state means *for this user*.
 * Safe to import from client components.
 */
import type { CompetitionSide, CompetitionStatus, VerdictOutcome } from "@domain/db/schema";

/** Competition statuses that appear in a public debate history (never-started challenges are omitted). */
export const HISTORY_STATUSES = [
  "active",
  "locked",
  "evaluating",
  "under_appeal",
  "completed",
  "needs_review",
  "cancelled",
] as const satisfies readonly CompetitionStatus[];
export type HistoryStatus = (typeof HISTORY_STATUSES)[number];

export type DebateResult =
  | "won"
  | "lost"
  | "draw"
  | "won_forfeit"
  | "lost_forfeit"
  | "inconclusive"
  | "in_progress"
  | "awaiting_verdict"
  | "under_review"
  | "cancelled";

export interface DebateResultInput {
  status: CompetitionStatus;
  side: CompetitionSide;
  userId: string;
  verdict: { outcome: VerdictOutcome; winnerUserId: string | null } | null;
}

export function debateResultFor(input: DebateResultInput): DebateResult {
  const { status, verdict } = input;
  if (status === "cancelled") return "cancelled";
  if (status === "active" || status === "pending_acceptance") return "in_progress";
  if (status === "locked" || status === "evaluating") return "awaiting_verdict";
  if (!verdict) return status === "needs_review" ? "under_review" : "awaiting_verdict";
  if (status === "needs_review") return "under_review";

  const mySideLabel = input.side === "FOR" ? "A" : "B";
  switch (verdict.outcome) {
    case "draw":
      return "draw";
    case "inconclusive":
      return "inconclusive";
    case "forfeit":
      return verdict.winnerUserId === input.userId ? "won_forfeit" : "lost_forfeit";
    case "A":
    case "B":
      return verdict.outcome === mySideLabel ? "won" : "lost";
    default: {
      const exhaustive: never = verdict.outcome;
      return exhaustive;
    }
  }
}

export interface DebateResultDisplay {
  label: string;
  tone: "success" | "danger" | "neutral" | "warning" | "outline" | "judge";
  /** True when there is a verdict page worth linking to. */
  hasVerdict: boolean;
}

export const DEBATE_RESULT_DISPLAY: Record<DebateResult, DebateResultDisplay> = {
  won: { label: "Won", tone: "success", hasVerdict: true },
  lost: { label: "Lost", tone: "danger", hasVerdict: true },
  draw: { label: "Draw", tone: "neutral", hasVerdict: true },
  won_forfeit: { label: "Won · forfeit", tone: "success", hasVerdict: true },
  lost_forfeit: { label: "Lost · no-show", tone: "danger", hasVerdict: true },
  inconclusive: { label: "Inconclusive", tone: "warning", hasVerdict: true },
  in_progress: { label: "Live", tone: "outline", hasVerdict: false },
  awaiting_verdict: { label: "Judging", tone: "judge", hasVerdict: false },
  under_review: { label: "Human review", tone: "warning", hasVerdict: true },
  cancelled: { label: "Cancelled", tone: "neutral", hasVerdict: false },
};
