import { Compass, Flame, PlusSquare, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Path prefixes that mark this item active. */
  match: (pathname: string) => boolean;
}

export const PRIMARY_NAV: readonly NavItem[] = [
  { href: "/", label: "Feed", icon: Flame, match: (p) => p === "/" || p.startsWith("/a/") },
  { href: "/explore", label: "Explore", icon: Compass, match: (p) => p.startsWith("/explore") },
  { href: "/new", label: "Post", icon: PlusSquare, match: (p) => p.startsWith("/new") },
];
