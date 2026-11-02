import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser } from "@domain/test-helpers/factories";
import { setupTestDb } from "@domain/test-helpers/db";

const requestEmail = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => requestEmail.value,
}));

const { ensureAppUser, getSession, requireRole, requireUser, setTestSessionUser } = await import("@domain/auth");

describe("auth bridge (framework session email → ARGUE IT users)", () => {
  const t = setupTestDb();

  beforeEach(() => {
    requestEmail.value = undefined;
    // Exercise the real (framework) path, not the test override.
    setTestSessionUser(undefined);
  });
  afterEach(() => {
    requestEmail.value = undefined;
    setTestSessionUser(undefined);
  });

  it("getSession returns null when there is no request email", async () => {
    await createTestUser(t.db, { handle: "ada", email: "ada@example.test" });
    expect(await getSession()).toBeNull();
  });

  it("getSession maps a known email to SessionUser with role and handle", async () => {
    const { user } = await createTestUser(t.db, { handle: "ngozi", email: "ngozi@argueit.test", role: "moderator" });
    requestEmail.value = "  Ngozi@ArgueIt.TEST ";
    const session = await getSession();
    expect(session).toMatchObject({ id: user.id, email: "ngozi@argueit.test", role: "moderator", handle: "ngozi" });
  });

  it("ensureAppUser returns \"needs-handle\" for an unknown email", async () => {
    expect(await ensureAppUser("nobody@example.test")).toBe("needs-handle");
  });

  it("ensureAppUser returns the SessionUser for a known email", async () => {
    const { user } = await createTestUser(t.db, { handle: "emeka", email: "emeka@argueit.test" });
    expect(await ensureAppUser("EMEKA@argueit.test")).toMatchObject({ id: user.id, handle: "emeka" });
  });

  it("requireRole(\"moderator\") throws FORBIDDEN for role user", async () => {
    await createTestUser(t.db, { handle: "chidi", email: "chidi@argueit.test" });
    requestEmail.value = "chidi@argueit.test";
    await expect(requireRole("moderator")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requireUser throws UNAUTHENTICATED with no request email and an unknown email", async () => {
    await expect(requireUser()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    requestEmail.value = "stranger@example.test";
    await expect(requireUser()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("requireUser throws SUSPENDED for a suspended user, read fresh from the database", async () => {
    const { user } = await createTestUser(t.db, { handle: "zainab", email: "zainab@argueit.test" });
    requestEmail.value = "zainab@argueit.test";
    await expect(requireUser()).resolves.toMatchObject({ id: user.id });
    const { users } = await import("@domain/db/schema");
    const { eq } = await import("drizzle-orm");
    await t.db.update(users).set({ status: "suspended", suspendedUntil: null }).where(eq(users.id, user.id));
    await expect(requireUser()).rejects.toMatchObject({ code: "SUSPENDED" });
    await expect(requireUser({ allowSuspended: true })).resolves.toMatchObject({ id: user.id });
  });

  it("setTestSessionUser overrides the request email", async () => {
    const { user } = await createTestUser(t.db, { handle: "tunde", email: "tunde@argueit.test" });
    requestEmail.value = undefined;
    setTestSessionUser(user.id);
    expect(await getSession()).toMatchObject({ id: user.id });
    setTestSessionUser(null);
    requestEmail.value = "tunde@argueit.test";
    expect(await getSession()).toBeNull();
  });
});
