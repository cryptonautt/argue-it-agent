/**
 * `outputSchema`s for the ARGUE IT actions. Small mutation results are typed exactly. Large read models
 * (feed page, debate room, verdict page, queues) use `z.looseObject` with their key fields typed: strict
 * output validation still catches a drifting shape, and nothing the UI needs is silently stripped.
 * All results are JSON-safe (ISO date strings); see `toJson` in domain-action.ts.
 */
import { z } from "zod";

export const competitionStatusOutput = z.string().describe("Competition status, e.g. active, evaluating, completed.");

/** Reference `CompetitionStateResult`. */
export const competitionStateOutput = z.object({
  competitionId: z.string(),
  status: competitionStatusOutput,
  round: z.enum(["opening", "rebuttal"]).nullable(),
});

export const categoryOutput = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
});

export const argumentCardOutput = z.looseObject({
  id: z.string(),
  title: z.string(),
  proposition: z.string(),
  createdAt: z.string(),
  category: z.looseObject({ slug: z.string(), name: z.string() }),
});

export const feedPageOutput = z.object({
  items: z.array(argumentCardOutput),
  nextCursor: z.string().nullable(),
});

export const positionSummaryOutput = z.object({
  argumentId: z.string(),
  agree: z.number(),
  against: z.number(),
  viewerSide: z.enum(["AGREE", "AGAINST"]).nullable(),
});
