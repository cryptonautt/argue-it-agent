/**
 * Owner: challenges. The frozen terms of a direct challenge (design §4.2).
 *
 * PURE and isomorphic: no `server-only`, no Node APIs. The challenge setup form imports this to render
 * the exact same terms preview the server will freeze, so what the challenger reviews is what is sent.
 * Hashing lives in `terms-hash.ts` (server only).
 */
import {
  ROUND_DURATION_HOURS,
  type CompetitionSideLabel,
  type RoundDurationHours,
  type RubricCriterion,
  type RulesSnapshot,
} from "@domain/db/json-types";

export { ROUND_DURATION_HOURS, type RoundDurationHours };

export const DEFAULT_ROUND_DURATION_HOURS: RoundDurationHours = 24;
/** A pending challenge expires this long after it is sent. */
export const ACCEPT_WINDOW_HOURS = 48;
export const PROPOSITION_MAX_CHARS = 280;
export const OPENING_MAX_CHARS = 4_000;
export const REBUTTAL_MAX_CHARS = 2_500;
export const MAX_LINKS_PER_SUBMISSION = 5;
export const DECLINE_REASON_MAX_CHARS = 500;
export const CANCEL_REASON_MAX_CHARS = 500;
/** Participants get one "deadline soon" nudge per round when this close to the deadline. */
export const DEADLINE_SOON_HOURS = 2;

/**
 * Plain-language rules frozen into every snapshot. Changing this text only affects challenges sent
 * afterwards — old snapshots keep the words both sides actually agreed to.
 */
export const RULES_TEXT: RulesSnapshot["rulesText"] = {
  noShow:
    "If only one side has an opening when the opening round closes, that side wins by forfeit: no AI judging, " +
    "and a smaller rating change than a judged win. If neither side has an opening, the challenge is cancelled " +
    "with no rating change. A missing rebuttal is allowed but will score lower on rebuttal.",
  late:
    "Deadlines run on the server clock, not your phone's. Nothing can be saved after a round closes. A draft you " +
    "saved but did not lock in is entered exactly as it was saved when the round closes.",
  cancellation:
    "Before it is accepted, the challenger can withdraw and the opponent can decline. Once it has started, the " +
    "challenge can only be cancelled if both sides ask to cancel, or by an admin with a recorded reason. " +
    "Cancelled challenges never change ratings.",
  appeal:
    "Either side can appeal once, within 48 hours of the verdict, on a specific ground: evidence overlooked, a " +
    "factual error in the verdict, the wrong rubric, a submission left out or cut off, or a technical failure. " +
    "Simply disagreeing is not a ground for appeal.",
};

export const FORMAT_SUMMARY =
  "Two rounds. Round 1: each side writes an opening, sealed — neither side sees the other's until the round " +
  "closes. Round 2: each side reads the other's opening and writes a rebuttal. Each round closes at its deadline, " +
  "or as soon as both sides lock in.";

export const JUDGING_SUMMARY =
  "An AI judge scores both sides against the rubric below. It sees only the proposition and the two sides' " +
  "submissions — no names, profiles, ratings, followers or reactions, and not who challenged whom. It judges " +
  "twice with the sides in swapped order, and it can call a draw or say the result is unclear and hand it to a " +
  "human reviewer.";

/** The rubric details shown in a terms preview (resolved by rubric.ts on the server). */
export interface RubricView {
  id: string;
  version: number;
  name: string;
  description: string;
  criteria: RubricCriterion[];
}

export function otherSide(side: CompetitionSideLabel): CompetitionSideLabel {
  return side === "FOR" ? "AGAINST" : "FOR";
}

export function isRoundDuration(value: number): value is RoundDurationHours {
  return (ROUND_DURATION_HOURS as readonly number[]).includes(value);
}

export interface BuildRulesSnapshotInput {
  proposition: string;
  argumentId: string;
  sourceCommentId: string | null;
  category: { id: string; slug: string; name: string };
  rubric: { id: string; version: number };
  challengerId: string;
  recipientId: string;
  challengerSide: CompetitionSideLabel;
  roundDurationHours: RoundDurationHours;
  sentAt: Date;
}

/** The exact terms both sides agree to. The recipient always gets the side the challenger did not pick. */
export function buildRulesSnapshot(input: BuildRulesSnapshotInput): RulesSnapshot {
  return {
    snapshotVersion: 1,
    format: "direct_v1",
    proposition: input.proposition.trim(),
    argumentId: input.argumentId,
    sourceCommentId: input.sourceCommentId,
    category: { id: input.category.id, slug: input.category.slug, name: input.category.name },
    rubric: { id: input.rubric.id, version: input.rubric.version },
    challengerId: input.challengerId,
    recipientId: input.recipientId,
    challengerSide: input.challengerSide,
    recipientSide: otherSide(input.challengerSide),
    roundDurationHours: input.roundDurationHours,
    acceptWindowHours: ACCEPT_WINDOW_HOURS,
    limits: {
      openingMaxChars: OPENING_MAX_CHARS,
      rebuttalMaxChars: REBUTTAL_MAX_CHARS,
      maxLinksPerSubmission: MAX_LINKS_PER_SUBMISSION,
    },
    rulesText: { ...RULES_TEXT },
    sentAt: input.sentAt.toISOString(),
  };
}

/** Character limit for a round, read from the frozen snapshot (never from today's constants). */
export function roundCharLimit(snapshot: RulesSnapshot, round: "opening" | "rebuttal"): number {
  return round === "opening" ? snapshot.limits.openingMaxChars : snapshot.limits.rebuttalMaxChars;
}

/**
 * Canonical JSON: object keys sorted recursively, no whitespace, `undefined` object fields dropped.
 * Two snapshots with the same content always serialise to the same string, whatever their key order
 * (JSONB does not preserve key order, so this is what makes `terms_hash` reproducible).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : canonicalize(item)));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined) out[key] = canonicalize(item);
  }
  return out;
}

/** Short, human-checkable fingerprint of a terms hash ("Terms fingerprint: 3fa9 c21e"). */
export function termsFingerprint(hash: string): string {
  const head = hash.slice(0, 8).toUpperCase();
  return `${head.slice(0, 4)} ${head.slice(4, 8)}`;
}
