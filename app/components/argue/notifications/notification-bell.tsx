import Link from "@/shims/next-link";
import { Bell } from "lucide-react";
import { getSession } from "@domain/auth";
import { countUnreadNotifications } from "@domain/notifications/queries";
import { UnreadBadge } from "./unread-badge";

/** Header bell with unread count, linking to /notifications. Rendered only for signed-in users. */
export async function NotificationBell() {
  const viewer = await getSession();
  if (!viewer) return null;
  const unread = await countUnreadNotifications(viewer.id);
  return (
    <Link
      href="/notifications"
      className="relative inline-flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      <Bell aria-hidden className="size-5" />
      <span className="sr-only">Notifications</span>
      <UnreadBadge key={unread} initialCount={unread} />
    </Link>
  );
}

/**
 * Unread dot for the phone bottom nav's "Alerts" tab (pass as `BottomNav`'s `unreadSlot`).
 * Renders nothing for signed-out viewers.
 */
export async function NotificationNavBadge() {
  const viewer = await getSession();
  if (!viewer) return null;
  const unread = await countUnreadNotifications(viewer.id);
  return <UnreadBadge key={unread} initialCount={unread} variant="dot" />;
}
