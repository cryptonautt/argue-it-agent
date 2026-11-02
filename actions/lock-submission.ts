import { defineAction } from "@agent-native/core/action";

import { lockSubmission } from "@domain/competitions/actions";

import { domainErrors, runDomain, withIdempotencyKey } from "../server/lib/domain-action.js";
import { submissionInput } from "../server/lib/domain-action-schemas.js";
import { competitionStateOutput } from "../server/lib/domain-action-outputs.js";

export default defineAction({
  description:
    "Lock in the signed-in user's entry for the current round: saves exactly this text and makes it final. Submitting is the user's own act, so an agent call always needs the user's approval.",
  schema: submissionInput,
  outputSchema: competitionStateOutput,
  errors: domainErrors,
  http: { method: "POST" },
  needsApproval: true,
  run: async (args) => runDomain(lockSubmission(withIdempotencyKey(args))),
});
