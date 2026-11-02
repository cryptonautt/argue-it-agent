import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestUser } from "@domain/test-helpers/factories";
import { fail, ok } from "@domain/lib/action-result";
import { idempotencyKeySchema, withIdempotency } from "./idempotency";

const t = setupTestDb();

describe("withIdempotency", () => {
  it("runs once and replays the stored result", async () => {
    const { user } = await createTestUser(t.db);
    const key = randomUUID();
    const fn = vi.fn(async () => ok({ id: "c1" }));
    expect(await withIdempotency(key, user.id, "challenge.send", fn)).toEqual(ok({ id: "c1" }));
    expect(await withIdempotency(key, user.id, "challenge.send", fn)).toEqual(ok({ id: "c1" }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("scopes keys per user", async () => {
    const a = await createTestUser(t.db);
    const b = await createTestUser(t.db);
    const key = randomUUID();
    const fn = vi.fn(async () => "done");
    await withIdempotency(key, a.user.id, "x", fn);
    await withIdempotency(key, b.user.id, "x", fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rejects a key reused for another action", async () => {
    const { user } = await createTestUser(t.db);
    const key = randomUUID();
    await withIdempotency(key, user.id, "a", async () => 1);
    await expect(withIdempotency(key, user.id, "b", async () => 2)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("reports IN_PROGRESS for a concurrent duplicate", async () => {
    const { user } = await createTestUser(t.db);
    const key = randomUUID();
    let release: () => void = () => {};
    const first = withIdempotency(
      key,
      user.id,
      "a",
      () => new Promise<string>((resolve) => (release = () => resolve("first"))),
    );
    await new Promise((r) => setTimeout(r, 50));
    await expect(withIdempotency(key, user.id, "a", async () => "second")).rejects.toMatchObject({
      code: "IN_PROGRESS",
    });
    release();
    expect(await first).toBe("first");
  });

  it("releases the key when fn throws or returns a failure", async () => {
    const { user } = await createTestUser(t.db);
    const key = randomUUID();
    await expect(withIdempotency(key, user.id, "a", async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await withIdempotency(key, user.id, "a", async () => fail("bad input"))).toEqual(fail("bad input"));
    expect(await withIdempotency(key, user.id, "a", async () => ok(3))).toEqual(ok(3));
  });

  it("idempotencyKeySchema requires a uuid", () => {
    expect(idempotencyKeySchema.safeParse(randomUUID()).success).toBe(true);
    expect(idempotencyKeySchema.safeParse("123").success).toBe(false);
  });
});
