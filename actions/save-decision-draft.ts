import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { saveDecisionDraftAction } from "@domain/drafts/actions";
import { saveDraftInputSchema } from "@domain/drafts/service";

import { authorizeModerator, domainErrors, runDomain } from "../server/lib/domain-action.js";

export default defineAction({
  description:
    'Moderators only. Save (or replace) the agent\'s DRAFT decision for one appeal or needs-review debate, for a human moderator to edit and approve. It decides nothing. Always pass the explicit targetId (appealId for kind "appeal", competitionId for kind "review"). Every citation must be copied exactly from the side it is attributed to (A = FOR, B = AGAINST), or the save fails naming the quote. Fails with CONFLICT if the appeal/review is already decided.',
  schema: saveDraftInputSchema,
  outputSchema: z.object({ id: z.string(), message: z.string() }),
  errors: domainErrors,
  http: { method: "POST" },
  authorize: authorizeModerator,
  run: async (args) => {
    const { id } = await runDomain(saveDecisionDraftAction(args));
    return { id, message: `Draft saved for ${args.kind} ${args.targetId}. A moderator must approve it.` };
  },
});
