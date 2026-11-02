import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { createArgument } from "@domain/arguments/actions";

import { domainErrors, runDomain, withIdempotencyKey } from "../server/lib/domain-action.js";
import { createArgumentInput } from "../server/lib/domain-action-schemas.js";

export default defineAction({
  description:
    "Publish a new argument as the signed-in user: title, one-sentence proposition people can AGREE or be AGAINST, body, category slug (list-categories) and optional links.",
  schema: createArgumentInput,
  outputSchema: z.object({ id: z.string().describe("The new argument id.") }),
  errors: domainErrors,
  http: { method: "POST" },
  link: ({ result }) => (result?.id ? { url: `/a/${result.id}`, label: "Open argument" } : null),
  run: async (args) => runDomain(createArgument(withIdempotencyKey(args))),
});
