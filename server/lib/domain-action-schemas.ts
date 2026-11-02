/**
 * Input schemas for the ARGUE IT actions, taken from the reference domain layer.
 *
 * Rule (plan Task 5): an action's schema IS the reference zod input schema. Where the reference exports
 * it, it is imported and only `idempotencyKey` is relaxed (see `withIdempotencyKey`). Where the
 * reference keeps it module-local (not exported), it is composed from the exported building blocks and
 * marked MIRROR below. Either way the domain function re-parses its input with the ORIGINAL schema
 * (`parseInput` inside every reference action), so validation and its field messages stay authoritative;
 * these schemas only shape the tool contract the agent sees.
 *
 * If agent 2/3 later add `export` to the module-local schemas, swap the MIRROR blocks for imports.
 */
import { z } from "zod";

import { competitionOnlySchema, decideAppealSchema, fileAppealSchema, resolveReviewSchema } from "@domain/appeals/schemas";
import { DEFAULT_FEED_TAB, FEED_TABS, type FeedTab } from "@domain/arguments/feed-params";
import { argumentFieldsSchema } from "@domain/arguments/validation";
import {
  DECLINE_REASON_MAX_CHARS,
  OPENING_MAX_CHARS,
  PROPOSITION_MAX_CHARS,
  ROUND_DURATION_HOURS,
} from "@domain/competitions/terms";
import { positionSideEnum } from "@domain/db/schema";
import { idempotencyKeySchema } from "@domain/idempotency";
import { displayNameSchema, handleSchema } from "@domain/lib/handles";
import { COMMENT_MAX_LENGTH } from "@domain/social/comments";

/** Optional for agent callers; the UI passes its own `crypto.randomUUID()`. */
export const optionalIdempotencyKey = idempotencyKeySchema
  .optional()
  .describe("Optional request key (uuid) that makes retries safe. Omit it and the server generates one.");

const relaxKey = { idempotencyKey: optionalIdempotencyKey };

// ---------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------

/** Reference `createArgumentSchema` (module-local) = `argumentFieldsSchema.extend({ idempotencyKey })`. */
export const createArgumentInput = argumentFieldsSchema.extend(relaxKey);

const feedTabKeys = FEED_TABS.map((tab) => tab.key) as [FeedTab, ...FeedTab[]];

/**
 * MIRROR of module-local `loadFeedSchema` (arguments/actions.ts), with `cursor` optional so the first
 * page can be read (the reference "load more" action requires one).
 */
export const listFeedInput = z.object({
  tab: z
    .enum(feedTabKeys)
    .default(DEFAULT_FEED_TAB)
    .describe(`Which feed: ${feedTabKeys.map((k) => `"${k}"`).join(", ")}; defaults to "${DEFAULT_FEED_TAB}".`),
  category: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/)
    .nullable()
    .optional()
    .describe("Optional category slug filter (see list-categories)."),
  cursor: z
    .string()
    .min(1)
    .max(4096)
    .optional()
    .describe("Omit for the first page; pass the previous page's nextCursor for the next one."),
});

export const argumentIdInput = z.object({
  id: z.uuid("That argument doesn't exist.").describe("The argument id (uuid)."),
});

// ---------------------------------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------------------------------

/** MIRROR of module-local `setPositionSchema` (social/actions.ts). */
export const setPositionInput = z.object({
  argumentId: z.uuid().describe("The argument id (uuid)."),
  side: z.enum(positionSideEnum.enumValues).describe('The free position to take: "AGREE" or "AGAINST".'),
});

/** MIRROR of module-local `createCommentSchema` (social/actions.ts). */
export const createCommentInput = z.object({
  argumentId: z.uuid().describe("The argument id (uuid)."),
  parentCommentId: z.uuid().optional().describe("Optional: the comment being replied to."),
  body: z
    .string()
    .trim()
    .min(1, "Write something first.")
    .max(COMMENT_MAX_LENGTH, "Keep comments under 2,000 characters.")
    .describe("Comment text (free discussion, never judged)."),
  showPosition: z
    .boolean()
    .optional()
    .default(true)
    .describe("Tag the comment with your AGREE/AGAINST position; defaults to true."),
  ...relaxKey,
});

