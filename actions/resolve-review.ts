import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { resolveReview } from "@domain/appeals/actions";
import { decideWithOptionalDraft } from "@domain/drafts/actions";

import { authorizeModerator, domainErrors, runDomain, withIdempotencyKey } from "../server/lib/domain-action.js";
import { resolveReviewInput } from "../server/lib/domain-action-schemas.js";

export default defineAction({
  description:
    'Moderators only. Resolve a debate in the needs-review queue with a human outcome ("A", "B", "draw" or "inconclusive") and a note both debaters read. A human decides: an agent call always needs the moderator\'s approval.',
  schema: resolveReviewInput.extend({
    draftId: z
      .string()
      .min(1)
      .optional()
      .describe("Optional: the agent draft being approved (from list-decision-drafts). Must match this debate and outcome."),
  }),
  outputSchema: z.object({
    competitionId: z.string(),
    verdictId: z.string(),
    ratingsUpdated: z.boolean(),
  }),
  errors: domainErrors,
  http: { method: "POST" },
  needsApproval: true,
  authorize: authorizeModerator,
  run: async ({ draftId, ...input }) =>
    runDomain(
      decideWithOptionalDraft(
        draftId,
        { kind: "review", targetId: input.competitionId, recommendation: input.outcome },
        input.note,
        () => resolveReview(withIdempotencyKey(input)),
      ),
    ),
});
