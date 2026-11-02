/**
 * Client shim for `next/link`, so copied ARGUE IT components keep their bodies unchanged.
 * `href` (string or a Next-style URL object) maps to React Router's `to`. Next-only props
 * (`prefetch`, `scroll`, `shallow`, `legacyBehavior`, `passHref`, `locale`) are dropped.
 */
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { Link as RouterLink } from "react-router";

export interface NextUrlObject {
  pathname?: string | null;
  query?: Record<string, string | number | boolean | readonly (string | number | boolean)[] | null | undefined> | string | null;
  hash?: string | null;
  search?: string | null;
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string | NextUrlObject;
  replace?: boolean;
  prefetch?: boolean | "auto" | null;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
  locale?: string | false;
  children?: ReactNode;
}

export function hrefToString(href: string | NextUrlObject): string {
  if (typeof href === "string") return href;
  let out = href.pathname ?? "";
  if (href.search) {
    out += href.search.startsWith("?") ? href.search : `?${href.search}`;
  } else if (href.query) {
    const params =
      typeof href.query === "string" ? new URLSearchParams(href.query) : new URLSearchParams();
    if (typeof href.query !== "string") {
      for (const [key, value] of Object.entries(href.query)) {
        if (value === null || value === undefined) continue;
        if (Array.isArray(value)) for (const v of value) params.append(key, String(v));
        else params.append(key, String(value));
      }
    }
    const qs = params.toString();
    if (qs) out += `?${qs}`;
  }
  if (href.hash) out += href.hash.startsWith("#") ? href.hash : `#${href.hash}`;
  return out;
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  {
    href,
    replace,
    prefetch: _prefetch,
    scroll: _scroll,
    shallow: _shallow,
    passHref: _passHref,
    legacyBehavior: _legacyBehavior,
    locale: _locale,
    ...rest
  },
  ref,
) {
  const to = hrefToString(href);
  // External links render a plain anchor; React Router only handles in-app paths.
  if (/^[a-z][a-z0-9+.-]*:/i.test(to) || to.startsWith("//")) {
    return <a ref={ref} href={to} {...rest} />;
  }
  return <RouterLink ref={ref} to={to} replace={replace} {...rest} />;
});

export default Link;
