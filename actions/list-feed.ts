import { defineAction } from "@agent-native/core/action";

import { runAction } from "@domain/action";
import { loadFeedPage } from "@domain/arguments/actions";
import { getFeedPage } from "@domain/arguments/feed";
import { requireUser } from "@domain/auth";
import { ok } from "@domain/lib/action-result";

import { domainErrors, runDomain, toJson } from "../server/lib/domain-action.js";
import { listFeedInput } from "../server/lib/domain-action-schemas.js";
import { feedPageOutput } from "../server/lib/domain-action-outputs.js";

export default defineAction({
  description:
    "List a page of argument cards from the signed-in user's feed (title, proposition, category, AGREE/AGAINST counts, live debates). Pass nextCursor back for more.",
  schema: listFeedInput,
  outputSchema: feedPageOutput,
  errors: domainErrors,
  http: { method: "GET" },
  run: async ({ tab, category, cursor }) => {
    const page = cursor
      ? // "Load more": the reference server action, unchanged.
        await runDomain(loadFeedPage({ tab, category: category ?? null, cursor }))
      : // First page: same read model and auth rule (suspended users may read), no cursor.
        await runDomain(
          runAction(async () => {
            const user = await requireUser({ allowSuspended: true });
            return ok(await getFeedPage({ tab, viewerId: user.id, categorySlug: category ?? null }));
          }),
        );
    return toJson(page);
  },
});
