import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireUser } from "@domain/auth";
import { listMarketEvents } from "@domain/polymarket/markets";

import { domainErrors, runDomainQuery } from "../server/lib/domain-action.js";

const leaderOutput = z.object({ label: z.string(), yesPrice: z.number().nullable(), marketId: z.string() });

export default defineAction({
  description:
    "List live Polymarket prediction markets (events) with their leading options and Yes odds (0..1). With no query it returns the most traded open events; with `query` it searches. Use a slug with get-market or navigate view \"market\". Read-only: placing a bet is done by the user in the UI with their own wallet.",
  schema: z.object({
    query: z.string().max(100).optional().describe("Free-text search, e.g. \"Kansas Senate\" or \"Ballon d'Or\"."),
    limit: z.coerce.number().int().min(1).max(50).optional().describe("How many events (default 24)."),
  }),
  outputSchema: z.object({
    events: z.array(
      z.object({
        slug: z.string(),
        title: z.string(),
        image: z.string().nullable(),
        endDate: z.string().nullable(),
        volume: z.number(),
        volume24hr: z.number(),
        outcomeCount: z.number(),
        leaders: z.array(leaderOutput),
      }),
    ),
  }),
  errors: domainErrors,
  http: { method: "GET" },
  run: async ({ query, limit }) => {
    const events = await runDomainQuery(async () => {
      await requireUser({ allowSuspended: true });
      return listMarketEvents({ query, limit });
    });
    return { events };
  },
});
