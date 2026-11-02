"use client";

import Link from "@/shims/next-link";
import { useState } from "react";
import { Gavel, MessageSquare, ShieldAlert, Swords, UserPlus, type LucideIcon } from "lucide-react";
import { cn } from "@domain/lib/cn";
import { formatDateTime, formatRelative } from "@domain/lib/time";
import { markNotificationsRead } from "@/lib/server-actions";
import type { NotificationKind } from "./notification-format";

export interface NotificationItemView {
  id: string;
  href: string;
  kind: NotificationKind;
  text: string;
  actorName: string | null;
  detail: string | null;
  read: boolean;
  createdAt: string;
}

const KIND_ICON: Record<NotificationKind, { icon: LucideIcon; className: string; label: string }> = {
  discussion: { icon: MessageSquare, className: "bg-surface-2 text-ink-2", label: "Discussion" },
  social: { icon: UserPlus, className: "bg-surface-2 text-ink-2", label: "Follower" },
  challenge: { icon: Swords, className: "bg-ink text-ink-inverse", label: "Direct challenge" },
  verdict: { icon: Gavel, className: "bg-judge text-on-judge", label: "AI verdict" },
  moderation: { icon: ShieldAlert, className: "bg-warning-soft text-warning", label: "Moderation" },
};

/** Text with the actor's name emphasised (all of it rendered as plain text). */
function MessageText({ text, actorName }: { text: string; actorName: string | null }) {
  if (actorName && text.startsWith(actorName)) {
    return (
      <>
        <strong className="font-semibold text-ink">{actorName}</strong>
        {text.slice(actorName.length)}
      </>
    );
  }
  return <>{text}</>;
}

/** One notification row. Opening it marks it read (fire-and-forget, so navigation is never delayed). */
export function NotificationItem({ item }: { item: NotificationItemView }) {
  const [read, setRead] = useState(item.read);
  const { icon: Icon, className, label } = KIND_ICON[item.kind];

  function onOpen() {
    if (read) return;
    setRead(true);
    void markNotificationsRead({ ids: [item.id] }).catch(() => undefined);
  }

  return (
    <li>
      <Link
        href={item.href}
        onClick={onOpen}
        className={cn(
          "relative flex gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2",
          !read && "bg-surface-2/60",
        )}
      >
        {!read ? <span aria-hidden className="slant absolute inset-y-2 left-0 w-1 rounded-r bg-ink" /> : null}
        <span className={cn("mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full", className)}>
          <Icon aria-hidden className="size-4" />
          <span className="sr-only">{label}: </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-[0.95rem] leading-snug", read ? "text-ink-2" : "text-ink")}>
            {!read ? <span className="sr-only">Unread: </span> : null}
            <MessageText text={item.text} actorName={item.actorName} />
          </span>
          {item.detail ? (
            <span className="mt-1 line-clamp-2 block text-sm break-words text-ink-3">“{item.detail}”</span>
          ) : null}
          <time
            dateTime={item.createdAt}
            title={formatDateTime(item.createdAt)}
            className="mt-1 block text-xs text-ink-3"
            suppressHydrationWarning
          >
            {formatRelative(item.createdAt)}
          </time>
        </span>
        {!read ? <span aria-hidden className="mt-2 size-2.5 shrink-0 rounded-full bg-danger" /> : null}
      </Link>
    </li>
  );
}
