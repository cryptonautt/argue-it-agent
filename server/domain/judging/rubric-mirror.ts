/**
 * Keeps the `rubrics` table mirrored from code (design §4.3.5) without a startup hook of our own:
 * runs `syncRubrics()` at most once per database instance per process. Idempotent and cheap.
 */
import { getDb, type Db, type DbOrTx } from "@domain/db";
import { syncRubrics } from "./rubrics";

const mirrored = new WeakSet<Db>();

/** Pass `tx` when inside a transaction (PGlite has a single connection). */
export async function ensureRubricsMirrored(tx?: DbOrTx): Promise<void> {
  const database = getDb();
  if (mirrored.has(database)) return;
  await syncRubrics(tx ?? database);
  mirrored.add(database);
}
