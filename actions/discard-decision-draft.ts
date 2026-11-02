import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { discardDecisionDraftAction } from "@domain/drafts/actions";

import { authorizeModerator, domainErrors, runDomain } from "../server/lib/domain-action.js";

export default defineAction({
  description: "Moderators only. Discard an open agent-drafted decision by its draft id. Decides nothing.",
  schema: z.object({ id: z.string().min(1).describe("The draft id (from list-decision-drafts or save-decision-draft)") }),
  outputSchema: z.object({ id: z.string() }),
  errors: domainErrors,
  http: { method: "POST" },
  mcpAnnotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  authorize: authorizeModerator,
  run: async ({ id }) => runDomain(discardDecisionDraftAction(id)),
});
