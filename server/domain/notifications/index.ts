import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";
import { MINUTE_MS, addMs, now } from "@domain/lib/time";
import { db, type DbOrTx } from "@domain/db";
import type { NotificationData } from "@domain/db/json-types";
import { isMutableNotificationType, wantsNotification } from "@domain/lib/notification-prefs";
import { blocks, notifications, profiles, type NotificationType, type TargetType } from "@domain/db/schema";

export const NOTIFICATION_DEDUPE_WINDOW_MS = 10 * MINUTE_MS;

export interface NotifyInput {
  /** Recipient. */
  userId: string;
  type: NotificationType;
  targetType: TargetType;
  targetId: string;
  /** Who caused it (null/omitted = system). */
  actorId?: string | null;
  /** Small render payload, e.g. { argumentTitle, handle }. */
  data?: NotificationData;
}

export type NotifyResult =
  | { created: true; id: string }
  | { created: false; reason: "self" | "duplicate" | "blocked" | "muted" };

/**
 * Create an in-app notification (design §5.2). Skips:
 *  - self-notifications (actor === recipient),
 *  - duplicates: same (userId, type, targetId, actorId) within the last 10 minutes,
 *  - actors the recipient has blocked,
 *  - social types the recipient muted in Settings (profiles.notification_prefs; debate, verdict, appeal and
 *    moderation types can never be muted — see src/lib/notification-prefs.ts).
 * Pass `tx` to create it inside your transaction (it is then rolled back with it).
 */
export async function notify(input: NotifyInput, tx: DbOrTx = db): Promise<NotifyResult> {
  const actorId = input.actorId ?? null;
  if (actorId !== null && actorId === input.userId) return { created: false, reason: "self" };

  if (actorId !== null) {
    const [blocked] = await tx
      .select({ blockerId: blocks.blockerId })
      .from(blocks)
      .where(and(eq(blocks.blockerId, input.userId), eq(blocks.blockedId, actorId)))
      .limit(1);
    if (blocked) return { created: false, reason: "blocked" };
  }

  if (isMutableNotificationType(input.type)) {
    const [recipient] = await tx
      .select({ prefs: profiles.notificationPrefs })
      .from(profiles)
      .where(eq(profiles.userId, input.userId))
      .limit(1);
    if (recipient && !wantsNotification(recipient.prefs, input.type)) return { created: false, reason: "muted" };
  }

  const at = now();
  const [duplicate] = await tx
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, input.userId),
        eq(notifications.type, input.type),
        eq(notifications.targetId, input.targetId),
        actorId === null ? isNull(notifications.actorId) : eq(notifications.actorId, actorId),
        gt(notifications.createdAt, addMs(at, -NOTIFICATION_DEDUPE_WINDOW_MS)),
      ),
    )
    .limit(1);
  if (duplicate) return { created: false, reason: "duplicate" };

  const [row] = await tx
    .insert(notifications)
    .values({
      userId: input.userId,
      type: input.type,
      targetType: input.targetType,
      targetId: input.targetId,
      actorId,
      data: input.data ?? {},
      createdAt: at,
    })
    .returning({ id: notifications.id });
  if (!row) throw new Error("notify: insert returned no row");
  return { created: true, id: row.id };
}

/** Notify several recipients of the same event (e.g. both competition participants). */
export async function notifyMany(
  recipients: readonly string[],
  input: Omit<NotifyInput, "userId">,
  tx: DbOrTx = db,
): Promise<NotifyResult[]> {
  const results: NotifyResult[] = [];
  for (const userId of new Set(recipients)) results.push(await notify({ ...input, userId }, tx));
  return results;
}
