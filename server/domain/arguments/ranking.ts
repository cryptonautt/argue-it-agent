/**
 * Feed ranking (design §4.6). Pure: constants + reference maths. The SQL in `engagement.ts` implements
 * exactly these formulas; the tests check both against each other.
 *
 * Trending score of an argument at instant `asOf`:
 *
 *   score = Σ_events weight(kind) · ½^(age_h / HALF_LIFE)          (engagement in the last 48h)
 *         + FRESHNESS_WEIGHT · ½^(argumentAge_h / FRESHNESS_HALF_LIFE)
 *
 * weight: AGREE/AGAINST position = 1, comment = 2, reaction = 1. The freshness term makes a brand-new
 * post count like one fresh engagement, so a quiet feed still shows new arguments instead of nothing.
 *
 * For You = Trending × category affinity (1 … 1 + AFFINITY_MAX_BOOST) from the categories the viewer
 * engaged with recently or picked as interests; with no signals it is exactly Trending (the fallback).
 *
 * What never affects ranking: money (there is none), follower counts, debate rating, or who the author is.
 */

export const RANKING = {
  /** Engagement older than this does not count towards Trending. */
  windowHours: 48,
  /** An engagement event loses half its weight every 12h. */
  halfLifeHours: 12,
  weights: { position: 1, comment: 2, reaction: 1 },
  freshnessWeight: 1,
  freshnessHalfLifeHours: 12,
  /** Trending candidates: engaged in the window OR created within it. */
  trendingCreationWindowHours: 48,
  /** For You also considers quieter posts from the last week so the tab doesn't run dry. */
  forYouCreationWindowHours: 7 * 24,
  /** How far back we look for the viewer's category signals. */
  affinityLookbackDays: 30,
  /** Strongest category gets ×(1 + 1.5) = ×2.5. */
  affinityMaxBoost: 1.5,
  /** A category picked at onboarding counts like this many interactions. */
  interestWeight: 3,
} as const;

export type EngagementKind = keyof typeof RANKING.weights;

/** ½^(age/halfLife); future events (clock skew) count fully. */
export function decayFactor(ageHours: number, halfLifeHours: number): number {
  if (ageHours <= 0) return 1;
  return 0.5 ** (ageHours / halfLifeHours);
}

export interface EngagementEvent {
  kind: EngagementKind;
  ageHours: number;
}

/** Reference implementation of the trending score (see module docs). */
export function trendingScore(events: readonly EngagementEvent[], argumentAgeHours: number): number {
  let score = 0;
  for (const event of events) {
    if (event.ageHours > RANKING.windowHours) continue;
    score += RANKING.weights[event.kind] * decayFactor(event.ageHours, RANKING.halfLifeHours);
  }
  return score + RANKING.freshnessWeight * decayFactor(argumentAgeHours, RANKING.freshnessHalfLifeHours);
}

export interface CategorySignal {
  categoryId: string;
  /** Number of the viewer's positions/comments/posts in this category in the lookback window. */
  count: number;
}

/**
 * Category → multiplier for For You. The viewer's strongest category gets the full boost; others scale
 * linearly with their share of the strongest; unknown categories stay at ×1. Empty when there are no signals.
 */
export function affinityMultipliers(
  signals: readonly CategorySignal[],
  interestCategoryIds: readonly string[] = [],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const { categoryId, count } of signals) {
    if (count > 0) totals.set(categoryId, (totals.get(categoryId) ?? 0) + count);
  }
  for (const categoryId of new Set(interestCategoryIds)) {
    totals.set(categoryId, (totals.get(categoryId) ?? 0) + RANKING.interestWeight);
  }
  const strongest = Math.max(0, ...totals.values());
  const result = new Map<string, number>();
  if (strongest === 0) return result;
  for (const [categoryId, total] of totals) {
    result.set(categoryId, roundMultiplier(1 + RANKING.affinityMaxBoost * (total / strongest)));
  }
  return result;
}

/** Multipliers travel in cursors; keep them short and bounded. */
export function roundMultiplier(value: number): number {
  const bounded = Math.min(1 + RANKING.affinityMaxBoost, Math.max(1, value));
  return Math.round(bounded * 1000) / 1000;
}
