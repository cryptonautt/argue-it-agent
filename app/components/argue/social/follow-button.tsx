import { UserPlus } from "lucide-react";
import { ButtonLink } from "@/components/argue/ui/button";
import type { FollowState } from "@domain/social/types";
import { FollowToggle } from "./follow-toggle";

export interface FollowButtonProps {
  userId: string;
  /** The profile handle of `userId`. */
  handle: string;
  /** The signed-in viewer's id, or null when signed out. */
  viewerId: string | null;
  /**
   * Loader-fed (reference `getFollowState(userId, viewerId)`). `null` when the viewer may not follow
   * (blocked either way, or the profile is gone): the button renders nothing, as in the reference.
   */
  state: FollowState | null;
}

/**
 * Follow / unfollow a user. Renders nothing on your own profile or across a block.
 * Followers are a community signal only — they never affect debate rating or judging.
 * Ported from an async server component: data now arrives as props from the route loader.
 */
export function FollowButton({ userId, handle, viewerId, state }: FollowButtonProps) {
  if (viewerId === userId) return null;
  if (!viewerId) {
    return (
      <ButtonLink href="/sign-in" variant="primary" size="sm" icon={<UserPlus aria-hidden className="size-4" />}>
        Follow
      </ButtonLink>
    );
  }
  if (!state) return null;
  return <FollowToggle initial={state} name={`@${handle}`} />;
}
