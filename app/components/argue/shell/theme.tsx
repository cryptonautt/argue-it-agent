"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

export type ThemePreference = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "argueit-theme";

/**
 * Inline script for <head>: sets data-theme on <html> before first paint (no flash).
 * Stored preference wins; otherwise follows the OS setting.
 */
export const themeInitScript = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");var d=p==="dark"||((p===null||p==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;

function currentTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Subscribe to data-theme changes on <html> (set by the inline script or the toggle). */
function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/** Light/dark toggle (stores an explicit preference). */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme, () => "light" as const);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode): the toggle still works for this page view.
    }
  }

  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={
        className ??
        "inline-flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink"
      }
    >
      {theme === "dark" ? <Sun aria-hidden className="size-5" /> : <Moon aria-hidden className="size-5" />}
    </button>
  );
}
