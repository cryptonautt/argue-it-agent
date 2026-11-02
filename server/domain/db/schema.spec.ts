import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestArgument, createTestUser } from "@domain/test-helpers/factories";
import { setupTestDb } from "@domain/test-helpers/db";
import { CATEGORY_SEED, seedCategories } from "@domain/db/categories-seed";
import { db } from "@domain/db";
import { argumentsTable, categories, profiles, userRatings } from "@domain/db/schema";

const t = setupTestDb();

describe("schema + test database", () => {
  it("seeds the five launch categories idempotently", async () => {
    await seedCategories(t.db);
    await seedCategories(t.db);
    const rows = await t.db.select().from(categories);
    expect(rows.map((r) => r.slug).sort()).toEqual(CATEGORY_SEED.map((c) => c.slug).sort());
  });

  it("routes the `db` proxy to the test database", async () => {
    const { user } = await createTestUser(t.db, { handle: "proxy_check" });
    const [row] = await db.select().from(profiles).where(eq(profiles.userId, user.id));
    expect(row?.handle).toBe("proxy_check");
  });

  it("rejects invalid handles at the database level", async () => {
    await expect(createTestUser(t.db, { handle: "Bad Handle!" })).rejects.toThrow();
  });

  it("maintains the full-text search vector", async () => {
    const { user } = await createTestUser(t.db);
    await createTestArgument(t.db, user.id, { title: "Jollof rice: Nigeria beats Ghana" });
    const hits = await t.db
      .select({ id: argumentsTable.id })
      .from(argumentsTable)
      .where(sql`${argumentsTable.searchVector} @@ websearch_to_tsquery('english', 'jollof')`);
    expect(hits).toHaveLength(1);
  });

  it("allows only one overall rating row per user (NULLS NOT DISTINCT)", async () => {
    const { user } = await createTestUser(t.db);
    await t.db.insert(userRatings).values({ userId: user.id, categoryId: null });
    await expect(t.db.insert(userRatings).values({ userId: user.id, categoryId: null })).rejects.toThrow();
  });
});
