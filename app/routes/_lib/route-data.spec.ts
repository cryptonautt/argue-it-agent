import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callAction = vi.fn();
vi.mock("@agent-native/core/client/hooks", () => ({ callAction: (...args: unknown[]) => callAction(...args) }));
vi.mock("@agent-native/core/client/api-path", () => ({ appPath: (p: string) => p }));
vi.mock("@agent-native/core/client/sign-in-return", () => ({
  buildSignInReturnHref: ({ returnTo }: { returnTo: string }) => `/sign-in?return=${encodeURIComponent(returnTo)}`,
}));

import {
  loadAction,
  loadStaffAction,
  readLoadError,
  requireUuid,
  welcomeHref,
} from "./route-data";

function actionError(errorCode: string | undefined, status: number, actionMessage = "nope") {
  return Object.assign(new Error(actionMessage), { errorCode, status, actionMessage });
}

function sessionResponds(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => body })),
  );
}

const request = new Request("http://localhost/c/abc?x=1");

async function thrown(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a throw");
}

beforeEach(() => {
  callAction.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readLoadError", () => {
  it("normalises errorCode case and keeps the action message", () => {
    expect(readLoadError(actionError("not-found", 404, "No such debate"))).toEqual({
      code: "NOT_FOUND",
      message: "No such debate",
      status: 404,
    });
  });

  it("falls back to the HTTP status, then INTERNAL with a generic message", () => {
    expect(readLoadError({ status: 403 }).code).toBe("FORBIDDEN");
    const unknown = readLoadError(new Error("boom"));
    expect(unknown.code).toBe("INTERNAL");
    expect(unknown.message).toMatch(/something went wrong/i);
  });
});

describe("loadAction", () => {
  it("calls the GET action and returns its data", async () => {
    callAction.mockResolvedValue({ id: "c1" });
    await expect(loadAction("get-competition", { competitionId: "c1" }, request)).resolves.toEqual({ id: "c1" });
    expect(callAction).toHaveBeenCalledWith("get-competition", { competitionId: "c1" }, { method: "GET" });
  });

  it("UNAUTHENTICATED with no framework session sends a full-document redirect to sign-in with the return path", async () => {
    callAction.mockRejectedValue(actionError("UNAUTHENTICATED", 401));
    sessionResponds(null, false);
    const res = await thrown(loadAction("get-competition", {}, request));
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/sign-in?return=%2Fc%2Fabc%3Fx%3D1");
    expect(res.headers.get("X-Remix-Reload-Document")).toBe("true");
  });

  it("UNAUTHENTICATED while the framework says signed in redirects to /welcome (needs-handle)", async () => {
    callAction.mockRejectedValue(actionError("UNAUTHENTICATED", 401));
    sessionResponds({ email: "new@argueit.test" });
    const res = await thrown(loadAction("get-competition", {}, request));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(welcomeHref("/c/abc?x=1"));
    expect(res.headers.get("Location")).toBe("/welcome?setup=1&next=%2Fc%2Fabc%3Fx%3D1");
  });

  it("an explicit NEEDS_HANDLE code redirects to /welcome without asking the session", async () => {
    callAction.mockRejectedValue(actionError("NEEDS_HANDLE", 403));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await thrown(loadAction("get-verdict", {}, request));
    expect(res.headers.get("Location")).toBe("/welcome?setup=1&next=%2Fc%2Fabc%3Fx%3D1");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("NOT_FOUND and a null result both become a 404 route error", async () => {
    callAction.mockRejectedValueOnce(actionError("NOT_FOUND", 404, "Gone"));
    const a = await thrown(loadAction("get-verdict", {}, request));
    expect(a.type).toBe("DataWithResponseInit");
    expect(a.init.status).toBe(404);
    expect(a.data.message).toBe("Gone");

    callAction.mockResolvedValueOnce(null);
    const b = await thrown(loadAction("get-verdict", {}, request));
    expect(b.init.status).toBe(404);
  });

  it("FORBIDDEN becomes a 403 route error carrying no data", async () => {
    callAction.mockRejectedValue(actionError("FORBIDDEN", 403, "Moderators only"));
    const res = await thrown(loadAction("list-review-queue", {}, request));
    expect(res.init.status).toBe(403);
    expect(res.data).toEqual({ message: "Moderators only" });
  });
});

describe("loadStaffAction", () => {
  it("returns { ok:false, forbidden } for a non-staff user instead of throwing", async () => {
    callAction.mockRejectedValue(actionError("FORBIDDEN", 403, "Moderators only"));
    await expect(loadStaffAction("list-review-queue", {}, request)).resolves.toEqual({
      ok: false,
      forbidden: "Moderators only",
    });
  });

  it("returns data for staff and still redirects a signed-out visitor", async () => {
    callAction.mockResolvedValueOnce({ review: [] });
    await expect(loadStaffAction("list-review-queue", {}, request)).resolves.toEqual({
      ok: true,
      data: { review: [] },
    });

    callAction.mockRejectedValueOnce(actionError("UNAUTHENTICATED", 401));
    sessionResponds({});
    const res = await thrown(loadStaffAction("list-review-queue", {}, request));
    expect(res.headers.get("Location")).toMatch(/^\/sign-in\?return=/);
  });
});

describe("requireUuid", () => {
  it("passes a uuid and 404s anything else", async () => {
    expect(requireUuid("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
    const bad = (() => {
      try {
        requireUuid("abc");
      } catch (e) {
        return e as any;
      }
    })();
    expect(bad.init.status).toBe(404);
  });
});
