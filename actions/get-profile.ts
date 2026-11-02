import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireUser } from "@domain/auth";
import {
  getArgumentCount,
  getCommentCount,
  getDebateHistory,
  getPostedArguments,
  getProfileByHandle,
} from "@domain/profiles/queries";
import { getDebateRecord } from "@domain/reputation";
import { hasBlocked, isBlocked } from "@domain/social/blocks";
import { getFollowCounts } from "@domain/social/follows";

import { domainErrors, runDomainQuery, toJson } from "../server/lib/domain-action.js";
import { getProfileInput } from "../server/lib/domain-action-schemas.js";

export default defineAction({
  description:
    "Read a user's public profile by handle: debate record (rating, wins/losses/draws, judge-score averages by criterion), community counts, recent debates and posted arguments. Blocked or deleted accounts return only their status.",
  schema: getProfileInput,
  outputSchema: z.looseObject({
    availability: z.enum(["available", "deleted", "blocked"]),
    isOwnProfile: z.boolean(),
    profile: z.looseObject({ userId: z.string(), handle: z.string(), displayName: z.string() }),
  }),
  errors: domainErrors,
  http: { method: "GET" },
  run: async ({ handle }) => {
    const { viewer, profile } = await runDomainQuery(async () => {
      const viewer = await requireUser({ allowSuspended: true });
      const profile = await getProfileByHandle(handle);
      return profile ? { viewer, profile } : null;
    }, "There's no profile with that handle.");
    const isOwnProfile = viewer.id === profile.userId;

    // Same gates as the reference /u/[handle] page.
    if (profile.status === "deleted") return toJson({ availability: "deleted" as const, isOwnProfile, profile });
    const blockedEitherWay = !isOwnProfile && (await isBlocked(viewer.id, profile.userId));
    if (blockedEitherWay) {
      const viewerBlocks = await hasBlocked(viewer.id, profile.userId);
      return toJson({ availability: "blocked" as const, isOwnProfile, viewerBlocks, profile });
    }

    const [record, follows, commentCount, argumentCount, debates, postedArguments] = await Promise.all([
      getDebateRecord(profile.userId),
      getFollowCounts(profile.userId),
      getCommentCount(profile.userId),
      getArgumentCount(profile.userId),
      getDebateHistory(profile.userId),
      getPostedArguments(profile.userId),
    ]);
    return toJson({
      availability: "available" as const,
      isOwnProfile,
      profile,
      record,
      community: { ...follows, comments: commentCount, arguments: argumentCount },
      debates,
      postedArguments,
    });
  },
});
