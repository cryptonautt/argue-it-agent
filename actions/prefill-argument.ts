import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";
import { runAction } from "@domain/action";
import { requireUser } from "@domain/auth";
import { ARGUMENT_DRAFT_KEY } from "@domain/explain/rules";
import { argumentDraftSchema, prepareArgumentDraft } from "@domain/explain/service";
import { ok } from "@domain/lib/action-result";
import { runDomain } from "../server/lib/domain-action";

export default defineAction({
  description:
    "Pre-fill (not publish) the new-argument form at /new with a sharpened title, proposition, body and category. Uses the same length limits as create-argument; fails with NOT_FOUND for an unknown category (see list-categories). The user publishes it themselves.",
  schema: argumentDraftSchema.extend({
    title: argumentDraftSchema.shape.title.describe("Short title, 3–120 characters"),
    proposition: argumentDraftSchema.shape.proposition.describe(
      "One specific, arguable statement people can be FOR or AGAINST, 10–280 characters",
    ),
    body: argumentDraftSchema.shape.body.describe("The user's case in their own voice, 10–5000 characters"),
    categorySlug: argumentDraftSchema.shape.categorySlug.describe("Category slug from list-categories, e.g. \"sports\""),
  }),
  outputSchema: z.object({
    title: z.string(),
    proposition: z.string().nullable(),
    body: z.string(),
    categorySlug: z.string(),
    categoryName: z.string(),
    rubricId: z.string(),
    message: z.string(),
  }),
  http: false,
  run: async (args) =>
    runDomain(
      runAction(async () => {
        await requireUser();
        const draft = await prepareArgumentDraft(args);
        await writeAppStateForCurrentTab(ARGUMENT_DRAFT_KEY, {
          ...draft,
          draftedAt: new Date().toISOString(),
          _writeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        });
        return ok({ ...draft, message: "The new-argument form is pre-filled. The user reviews and publishes it." });
      }),
    ),
});
