import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

import { navFromCommand, pathForNav } from "../app/hooks/navigation-map";

const ARGUE_VIEW_HELP =
  'ARGUE IT views: "feed", "argument" (needs argumentId), "new-argument", "new-challenge" (optional argumentId), ' +
  '"debate" or "verdict" (need competitionId), "review-queue" (optional tab "review" | "appeals"), ' +
  '"profile" (needs handle), "welcome", "rules", "markets", "market" (needs slug). Template views ("chat", "settings", "database", …) also work.';

export default defineAction({
  description: `Navigate the user's UI to an ARGUE IT screen or a path. ${ARGUE_VIEW_HELP} Writes a one-shot navigate command the UI consumes.`,
  schema: z.object({
    view: z.string().optional().describe(`View name to open. ${ARGUE_VIEW_HELP}`),
    path: z.string().optional().describe("Router-local URL path to open, e.g. /c/<competitionId>/verdict"),
    argumentId: z.string().optional().describe('Argument id for view "argument" or "new-challenge"'),
    competitionId: z.string().optional().describe('Competition (debate) id for view "debate" or "verdict"'),
    handle: z.string().optional().describe('Profile handle for view "profile"'),
    slug: z.string().optional().describe('Polymarket event slug for view "market"'),
    tab: z.enum(["review", "appeals"]).optional().describe('Tab for view "review-queue": "review" (default) or "appeals"'),
    threadId: z.string().optional().describe("Chat thread ID to open (view \"chat\")"),
  }),
  outputSchema: z.string(),
  http: false,
  run: async (args) => {
    if (!args.view && !args.path) {
      throw new Error("At least --view or --path is required.");
    }
    const nav: Record<string, string> = {};
    // ARGUE IT views resolve to a concrete path here so the UI never has to guess a record.
    const argue = args.path ? null : navFromCommand(args);
    if (argue) {
      Object.assign(nav, argue);
      nav.path = pathForNav(argue);
    } else {
      if (args.view) nav.view = args.view;
      if (args.path) nav.path = args.path;
      if (args.threadId) nav.threadId = args.threadId;
    }
    nav._writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeAppStateForCurrentTab("navigate", nav);
    return `Navigating to ${nav.path ?? args.view}`;
  },
});
