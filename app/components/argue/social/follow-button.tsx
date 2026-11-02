import { eq } from "drizzle-orm";
import { UserPlus } from "lucide-react";
import { ButtonLink } from "@/components/argue/ui/button";
import { getSession } from "@domain/auth";
import { db } from "@domain/db";
import { profiles } from "@domain/db/schema";
import { isBlocked } from "@domain/social/blocks";
import { getFollowState } from "@domain/social/follows";
import { FollowToggle } from "./follow-toggle";

export interface FollowButtonProps {
  userId: string;
}

/**
 * Follow / unfollow a user. Renders nothing on your own profile or across a block.
 * Followers are a community signal only — they never affect debate rating or judging.
 */
export async function FollowButton({ userId }: FollowButtonProps) {
  const viewer = await getSession();
  if (viewer?.id === userId) return null;
  if (!viewer) {
    return (
      <ButtonLink href="/sign-in" variant="primary" size="sm" icon={<UserPlus aria-hidden className="size-4" />}>
        Follow
      </ButtonLink>
    );
  }
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId), columns: { handle: true } });
  if (!profile || (await isBlocked(viewer.id, userId))) return null;
  const state = await getFollowState(userId, viewer.id);
  return <FollowToggle initial={state} name={`@${profile.handle}`} />;
}
