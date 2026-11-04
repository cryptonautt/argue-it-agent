/**
 * ARGUE IT route <-> semantic screen state for the agent (plan Task 7).
 *
 * Pure (no React, no DB) so the UI hook, the `navigate` action and tests all share one table.
 * `toNavigationState` returns null for routes that are not ARGUE IT screens (the template's chat,
 * settings, database… pages); the caller then falls back to the template's own view mapping.
 */

export type ReviewTab = "review" | "appeals";

export type ArgueNav =
  | { view: "feed" }
  | { view: "argument"; argumentId: string }
  | { view: "new-argument" }
  | { view: "new-challenge"; argumentId?: string }
  | { view: "debate"; competitionId: string }
  | { view: "verdict"; competitionId: string }
  | { view: "review-queue"; tab: ReviewTab }
  | { view: "profile"; handle: string }
  | { view: "welcome" }
  | { view: "rules" }
  | { view: "markets" }
  | { view: "market"; slug: string };

export type ArgueView = ArgueNav["view"];

export const ARGUE_VIEWS: readonly ArgueView[] = [
  "feed",
  "argument",
  "new-argument",
  "new-challenge",
  "debate",
  "verdict",
  "review-queue",
  "profile",
  "welcome",
  "rules",
  "markets",
  "market",
];

export function isArgueView(view: unknown): view is ArgueView {
  return typeof view === "string" && (ARGUE_VIEWS as readonly string[]).includes(view);
}

type SearchInput = URLSearchParams | string | null | undefined;

function toSearchParams(search: SearchInput): URLSearchParams {
  if (search instanceof URLSearchParams) return search;
  return new URLSearchParams(typeof search === "string" ? search : "");
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function reviewTab(value: string | null): ReviewTab {
  return value === "appeals" ? "appeals" : "review";
}

/** Map a router-local pathname (plus optional query string) to the ARGUE IT screen it shows. */
export function toNavigationState(pathname: string, search?: SearchInput): ArgueNav | null {
  const params = toSearchParams(search);
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const parts = path.split("/").filter(Boolean).map(decodeSegment);

  if (parts.length === 0) return { view: "feed" };
  const [first, second, third] = parts;

  switch (first) {
    case "a":
      return parts.length === 2 && second ? { view: "argument", argumentId: second } : null;
    case "new":
      return parts.length === 1 ? { view: "new-argument" } : null;
    case "challenge":
      if (parts.length === 2 && second === "new") {
        const argumentId = params.get("argument");
        return argumentId ? { view: "new-challenge", argumentId } : { view: "new-challenge" };
      }
      return null;
    case "c":
      if (parts.length === 2 && second) return { view: "debate", competitionId: second };
      if (parts.length === 3 && second && third === "verdict") return { view: "verdict", competitionId: second };
      return null;
    case "admin":
      if (parts.length === 2 && second === "review") return { view: "review-queue", tab: reviewTab(params.get("tab")) };
      // The reference app had a separate appeals page; keep the old URL meaningful for the agent.
      if (parts.length === 2 && second === "appeals") return { view: "review-queue", tab: "appeals" };
      return null;
    case "u":
      return parts.length === 2 && second ? { view: "profile", handle: second } : null;
    case "welcome":
      return parts.length === 1 ? { view: "welcome" } : null;
    case "rules":
      return parts.length === 1 ? { view: "rules" } : null;
    case "markets":
      if (parts.length === 1) return { view: "markets" };
      return parts.length === 2 && second ? { view: "market", slug: second } : null;
    default:
      return null;
  }
}

/** The router-local path for an ARGUE IT screen (inverse of `toNavigationState`). */
export function pathForNav(nav: ArgueNav): string {
  const seg = encodeURIComponent;
  switch (nav.view) {
    case "feed":
      return "/";
    case "argument":
      return `/a/${seg(nav.argumentId)}`;
    case "new-argument":
      return "/new";
    case "new-challenge":
      return nav.argumentId ? `/challenge/new?argument=${seg(nav.argumentId)}` : "/challenge/new";
    case "debate":
      return `/c/${seg(nav.competitionId)}`;
    case "verdict":
      return `/c/${seg(nav.competitionId)}/verdict`;
    case "review-queue":
      return nav.tab === "appeals" ? "/admin/review?tab=appeals" : "/admin/review";
    case "profile":
      return `/u/${seg(nav.handle)}`;
    case "welcome":
      return "/welcome";
    case "rules":
      return "/rules";
    case "markets":
      return "/markets";
    case "market":
      return `/markets/${seg(nav.slug)}`;
  }
}

/** Ids a `navigate` command may carry alongside `view`. */
export interface ArgueNavCommandFields {
  view?: string;
  argumentId?: string;
  competitionId?: string;
  handle?: string;
  tab?: string;
  slug?: string;
}

/**
 * Build an ArgueNav from a loose command (agent `navigate` input). Returns null when the view is not an
 * ARGUE IT view; throws when a required id is missing so the agent gets a clear error instead of a
 * silent redirect to the wrong record.
 */
export function navFromCommand(command: ArgueNavCommandFields): ArgueNav | null {
  const view = command.view;
  if (!isArgueView(view)) return null;
  const need = (value: string | undefined, name: string): string => {
    const v = value?.trim();
    if (!v) throw new Error(`The "${view}" view needs --${name}.`);
    return v;
  };
  switch (view) {
    case "feed":
    case "new-argument":
    case "welcome":
    case "rules":
    case "markets":
      return { view };
    case "market":
      return { view, slug: need(command.slug, "slug") };
    case "new-challenge":
      return command.argumentId?.trim() ? { view, argumentId: command.argumentId.trim() } : { view };
    case "argument":
      return { view, argumentId: need(command.argumentId, "argumentId") };
    case "debate":
    case "verdict":
      return { view, competitionId: need(command.competitionId, "competitionId") };
    case "review-queue":
      return { view, tab: reviewTab(command.tab ?? null) };
    case "profile":
      return { view, handle: need(command.handle, "handle") };
  }
}
