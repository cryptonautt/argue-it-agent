/**
 * Who may change an argument, and when (design §2, §4.7; PRD §8.2). Pure so the page (to decide which
 * controls to show) and the server actions (to enforce) share one rule.
 *
 * - Only the author edits or deletes their own argument. Moderators act through moderation tools instead.
 * - Editing stops for good once a challenge on it has been accepted (`locked_at`, or an accepted
 *   competition when the lock flag has not been written yet): the debate's terms were agreed against it.
 * - Hidden arguments are under moderator review and removed ones are gone: neither can be edited or deleted.
 * - Deleting stays possible after the lock; debates already running keep their frozen terms (§4.2) and the
 *   page shows a "This argument was removed" placeholder (§4.7).
 */
import type { ContentStatus } from "@domain/db/schema";

export interface ArgumentPolicySubject {
  authorId: string;
  status: ContentStatus;
  lockedAt: Date | string | null;
}

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: "signed_out" | "not_author" | "hidden" | "removed" | "locked"; message: string };

export function isLocked(argument: Pick<ArgumentPolicySubject, "lockedAt">, hasAcceptedChallenge: boolean): boolean {
  return argument.lockedAt !== null || hasAcceptedChallenge;
}

function baseDecision(argument: ArgumentPolicySubject, viewerId: string | null): PolicyDecision | null {
  if (!viewerId) return { allowed: false, reason: "signed_out", message: "Sign in to do that." };
  if (argument.authorId !== viewerId) {
    return { allowed: false, reason: "not_author", message: "Only the author can change this argument." };
  }
  if (argument.status === "removed") {
    return { allowed: false, reason: "removed", message: "This argument has been removed." };
  }
  if (argument.status === "hidden") {
    return {
      allowed: false,
      reason: "hidden",
      message: "This argument is hidden while moderators review it, so it can't be changed right now.",
    };
  }
  return null;
}

export function canEditArgument(
  argument: ArgumentPolicySubject,
  viewerId: string | null,
  hasAcceptedChallenge: boolean,
): PolicyDecision {
  const blocked = baseDecision(argument, viewerId);
  if (blocked) return blocked;
  if (isLocked(argument, hasAcceptedChallenge)) {
    return {
      allowed: false,
      reason: "locked",
      message: "A challenge on this argument has been accepted, so it's locked and can no longer be edited.",
    };
  }
  return { allowed: true };
}

export function canDeleteArgument(argument: ArgumentPolicySubject, viewerId: string | null): PolicyDecision {
  return baseDecision(argument, viewerId) ?? { allowed: true };
}