// ---------------------------------------------------------------------------------------------------
// Competitions
// ---------------------------------------------------------------------------------------------------

const competitionId = z.uuid("That challenge link looks broken.").describe("The debate (competition) id (uuid).");

/** MIRROR of module-local `sendSchema` (competitions/actions.ts). */
export const sendChallengeInput = z.object({
  argumentId: z.uuid("Pick an argument to challenge.").describe("The argument the debate is about."),
  commentId: z.uuid().nullish().describe("Optional: challenge the author of this comment."),
  opponentId: z.uuid().nullish().describe("Optional: opponent user id. Default opponent is the argument's author."),
  opponentHandle: z.string().trim().max(32).nullish().describe("Optional: opponent handle instead of an id."),
  proposition: z
    .string()
    .trim()
    .min(10, "Write the proposition as one clear statement both sides can argue.")
    .max(PROPOSITION_MAX_CHARS, `Keep the proposition under ${PROPOSITION_MAX_CHARS} characters.`)
    .describe("One clear statement both sides argue."),
  challengerSide: z
    .enum(["FOR", "AGAINST"], "Choose the side you will argue.")
    .describe('The side the challenger argues: "FOR" or "AGAINST" the proposition.'),
  roundDurationHours: z
    .number()
    .int()
    .refine((value) => (ROUND_DURATION_HOURS as readonly number[]).includes(value), "Pick 24, 48 or 72 hours.")
    .default(24)
    .describe("Hours per round: 24, 48 or 72; defaults to 24."),
  ...relaxKey,
});

/**
 * Merges module-local `acceptSchema` and `declineSchema` (competitions/actions.ts) behind `response`.
 * `termsHash` is required for accept and validated by `acceptChallenge` itself.
 */
export const respondToChallengeInput = z.object({
  competitionId,
  response: z.enum(["accept", "decline"]).describe('"accept" starts the debate on the frozen terms; "decline" refuses it.'),
  termsHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "These terms couldn't be verified. Refresh and review them again.")
    .optional()
    .describe("Required for accept: the termsHash returned by get-competition for these exact terms."),
  reason: z
    .string()
    .trim()
    .max(DECLINE_REASON_MAX_CHARS, `Keep the reason under ${DECLINE_REASON_MAX_CHARS} characters.`)
    .nullish()
    .describe("Optional decline reason."),
  ...relaxKey,
});

export const competitionIdInput = z.object({ id: competitionId });

/** MIRROR of module-local `submissionSchema` (competitions/actions.ts), shared by save and lock. */
export const submissionInput = z.object({
  competitionId,
  round: z.enum(["opening", "rebuttal"]).describe('The current round: "opening" or "rebuttal".'),
  body: z
    .string()
    .trim()
    .min(1, "Write your argument first.")
    .max(OPENING_MAX_CHARS, `Keep it under ${OPENING_MAX_CHARS.toLocaleString("en-GB")} characters.`)
    .describe("The submission text."),
  links: z.array(z.string().max(2_048)).max(20).default([]).describe("Optional source links; defaults to none."),
  ...relaxKey,
});

// ---------------------------------------------------------------------------------------------------
// Verdicts, appeals and the review queue (reference exports these: imported, key relaxed)
// ---------------------------------------------------------------------------------------------------

export const verdictInput = z.object({ competitionId });

export const fileAppealInput = fileAppealSchema.extend(relaxKey);

const [upholdBranch, reevaluateBranch, overturnBranch] = decideAppealSchema.options;
export const decideAppealInput = z.discriminatedUnion("decision", [
  upholdBranch.extend(relaxKey),
  reevaluateBranch.extend(relaxKey),
  overturnBranch.extend(relaxKey),
]);

export const resolveReviewInput = resolveReviewSchema.extend(relaxKey);

export const retryEvaluationInput = competitionOnlySchema.extend(relaxKey);

// ---------------------------------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------------------------------

export const getProfileInput = z.object({
  handle: z.string().trim().min(1).max(64).describe('The user handle, with or without "@".'),
});

export const createProfileInput = z.object({
  handle: handleSchema.describe("3–20 characters: lowercase letters, numbers or underscores."),
  displayName: displayNameSchema.optional().describe("Optional display name; defaults to the handle."),
});
