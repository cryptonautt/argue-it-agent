import type { UserRole, UserStatus } from "@domain/db/schema";
import { now } from "@domain/lib/time";

/** The signed-in user as every server module sees it (fresh from the DB on each request). */
export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  suspendedUntil: Date | null;
  /** From profiles. Null only if profile creation failed mid sign-up (treat as onboarding needed). */
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

const ROLE_RANK: Record<UserRole, number> = { user: 0, moderator: 1, admin: 2 };

/** True if `role` is at least `required` (admin ⊇ moderator ⊇ user). */
export function hasRole(role: UserRole, required: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

/**
 * Suspended users can read but not write (design §5.4). A suspension with a past `suspendedUntil`
 * has lapsed and no longer applies (moderation may tidy the status lazily).
 */
export function isSuspended(user: Pick<SessionUser, "status" | "suspendedUntil">, at: Date = now()): boolean {
  if (user.status !== "suspended") return false;
  return user.suspendedUntil === null || user.suspendedUntil.getTime() > at.getTime();
}
