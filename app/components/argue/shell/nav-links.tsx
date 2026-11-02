"use client";

import Link from "@/shims/next-link";
import { usePathname } from "@/shims/next-navigation";
import type { ReactNode } from "react";
import { Bell, User } from "lucide-react";
import { cn } from "@domain/lib/cn";
import { PRIMARY_NAV } from "./nav-items";

/** Desktop header navigation. */
export function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {PRIMARY_NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-sm font-semibold transition-colors",
                  active ? "bg-ink text-ink-inverse" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                )}
              >
                <item.icon aria-hidden className="size-4" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Fixed bottom tab bar on phones (thumb reach). */
export function BottomNav({ profileHref, unreadSlot }: { profileHref: string; unreadSlot?: ReactNode }) {
  const pathname = usePathname();
  const items = [
    ...PRIMARY_NAV,
    { href: "/notifications", label: "Alerts", icon: Bell, match: (p: string) => p.startsWith("/notifications") },
    { href: profileHref, label: "Me", icon: User, match: (p: string) => p === profileHref || p.startsWith("/settings") },
  ];
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto grid h-[var(--bottom-nav-h)] max-w-md grid-cols-5">
        {items.map((item) => {
          const active = item.match(pathname);
          const isPost = item.href === "/new";
          return (
            <li key={item.label}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-full flex-col items-center justify-center gap-0.5 text-[0.7rem] font-semibold",
                  active ? "text-ink" : "text-ink-3",
                )}
              >
                {isPost ? (
                  <span className="slant inline-flex h-8 w-11 items-center justify-center rounded-[5px] bg-ink text-ink-inverse">
                    <item.icon aria-hidden className="unslant size-5" />
                  </span>
                ) : (
                  <item.icon aria-hidden className="size-5" />
                )}
                <span className={cn(isPost && "sr-only")}>{item.label}</span>
                {item.href === "/notifications" ? unreadSlot : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
