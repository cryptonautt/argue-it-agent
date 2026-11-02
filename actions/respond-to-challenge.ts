import { defineAction } from "@agent-native/core/action";

import { acceptChallenge, declineChallenge } from "@domain/competitions/actions";

import { domainErrors, runDomain, withIdempotencyKey } from "../server/lib/domain-action.js";
import { respondToChallengeInput } from "../server/lib/domain-action-schemas.js";
import { competitionStateOutput } from "../server/lib/domain-action-outputs.js";

export default defineAction({
  description:
    'Accept or decline a pending challenge sent to the signed-in user. Accepting needs the termsHash from get-competition so the user accepts exactly the terms they saw.',
  schema: respondToChallengeInput,
  outputSchema: competitionStateOutput,
  errors: domainErrors,
  http: { method: "POST" },
  run: async (args) => {
    const { competitionId, idempotencyKey } = withIdempotencyKey(args);
    if (args.response === "accept") {
      // acceptChallenge validates termsHash itself (VALIDATION with a field message when missing).
      return runDomain(acceptChallenge({ competitionId, termsHash: args.termsHash ?? "", idempotencyKey }));
    }
    return runDomain(declineChallenge({ competitionId, reason: args.reason ?? null, idempotencyKey }));
  },
});
