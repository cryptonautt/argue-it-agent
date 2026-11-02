import { afterEach, describe, expect, it } from "vitest";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestUser } from "@domain/test-helpers/factories";
import { ActionError } from "@domain/lib/action-result";
import { HOUR_MS, advanceClock, resetClock, setClock } from "@domain/lib/time";
import { RATE_LIMITS, checkRateLimit, enforceRateLimit, pruneRateLimitHits } from "./rate-limit";

const t = setupTestDb();
afterEach(() => resetClock());

describe("checkRateLimit", () => {
  it("allows up to the limit then blocks with a retry time", async () => {
    setClock(new Date("2026-10-31T10:00:00Z"));
    const { user } = await createTestUser(t.db);
    for (let i = 0; i < RATE_LIMITS.argument.limit; i++) {
      const r = await checkRateLimit(user.id, "argument");
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(RATE_LIMITS.argument.limit - i - 1);
    }
    const blocked = await checkRateLimit(user.id, "argument");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(3600);
  });

  it("is a sliding window", async () => {
    setClock(new Date("2026-10-31T10:00:00Z"));
    const { user } = await createTestUser(t.db);
    for (let i = 0; i < 10; i++) await checkRateLimit(user.id, "argument");
    expect((await checkRateLimit(user.id, "argument")).allowed).toBe(false);
    advanceClock(HOUR_MS + 1);
    expect((await checkRateLimit(user.id, "argument")).allowed).toBe(true);
  });

  it("keeps users and actions separate", async () => {
    const a = await createTestUser(t.db);
    const b = await createTestUser(t.db);
    for (let i = 0; i < 10; i++) await checkRateLimit(a.user.id, "argument");
    expect((await checkRateLimit(b.user.id, "argument")).allowed).toBe(true);
    expect((await checkRateLimit(a.user.id, "comment")).allowed).toBe(true);
  });

  it("enforceRateLimit throws RATE_LIMITED", async () => {
    const { user } = await createTestUser(t.db);
    for (let i = 0; i < RATE_LIMITS.challenge.limit; i++) await enforceRateLimit(user.id, "challenge");
    await expect(enforceRateLimit(user.id, "challenge")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(enforceRateLimit(user.id, "challenge")).rejects.toBeInstanceOf(ActionError);
  });

  it("prunes old hits", async () => {
    setClock(new Date("2026-10-01T00:00:00Z"));
    const { user } = await createTestUser(t.db);
    await checkRateLimit(user.id, "report");
    setClock(new Date("2026-10-31T00:00:00Z"));
    expect(await pruneRateLimitHits()).toBe(1);
  });
});
