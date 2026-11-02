import { defineAction } from "@agent-native/core/action";

import { setPosition } from "@domain/social/actions";

import { domainErrors, runDomain } from "../server/lib/domain-action.js";
import { setPositionInput } from "../server/lib/domain-action-schemas.js";
import { positionSummaryOutput } from "../server/lib/domain-action-outputs.js";

export default defineAction({
  description: 'Take or change the signed-in user\'s free position on an argument: "AGREE" or "AGAINST". Returns fresh counts.',
  schema: setPositionInput,
  outputSchema: positionSummaryOutput,
  errors: domainErrors,
  http: { method: "POST" },
  run: async (args) => runDomain(setPosition(args)),
});
