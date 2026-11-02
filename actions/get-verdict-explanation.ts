import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { runAction } from "@domain/action";
import { getSession } from "@domain/auth";
import { getVerdictExplanation } from "@domain/explain/service";
import { ok } from "@domain/lib/action-result";
import { runDomain } from "../server/lib/domain-action";

const side = z.enum(["A", "B"]);
const explainedSide = z.object({ score: z.number().nullable(), reason: z.string().nullable(), quotes: z.array(z.string()) });

const outputSchema = z.object({
  competitionId: z.string(),
  status: z.string(),
  proposition: z.string(),
  category: z.object({ slug: z.string(), name: z.string() }),
  sides: z.object({
    A: z.object({ displayName: z.string(), stance: z.enum(["FOR", "AGAINST"]) }),
    B: z.object({ displayName: z.string(), stance: z.enum(["FOR", "AGAINST"]) }),
  }),
  viewer: z.object({ side: side.nullable(), isStaff: z.boolean() }),
  rubric: z.object({
    id: z.string(),
    version: z.number(),
    name: z.string().nullable(),
    criteria: z.array(z.object({ key: z.string(), label: z.string(), weight: z.number() })),
  }),
  outcome: z.string(),
  winnerSide: side.nullable(),
  decidedBy: z.string(),
  confidence: z.number().nullable(),
  summary: z.string().nullable(),
  reviewNote: z.string().nullable(),
  totals: z.object({ A: z.number(), B: z.number() }).nullable(),
  criteria: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      weight: z.number(),
      A: explainedSide,
      B: explainedSide,
      gap: z.number().nullable(),
      passCount: z.number(),
    }),
  ),
  passes: z.array(
    z.object({
      passNo: z.number(),
      order: z.enum(["AB", "BA"]),
      winner: z.enum(["A", "B", "draw"]).nullable(),
      confidence: z.number().nullable(),
      model: z.string(),
    }),
  ),
  judgedBy: z.string().nullable(),
  rule: z.object({ kind: z.string(), label: z.string() }),
  hiddenQuoteCount: z.number(),
  appeal: z.object({
    eligible: z.boolean(),
    deadline: z.string().nullable(),
    grounds: z.array(z.string()),
    alreadyFiled: z.boolean(),
    message: z.string().nullable(),
  }),
});

export default defineAction({
  description:
    "Explain a debate's current verdict from the stored judging passes: proposition, rubric weights, per-criterion scores averaged across passes with each side's quotes, each pass's winner/confidence/order/model, the fairness rule that decided it, and whether the viewer can still appeal (deadline, the five grounds). Read-only; never re-judges.",
  schema: z.object({
    competitionId: z.string().describe("The debate (competition) id, from the verdict page URL /c/<id>/verdict or view-screen"),
  }),
  outputSchema,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ competitionId }) =>
    runDomain(runAction(async () => ok(await getVerdictExplanation(await getSession(), competitionId)))),
});
