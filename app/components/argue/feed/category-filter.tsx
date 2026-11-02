import Link from "@/shims/next-link";
import { cn } from "@domain/lib/cn";

export interface CategoryChip {
  slug: string;
  name: string;
}

export interface CategoryFilterProps {
  categories: readonly CategoryChip[];
  active: string | null;
  /** Build the link for a category (null = all). */
  hrefFor: (slug: string | null) => string;
  className?: string;
}

/** Horizontally scrolling category chips (URL-driven, works without JavaScript). */
export function CategoryFilter({ categories, active, hrefFor, className }: CategoryFilterProps) {
  const chips = [{ slug: null, name: "All" }, ...categories];
  return (
    <nav aria-label="Filter by category" className={cn("-mx-4 overflow-x-auto px-4 [scrollbar-width:none]", className)}>
      <ul className="flex min-w-max gap-2 py-1">
        {chips.map((chip) => {
          const isActive = chip.slug === active;
          return (
            <li key={chip.slug ?? "all"}>
              <Link
                href={hrefFor(chip.slug)}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap transition-colors",
                  isActive
                    ? "border-ink bg-ink text-ink-inverse"
                    : "border-line-strong bg-surface text-ink-2 hover:border-ink hover:text-ink",
                )}
              >
                {chip.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
