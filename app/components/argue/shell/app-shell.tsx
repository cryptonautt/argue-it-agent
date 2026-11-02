import type { ReactNode } from "react";
import { NotificationBell, NotificationNavBadge } from "@/components/argue/notifications/notification-bell";
import { ButtonLink } from "@/components/argue/ui/button";
import { hasRole, type SessionUser } from "@domain/auth/roles";
import { Logo } from "./logo";
import { BottomNav, DesktopNav } from "./nav-links";
import { ProfileMenu } from "./profile-menu";
import { ThemeToggle } from "./theme";

/**
 * Global chrome: sticky header (logo, nav, bell, profile menu, theme) + phone bottom nav.
 * Pages render inside <main>; use <PageContainer> for the standard reading width.
 */
export function AppShell({
  user,
  unread = null,
  children,
}: {
  user: SessionUser | null;
  /** Unread notification count; the bell is hidden when null (no notifications action in the port yet). */
  unread?: number | null;
  children: ReactNode;
}) {
  const displayName = user?.displayName ?? user?.handle ?? "You";
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-ink-inverse"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-[var(--header-h)] max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-6">
            <Logo />
            <DesktopNav />
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            {user ? (
              <>
                {unread !== null ? (
                  <div className="hidden md:block">
                    <NotificationBell unread={unread} />
                  </div>
                ) : null}
                <ProfileMenu
                  displayName={displayName}
                  handle={user.handle}
                  avatarUrl={user.avatarUrl}
                  isStaff={hasRole(user.role, "moderator")}
                />
              </>
            ) : (
              <>
                <ButtonLink href="/sign-in" variant="ghost" size="sm">
                  Sign in
                </ButtonLink>
                <ButtonLink href="/sign-up" variant="primary" size="sm">
                  Join free
                </ButtonLink>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="flex-1 pb-[calc(var(--bottom-nav-h)+24px)] md:pb-12">
        {children}
      </main>
      {user ? (
        <BottomNav profileHref={user.handle ? `/u/${user.handle}` : "/settings"} unreadSlot={unread !== null ? <NotificationNavBadge unread={unread} /> : null} />
      ) : null}
    </>
  );
}
