/**
 * Average rubric criterion scores for a user across their judged debates (design §4.5: "average rubric
 * scores per criterion"). Pure: callers pass the user's side and the verdict scores of each debate.
 *
 * Rubrics differ by category (e.g. the subjective rubric has no "evidence" criterion), so each criterion
 * is averaged only over the debates whose rubric actually had it, and the count is reported alongside.
 */
import type { SideLabel, VerdictScores } from "@domain/db/json-types";

export interface JudgedDebateScores {
  side: SideLabel;
  scores: VerdictScores;
}

export interface CriterionAverage {
  key: string;
  label: string;
  /** Mean 0–10 score, rounded to one decimal place. */
  average: number;
  /** Number of judged debates this criterion was scored in. */
  count: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function averageCriterionScores(debates: readonly JudgedDebateScores[]): CriterionAverage[] {
  const totals = new Map<string, { label: string; sum: number; count: number; weight: number }>();
  for (const debate of debates) {
    for (const criterion of debate.scores.criteria) {
      const score = criterion[debate.side];
      if (!Number.isFinite(score)) continue;
      const entry = totals.get(criterion.key) ?? { label: criterion.label, sum: 0, count: 0, weight: 0 };
      entry.sum += score;
      entry.count += 1;
      entry.weight = Math.max(entry.weight, criterion.weight);
      totals.set(criterion.key, entry);
    }
  }
  return [...totals.entries()]
    .map(([key, t]) => ({ key, label: t.label, average: round1(t.sum / t.count), count: t.count, weight: t.weight }))
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
    .map(({ key, label, average, count }) => ({ key, label, average, count }));
}

/**
 * The criterion a user scores best at, or null when there is no clear signal: no judged debates, or a
 * tie at the top (we never invent a strength). Ties are broken by nothing — honesty over flattery.
 */
export function strongestCriterion(
  averages: readonly CriterionAverage[],
  options: { minDebates?: number } = {},
): CriterionAverage | null {
  const minDebates = options.minDebates ?? 1;
  const eligible = averages.filter((a) => a.count >= minDebates);
  if (eligible.length < 2) return eligible[0] ?? null;
  const sorted = [...eligible].sort((a, b) => b.average - a.average);
  const [first, second] = sorted;
  if (!first || !second) return first ?? null;
  return first.average > second.average ? first : null;
}

/** Record<key, average> form used by UserRatingSummary. */
export function toAverageRecord(averages: readonly CriterionAverage[]): Record<string, number> {
  return Object.fromEntries(averages.map((a) => [a.key, a.average]));
}
