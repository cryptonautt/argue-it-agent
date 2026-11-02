import { beforeEach, describe, expect, it, vi } from "vitest";

const callAction = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({ callAction, signOut }));

import {
  acceptChallenge,
  createArgument,
  declineChallenge,
  decideAppeal,
  deleteArgument,
  loadFeedPage,
  NOT_PORTED_MESSAGE,
  toActionFailure,
} from "./server-actions";

/** What `callAction` throws for a non-2xx response (see core client/use-action.js). */
function actionError(init: { status: number; errorCode?: string; message?: string; details?: unknown }) {
  const error = new Error(`Action x failed: ${init.message ?? ""}`) as Error & Record<string, unknown>;
  error.status = init.status;
  if (init.message !== undefined) error.actionMessage = init.message;
  if (init.errorCode !== undefined) error.errorCode = init.errorCode;
  if (init.details !== undefined) error.details = init.details;
  return error;
}

describe("server-actions stubs", () => {
  beforeEach(() => {
    callAction.mockReset();
  });

  it("stub returns { ok:false, code, fieldErrors } when callAction throws a VALIDATION action error", async () => {
    callAction.mockRejectedValueOnce(
      actionError({
        status: 400,
        errorCode: "VALIDATION",
        message: "Please fix the highlighted fields.",
        details: { fieldErrors: { title: ["Title is too short."] } },
      }),
    );
    const result = await createArgument({ title: "x", body: "y", categorySlug: "sports" } as never);
    expect(result).toEqual({
      ok: false,
      error: "Please fix the highlighted fields.",
      code: "VALIDATION",
      fieldErrors: { title: ["Title is too short."] },
    });
    expect(callAction).toHaveBeenCalledWith("create-argument", expect.any(Object), undefined);
  });

  it("wraps a successful action result as { ok:true, data }", async () => {
    callAction.mockResolvedValueOnce({ id: "arg_1" });
    await expect(createArgument({} as never)).resolves.toEqual({ ok: true, data: { id: "arg_1" } });
  });

  it("sends GET for read actions", async () => {
    callAction.mockResolvedValueOnce({ items: [], nextCursor: null });
    await loadFeedPage({} as never);
    expect(callAction).toHaveBeenCalledWith("list-feed", {}, { method: "GET" });
  });

  it("routes accept and decline to respond-to-challenge with the response field", async () => {
    callAction.mockResolvedValue({ status: "active" });
    await acceptChallenge({ competitionId: "c1", termsHash: "h", idempotencyKey: "k" } as never);
    await declineChallenge({ competitionId: "c1", idempotencyKey: "k" } as never);
    expect(callAction.mock.calls[0]?.[0]).toBe("respond-to-challenge");
    expect(callAction.mock.calls[0]?.[1]).toMatchObject({ competitionId: "c1", response: "accept" });
    expect(callAction.mock.calls[1]?.[1]).toMatchObject({ competitionId: "c1", response: "decline" });
  });

  it("passes draftId through to decide-appeal", async () => {
    callAction.mockResolvedValueOnce({});
    await decideAppeal({ appealId: "a1", decision: "uphold", note: "n", draftId: "d1" } as never);
    expect(callAction).toHaveBeenCalledWith(
      "decide-appeal",
      expect.objectContaining({ draftId: "d1" }),
      undefined,
    );
  });

  it("an unported operation fails plainly and never calls the server", async () => {
    const result = await deleteArgument({} as never);
    expect(result).toEqual({ ok: false, error: NOT_PORTED_MESSAGE, code: "INTERNAL" });
    expect(callAction).not.toHaveBeenCalled();
  });
});

describe("toActionFailure", () => {
  it("accepts lower-case codes", () => {
    expect(toActionFailure(actionError({ status: 403, errorCode: "forbidden", message: "No." }))).toEqual({
      ok: false,
      error: "No.",
      code: "FORBIDDEN",
    });
  });

  it("maps SUSPENDED", () => {
    expect(toActionFailure(actionError({ status: 403, errorCode: "SUSPENDED", message: "Suspended." })).code).toBe(
      "SUSPENDED",
    );
  });

  it("falls back on HTTP status when the code is unknown", () => {
    expect(toActionFailure(actionError({ status: 409, errorCode: "something_else", message: "Taken." })).code).toBe(
      "CONFLICT",
    );
    expect(toActionFailure(actionError({ status: 401 })).code).toBe("UNAUTHENTICATED");
  });

  it("never leaks a raw error message or stack for network failures", () => {
    const result = toActionFailure(new TypeError("Failed to fetch"));
    expect(result).toEqual({ ok: false, error: "Something went wrong. Please try again.", code: "INTERNAL" });
  });
});
