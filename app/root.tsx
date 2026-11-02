import { configureTracking } from "@agent-native/core/client/analytics";
import { appPath } from "@agent-native/core/client/api-path";
import { useDbSync } from "@agent-native/core/client/hooks";
import { createAgentNativeQueryClient } from "@agent-native/core/client/hooks";
import { getLocaleInitScript, useT } from "@agent-native/core/client/i18n";
import { getThemeInitScript } from "@agent-native/core/client/theme";
import { AppProviders } from "@agent-native/toolkit/app/providers";
import { useCommandMenuShortcut } from "@agent-native/toolkit/app/shared";
import { CommandMenu } from "@agent-native/toolkit/app/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useNavigate,
} from "react-router";
import type { LinksFunction } from "react-router";

import { ArgueFrame } from "@/components/layout/ArgueFrame";
import { Layout as AppLayout } from "@/components/layout/Layout";
import { AppToolkitProvider } from "@/components/ui/toolkit-provider";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { useRevalidateOnAgentWrites } from "@/hooks/use-revalidate-on-agent-writes";
import { APP_TITLE } from "@/lib/app-config";
import {
  isChatPathname,
  NEW_CHAT_PATH,
  skeletonLayoutForPath,
  threadIdFromPath,
} from "@/lib/chat-paths";
import { TAB_ID } from "@/lib/tab-id";

import { i18nCatalog } from "./i18n";

import stylesheet from "./global.css?url";

configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "argue-it",
    template: "chat",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

const THEME_INIT_SCRIPT = getThemeInitScript();
const LOCALE_INIT_SCRIPT = getLocaleInitScript();

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=resizes-content"
        />
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <script
          data-agent-native-locale-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }}
        />
        <meta name="theme-color" content="#18181B" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content={APP_TITLE} />
        <link rel="icon" type="image/svg+xml" href={appPath("/favicon.svg")} />
        <link rel="apple-touch-icon" href={appPath("/icon-180.svg")} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function DbSyncSetup() {
  const qc = useQueryClient();
  useNavigationState();
  // Review Focus #4: re-run route loaders when the agent (or any action) writes.
  useRevalidateOnAgentWrites();
  useDbSync({
    queryClient: qc,
    ignoreSource: TAB_ID,
  });
  return null;
}

function ThemeToggleItem() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useT();
  const isDark = resolvedTheme === "dark";
  return (
    <CommandMenu.Item
      onSelect={() => setTheme(isDark ? "light" : "dark")}
      keywords={["theme", "dark", "light", "mode"]}
    >
      {t("root.toggleTheme")}
    </CommandMenu.Item>
  );
}

function AppContent() {
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const navigate = useNavigate();
  const t = useT();
  const location = useLocation();
  const isChatThread = threadIdFromPath(location.pathname) !== null;
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  return (
    <>
      <CommandMenu
        open={cmdkOpen}
        onOpenChange={setCmdkOpen}
        chatStorageKey="chat"
      >
        <CommandMenu.Group heading={t("root.commandActions")}>
          {isChatThread ? (
            <CommandMenu.Item
              onSelect={() =>
                window.dispatchEvent(new Event("agent-chat:new-chat"))
              }
            >
              {t("chat.newChat")}
            </CommandMenu.Item>
          ) : null}
          {location.pathname !== "/" ? (
            <CommandMenu.Item onSelect={() => navigate("/")}>
              {t("navigation.home")}
            </CommandMenu.Item>
          ) : null}
          {!isChatPathname(location.pathname) ? (
            <CommandMenu.Item onSelect={() => navigate(NEW_CHAT_PATH)}>
              {t("navigation.chat")}
            </CommandMenu.Item>
          ) : null}
          <CommandMenu.Item
            onSelect={() => navigate("/settings/agent")}
            keywords={[
              "agent",
              "context",
              "files",
              "connections",
              "jobs",
              "access",
            ]}
          >
            {t("settings.openAgentSettings")}
          </CommandMenu.Item>
        </CommandMenu.Group>
        <CommandMenu.Group heading={t("root.commandAppearance")}>
          <ThemeToggleItem />
        </CommandMenu.Group>
      </CommandMenu>
      <AppLayout>
        <ArgueFrame>
          <Outlet />
        </ArgueFrame>
      </AppLayout>
    </>
  );
}

/**
 * The shell for public pages. They render on the server for signed-out visitors, so they skip everything
 * agent-related: the agent sidebar layout, the command menu, agent route state and DB sync. Those use the
 * framework's own react-router copy, which has no <Router> during this SSR (useLocation() throws), and an
 * anonymous visitor has no agent anyway.
 */
function PublicContent() {
  return (
    <>
      <header className="argue-app flex items-center justify-between border-b border-line px-4 py-3">
        <a href="/" className="font-display text-xl text-ink">
          {APP_TITLE}
        </a>
        <a href="/sign-in" className="text-sm font-semibold text-ink underline underline-offset-2">
          Sign in
        </a>
      </header>
      <ArgueFrame>
        <Outlet />
      </ArgueFrame>
    </>
  );
}

/**
 * ARGUE IT pages that anonymous visitors may open (the reference served `/rules` signed out). Path-based,
 * not visitor-based, so the SSR shell stays one cached page per URL. `/` stays private on purpose: the flag
 * also drops RequireSession and the agent for signed-in users on that path, and the feed is the main signed-in
 * surface (so the reference's signed-out landing is not reachable; sign-in comes first).
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set(["/rules"]);

function isArguePublicPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_PATHS.has(path);
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  // The path, not the visitor, picks the shell, so the SSR shell stays one
  // cached page per URL.
  const { pathname } = useLocation();
  const isPublic = isArguePublicPath(pathname);
  return (
    <AppToolkitProvider>
      <AppProviders
        queryClient={queryClient}
        isPublicPath={isPublic}
        skeletonLayout={skeletonLayoutForPath(pathname)}
        i18n={{ catalog: i18nCatalog }}
      >
        {isPublic ? (
          <PublicContent />
        ) : (
          <>
            <DbSyncSetup />
            <AppContent />
          </>
        )}
      </AppProviders>
    </AppToolkitProvider>
  );
}

export { ErrorBoundary } from "@agent-native/toolkit/app/shared/ErrorBoundary";
