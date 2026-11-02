/**
 * Owner: profiles. Debate reputation (design §4.5) — public API used by the judge, appeals and profiles.
 *
 * - Glicko-2 per user, overall and per category (start 1500 / RD 350 / σ 0.06).
 * - win 1 / draw 0.5 / loss 0; forfeit at half weight; inconclusive or cancelled → no change.
 * - Immutable `reputation_events` ledger + materialised `user_ratings` (with W/L/D).
 * - Community engagement (comments, reactions, followers) NEVER feeds into rating.
 */
import "server-only";

import type { DbOrTx } from "@domain/db";
import { applyCompetitionResultDetailed } from "./apply";

export { applyCompetitionResultDetailed } from "./apply";
export { getCriterionAverages, getDebateRecord, getUserRatingSummary } from "./summary";
export { strongestCriterion, type CriterionAverage } from "./criteria";
export { FORFEIT_WEIGHT } from "./outcome";
export {
  PROVISIONAL_RD,
  RATING_DEFAULTS,
  isProvisional,
  type ApplyCompetitionResultOutcome,
  type CategoryRatingLine,
  type RatingLine,
  type UserRatingSummary,
} from "./types";

/**
 * Apply the current verdict of a competition to overall + category ratings. Idempotent: if the ledger
 * already reflects the current verdict nothing is written; otherwise prior reputation events for that
 * competition are reversed and the current verdict applied (win 1 / draw 0.5 / loss 0; forfeit at half
 * weight; inconclusive/cancelled → no change). Pass `tx` to join the caller's transaction.
 */
export async function applyCompetitionResult(competitionId: string, tx?: DbOrTx): Promise<void> {
  await applyCompetitionResultDetailed(competitionId, tx);
}
