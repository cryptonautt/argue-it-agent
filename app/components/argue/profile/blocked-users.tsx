"use client";

import Link from "@/shims/next-link";
import { useState, useTransition } from "react";
import { Avatar } from "@/components/argue/ui/avatar";
import { Button } from "@/components/argue/ui/button";
import { useToast } from "@/components/argue/ui/toast";
import { unblockUser } from "@domain/lib/server-actions";
import { formatShortDate } from "./format";

export interface BlockedUserItem {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  blockedAt: string;
}

/** Settings → Blocked users, with Unblock (social's unblockUser action). */
export function BlockedUsers({ initial }: { initial: readonly BlockedUserItem[] }) {
  const [items, setItems] = useState(() => [...initial]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [, startTransition] = useTransition();
  const { error } = useToast();

  function unblock(item: BlockedUserItem) {
    setPendingId(item.id);
    startTransition(async () => {
      const result = await unblockUser({ userId: item.id });
      setPendingId(null);
      if (!result.ok) {
        error(result.error);
        return;
      }
      setItems((current) => current.filter((i) => i.id !== item.id));
      setAnnouncement(`Unblocked @${item.handle}.`);
    });
  }

  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-ink-2">
          You haven&apos;t blocked anyone. Blocking someone hides their content from you and stops them challenging,
          following or replying to you. You can block from anyone&apos;s profile.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={item.displayName} src={item.avatarUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <Link href={`/u/${item.handle}`} className="block truncate font-semibold text-ink hover:underline">
                  {item.displayName}
                </Link>
                <p className="truncate text-xs text-ink-3">
                  @{item.handle} · blocked {formatShortDate(item.blockedAt)}
                </p>
              </div>
              <Button variant="secondary" size="sm" loading={pendingId === item.id} onClick={() => unblock(item)}>
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
