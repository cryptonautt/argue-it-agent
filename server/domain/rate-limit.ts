import "server-only";

import { and, count, eq, gt, lt } from "drizzle-orm";
import { ActionError } from "@domain/lib/action-result";
import { DAY_MS, HOUR_MS, addMs, now } from "@domain/lib/time";
import { db, type DbOrTx } from "@domain/db";
import { rateLimitHits } from "@domain/db/schema";

/** Limits per user (design §4.7). Sliding window, DB-backed. */
export const RATE_LIMITS = {
  argument: { limit: 10, windowMs: HOUR_MS, label: "arguments per hour" },
  comment: { limit: 60, windowMs: HOUR_MS, label: "comments per hour" },
  challenge: { limit: 10, windowMs: DAY_MS, label: "challenges per day" },
  report: { limit: 20, windowMs: DAY_MS, label: "reports per day" },
  position: { limit: 300, windowMs: HOUR_MS, label: "position changes per hour" },
  // Not in design §4.7 but cheap abuse protection for the social team:
  reaction: { limit: 300, windowMs: HOUR_MS, label: "reactions per hour" },
  follow: { limit: 100, windowMs: HOUR_MS, label: "follows per hour" },
  appeal: { limit: 5, windowMs: DAY_MS, label: "appeals per day" },
  // Password-reset emails per account. Checked silently (never surfaced) so it can't reveal which emails exist.
  password_reset: { limit: 5, windowMs: HOUR_MS, label: "password reset emails per hour" },
} as const satisfies Record<string, { limit: number; windowMs: number; label: string }>;

export type RateLimitAction = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Remaining actions in the current window after this one (0 when blocked). */
  remaining: number;
  /** When blocked: seconds until the oldest hit in the window expires. */
  retryAfterSeconds: number;
}

/**
 * Check AND consume one unit of `action` for `userId`. When allowed, a hit is recorded.
 * Prefer `enforceRateLimit()` in server actions; use this when you need the numbers.
 */
export async function checkRateLimit(
  userId: string,
  action: RateLimitAction,
  tx: DbOrTx = db,
): Promise<RateLimitResult> {
  const { limit, windowMs } = RATE_LIMITS[action];
  const at = now();
  const windowStart = addMs(at, -windowMs);
  const inWindow = and(
    eq(rateLimitHits.userId, userId),
    eq(rateLimitHits.action, action),
    gt(rateLimitHits.createdAt, windowStart),
  );

  const [row] = await tx.select({ used: count() }).from(rateLimitHits).where(inWindow);
  const used = row?.used ?? 0;

  if (used >= limit) {
    const [oldest] = await tx
      .select({ createdAt: rateLimitHits.createdAt })
      .from(rateLimitHits)
      .where(inWindow)
      .orderBy(rateLimitHits.createdAt)
      .limit(1);
    const retryAt = oldest ? oldest.createdAt.getTime() + windowMs : at.getTime() + windowMs;
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((retryAt - at.getTime()) / 1000)),
    };
  }

  await tx.insert(rateLimitHits).values({ userId, action, createdAt: at });
  return { allowed: true, limit, remaining: limit - used - 1, retryAfterSeconds: 0 };
}

/** checkRateLimit() that throws ActionError("RATE_LIMITED") with a friendly message when blocked. */
export async function enforceRateLimit(userId: string, action: RateLimitAction, tx: DbOrTx = db): Promise<void> {
  const result = await checkRateLimit(userId, action, tx);
  if (!result.allowed) {
    const minutes = Math.ceil(result.retryAfterSeconds / 60);
    const wait = minutes >= 60 ? `${Math.ceil(minutes / 60)} hour(s)` : `${minutes} minute(s)`;
    throw new ActionError(
      "RATE_LIMITED",
      `You've hit the limit of ${RATE_LIMITS[action].limit} ${RATE_LIMITS[action].label}. Try again in about ${wait}.`,
    );
  }
}

/** Delete hits older than the longest window (call from the cron tick). Returns rows deleted. */
export async function pruneRateLimitHits(tx: DbOrTx = db): Promise<number> {
  const longest = Math.max(...Object.values(RATE_LIMITS).map((r) => r.windowMs));
  const deleted = await tx
    .delete(rateLimitHits)
    .where(lt(rateLimitHits.createdAt, addMs(now(), -longest)))
    .returning({ id: rateLimitHits.id });
  return deleted.length;
}
