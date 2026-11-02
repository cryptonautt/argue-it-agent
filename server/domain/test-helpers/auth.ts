/**
 * Act as a user in tests: server code calling getSession()/requireUser() sees this user.
 *
 *   const { user } = await createTestUser(t.db);
 *   actAs(user.id);
 *   const result = await createArgument({...});
 *   actAsSignedOut();
 */
import { afterEach } from "vitest";
import { setTestSessionUser } from "@domain/auth";

export function actAs(userId: string): void {
  setTestSessionUser(userId);
}

export function actAsSignedOut(): void {
  setTestSessionUser(null);
}

/** Restore real (cookie) sessions. Registered automatically after each test when this file is imported. */
export function resetSession(): void {
  setTestSessionUser(undefined);
}

afterEach(() => {
  resetSession();
});
