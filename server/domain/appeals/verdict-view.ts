/**
 * Owner: verdict. Pure presentation logic for verdicts: maps blind side labels (A = FOR, B = AGAINST)
 * back to the two named users, words the outcome, and labels confidence. Client-safe, no DB.
 *
 * The judge never saw these names — this is the only place they are joined to the result.
 */
import type { ClaimClassification, ConfidenceLabel, SideLabel } from "@domain/db/json-types";
import type { DecidedBy, VerdictOutcome } from "@domain/db/schema";
import { HIGH_CONFIDENCE_MIN, MEDIUM_CONFIDENCE_MIN } from "@domain/judging/config";

export interface ParticipantView {
  userId: string;
  side: SideLabel;
  stance: "FOR" | "AGAINST";
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
}

export type SidePair = { A: ParticipantView; B: ParticipantView };

export function otherSide(side: SideLabel): SideLabel {
  return side === "A" ? "B" : "A";
}

/** Blind label for a competition side. Side A is always FOR. */
export function sideForStance(stance: "FOR" | "AGAINST"): SideLabel {
  return stance === "FOR" ? "A" : "B";
}

export function winnerSideOf(
  outcome: VerdictOutcome,
  winnerUserId: string | null,
  sides: SidePair,
): SideLabel | null {
  if (outcome === "A" || outcome === "B") return outcome;
  if (outcome === "forfeit" && winnerUserId) {
    if (sides.A.userId === winnerUserId) return "A";
    if (sides.B.userId === winnerUserId) return "B";
  }
  return null;
}

/** The user id that should be recorded as winner for an outcome (null for draw / inconclusive). */
export function winnerUserIdFor(outcome: "A" | "B" | "draw" | "inconclusive", sides: { A: string; B: string }): string | null {
  return outcome === "A" ? sides.A : outcome === "B" ? sides.B : null;
}

/**
 * The banner over a result. Only an AI-judged result may say "The AI verdict is in": a forfeit was decided
 * by the published no-show rule, and a human decision by a reviewer (we never imply the AI judged it).
 */
export function verdictKicker(outcome: VerdictOutcome, decidedBy: DecidedBy): string {
  if (outcome === "forfeit") return "Won by forfeit · no AI judging";
  if (decidedBy === "human") return "Final verdict · human reviewed";
  return "The AI verdict is in";
}

/** Who/what produced a verdict version, for history lists. */
export function verdictSource(outcome: VerdictOutcome, decidedBy: DecidedBy): string {
  if (decidedBy === "human") return "Human decision";
  if (outcome === "forfeit") return "No-show rule";
  return "AI verdict";
}

/** Personal one-liner for notifications: "You won", "You lost", "Draw", "No winner (inconclusive)". */
export function personalOutcomeLabel(outcome: VerdictOutcome, winnerUserId: string | null, userId: string): string {
  if (outcome === "draw") return "Draw";
  if (outcome === "inconclusive") return "No winner (inconclusive)";
  if (!winnerUserId) return "Result updated";
  const won = winnerUserId === userId;
  if (outcome === "forfeit") return won ? "You won by forfeit" : "You lost by forfeit";
  return won ? "You won" : "You lost";
}

export type OutcomeKind = "win" | "draw" | "inconclusive" | "forfeit";

export interface OutcomeView {
  kind: OutcomeKind;
  winnerSide: SideLabel | null;
  /** Big hero line, e.g. "Ada wins". */
  headline: string;
  /** One plain sentence under it. */
  subline: string;
}

export function describeOutcome(outcome: VerdictOutcome, winnerUserId: string | null, sides: SidePair): OutcomeView {
  const winnerSide = winnerSideOf(outcome, winnerUserId, sides);
  if (outcome === "draw") {
    return {
      kind: "draw",
      winnerSide: null,
      headline: "It's a draw",
      subline: "Both sides made an equally strong case under the rubric. Nobody was forced to lose.",
    };
  }
  if (outcome === "inconclusive") {
    return {
      kind: "inconclusive",
      winnerSide: null,
      headline: "No winner: inconclusive",
      subline:
        "The judging passes couldn't confidently separate the two sides, so no winner was forced. Ratings don't change.",
    };
  }
  if (outcome === "forfeit") {
    const winner = winnerSide ? sides[winnerSide] : null;
    const loser = winnerSide ? sides[otherSide(winnerSide)] : null;
    return {
      kind: "forfeit",
      winnerSide,
      headline: winner ? `${winner.displayName} wins by forfeit` : "Won by forfeit",
      subline: loser
        ? `${loser.displayName} didn't submit an opening before the deadline, so there was nothing to judge.`
        : "One side didn't submit an opening before the deadline, so there was nothing to judge.",
    };
  }
  const winner = winnerSide ? sides[winnerSide] : null;
  return {
    kind: "win",
    winnerSide,
    headline: winner ? `${winner.displayName} wins` : "Verdict reached",
    subline: winner
      ? `${winner.displayName} argued ${winner.stance} the proposition and made the stronger case under the rubric.`
      : "One side made the stronger case under the rubric.",
  };
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/** Fallback thresholds when a verdict row has a number but no label (the judge normally sets the label). */
export const CONFIDENCE_THRESHOLDS = { high: HIGH_CONFIDENCE_MIN, medium: MEDIUM_CONFIDENCE_MIN } as const;

export function confidenceLabelFor(confidence: number | null, explicit?: ConfidenceLabel | null): ConfidenceLabel | null {
  if (explicit) return explicit;
  if (confidence === null || Number.isNaN(confidence)) return null;
  if (confidence >= CONFIDENCE_THRESHOLDS.high) return "high";
  if (confidence >= CONFIDENCE_THRESHOLDS.medium) return "medium";
  return "low";
}

export const CONFIDENCE_COPY: Record<ConfidenceLabel, { label: string; description: string }> = {
  high: { label: "High", description: "The independent judging passes agreed, with a clear gap between the sides." },
  medium: { label: "Medium", description: "The passes agreed, but the gap between the sides was modest." },
  low: { label: "Low", description: "The passes found this close or didn't fully agree. Treat it as a narrow call." },
};

export const CLAIM_COPY: Record<ClaimClassification, { label: string; tone: "success" | "neutral" | "warning" | "danger" }> = {
  common_knowledge: { label: "Common knowledge", tone: "success" },
  opinion: { label: "Opinion", tone: "neutral" },
  unsupported: { label: "Unsupported", tone: "warning" },
  likely_false: { label: "Likely false", tone: "danger" },
};

// ---------------------------------------------------------------------------
// Moderated quotes
// ---------------------------------------------------------------------------

const normalise = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Hide verbatim quotes that come from a submission moderators hid or removed (harassment etc.).
 * Moderation never changes the verdict itself — it only stops us re-publishing the hidden words.
 */
export function hideModeratedQuotes(
  quotes: readonly string[],
  hiddenTexts: readonly string[],
): { visible: string[]; hiddenCount: number } {
  if (hiddenTexts.length === 0) return { visible: [...quotes], hiddenCount: 0 };
  const hidden = hiddenTexts.map(normalise);
  const visible: string[] = [];
  let hiddenCount = 0;
  for (const quote of quotes) {
    const q = normalise(quote);
    if (q.length > 0 && hidden.some((h) => h.includes(q))) hiddenCount += 1;
    else visible.push(quote);
  }
  return { visible, hiddenCount };
}

export function displayHandle(p: Pick<ParticipantView, "handle">): string | null {
  return p.handle ? `@${p.handle}` : null;
}
