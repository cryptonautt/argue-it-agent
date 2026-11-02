import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";
import { runAction } from "@domain/action";
import { APPEAL_GROUND_VALUES, APPEAL_TEXT_MAX } from "@domain/appeals/rules";
import { requireUser } from "@domain/auth";
import { APPEAL_DRAFT_KEY } from "@domain/explain/rules";
import { prepareAppealDraft } from "@domain/explain/service";
import { ok } from "@domain/lib/action-result";
import { runDomain } from "../server/lib/domain-action";

export default defineAction({
  description:
    "Pre-fill (not submit) the appeal form on the verdict page for the signed-in debater. Checks the user can still appeal (participant, 48h window, no earlier appeal) and fails with CONFLICT otherwise. The user reviews, edits and submits it themselves with file-appeal.",
  schema: z.object({
    competitionId: z.string().describe("The debate (competition) id whose verdict is being appealed"),
    ground: z
      .enum(APPEAL_GROUND_VALUES)
      .describe(
        'Appeal ground, one of: "evidence_overlooked", "factual_error", "wrong_rubric", "submission_excluded", "technical_failure"',
      ),
    statement: z
      .string()
      .max(APPEAL_TEXT_MAX)
      .describe(`What went wrong, in the user's voice, pointing at the exact verdict text and their own words (20–${APPEAL_TEXT_MAX} chars)`),
  }),
  outputSchema: z.object({
    competitionId: z.string(),
    ground: z.enum(APPEAL_GROUND_VALUES),
    statement: z.string(),
    closesAt: z.string(),
    message: z.string(),
  }),
  http: false,
  run: async (args) =>
    runDomain(
      runAction(async () => {
        const user = await requireUser();
        const draft = await prepareAppealDraft(user, args);
        await writeAppStateForCurrentTab(APPEAL_DRAFT_KEY, {
          ...draft,
          draftedAt: new Date().toISOString(),
          _writeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        });
        return ok({
          ...draft,
          message: "The appeal form on the verdict page is pre-filled. The user reviews, edits and submits it.",
        });
      }),
    ),
});
