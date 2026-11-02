/**
 * Wraps ARGUE IT screens (feed, arguments, debates, verdicts, profiles, review queue, rules, welcome) in
 * the `.argue-app` token scope and the reference ToastProvider. Framework screens (chat, settings,
 * database, extensions, ...) render untouched, so the template's shadcn tokens keep styling them.
 */
import type { ReactNode } from "react";
import { useLocation } from "react-router";

import { ToastProvider } from "@/components/argue/ui/toast";

const ARGUE_PREFIXES = ["/a/", "/c/", "/u/", "/challenge/", "/admin/"];
const ARGUE_EXACT = new Set(["/", "/new", "/welcome", "/rules", "/admin"]);

export function isArguePath(pathname: string): boolean {
  return ARGUE_EXACT.has(pathname) || ARGUE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function ArgueFrame({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  if (!isArguePath(pathname)) return <>{children}</>;
  return (
    <ToastProvider>
      <div className="argue-app">{children}</div>
    </ToastProvider>
  );
}
