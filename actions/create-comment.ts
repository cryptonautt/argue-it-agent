import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { createComment } from "@domain/social/actions";

import { domainErrors, runDomain, toJson, withIdempotencyKey } from "../server/lib/domain-action.js";
import { createCommentInput } from "../server/lib/domain-action-schemas.js";

export default defineAction({
  description:
    "Post a comment (free discussion, never judged) on an argument, or a reply to a comment, as the signed-in user.",
  schema: createCommentInput,
  outputSchema: z.looseObject({
    id: z.string(),
    argumentId: z.string(),
    parentCommentId: z.string().nullable(),
  }),
  errors: domainErrors,
  http: { method: "POST" },
  run: async (args) => toJson(await runDomain(createComment(withIdempotencyKey(args)))),
});
