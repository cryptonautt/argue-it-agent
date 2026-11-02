import type { ReactionTarget } from "@domain/db/schema";
import type { ReactionSummary } from "@domain/social/types";
import { ReactionToggle, type ReactionMode } from "./reaction-toggle";
import { signInHrefFor } from "./view-modes";

export interface ReactionButtonProps {
  targetType: ReactionTarget;
  targetId: string;
  /** The argument the target belongs to (for the sign-in return path). */
  argumentId: string;
  /** Loader-fed (reference `getReactionSummary(targetType, targetId, viewerId)`). */
  summary: Pick<ReactionSummary, "count" | "viewerReacted">;
  /** Loader-fed; compute with `reactionModeFor` from ./view-modes. */
  mode: ReactionMode;
}

/**
 * React to an argument or comment (one "fire" reaction per user per target).
 * Ported from an async server component: data now arrives as props from the route loader.
 */
export function ReactionButton({ targetType, targetId, argumentId, summary, mode }: ReactionButtonProps) {
  return (
    <ReactionToggle
      targetType={targetType}
      targetId={targetId}
      initialCount={summary.count}
      initialReacted={summary.viewerReacted}
      mode={mode}
      signInHref={signInHrefFor(argumentId)}
    />
  );
}
