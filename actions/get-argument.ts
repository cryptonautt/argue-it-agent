import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getArgumentDetail, hasOpenDebates, type ArgumentDetail } from "@domain/arguments/queries";
import { hasRole, requireUser, type SessionUser } from "@domain/auth";
import { listArgumentChallenges } from "@domain/competitions/queries";
import { getCommentCounts, listCommentThreads } from "@domain/social/comments";
import { getFollowState } from "@domain/social/follows";
import { getPositionSummary } from "@domain/social/positions";
import { getReactionSummary } from "@domain/social/reactions";

import { domainErrors, runDomainQuery, toJson } from "../server/lib/domain-action.js";
import { argumentIdInput } from "../server/lib/domain-action-schemas.js";
import { positionSummaryOutput } from "../server/lib/domain-action-outputs.js";

type Visibility = "full" | "revealed" | "placeholder";

/**
 * Reference `visibilityFor` (src/app/a/[id]/page.tsx, design §4.7): staff see everything; the author sees
 * their own hidden post; everyone else gets a placeholder. `getArgumentDetail` returns every status, so
 * this gate is what keeps a hidden or removed body away from the agent.
 */
function visibilityFor(argument: ArgumentDetail, viewer: SessionUser): Visibility {
  if (argument.status === "visible") return "full";
  if (hasRole(viewer.role, "moderator")) return "revealed";
  if (argument.status === "hidden" && viewer.id === argument.authorId) return "revealed";
  return "placeholder";
}

function placeholder(argument: ArgumentDetail) {
  return {
    id: argument.id,
    status: argument.status,
    removedBy: argument.removedBy,
    createdAt: argument.createdAt,
    category: argument.category,
    author: argument.author,
    locked: argument.locked,
  };
}

export default defineAction({
  description:
    "Read one argument: its title, proposition, body and links (when visible to the user), AGREE/AGAINST counts, reactions, the debates started from it, and the first page of comments.",
  schema: argumentIdInput,
  outputSchema: z.looseObject({
    visibility: z.enum(["full", "revealed", "placeholder"]),
    argument: z.looseObject({ id: z.string(), status: z.enum(["visible", "hidden", "removed"]) }),
    positions: positionSummaryOutput,
    challenges: z.array(z.looseObject({ id: z.string(), status: z.string(), proposition: z.string() })),
    comments: z.looseObject({ threads: z.array(z.unknown()), nextCursor: z.string().nullable(), total: z.number() }),
    viewer: z.looseObject({ id: z.string(), role: z.enum(["user", "moderator", "admin"]), handle: z.string().nullable() }),
    reaction: z.looseObject({}),
    follow: z.looseObject({ userId: z.string(), following: z.boolean(), followerCount: z.number() }).nullable(),
    hasOpenDebates: z.boolean(),
  }),
  errors: domainErrors,
  http: { method: "GET" },
  run: async ({ id }) => {
    const { viewer, argument } = await runDomainQuery(async () => {
      const viewer = await requireUser({ allowSuspended: true });
      const argument = await getArgumentDetail(id, viewer.id);
      return argument ? { viewer, argument } : null;
    }, "That argument doesn't exist.");
    const visibility = visibilityFor(argument, viewer);
    const isAuthor = viewer.id === argument.authorId;
    const blocked = argument.viewerBlockedAuthor || argument.authorBlockedViewer;
    const [positions, challenges, comments, commentCounts, reaction, follow, openDebates] = await Promise.all([
      getPositionSummary(argument.id, viewer.id),
      listArgumentChallenges(argument.id),
      listCommentThreads({ argumentId: argument.id, viewerId: viewer.id }),
      getCommentCounts([argument.id]),
      getReactionSummary("argument", argument.id, viewer.id),
      // No follow control on your own post or across a block (reference a/[id] page).
      isAuthor || blocked ? Promise.resolve(null) : getFollowState(argument.authorId, viewer.id),
      // The reference only asks this for the author (it gates the delete/edit warning).
      isAuthor ? hasOpenDebates(argument.id) : Promise.resolve(false),
    ]);
    return toJson({
      visibility,
      argument: visibility === "placeholder" ? placeholder(argument) : argument,
      viewer: { id: viewer.id, role: viewer.role, handle: viewer.handle, status: viewer.status },
      positions,
      challenges,
      comments: { ...comments, total: commentCounts.get(argument.id) ?? 0 },
      reaction,
      follow,
      hasOpenDebates: openDebates,
    });
  },
});
