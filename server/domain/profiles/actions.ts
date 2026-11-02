"use server";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ActionError, ok, type ActionResult } from "@domain/lib/action-result";
import { notificationPrefsSchema, type NotificationPrefsInput } from "@domain/lib/notification-prefs";
import { now } from "@domain/lib/time";
import { parseInput, runAction, assertFound } from "@domain/action";
import { writeAudit } from "@domain/audit";
import { requireUser } from "@domain/auth";
import { db } from "@domain/db";
import { isUniqueViolation } from "@domain/db/errors";
import { accounts, blocks, categories, follows, notifications, profiles, sessions, users } from "@domain/db/schema";
import { countBlockingCompetitions } from "./queries";
import {
  DELETED_DISPLAY_NAME,
  deleteAccountSchema,
  deletedHandleFor,
  saveInterestsSchema,
  updateProfileSchema,
  type DeleteAccountInput,
  type SaveInterestsInput,
  type UpdateProfileInput,
} from "./schemas";

/** Edit display name, bio and avatar URL. */
export async function updateProfile(
  input: UpdateProfileInput,
): Promise<ActionResult<{ handle: string; displayName: string; bio: string | null; avatarUrl: string | null }>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(updateProfileSchema, input);

    const result = await db.transaction(async (tx) => {
      const before = assertFound(
        await tx.query.profiles.findFirst({ where: eq(profiles.userId, user.id) }),
        "We couldn't find your profile.",
      );
      const after = { displayName: data.displayName, bio: data.bio, avatarUrl: data.avatarUrl };
      const changed = (Object.keys(after) as Array<keyof typeof after>).filter((k) => before[k] !== after[k]);
      if (changed.length === 0) return { handle: before.handle, ...after };

      await tx.update(profiles).set({ ...after, updatedAt: now() }).where(eq(profiles.userId, user.id));
      if (changed.includes("displayName")) {
        await tx.update(users).set({ name: data.displayName, updatedAt: now() }).where(eq(users.id, user.id));
      }
      await writeAudit(
        {
          actorId: user.id,
          action: "profile.update",
          targetType: "profile",
          targetId: user.id,
          before: Object.fromEntries(changed.map((k) => [k, before[k]])),
          after: Object.fromEntries(changed.map((k) => [k, after[k]])),
        },
        tx,
      );
      return { handle: before.handle, ...after };
    });

    revalidatePath(`/u/${result.handle}`);
    revalidatePath("/settings");
    revalidatePath("/", "layout"); // header avatar / name
    return ok(result);
  });
}

/** Save favourite categories (a For You signal). With `completeOnboarding`, also marks /welcome done. */
export async function saveInterests(input: SaveInterestsInput): Promise<ActionResult<{ categorySlugs: string[] }>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(saveInterestsSchema, input);

    if (data.categorySlugs.length > 0) {
      const known = await db
        .select({ slug: categories.slug })
        .from(categories)
        .where(and(inArray(categories.slug, data.categorySlugs), eq(categories.active, true)));
      const knownSlugs = new Set(known.map((c) => c.slug));
      const unknown = data.categorySlugs.filter((s) => !knownSlugs.has(s));
      if (unknown.length > 0) {
        throw new ActionError("VALIDATION", "One of those categories isn't available any more.", {
          categorySlugs: ["Pick from the categories shown."],
        });
      }
    }

    const existing = assertFound(
      await db.query.profiles.findFirst({ where: eq(profiles.userId, user.id), columns: { onboardedAt: true, handle: true } }),
      "We couldn't find your profile.",
    );
    await db
      .update(profiles)
      .set({
        interests: data.categorySlugs,
        updatedAt: now(),
        ...(data.completeOnboarding && !existing.onboardedAt ? { onboardedAt: now() } : {}),
      })
      .where(eq(profiles.userId, user.id));

    revalidatePath("/settings");
    revalidatePath("/");
    return ok({ categorySlugs: data.categorySlugs });
  });
}

/**
 * Settings → Notifications: mute or unmute the social notification types (replies, comments, mentions,
 * follows). Debate, verdict, appeal and moderation notifications can't be muted (src/lib/notification-prefs).
 * A personal preference, not content, so suspended users may change it too.
 */
