/**
 * Test database helpers. Every test file that touches the DB gets its own isolated in-memory PGlite
 * with all migrations from drizzle/ applied, the 5 categories seeded and the code rubrics mirrored.
 *
 *   import { setupTestDb } from "@domain/test-helpers/db";
 *   const t = setupTestDb();               // registers beforeAll/afterAll(/beforeEach) hooks
 *   it("works", async () => {
 *     const user = await createTestUser(t.db, { handle: "ada" });
 *     await someServerFunction(...);    // server modules importing `db` hit the test database
 *   });
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { setTestDb, type Db } from "@domain/db";
import { seedCategories } from "@domain/db/categories-seed";
import { syncRubrics } from "@domain/judging/rubrics";
import * as schema from "@domain/db/schema";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../drizzle", import.meta.url));

export interface TestDb {
  db: Db;
  client: PGlite;
  close: () => Promise<void>;
}

/** Create a fresh in-memory database with migrations applied and categories seeded. */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const pgliteDb = drizzle({ client, schema });
  await migrate(pgliteDb, { migrationsFolder: MIGRATIONS_FOLDER });
  const db = pgliteDb as unknown as Db;
  await seedCategories(db);
  await syncRubrics(db);
  return { db, client, close: () => client.close() };
}

/** Tables that survive `resetTestDb()` (reference data). */
const KEEP_TABLES = new Set(["categories", "rubrics", "__drizzle_migrations"]);

/** Delete all rows except reference data. Fast enough to run before each test. */
export async function resetTestDb(db: Db): Promise<void> {
  const result = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const rows = (result as unknown as { rows?: Array<{ tablename: string }> }).rows ?? [];
  const tables = rows.map((r) => r.tablename).filter((t) => !KEEP_TABLES.has(t));
  if (tables.length === 0) return;
  await db.execute(sql.raw(`truncate table ${tables.map((t) => `"${t}"`).join(", ")} restart identity cascade`));
}

export interface SetupTestDbOptions {
  /** Truncate non-reference tables before each test (default true). */
  resetBetweenTests?: boolean;
}

/**
 * Install an isolated test database for the current test file and route `@domain/db` to it.
 * Returns a live handle; read `.db` inside tests/hooks (it is set in beforeAll).
 */
export function setupTestDb(options: SetupTestDbOptions = {}): { readonly db: Db } {
  let current: TestDb | undefined;
  const handle = {
    get db(): Db {
      if (!current) throw new Error("setupTestDb(): database not ready — access .db inside a test or hook");
      return current.db;
    },
  };
  beforeAll(async () => {
    current = await createTestDb();
    setTestDb(current.db);
  }, 60_000);
  if (options.resetBetweenTests ?? true) {
    beforeEach(async () => {
      if (current) await resetTestDb(current.db);
    });
  }
  afterAll(async () => {
    setTestDb(null);
    await current?.close();
    current = undefined;
  });
  return handle;
}
