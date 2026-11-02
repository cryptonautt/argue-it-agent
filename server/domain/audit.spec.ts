import { describe, expect, it } from "vitest";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestUser } from "@domain/test-helpers/factories";
import { auditLogs } from "@domain/db/schema";
import { writeAudit } from "./audit";

const t = setupTestDb();

describe("writeAudit", () => {
  it("records actor, action, target and before/after", async () => {
    const { user } = await createTestUser(t.db);
    await writeAudit({
      actorId: user.id,
      action: "moderation.hide",
      targetType: "argument",
      targetId: "a1",
      before: { status: "visible" },
      after: { status: "hidden" },
    });
    await writeAudit({ actorId: null, action: "competition.expire", targetType: "competition", targetId: "c1" });
    const rows = await t.db.select().from(auditLogs);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.action === "moderation.hide")).toMatchObject({
      actorId: user.id,
      before: { status: "visible" },
      after: { status: "hidden" },
    });
    expect(rows.find((r) => r.action === "competition.expire")?.actorId).toBeNull();
  });
});
