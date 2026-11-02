import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireUser } from "@domain/auth";
import { getCompetitionRoom } from "@domain/competitions/queries";

import { domainErrors, runDomainQuery, toJson } from "../server/lib/domain-action.js";
import { competitionIdInput } from "../server/lib/domain-action-schemas.js";
import { competitionStatusOutput } from "../server/lib/domain-action-outputs.js";

export default defineAction({
  description:
    "Read a debate room as the signed-in user may see it: status, phase, current round and deadline, frozen terms and termsHash, rubric, both sides, and each submission (sealed until both sides are in).",
  schema: competitionIdInput,
  outputSchema: z.looseObject({
    id: z.string(),
    status: competitionStatusOutput,
    round: z.enum(["opening", "rebuttal"]).nullable(),
    phase: z.string(),
    termsHash: z.string(),
    deadline: z.string().nullable(),
    viewer: z.looseObject({ role: z.enum(["challenger", "recipient"]).nullable() }),
    hasVerdict: z.boolean(),
  }),
  errors: domainErrors,
  http: { method: "GET" },
  run: async ({ id }) => {
    const room = await runDomainQuery(async () => {
      const viewer = await requireUser({ allowSuspended: true });
      return getCompetitionRoom(id, viewer);
    }, "That debate doesn't exist.");
    return toJson(room);
  },
});
