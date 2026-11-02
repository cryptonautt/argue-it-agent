"use server";

/**
 * Notification actions (design §5.4). Marking notifications read is bookkeeping on the user's own inbox,
 * not posting, so suspended users may do it (they can still read).
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ok, type ActionResult } from "@domain/lib/action-result";
import { now } from "@domain/lib/time";
import { parseInput, runAction } from "@domain/action";
import { getSession, requireUser } from "@domain/auth";
import { db } from "@domain/db";
import { notifications } from "@domain/db/schema";
import { countUnreadNotifications } from "./queries";

const markReadSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(100),
});

/** Mark specific notifications read (only the caller's own; others' ids are silently ignored). */
export async function markNotificationsRead(
  input: z.input<typeof markReadSchema>,
): Promise<ActionResult<{ unread: number }>> {
  return runAction(async () => {
    const user = await requireUser({ allowSuspended: true });
    const data = parseInput(markReadSchema, input);
    await db
      .update(notifications)
      .set({ readAt: now() })
      .where(
        and(eq(notifications.userId, user.id), inArray(notifications.id, data.ids), isNull(notifications.readAt)),
      );
    revalidatePath("/notifications");
    return ok({ unread: await countUnreadNotifications(user.id) });
  });
}

/** Mark every unread notification read. */
export async function markAllNotificationsRead(): Promise<ActionResult<{ marked: number; unread: number }>> {
  return runAction(async () => {
    const user = await requireUser({ allowSuspended: true });
    const updated = await db
      .update(notifications)
      .set({ readAt: now() })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    revalidatePath("/notifications");
    return ok({ marked: updated.length, unread: await countUnreadNotifications(user.id) });
  });
}

/** Unread count for the header bell's light polling. Signed-out callers get 0 (no error noise). */
export async function getUnreadNotificationCount(): Promise<ActionResult<number>> {
  return runAction(async () => {
    const user = await getSession();
    return ok(user ? await countUnreadNotifications(user.id) : 0);
  });
}
