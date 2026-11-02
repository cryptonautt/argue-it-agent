import { afterEach, describe, expect, it } from "vitest";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestUser } from "@domain/test-helpers/factories";
import { MINUTE_MS, advanceClock, resetClock, setClock } from "@domain/lib/time";
import { eq } from "drizzle-orm";
import { blocks, notifications, profiles } from "@domain/db/schema";
import { notify, notifyMany } from "./index";

const t = setupTestDb();
afterEach(() => resetClock());

describe("notify", () => {
  it("respects muted social types but always delivers debate and moderation types", async () => {
    const recipient = await createTestUser(t.db);
    const actor = await createTestUser(t.db);
    await t.db.update(profiles).set({ notificationPrefs: { follow: false, challenge_received: false } }).where(eq(profiles.userId, recipient.user.id));
    const base = { userId: recipient.user.id, actorId: actor.user.id, targetType: "user" as const, targetId: actor.user.id };
    expect(await notify({ ...base, type: "follow" })).toEqual({ created: false, reason: "muted" });
    // challenge_received can't be muted, even if the stored prefs say so.
    expect((await notify({ ...base, type: "challenge_received", targetType: "competition" })).created).toBe(true);
    expect((await notify({ ...base, type: "mention" })).created).toBe(true);
  });

  it("creates a notification", async () => {
    const recipient = await createTestUser(t.db);
    const actor = await createTestUser(t.db);
    const result = await notify({
      userId: recipient.user.id,
      actorId: actor.user.id,
      type: "follow",
      targetType: "user",
      targetId: actor.user.id,
      data: { handle: actor.profile.handle },
    });
    expect(result.created).toBe(true);
    const rows = await t.db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toEqual({ handle: actor.profile.handle });
  });

  it("dedupes the same event within 10 minutes, not after", async () => {
    setClock(new Date("2026-10-31T10:00:00Z"));
    const recipient = await createTestUser(t.db);
    const actor = await createTestUser(t.db);
    const input = {
      userId: recipient.user.id,
      actorId: actor.user.id,
      type: "follow" as const,
      targetType: "user" as const,
      targetId: actor.user.id,
    };
    expect((await notify(input)).created).toBe(true);
    advanceClock(9 * MINUTE_MS);
    expect(await notify(input)).toEqual({ created: false, reason: "duplicate" });
    advanceClock(2 * MINUTE_MS);
    expect((await notify(input)).created).toBe(true);
  });

  it("dedupes system notifications (null actor) too", async () => {
    const recipient = await createTestUser(t.db);
    const input = {
      userId: recipient.user.id,
      type: "deadline_soon" as const,
      targetType: "competition" as const,
      targetId: recipient.user.id,
    };
    expect((await notify(input)).created).toBe(true);
    expect((await notify(input)).created).toBe(false);
  });

  it("skips self-notifications and blocked actors", async () => {
    const a = await createTestUser(t.db);
    const b = await createTestUser(t.db);
    expect(
      await notify({ userId: a.user.id, actorId: a.user.id, type: "mention", targetType: "comment", targetId: a.user.id }),
    ).toEqual({ created: false, reason: "self" });
    await t.db.insert(blocks).values({ blockerId: a.user.id, blockedId: b.user.id });
    expect(
      await notify({ userId: a.user.id, actorId: b.user.id, type: "mention", targetType: "comment", targetId: b.user.id }),
    ).toEqual({ created: false, reason: "blocked" });
  });

  it("notifyMany de-duplicates recipients", async () => {
    const a = await createTestUser(t.db);
    const b = await createTestUser(t.db);
    const results = await notifyMany([a.user.id, b.user.id, a.user.id], {
      type: "verdict_ready",
      targetType: "competition",
      targetId: a.user.id,
    });
    expect(results.filter((r) => r.created)).toHaveLength(2);
  });

  it("rolls back with the caller's transaction", async () => {
    const a = await createTestUser(t.db);
    await expect(
      t.db.transaction(async (tx) => {
        await notify({ userId: a.user.id, type: "forfeit", targetType: "competition", targetId: a.user.id }, tx);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await t.db.select().from(notifications)).toHaveLength(0);
  });
});
