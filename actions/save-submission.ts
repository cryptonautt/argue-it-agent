import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { saveSubmission } from "@domain/competitions/actions";

import { domainErrors, runDomain, withIdempotencyKey } from "../server/lib/domain-action.js";
import { submissionInput } from "../server/lib/domain-action-schemas.js";
import { competitionStateOutput } from "../server/lib/domain-action-outputs.js";

export default defineAction({
  description:
    "Save (or overwrite) the signed-in user's draft for the current round of their debate. Drafts stay sealed from the opponent and are not final until lock-submission.",
  schema: submissionInput,
  outputSchema: competitionStateOutput.extend({ savedAt: z.string() }),
  errors: domainErrors,
  http: { method: "POST" },
  run: async (args) => runDomain(saveSubmission(withIdempotencyKey(args))),
});
