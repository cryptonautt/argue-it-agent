import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { sendChallenge } from "@domain/competitions/actions";

import { domainErrors, runDomain, withIdempotencyKey } from "../server/lib/domain-action.js";
import { sendChallengeInput } from "../server/lib/domain-action-schemas.js";

export default defineAction({
  description:
    "Challenge someone to a judged debate on an argument. Freezes the terms (proposition, sides, round length) at send time; the opponent must accept.",
  schema: sendChallengeInput,
  outputSchema: z.object({ competitionId: z.string().describe("The new debate id.") }),
  errors: domainErrors,
  http: { method: "POST" },
  link: ({ result }) => (result?.competitionId ? { url: `/c/${result.competitionId}`, label: "Open debate" } : null),
  run: async (args) => runDomain(sendChallenge(withIdempotencyKey(args))),
});
