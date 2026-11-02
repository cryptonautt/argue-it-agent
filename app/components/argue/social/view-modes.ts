/**
 * The viewer-state decisions the reference async server components made inline, now pure so a route
 * loader (or the action that feeds it) can compute them and the components stay data-in, JSX-out.
 * Logic copied unchanged from the reference PositionBar / ReactionButton / CommentThread / FollowButton.
 */
import type { PositionPickerMode } from "./position-picker";
import type { ReactionMode } from "./reaction-toggle";

export interface ViewerLike {
  id: string;
  status?: string;
  suspendedUntil?: Date | string | null;
}

export interface TargetLike {
  authorId: string;
  /** `status === "visible"` on the argument or comment. */
  open: boolean;
}

export function signInHrefFor(argumentId: string): string {
  return `/sign-in?next=${encodeURIComponent(`/a/${argumentId}`)}`;
}

export function positionModeFor(viewer: ViewerLike | null, argument: TargetLike, blocked: boolean): PositionPickerMode {
  if (!viewer) return "signed-out";
  if (!argument.open) return "closed";
  if (blocked) return "blocked";
  return "open";
}

export function reactionModeFor(viewer: ViewerLike | null, target: TargetLike, blocked: boolean): ReactionMode {
  if (!viewer) return "signed-out";
  if (viewer.id === target.authorId) return "own";
  if (!target.open || blocked) return "disabled";
  return "open";
}

/** `suspended` is the result of the reference `isSuspended(viewer)` (computed where the clock lives). */
export function commentClosedReason(argumentOpen: boolean, blocked: boolean, suspended: boolean): string | null {
  if (!argumentOpen) return "This argument is closed to new comments.";
  if (blocked) return "You can't comment on this argument.";
  if (suspended) return "Your account is suspended. You can read, but not post.";
  return null;
}
