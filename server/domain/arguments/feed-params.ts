/**
 * Feed tabs and URL parameters (design §4.6). Pure and client-safe: used by the home page, the feed
 * list's "load more", and the category filter so every link agrees on the same query string.
 */

export const FEED_TABS = [
  { key: "for-you", label: "For You" },
  { key: "trending", label: "Trending" },
  { key: "new", label: "New" },
  { key: "following", label: "Following" },
  { key: "active", label: "Active Debates" },
  { key: "ending", label: "Ending Soon" },
] as const;

export type FeedTab = (typeof FEED_TABS)[number]["key"];
export const DEFAULT_FEED_TAB: FeedTab = "for-you";

const TAB_KEYS: ReadonlySet<string> = new Set(FEED_TABS.map((t) => t.key));

export function isFeedTab(value: unknown): value is FeedTab {
  return typeof value === "string" && TAB_KEYS.has(value);
}

/** First value of a search param (Next gives `string | string[] | undefined`). */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseFeedTab(value: string | string[] | undefined): FeedTab {
  const raw = firstParam(value);
  return isFeedTab(raw) ? raw : DEFAULT_FEED_TAB;
}

const SLUG = /^[a-z0-9-]{1,64}$/;

/** Category slug from the URL, or null when absent/malformed (unknown-but-wellformed slugs are checked by the query). */
export function parseCategorySlug(value: string | string[] | undefined): string | null {
  const raw = firstParam(value)?.trim().toLowerCase();
  return raw && SLUG.test(raw) ? raw : null;
}

export function feedHref(tab: FeedTab, categorySlug: string | null): string {
  const params = new URLSearchParams();
  if (tab !== DEFAULT_FEED_TAB) params.set("tab", tab);
  if (categorySlug) params.set("category", categorySlug);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}
