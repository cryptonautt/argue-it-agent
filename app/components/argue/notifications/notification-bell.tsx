import Link from "@/shims/next-link";
import { Bell } from "lucide-react";
import { UnreadBadge } from "./unread-badge";

/**
 * Header bell with unread count, linking to /notifications.
 * Ported from an async server component: the caller passes the unread count (reference
 * `countUnreadNotifications(viewer.id)`). Not mounted in the port yet: there is no notifications action
 * (go/no-go cut, plan Task 6 step 3b).
 */
export function NotificationBell({ unread }: { unread: number }) {
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

/** Unread dot for the phone bottom nav's "Alerts" tab (pass as `BottomNav`'s `unreadSlot`). */
export function NotificationNavBadge({ unread }: { unread: number }) {
  return <UnreadBadge key={unread} initialCount={unread} variant="dot" />;
}
