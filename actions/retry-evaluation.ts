import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { retryFailedEvaluation } from "@domain/appeals/actions";

import { authorizeModerator, domainErrors, runDomain, withIdempotencyKey } from "../server/lib/domain-action.js";
import { retryEvaluationInput } from "../server/lib/domain-action-schemas.js";

export default defineAction({
  description:
    "Moderators only. Re-queue the AI judge for a needs-review debate whose last evaluation failed outright (provider error). It produces no verdict by itself.",
  schema: retryEvaluationInput,
  outputSchema: z.object({ competitionId: z.string() }),
  errors: domainErrors,
  http: { method: "POST" },
  authorize: authorizeModerator,
  run: async (args) => runDomain(retryFailedEvaluation(withIdempotencyKey(args))),
});
