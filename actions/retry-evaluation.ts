import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { retryFailedEvaluation } from "@domain/appeals/actions";
import { decideWithOptionalDraft } from "@domain/drafts/actions";

import { authorizeModerator, domainErrors, runDomain, withIdempotencyKey } from "../server/lib/domain-action.js";
import { retryEvaluationInput } from "../server/lib/domain-action-schemas.js";

export default defineAction({
  description:
    "Moderators only. Re-queue the AI judge for a needs-review debate whose last evaluation failed outright (provider error). It produces no verdict by itself.",
  schema: retryEvaluationInput.extend({
    draftId: z
      .string()
      .min(1)
      .optional()
      .describe('Optional: the agent "retry" draft being approved (from list-decision-drafts) for this debate.'),
  }),
  outputSchema: z.object({ competitionId: z.string() }),
  errors: domainErrors,
  http: { method: "POST" },
  authorize: authorizeModerator,
  run: async ({ draftId, ...input }) =>
    runDomain(
      decideWithOptionalDraft(
        draftId,
        { kind: "review", targetId: input.competitionId, recommendation: "retry" },
        "",
        () => retryFailedEvaluation(withIdempotencyKey(input)),
      ),
    ),
});
