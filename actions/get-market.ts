import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireUser } from "@domain/auth";
import { listMarketDebates } from "@domain/polymarket/debates";
import { PRICE_RANGES, getEventPriceSeries, getMarketEvent } from "@domain/polymarket/markets";
import { tradingStatus } from "@domain/polymarket/trading";

import { domainErrors, runDomainQuery, toJson } from "../server/lib/domain-action.js";
import { argumentCardOutput } from "../server/lib/domain-action-outputs.js";

export default defineAction({
  description:
    "Read one live Polymarket event by slug: title, rules, every open option with its Yes/No price (0..1), best bid/ask, 1-day change and volume, the odds history for the leading options, the ARGUE IT arguments debating it, and whether in-app betting is switched on. Read-only: the agent cannot place bets; the user does that in the trade panel with their own wallet.",
  schema: z.object({
    slug: z.string().min(1).max(200).describe("Polymarket event slug, e.g. \"kansas-senate-election-winner\"."),
    range: z.enum(PRICE_RANGES).optional().describe("Odds history window: 1d, 1w, 1m or max (default max)."),
  }),
  outputSchema: z.object({
    event: z.looseObject({
      slug: z.string(),
      title: z.string(),
      url: z.string(),
      outcomes: z.array(
        z.looseObject({
          marketId: z.string(),
          label: z.string(),
          yesPrice: z.number().nullable(),
          noPrice: z.number().nullable(),
        }),
      ),
    }),
    history: z.array(
      z.object({
        marketId: z.string(),
        label: z.string(),
        points: z.array(z.object({ t: z.number(), p: z.number() })),
      }),
    ),
    debates: z.array(argumentCardOutput),
    trading: z.object({ enabled: z.boolean(), builderCode: z.string().nullable() }),
  }),
  errors: domainErrors,
  http: { method: "GET" },
  link: ({ args }) =>
    typeof args.slug === "string" ? { url: `/markets/${encodeURIComponent(args.slug)}`, label: "Open market" } : null,
  run: async ({ slug, range }) => {
    const page = await runDomainQuery(async () => {
      const viewer = await requireUser({ allowSuspended: true });
      const event = await getMarketEvent(slug);
      const [history, debates] = await Promise.all([
        getEventPriceSeries(event, range ?? "max"),
        listMarketDebates(event.slug, viewer.id),
      ]);
      return { event, history, debates, trading: tradingStatus() };
    }, "That market doesn't exist on Polymarket.");
    return toJson(page);
  },
});
