/**
 * In-app notification preferences (profiles.notification_prefs). Pure, shared by notify(), the settings
 * action and the settings form.
 *
 * Only the social, high-volume types can be muted. Anything about a debate the user is in (challenges,
 * deadlines, verdicts, appeals) or about moderation of their account is always delivered: missing one of
 * those could cost someone a debate by forfeit or leave them unaware of an action taken against them.
 */
import { z } from "zod";
import type { NotificationType } from "@domain/db/schema";

export const MUTABLE_NOTIFICATION_TYPES = ["comment_reply", "argument_comment", "mention", "follow"] as const;
export type MutableNotificationType = (typeof MUTABLE_NOTIFICATION_TYPES)[number];

export const MUTABLE_NOTIFICATION_LABELS: Record<MutableNotificationType, { label: string; hint: string }> = {
  comment_reply: { label: "Replies to my comments", hint: "Someone replies in a thread you started." },
  argument_comment: { label: "Comments on my arguments", hint: "Someone comments on an argument you posted." },
  mention: { label: "Mentions", hint: "Someone writes your @handle in a comment." },
  follow: { label: "New followers", hint: "Someone starts following you." },
};

export type NotificationPrefs = Partial<Record<NotificationType, boolean>>;

export function isMutableNotificationType(type: NotificationType): type is MutableNotificationType {
  return (MUTABLE_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

/** Whether a notification of `type` should be delivered to someone with `prefs`. Default: delivered. */
export function wantsNotification(prefs: NotificationPrefs | null | undefined, type: NotificationType): boolean {
  if (!isMutableNotificationType(type)) return true;
  return prefs?.[type] !== false;
}

/** Input of the settings action: one boolean per mutable type (true = deliver). */
export const notificationPrefsSchema = z.object(
  Object.fromEntries(MUTABLE_NOTIFICATION_TYPES.map((t) => [t, z.boolean()])) as Record<MutableNotificationType, z.ZodBoolean>,
);
export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema>;

/** Current choices for the form: every mutable type, defaulting to on. */
export function prefsForForm(prefs: NotificationPrefs | null | undefined): NotificationPrefsInput {
  return Object.fromEntries(MUTABLE_NOTIFICATION_TYPES.map((t) => [t, wantsNotification(prefs, t)])) as NotificationPrefsInput;
}
