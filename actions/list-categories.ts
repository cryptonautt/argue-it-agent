import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listActiveCategories } from "@domain/arguments/queries";

import { domainErrors, runDomainQuery } from "../server/lib/domain-action.js";
import { categoryOutput } from "../server/lib/domain-action-outputs.js";

export default defineAction({
  description:
    "List the active debate categories (slug, name, description). Use a slug when creating an argument or filtering the feed.",
  schema: z.object({}),
  outputSchema: z.object({ categories: z.array(categoryOutput) }),
  errors: domainErrors,
  http: { method: "GET" },
  run: async () => {
    const categories = await runDomainQuery(() => listActiveCategories());
    return { categories };
  },
});
