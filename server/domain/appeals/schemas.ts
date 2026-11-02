/**
 * Owner: verdict. zod input schemas for appeal / review actions (server-side; forms share the limits via rules.ts).
 */
import { z } from "zod";
import { idempotencyKeySchema } from "@domain/idempotency";
import {
  APPEAL_GROUND_VALUES,
  APPEAL_TEXT_MAX,
  APPEAL_TEXT_MIN,
  DECISION_NOTE_MAX,
  DECISION_NOTE_MIN,
} from "./rules";

const humanOutcome = z.enum(["A", "B", "draw", "inconclusive"], "Choose an outcome.");

const decisionNote = z
  .string()
  .trim()
  .min(DECISION_NOTE_MIN, `Explain your decision in at least ${DECISION_NOTE_MIN} characters. Both debaters will read it.`)
  .max(DECISION_NOTE_MAX, `Keep the explanation under ${DECISION_NOTE_MAX.toLocaleString("en-GB")} characters.`);

export const fileAppealSchema = z.object({
  competitionId: z.uuid(),
  ground: z.enum(APPEAL_GROUND_VALUES, "Pick the ground that fits your appeal."),
  text: z
    .string()
    .trim()
    .min(APPEAL_TEXT_MIN, `Tell the reviewer what went wrong in at least ${APPEAL_TEXT_MIN} characters.`)
    .max(APPEAL_TEXT_MAX, `Keep your appeal under ${APPEAL_TEXT_MAX.toLocaleString("en-GB")} characters.`),
  idempotencyKey: idempotencyKeySchema,
});

export const decideAppealSchema = z.discriminatedUnion("decision", [
  z.object({ appealId: z.uuid(), decision: z.literal("uphold"), note: decisionNote, idempotencyKey: idempotencyKeySchema }),
  z.object({
    appealId: z.uuid(),
    decision: z.literal("reevaluate"),
    note: decisionNote,
    idempotencyKey: idempotencyKeySchema,
  }),
  z.object({
    appealId: z.uuid(),
    decision: z.literal("overturn"),
    outcome: humanOutcome,
    note: decisionNote,
    idempotencyKey: idempotencyKeySchema,
  }),
]);

export const resolveReviewSchema = z.object({
  competitionId: z.uuid(),
  outcome: humanOutcome,
  note: decisionNote,
  idempotencyKey: idempotencyKeySchema,
});

export const competitionOnlySchema = z.object({
  competitionId: z.uuid(),
  idempotencyKey: idempotencyKeySchema,
});

export type FileAppealInput = z.input<typeof fileAppealSchema>;
export type DecideAppealInput = z.input<typeof decideAppealSchema>;
export type ResolveReviewInput = z.input<typeof resolveReviewSchema>;
