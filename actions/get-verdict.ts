import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getVerdictPageData } from "@domain/appeals/queries";
import { findRubric } from "@domain/appeals/rubrics";
import { requireUser } from "@domain/auth";

import { domainErrors, runDomainQuery, toJson } from "../server/lib/domain-action.js";
import { verdictInput } from "../server/lib/domain-action-schemas.js";
import { competitionStatusOutput } from "../server/lib/domain-action-outputs.js";

export default defineAction({
  description:
    "Read a debate's verdict page: the proposition, current AI verdict (outcome, per-criterion scores, quotes, confidence), how it was judged, verdict history, appeals, and whether the signed-in user may still appeal.",
  schema: verdictInput,
  outputSchema: z.looseObject({
    competitionId: z.string(),
    status: competitionStatusOutput,
    proposition: z.string(),
    current: z.looseObject({ id: z.string(), outcome: z.string() }).nullable(),
    history: z.array(z.unknown()),
    appeals: z.array(z.looseObject({ id: z.string(), status: z.string() })),
    eligibility: z.looseObject({ eligible: z.boolean() }),
    rubricDetail: z.unknown().nullable(),
  }),
  errors: domainErrors,
  http: { method: "GET" },
  run: async ({ competitionId }) => {
    const data = await runDomainQuery(async () => {
      const viewer = await requireUser({ allowSuspended: true });
      return getVerdictPageData(competitionId, viewer);
    }, "That debate doesn't exist.");
    // The verdict page labels criteria from the pinned rubric (reference c/[id]/verdict/page.tsx).
    const rubricDetail = data.current ? await findRubric(data.rubric.id, data.rubric.version) : null;
    return toJson({ ...data, rubricDetail });
  },
});
