import { describe, expect, it, vi } from "vitest";
import { runAction } from "@domain/action";
import { ok } from "@domain/lib/action-result";
import { refresh, revalidatePath } from "next/cache";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { after } from "next/server";

describe("server shims for next/*", () => {
  it("notFound() throws ActionError NOT_FOUND, which runAction turns into a failure result", async () => {
    expect(() => notFound()).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    await expect(runAction(async () => notFound())).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("redirect() fails loudly: runAction rejects instead of returning a failure result", async () => {
    await expect(runAction(async () => redirect("/x"))).rejects.toThrow("redirect() is not supported in domain code");
  });

  it("unstable_rethrow is a no-op for ordinary errors", () => {
    expect(() => unstable_rethrow(new Error("boom"))).not.toThrow();
  });

  it("revalidatePath and refresh are no-ops", () => {
    expect(revalidatePath("/")).toBeUndefined();
    expect(refresh()).toBeUndefined();
  });

  it("after() runs the callback detached and logs (does not throw) when it fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ran = vi.fn();
    after(ran);
    after(() => {
      throw new Error("kick failed");
    });
    expect(ran).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ran).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("[after] background task failed", expect.any(Error));
    error.mockRestore();
  });

  it("runAction still returns ok results", async () => {
    await expect(runAction(async () => ok(1))).resolves.toEqual({ ok: true, data: 1 });
  });
});
