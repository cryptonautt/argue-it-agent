import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { fileAppeal } from "@domain/appeals/actions";

import { domainErrors, runDomain, withIdempotencyKey } from "../server/lib/domain-action.js";
import { fileAppealInput } from "../server/lib/domain-action-schemas.js";

export default defineAction({
  description:
    "File an appeal against a debate's current verdict, as one of its two debaters, within the appeal window, on one of the allowed grounds. The user submits: an agent call always needs the user's approval.",
  schema: fileAppealInput,
  outputSchema: z.object({ appealId: z.string() }),
  errors: domainErrors,
  http: { method: "POST" },
  needsApproval: true,
  run: async (args) => runDomain(fileAppeal(withIdempotencyKey(args))),
});
