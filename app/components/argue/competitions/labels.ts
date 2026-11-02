/** Owner: challenges. Plain-language labels for competition phases (PRD Appendix B language). Pure. */
import type { BadgeTone } from "@/components/argue/ui/badge";
import type { Phase } from "@domain/competitions/state-machine";

export const PHASE_LABEL: Record<Phase, string> = {
  pending_acceptance: "Waiting for reply",
  opening: "Round 1 · Openings",
  rebuttal: "Round 2 · Rebuttals",
  locked: "Entries locked",
  evaluating: "AI judge reviewing",
  under_appeal: "Under appeal",
  completed: "Verdict in",
  needs_review: "Human review",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
};

export const PHASE_TONE: Record<Phase, BadgeTone> = {
  pending_acceptance: "warning",
  opening: "success",
  rebuttal: "success",
  locked: "neutral",
  evaluating: "judge",
  under_appeal: "warning",
  completed: "judge",
  needs_review: "warning",
  declined: "outline",
  expired: "outline",
  withdrawn: "outline",
  cancelled: "outline",
};

export const DEADLINE_LABEL: Partial<Record<Phase, string>> = {
  pending_acceptance: "Expires in",
  opening: "Openings close in",
  rebuttal: "Rebuttals close in",
};

/** Phases where something can still change without a user acting (worth auto-refreshing). */
export const LIVE_PHASES: readonly Phase[] = ["pending_acceptance", "opening", "rebuttal", "locked", "evaluating"];
