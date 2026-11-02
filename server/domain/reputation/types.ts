/**
 * Reputation types and constants (design §4.5). Pure — safe to import from client components.
 * Re-exported by `@domain/reputation`.
 */
import { DEFAULT_GLICKO2_CONFIG } from "./glicko2";

export const RATING_DEFAULTS = {
  rating: DEFAULT_GLICKO2_CONFIG.defaultRating,
  rd: DEFAULT_GLICKO2_CONFIG.defaultRd,
  volatility: DEFAULT_GLICKO2_CONFIG.defaultVolatility,
} as const;

/** Ratings with RD above this show a "provisional" badge. */
export const PROVISIONAL_RD = 110;

export function isProvisional(rd: number): boolean {
  return rd > PROVISIONAL_RD;
}

export interface RatingLine {
  rating: number;
  rd: number;
  provisional: boolean;
  wins: number;
  losses: number;
  draws: number;
}

export interface CategoryRatingLine extends RatingLine {
  categoryId: string;
  slug: string;
  name: string;
}

export interface UserRatingSummary {
  userId: string;
  overall: RatingLine;
  categories: CategoryRatingLine[];
  /** Average rubric score (0–10) per criterion key across completed judged competitions. */
  averageCriterionScores: Record<string, number>;
  completedCompetitions: number;
}

/** What one applyCompetitionResult() call did (for tests, admin tooling and logs). */
export interface ApplyCompetitionResultOutcome {
  /**
   * applied   — previous events (if any) reversed and the current verdict applied
   * reversed  — previous events reversed; the current state carries no rating change
   * unchanged — events already reflect the current verdict (idempotent repeat): nothing written
   */
  status: "applied" | "reversed" | "unchanged";
  /** Why the competition is unrated, when it is. */
  unratedReason: string | null;
  verdictId: string | null;
  reversedEvents: number;
  createdEvents: number;
}
