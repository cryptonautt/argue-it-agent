import { isActionContractError, isNoWriteError, type ActionContractError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActionError, fail, ok, type ActionErrorCode } from "@domain/lib/action-result";

const mocks = vi.hoisted(() => ({
  email: undefined as string | undefined,
  ensureAppUser: vi.fn<(email: string) => Promise<unknown>>(),
  requireRole: vi.fn<(role: string) => Promise<unknown>>(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({ getRequestUserEmail: () => mocks.email }));
vi.mock("@domain/auth", () => ({ ensureAppUser: mocks.ensureAppUser, requireRole: mocks.requireRole }));

const { DOMAIN_ERROR_MAP, NEEDS_HANDLE, authorizeModerator, domainErrors, runDomain, runDomainQuery, withIdempotencyKey } =
  await import("./domain-action");

/** Await a promise that must reject with a framework action error, and return it. */
async function caught(promise: Promise<unknown>): Promise<ActionContractError> {
  try {
    await promise;
  } catch (error) {
    if (isActionContractError(error)) return error;
    throw new Error(`expected an action contract error, got: ${String(error)}`);
  }
  throw new Error("expected the promise to reject");
}

beforeEach(() => {
  mocks.email = undefined;
  mocks.ensureAppUser.mockReset();
  mocks.requireRole.mockReset();
});

describe("runDomain", () => {
  it("runDomain returns data on ok", async () => {
    await expect(runDomain(Promise.resolve(ok({ id: "a1" })))).resolves.toEqual({ id: "a1" });
  });

  it("runDomain throws FORBIDDEN with message on fail", async () => {
    const error = await caught(runDomain(Promise.resolve(fail("Only moderators can do that.", { code: "FORBIDDEN" }))));
    expect(error.errorCode).toBe("FORBIDDEN");
    expect(error.message).toContain("Only moderators can do that.");
    expect(error.statusCode).toBe(403);
  });

  it("runDomain keeps fieldErrors on VALIDATION", async () => {
    const fieldErrors = { title: ["Keep the title under 120 characters."] };
    const error = await caught(
      runDomain(Promise.resolve(fail("Please fix the highlighted fields.", { code: "VALIDATION", fieldErrors }))),
    );
    expect(error.errorCode).toBe("VALIDATION");
    expect(error.details).toEqual({ fieldErrors });
    expect(error.statusCode).toBe(400);
    // Rejected before any write: the agent may correct its arguments and retry.
    expect(isNoWriteError(error)).toBe(true);
  });

  it("runDomain maps SUSPENDED", async () => {
    const error = await caught(runDomain(Promise.resolve(fail("Your account is suspended.", { code: "SUSPENDED" }))));
    expect(error.errorCode).toBe("SUSPENDED");
    expect(error.message).toContain("Your account is suspended.");
  });

  it("maps every ActionErrorCode one-to-one and publishes it", async () => {
    const codes = Object.keys(DOMAIN_ERROR_MAP) as ActionErrorCode[];
    expect(codes).toHaveLength(9);
    for (const code of codes) {
      const error = await caught(runDomain(Promise.resolve(fail(`failed: ${code}`, { code }))));
      expect(error.errorCode).toBe(code);
      expect(error.statusCode).toBe(DOMAIN_ERROR_MAP[code].statusCode);
      expect(domainErrors.codes).toContain(code);
    }
    expect(domainErrors.codes).toContain(NEEDS_HANDLE);
  });

  it("treats a failure without a code as INTERNAL", async () => {
    const error = await caught(runDomain(Promise.resolve({ ok: false as const, error: "boom" })));
    expect(error.errorCode).toBe("INTERNAL");
    expect(error.statusCode).toBe(500);
  });

  it("maps a domain ActionError that escapes as a rejection", async () => {
    const error = await caught(runDomain(Promise.reject(new ActionError("NOT_FOUND", "That debate doesn't exist."))));
    expect(error.errorCode).toBe("NOT_FOUND");
  });

  it("rethrows non-domain errors unchanged", async () => {
    const boom = new Error("db down");
    await expect(runDomain(Promise.reject(boom))).rejects.toBe(boom);
  });

  it("turns UNAUTHENTICATED into NEEDS_HANDLE for a framework user with no ARGUE IT profile", async () => {
    mocks.email = "new@argueit.test";
    mocks.ensureAppUser.mockResolvedValue("needs-handle");
    const error = await caught(runDomain(Promise.resolve(fail("Sign in to do that.", { code: "UNAUTHENTICATED" }))));
    expect(error.errorCode).toBe(NEEDS_HANDLE);
    expect(mocks.ensureAppUser).toHaveBeenCalledWith("new@argueit.test");
  });

  it("keeps UNAUTHENTICATED when there is no framework session", async () => {
    const error = await caught(runDomain(Promise.resolve(fail("Sign in to do that.", { code: "UNAUTHENTICATED" }))));
    expect(error.errorCode).toBe("UNAUTHENTICATED");
    expect(mocks.ensureAppUser).not.toHaveBeenCalled();
  });
});

describe("runDomainQuery", () => {
  it("returns the value", async () => {
    await expect(runDomainQuery(async () => [1, 2])).resolves.toEqual([1, 2]);
  });

  it("maps null to NOT_FOUND", async () => {
    const error = await caught(runDomainQuery(async () => null, "That argument doesn't exist."));
    expect(error.errorCode).toBe("NOT_FOUND");
    expect(error.message).toContain("That argument doesn't exist.");
  });

  it("maps a thrown domain ActionError", async () => {
    const error = await caught(
      runDomainQuery(async () => {
        throw new ActionError("UNAUTHENTICATED", "Sign in to do that.");
      }),
    );
    expect(error.errorCode).toBe("UNAUTHENTICATED");
  });
});

describe("authorizeModerator", () => {
  it("passes for staff", async () => {
    mocks.requireRole.mockResolvedValue({ id: "u1", role: "moderator" });
    await expect(authorizeModerator()).resolves.toBeUndefined();
    expect(mocks.requireRole).toHaveBeenCalledWith("moderator");
  });

  it("denies with the mapped FORBIDDEN code", async () => {
    mocks.requireRole.mockRejectedValue(new ActionError("FORBIDDEN", "Only moderators can do that."));
    const error = await caught(authorizeModerator());
    expect(error.errorCode).toBe("FORBIDDEN");
  });
});

describe("withIdempotencyKey", () => {
  it("keeps a caller key and fills a missing one with a uuid", () => {
    expect(withIdempotencyKey({ idempotencyKey: "k" }).idempotencyKey).toBe("k");
    expect(withIdempotencyKey({ a: 1 } as { a: number; idempotencyKey?: string }).idempotencyKey).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });
});
