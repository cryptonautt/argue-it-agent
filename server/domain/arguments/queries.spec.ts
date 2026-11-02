import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestArgument, createTestUser, getCategory } from "@domain/test-helpers/factories";
import { blocks, categories, competitions, users } from "@domain/db/schema";
import { getArgumentDetail, getArgumentShareData, hasOpenDebates, listActiveCategories } from "./queries";

const t = setupTestDb();

async function competitionOn(argumentId: string, creatorId: string, status: "pending_acceptance" | "active" | "completed") {
  const category = await getCategory(t.db);
  await t.db.insert(competitions).values({
    rootArgumentId: argumentId,
    creatorId,
    categoryId: category.id,
    status,
    rulesSnapshot: {} as never,
    termsHash: "x",
    rubricId: "sports",
    rubricVersion: 1,
    acceptDeadline: new Date("2026-11-02T00:00:00Z"),
    acceptedAt: status === "pending_acceptance" ? null : new Date("2026-10-31T00:00:00Z"),
  });
}

describe("getArgumentDetail", () => {
  it("returns null for unknown ids", async () => {
    expect(await getArgumentDetail(randomUUID(), null)).toBeNull();
  });

  it("reports the lock once a challenge was accepted, not while pending", async () => {
    const { user: author } = await createTestUser(t.db);
    const { user: other } = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, author.id);
    await competitionOn(argument.id, other.id, "pending_acceptance");
    expect((await getArgumentDetail(argument.id, null))?.locked).toBe(false);
    expect(await hasOpenDebates(argument.id)).toBe(true);
    await competitionOn(argument.id, other.id, "completed");
    expect((await getArgumentDetail(argument.id, null))?.locked).toBe(true);
  });

  it("reports block direction between viewer and author", async () => {
    const { user: author } = await createTestUser(t.db);
    const { user: viewer } = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, author.id);
    await t.db.insert(blocks).values({ blockerId: viewer.id, blockedId: author.id });
    expect(await getArgumentDetail(argument.id, viewer.id)).toMatchObject({
      viewerBlockedAuthor: true,
      authorBlockedViewer: false,
    });
    expect(await getArgumentDetail(argument.id, author.id)).toMatchObject({
      viewerBlockedAuthor: false,
      authorBlockedViewer: false,
    });
  });

  it("anonymises deleted authors", async () => {
    const { user: author } = await createTestUser(t.db, { handle: "gone_user", displayName: "Gone User" });
    const argument = await createTestArgument(t.db, author.id);
    await t.db.update(users).set({ status: "deleted" }).where(eq(users.id, author.id));
    expect((await getArgumentDetail(argument.id, null))?.author).toEqual({
      id: author.id,
      handle: null,
      displayName: "Deleted user",
      avatarUrl: null,
    });
  });
});

describe("share data", () => {
  it("is only available for visible arguments", async () => {
    const { user } = await createTestUser(t.db);
    const visible = await createTestArgument(t.db, user.id);
    const hidden = await createTestArgument(t.db, user.id, { status: "hidden" });
    expect((await getArgumentShareData(visible.id))?.title).toBe(visible.title);
    expect(await getArgumentShareData(hidden.id)).toBeNull();
  });
});

describe("listActiveCategories", () => {
  it("lists active categories in configured order", async () => {
    const all = await listActiveCategories();
    expect(all.map((c) => c.slug)).toEqual(["sports", "entertainment", "gaming", "technology", "crypto"]);
    await t.db.update(categories).set({ active: false }).where(eq(categories.slug, "crypto"));
    expect((await listActiveCategories()).map((c) => c.slug)).not.toContain("crypto");
    await t.db.update(categories).set({ active: true }).where(eq(categories.slug, "crypto"));
  });
});
