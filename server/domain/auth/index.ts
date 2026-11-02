/**
 * Auth bridge: framework sessions → ARGUE IT users.
 *
 * The Agent-Native framework owns sign-in and sessions (its own Better Auth). Every request runs inside a
 * request context that carries the signed-in user's email; `getRequestUserEmail()` reads it. ARGUE IT's
 * `users` table is the profile/role table, keyed by (case-insensitive) email.
 *
 * Exported names and signatures match the reference `src/server/auth/index.ts`, so every domain module
 * keeps working. Removed: `getAuth` (second Better Auth instance), `requirePageUser`, `requirePageRole`
 * (route loaders call requireUser/requireRole and redirect on error). New: `ensureAppUser`.
 */
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { eq, sql } from "drizzle-orm";
import { ActionError } from "@domain/lib/action-result";
import { formatDateTime } from "@domain/lib/time";
import { db } from "@domain/db";
import { profiles, users, type UserRole } from "@domain/db/schema";
import { hasRole, isSuspended, type SessionUser } from "./roles";

export { hasRole, isSuspended, type SessionUser } from "./roles";

// --- Test hook --------------------------------------------------------------------------------------
const globalForSession = globalThis as unknown as { __argueItTestSessionUserId?: string | null };

/**
 * Tests only: make getSession()/requireUser() act as `userId` (or signed out with `null`;
 * `undefined` restores the real request-context session). Use `actAs()` from test-helpers/auth.ts.
 */
export function setTestSessionUser(userId: string | null | undefined): void {
  if (process.env.NODE_ENV === "production") throw new Error("setTestSessionUser is test-only");
  globalForSession.__argueItTestSessionUserId = userId;
}

// --- Lookups ----------------------------------------------------------------------------------------

const sessionColumns = {
  id: users.id,
  email: users.email,
  role: users.role,
  status: users.status,
  suspendedUntil: users.suspendedUntil,
  handle: profiles.handle,
  displayName: profiles.displayName,
  avatarUrl: profiles.avatarUrl,
};

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Load the SessionUser row for an email (any status), or undefined. */
async function findByEmail(email: string) {
  const [row] = await db
    .select(sessionColumns)
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(sql`lower(${users.email})`, normaliseEmail(email)))
    .limit(1);
  return row;
}

/** Load the SessionUser for a user id (role/status always fresh from the DB). Deleted users → null. */
export async function getSessionUserById(userId: string): Promise<SessionUser | null> {
  const [row] = await db
    .select(sessionColumns)
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || row.status === "deleted") return null;
  return row;
}

// --- Session ----------------------------------------------------------------------------------------

/**
 * The current user, or null when signed out or when the signed-in email has no ARGUE IT user yet
 * (see `ensureAppUser`). Not memoised: role/status/suspension are read fresh on every call.
 */
export async function getSession(): Promise<SessionUser | null> {
  const testUserId = globalForSession.__argueItTestSessionUserId;
  if (testUserId !== undefined) return testUserId === null ? null : getSessionUserById(testUserId);

  const email = getRequestUserEmail();
  if (!email || !email.trim()) return null;
  const row = await findByEmail(email);
  if (!row || row.status === "deleted") return null;
  return row;
}

/**
 * For route loaders / onboarding: the ARGUE IT user for a signed-in framework email, or
 * `"needs-handle"` when there is no `users` row yet (or it has no profile handle), so the caller sends
 * the user to `/welcome` to pick a handle. A deleted account throws FORBIDDEN rather than being offered
 * a fresh profile on the same email.
 */
export async function ensureAppUser(email: string): Promise<SessionUser | "needs-handle"> {
  const row = await findByEmail(email);
  if (!row) return "needs-handle";
  if (row.status === "deleted") throw new ActionError("FORBIDDEN", "This account has been deleted.");
  if (!row.handle) return "needs-handle";
  return row;
}

export interface RequireUserOptions {
  /** Allow suspended users (read-only operations). Default false: suspended users are rejected. */
  allowSuspended?: boolean;
}

/**
 * For actions / mutations. Throws ActionError("UNAUTHENTICATED") when signed out and
 * ActionError("SUSPENDED") when the user is suspended (unless `allowSuspended`).
 * Inside `runAction()` these become `{ ok: false, code, error }`.
 */
export async function requireUser(options: RequireUserOptions = {}): Promise<SessionUser> {
  const user = await getSession();
  if (!user) throw new ActionError("UNAUTHENTICATED", "Sign in to do that.");
  if (!options.allowSuspended && isSuspended(user)) {
    const until = user.suspendedUntil ? ` until ${formatDateTime(user.suspendedUntil, "UTC")} UTC` : "";
    throw new ActionError("SUSPENDED", `Your account is suspended${until}. You can still read, but not post.`);
  }
  return user;
}

/** requireUser() plus a minimum role. Throws ActionError("FORBIDDEN"). */
export async function requireRole(role: Exclude<UserRole, "user">): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasRole(user.role, role)) throw new ActionError("FORBIDDEN", "You don't have permission to do that.");
  return user;
}