export async function saveNotificationPrefs(input: NotificationPrefsInput): Promise<ActionResult<NotificationPrefsInput>> {
  return runAction(async () => {
    const user = await requireUser({ allowSuspended: true });
    const data = parseInput(notificationPrefsSchema, input);
    await db.transaction(async (tx) => {
      const before = assertFound(
        await tx.query.profiles.findFirst({ where: eq(profiles.userId, user.id), columns: { notificationPrefs: true } }),
        "We couldn't find your profile.",
      );
      const prefs = { ...before.notificationPrefs, ...data };
      await tx.update(profiles).set({ notificationPrefs: prefs, updatedAt: now() }).where(eq(profiles.userId, user.id));
      await writeAudit(
        { actorId: user.id, action: "profile.notification_prefs", targetType: "profile", targetId: user.id, before: before.notificationPrefs, after: prefs },
        tx,
      );
    });
    revalidatePath("/settings");
    return ok(data);
  });
}

/**
 * Soft-delete the signed-in account (design §6 "/settings → delete account").
 *
 * - The profile is anonymised to "Deleted user" with a random-looking handle; bio/avatar/interests cleared.
 * - Login is removed: credentials (accounts) and all sessions are deleted; email is replaced so it can be
 *   reused for a new sign-up. users.status = "deleted" makes getSession() treat the user as signed out.
 * - Integrity is kept: competitions, submissions, verdicts, reputation events, audit logs, arguments and
 *   comments stay (shown as "Deleted user") so opponents' records and verdict history remain valid.
 * - Blocks *others* placed on this user are kept, so someone who blocked a harasser keeps not seeing them.
 * - Refused while the user has a pending or live challenge: the opponent deserves a finished contest.
 *
 * Suspended users may delete their account (it is their data); the audit log keeps the old handle.
 */
export async function deleteAccount(input: DeleteAccountInput): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const user = await requireUser({ allowSuspended: true });
    const data = parseInput(deleteAccountSchema, input);
    if (!user.handle || data.confirmHandle !== user.handle) {
      throw new ActionError("VALIDATION", "That doesn't match your handle.", {
        confirmHandle: [`Type ${user.handle ? `@${user.handle}` : "your handle"} exactly to confirm.`],
      });
    }

    const blocking = await countBlockingCompetitions(user.id);
    if (blocking > 0) {
      throw new ActionError(
        "CONFLICT",
        blocking === 1
          ? "You have a challenge that's pending or live. Finish, withdraw or cancel it before deleting your account."
          : `You have ${blocking} challenges that are pending or live. Finish, withdraw or cancel them before deleting your account.`,
      );
    }

    const anonymise = async (handle: string) =>
      db.transaction(async (tx) => {
        const before = await tx.query.profiles.findFirst({ where: eq(profiles.userId, user.id) });
        const at = now();
        await tx
          .update(profiles)
          .set({ handle, displayName: DELETED_DISPLAY_NAME, bio: null, avatarUrl: null, interests: [], notificationPrefs: {}, updatedAt: at })
          .where(eq(profiles.userId, user.id));
        await tx
          .update(users)
          .set({
            status: "deleted",
            name: DELETED_DISPLAY_NAME,
            email: `deleted+${user.id}@deleted.invalid`,
            emailVerified: false,
            image: null,
            updatedAt: at,
          })
          .where(eq(users.id, user.id));
        await tx.delete(sessions).where(eq(sessions.userId, user.id));
        await tx.delete(accounts).where(eq(accounts.userId, user.id));
        await tx.delete(follows).where(or(eq(follows.followerId, user.id), eq(follows.followingId, user.id)));
        await tx.delete(blocks).where(eq(blocks.blockerId, user.id));
        await tx.delete(notifications).where(eq(notifications.userId, user.id));
        await writeAudit(
          {
            actorId: user.id,
            action: "user.delete",
            targetType: "user",
            targetId: user.id,
            before: { handle: before?.handle ?? user.handle, displayName: before?.displayName ?? null, status: user.status },
            after: { handle, status: "deleted" },
          },
          tx,
        );
      });

    try {
      await anonymise(deletedHandleFor(user.id));
    } catch (error) {
      // Someone registered the deterministic handle: fall back to a random one.
      if (!isUniqueViolation(error)) throw error;
      await anonymise(deletedHandleFor(randomUUID()));
    }

    revalidatePath("/", "layout");
    return ok({ redirectTo: "/" });
  });
}
