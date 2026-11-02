/**
 * Shapes of the JSONB columns in the schema. These are part of the frozen v1 data contract:
 * add optional fields freely, but never rename/remove a field without a migration plan
 * (old rows keep their old shape forever — rules snapshots and verdicts are immutable history).
 */

export type CompetitionSideLabel = "FOR" | "AGAINST";
/** Blind labels used by the judge and verdicts. Side A is ALWAYS the FOR side, Side B the AGAINST side. */
export type SideLabel = "A" | "B";

export const ROUND_DURATION_HOURS = [24, 48, 72] as const;
export type RoundDurationHours = (typeof ROUND_DURATION_HOURS)[number];

/**
 * Frozen terms of a challenge (design §4.2). Written once at send time; `terms_hash` is the sha256 of
 * the canonical JSON of this object. Immutable once accepted.
 */
export interface RulesSnapshot {
  snapshotVersion: 1;
  format: "direct_v1";
  /** ≤ 280 chars, prefilled from the argument's proposition. */
  proposition: string;
  argumentId: string;
  sourceCommentId: string | null;
  category: { id: string; slug: string; name: string };
  rubric: { id: string; version: number };
  challengerId: string;
  recipientId: string;
  challengerSide: CompetitionSideLabel;
  recipientSide: CompetitionSideLabel;
  roundDurationHours: RoundDurationHours;
  acceptWindowHours: number;
  limits: {
    openingMaxChars: number;
    rebuttalMaxChars: number;
    maxLinksPerSubmission: number;
  };
  /** Plain-language rule texts shown to both sides before accept. */
  rulesText: {
    noShow: string;
    late: string;
    cancellation: string;
    appeal: string;
  };
  /** ISO timestamp when the challenge was sent. */
  sentAt: string;
}

export interface RubricCriterion {
  /** Stable machine key, e.g. "evidence", "reasoning", "rebuttal", "clarity", "consistency". */
  key: string;
  label: string;
  /** Relative weight; weights of a rubric sum to 100. */
  weight: number;
  /** Guidance given to the judge for this criterion. */
  guidance: string;
}

/** Per-criterion final scores (averaged across the passes that decided the verdict). */
export interface VerdictScores {
  rubric: { id: string; version: number };
  criteria: Array<{
    key: string;
    label: string;
    weight: number;
    /** 0–10 */
    A: number;
    /** 0–10 */
    B: number;
  }>;
  /** Weighted totals on a 0–100 scale. */
  totals: { A: number; B: number };
  maxTotal: 100;
}

export type ClaimClassification = "common_knowledge" | "unsupported" | "likely_false" | "opinion";
export type ConfidenceLabel = "high" | "medium" | "low";

export interface VerdictExplanation {
  /** 2–4 sentence plain-language summary of why the outcome was reached. */
  summary: string;
  perCriterion: Array<{
    key: string;
    A: { reason: string; quotes: string[] };
    B: { reason: string; quotes: string[] };
  }>;
  strengths: { A: string[]; B: string[] };
  weaknesses: { A: string[]; B: string[] };
  flaggedClaims: Array<{ side: SideLabel; claim: string; classification: ClaimClassification }>;
  confidenceLabel: ConfidenceLabel;
  /** "How this was judged" panel data. */
  method: {
    blind: true;
    passCount: number;
    orders: Array<"AB" | "BA">;
    model: string;
    promptVersion: string;
    rubric: { id: string; version: number };
  } | null;
  injectionDetected: boolean;
  /** Human reviewer's written reason (decided_by = human), or forfeit/no-show explanation. */
  note?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface InjectionFinding {
  /** Which heuristic matched, e.g. "ignore_instructions". */
  pattern: string;
  /** Short excerpt around the match (≤ 160 chars). */
  excerpt: string;
  side: SideLabel | null;
  round: "opening" | "rebuttal" | null;
}

/** Free-form payload of a notification; renderers must tolerate missing keys. */
export type NotificationData = Record<string, string | number | boolean | null>;
