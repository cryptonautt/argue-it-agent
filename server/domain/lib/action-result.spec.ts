import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ActionError, fail, fromZodError, ok, unwrap } from "./action-result";

describe("ActionResult helpers", () => {
  it("ok/fail shapes", () => {
    expect(ok({ id: "1" })).toEqual({ ok: true, data: { id: "1" } });
    expect(ok()).toEqual({ ok: true, data: undefined });
    expect(fail("Nope")).toEqual({ ok: false, error: "Nope" });
    expect(fail("Nope", { code: "FORBIDDEN" })).toEqual({ ok: false, error: "Nope", code: "FORBIDDEN" });
  });

  it("fromZodError maps issues to field paths", () => {
    const schema = z.object({ title: z.string().min(3, "Too short"), links: z.array(z.url("Bad link")) });
    const parsed = schema.safeParse({ title: "a", links: ["x"] });
    if (parsed.success) throw new Error("expected failure");
    const result = fromZodError(parsed.error);
    expect(result.code).toBe("VALIDATION");
    expect(result.fieldErrors).toEqual({ title: ["Too short"], "links.0": ["Bad link"] });
  });

  it("ActionError converts to a failure", () => {
    const error = new ActionError("NOT_FOUND", "Gone", { id: ["Gone"] });
    expect(error.toResult()).toEqual({ ok: false, error: "Gone", code: "NOT_FOUND", fieldErrors: { id: ["Gone"] } });
  });

  it("unwrap", () => {
    expect(unwrap(ok(5))).toBe(5);
    expect(() => unwrap(fail("bad"))).toThrow("bad");
  });
});
