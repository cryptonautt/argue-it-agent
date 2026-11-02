import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listDecisionDraftsAction } from "@domain/drafts/actions";
import { listDraftsInputSchema } from "@domain/drafts/service";

import { authorizeModerator, domainErrors, runDomain } from "../server/lib/domain-action.js";

const draftItem = z.object({
  id: z.string(),
  kind: z.enum(["appeal", "review"]),
  targetId: z.string(),
  recommendation: z.string(),
  outcome: z.string().nullable(),
  note: z.string(),
  citations: z.array(z.object({ side: z.enum(["A", "B"]), quote: z.string(), criterion: z.string() })),
  confidence: z.enum(["low", "medium", "high"]),
  status: z.enum(["draft", "approved", "discarded"]),
  draftedByEmail: z.string(),
  decidedBy: z.string().nullable(),
  edited: z.boolean(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  target: z.object({ competitionId: z.string().nullable(), title: z.string(), open: z.boolean() }),
});

export default defineAction({
  description:
    'Moderators only. List agent-drafted decisions (default: open drafts, newest first), each with its target\'s title and whether the target is still undecided. Filter by status ("draft" | "approved" | "discarded" | "all"), kind or targetId.',
  schema: listDraftsInputSchema,
  outputSchema: z.array(draftItem),
  errors: domainErrors,
  http: { method: "GET" },
  persistInBrowser: false,
  authorize: authorizeModerator,
  run: async (args) => runDomain(listDecisionDraftsAction(args)),
});
