"use client";

import { useEffect, useState } from "react";
import { getUnreadNotificationCount } from "@domain/lib/server-actions";

/** Poll interval for the unread count (design: no websockets in v1). Paused while the tab is hidden. */
export const UNREAD_POLL_MS = 60_000;

export function formatUnread(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export interface UnreadBadgeProps {
  initialCount: number;
  /** "count" (header bell) or "dot" (compact, e.g. bottom nav). */
  variant?: "count" | "dot";
}

/**
 * Live unread count. Render with `key={initialCount}` so a server re-render (e.g. after "Mark all read")
 * resets it. Polls lightly — one tiny request a minute, only while the page is visible.
 */
export function UnreadBadge({ initialCount, variant = "count" }: UnreadBadgeProps) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const result = await getUnreadNotificationCount().catch(() => null);
      if (!cancelled && result?.ok) setCount(result.data);
    };
    const timer = window.setInterval(refresh, UNREAD_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Part of the link's accessible name ("Notifications, 3 unread"); only the header bell announces changes.
  const label = count === 0 ? "" : `, ${count} unread`;
  return (
    <>
      <span className="sr-only" aria-live={variant === "count" ? "polite" : undefined}>
        {label}
      </span>
      {count > 0 ? (
        variant === "dot" ? (
          <span aria-hidden className="absolute top-2 right-[calc(50%-14px)] size-2.5 rounded-full bg-danger ring-2 ring-surface" />
        ) : (
          <span
            aria-hidden
            className="tabular absolute -top-0.5 -right-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[0.7rem] font-bold text-white ring-2 ring-surface"
          >
            {formatUnread(count)}
          </span>
        )
      ) : null}
    </>
  );
}
