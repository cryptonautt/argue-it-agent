import "server-only";

import { closeDbExec, createGetDb, getRuntimeDatabaseUrl } from "@agent-native/core/db";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export { schema };
export type Schema = typeof schema;

/** The database handle every server module uses. Driver-agnostic (postgres-js, Neon or PGlite). */
export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** A transaction handle (`db.transaction(async (tx) => …)`). */
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Accept either in helpers that may run inside a caller's transaction. */
export type DbOrTx = Db | Tx;

/**
 * The framework's single connection (local PGlite at data/pglite, or DATABASE_URL Postgres), with the
 * ARGUE IT schema. createGetDb shares the pool Better Auth, application_state and the core stores use,
 * so this module never opens its own PGlite. The getter is lazy: nothing connects at import time.
 */
const getFrameworkDb = createGetDb(schema) as unknown as () => Db;

// Survive dev HMR / duplicated module instances: the test override lives on globalThis.
const globalForDb = globalThis as unknown as { __argueItTestDb?: Db | null };

/**
 * Returns the active database. In tests, returns the db installed with `setTestDb()`.
 * Prefer the `db` export below; use `getDb()` when you need the instance itself (e.g. to pass around).
 *
 * Caveat (framework): until the framework connection has finished opening, `getFrameworkDb()` hands out
 * a lazy proxy that records a query chain and runs it when awaited. A chain embedded synchronously in
 * another query (a subquery) throws in that window. server/plugins/db.ts awaits `ensureDbReady()` at
 * boot, so request-time code always gets the real Drizzle instance.
 */
export function getDb(): Db {
  return globalForDb.__argueItTestDb ?? getFrameworkDb();
}

/** Opens the framework connection (if needed) and resolves to the real Drizzle instance. */
export async function ensureDbReady(): Promise<Db> {
  const testDb = globalForDb.__argueItTestDb;
  if (testDb) return testDb;
  // Before init this is a thenable lazy proxy that resolves to the ready db; after init it is the
  // (non-thenable) Drizzle instance itself. Awaiting handles both.
  return (await (getFrameworkDb() as unknown as Promise<Db>)) as Db;
}

export function getDbDriver(): "postgres" | "pglite" | "test" {
  if (globalForDb.__argueItTestDb) return "test";
  return getRuntimeDatabaseUrl("pglite:./data/pglite").toLowerCase().startsWith("pglite:") ? "pglite" : "postgres";
}

/**
 * Test hook: route every `db`/`getDb()` call to the given database (or back to the real one with `null`).
 * Use via `@domain/test-helpers/db` → `setupTestDb()`; do not call from app code.
 */
export function setTestDb(testDb: Db | null): void {
  globalForDb.__argueItTestDb = testDb;
}

/** Close the framework database client (scripts only; the dev server owns its connection). */
export async function closeDb(): Promise<void> {
  await closeDbExec();
}

/**
 * The database. A thin proxy over `getDb()` so tests can swap the instance with `setTestDb()`
 * while app code keeps a plain `import { db } from "@domain/db"`. Importing it opens nothing.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb();
    const value: unknown = Reflect.get(real as object, prop, real);
    // The framework's not-yet-ready lazy proxy is itself a function proxy whose members are proxies:
    // binding would turn `db.query` into a plain bound function and lose `db.query.users`.
    if (typeof real === "function") return value;
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});
