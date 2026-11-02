import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { decideAppeal } from "@domain/appeals/actions";

import { authorizeModerator, domainErrors, runDomain, withIdempotencyKey } from "../server/lib/domain-action.js";
import { decideAppealInput } from "../server/lib/domain-action-schemas.js";

export default defineAction({
  description:
    'Moderators only. Decide an open appeal: "uphold" (verdict stands), "reevaluate" (re-run the AI judge once) or "overturn" (set the outcome), with a note both debaters read. A human decides: an agent call always needs the moderator\'s approval.',
  schema: decideAppealInput,
  outputSchema: z.object({
    appealId: z.string(),
    competitionId: z.string(),
    status: z.string(),
    verdictId: z.string().nullable(),
    ratingsUpdated: z.boolean().nullable(),
  }),
  errors: domainErrors,
  http: { method: "POST" },
  needsApproval: true,
  authorize: authorizeModerator,
  run: async (args) => runDomain(decideAppeal(withIdempotencyKey(args))),
});
