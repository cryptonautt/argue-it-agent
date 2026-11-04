/**
 * Boots the real ARGUE IT db plugin against an isolated in-memory framework database (never data/pglite):
 * framework migration runner + drizzle/*.sql + createGetDb + category/rubric seeding, end to end.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
});

afterAll(async () => {
  const { closeDb } = await import("@domain/db");
  await closeDb();
  vi.unstubAllEnvs();
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
});

describe("server/plugins/db", () => {
  it("applies the drizzle migrations on the framework connection and seeds 5 categories", async () => {
    const { default: plugin, MIGRATIONS_TABLE } = await import("./db");
    await plugin(null);
    // Idempotent: a second boot applies nothing and seeds nothing new.
    await plugin(null);

    const { getDbExec } = await import("@agent-native/core/db");
    const exec = getDbExec();
    const tables = (
      await exec.execute("select tablename from pg_tables where schemaname = 'public' order by 1")
    ).rows.map((r) => String((r as { tablename: string }).tablename));

    expect(tables).toEqual(expect.arrayContaining(["users", "profiles", "competitions", "verdicts", "ai_notifications"]));
    expect(tables).toContain(MIGRATIONS_TABLE);
    // The reference auth tables are not ported (the framework owns sign-in and sessions).
    expect(tables).not.toContain("accounts");
    expect(tables).not.toContain("verifications");

    const { rows } = await exec.execute("select count(*)::int as n from categories");
    expect(Number((rows[0] as { n: number }).n)).toBe(5);

    const named = await exec.execute(`select name from ${MIGRATIONS_TABLE}_named order by 1`);
    expect(named.rows.map((r) => String((r as { name: string }).name))).toEqual([
      "0000_init.sql",
      "0001_polymarket_event_slug.sql",
    ]);
  });

  it("routes the @domain/db proxy to the same framework connection", async () => {
    const { db, schema } = await import("@domain/db");
    const rows = await db.select({ slug: schema.categories.slug }).from(schema.categories);
    expect(rows).toHaveLength(5);
    const rubrics = await db.select({ id: schema.rubrics.id }).from(schema.rubrics);
    expect(rubrics.length).toBeGreaterThan(0);
  });
});
