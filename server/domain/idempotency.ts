import "server-only";

import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { ActionError } from "@domain/lib/action-result";
import { DAY_MS, addMs, now } from "@domain/lib/time";
import { db, type DbOrTx } from "@domain/db";
import { idempotencyKeys } from "@domain/db/schema";

/** zod field for the client-generated key: `idempotencyKey: idempotencyKeySchema` (crypto.randomUUID()). */
export const idempotencyKeySchema = z.uuid("Invalid request key. Refresh the page and try again.");

/**
 * Run `fn` at most once per (userId, key) (design §5.4, PRD §20 "Duplicate request").
 *
 * - First call: reserves the key, runs `fn`, stores its JSON-serialisable result, returns it.
 * - Repeat call after completion: returns the stored result without running `fn`.
 * - Repeat call while the first is still running: throws ActionError("IN_PROGRESS").
 * - Same key reused for a different action: throws ActionError("CONFLICT").
 * - If `fn` throws, or returns an ActionResult with `ok: false`, the reservation is released so the
 *   user can fix their input and retry with the same key (failures are never replayed).
 *
 * `fn` must return plain JSON data (an ActionResult is ideal). Dates come back as ISO strings on replay,
 * so return ids/ISO strings rather than Date objects.
 */
export async function withIdempotency<T>(
  key: string,
  userId: string,
  action: string,
  fn: () => Promise<T>,
  conn: DbOrTx = db,
): Promise<T> {
  const [reserved] = await conn
    .insert(idempotencyKeys)
    .values({ key, userId, action, status: "pending", createdAt: now() })
    .onConflictDoNothing({ target: [idempotencyKeys.userId, idempotencyKeys.key] })
    .returning({ id: idempotencyKeys.id });

  if (!reserved) {
    const [existing] = await conn
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
      .limit(1);
    if (!existing) throw new ActionError("CONFLICT", "Please try that again.");
    if (existing.action !== action) {
      throw new ActionError("CONFLICT", "This request was already used for something else. Refresh and try again.");
    }
    if (existing.status === "pending") {
      throw new ActionError("IN_PROGRESS", "We're still working on your last request. Give it a moment.");
    }
    return existing.result as T;
  }

  let result: T;
  try {
    result = await fn();
  } catch (error) {
    await conn.delete(idempotencyKeys).where(eq(idempotencyKeys.id, reserved.id));
    throw error;
  }
  if (isFailedResult(result)) {
    await conn.delete(idempotencyKeys).where(eq(idempotencyKeys.id, reserved.id));
    return result;
  }
  await conn
    .update(idempotencyKeys)
    .set({ status: "completed", result: (result ?? null) as unknown, completedAt: now() })
    .where(eq(idempotencyKeys.id, reserved.id));
  return result;
}

function isFailedResult(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;
}

/** Delete keys older than `maxAgeMs` (default 7 days). Call from the cron tick. */
export async function pruneIdempotencyKeys(maxAgeMs: number = 7 * DAY_MS, conn: DbOrTx = db): Promise<number> {
  const deleted = await conn
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.createdAt, addMs(now(), -maxAgeMs)))
    .returning({ id: idempotencyKeys.id });
  return deleted.length;
}
