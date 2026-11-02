import Link from "@/shims/next-link";
import { cn } from "@domain/lib/cn";

export interface LinkTabItem {
  key: string;
  label: string;
  href: string;
  /** Optional count shown after the label. */
  count?: number;
}

export interface LinkTabsProps {
  items: readonly LinkTabItem[];
  activeKey: string;
  /** Accessible name of the navigation, e.g. "Feed". */
  ariaLabel: string;
  className?: string;
}

/**
 * URL-driven tabs (feed tabs, profile sections, admin sub-nav). Server-component friendly; the active
 * tab is marked aria-current="page". Scrolls horizontally on small screens.
 */
export function LinkTabs({ items, activeKey, ariaLabel, className }: LinkTabsProps) {
  return (
    <nav aria-label={ariaLabel} className={cn("-mx-4 overflow-x-auto px-4 [scrollbar-width:none]", className)}>
      <ul className="flex min-w-max gap-1 border-b border-line">
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-11 items-center gap-1.5 px-3 text-sm font-semibold whitespace-nowrap transition-colors",
                  active ? "text-ink" : "text-ink-3 hover:text-ink",
                )}
              >
                {item.label}
                {item.count !== undefined ? <span className="tabular text-xs text-ink-3">{item.count}</span> : null}
                {active ? <span aria-hidden className="slant absolute inset-x-2 -bottom-px h-[3px] bg-ink" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
