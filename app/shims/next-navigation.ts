/**
 * Client shim for `next/navigation`, so copied ARGUE IT components keep their bodies unchanged.
 * - `useRouter().refresh()` re-runs the route loaders (React Router revalidation), which is what
 *   Next's refresh did for server components.
 * - `redirect` / `notFound` throw React Router responses (valid inside loaders and render).
 */
import { useMemo } from "react";
import {
  redirect as routerRedirect,
  useLocation,
  useNavigate,
  useParams as useRouterParams,
  useRevalidator,
  useSearchParams as useRouterSearchParams,
} from "react-router";

export interface AppRouterInstance {
  push(href: string, options?: { scroll?: boolean }): void;
  replace(href: string, options?: { scroll?: boolean }): void;
  back(): void;
  forward(): void;
  refresh(): void;
  prefetch(href: string): void;
}

export function useRouter(): AppRouterInstance {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  return useMemo<AppRouterInstance>(
    () => ({
      push: (href) => void navigate(href),
      replace: (href) => void navigate(href, { replace: true }),
      back: () => void navigate(-1),
      forward: () => void navigate(1),
      refresh: () => void revalidator.revalidate(),
      prefetch: () => {},
    }),
    [navigate, revalidator],
  );
}

export function usePathname(): string {
  return useLocation().pathname;
}

/** Next returns a read-only URLSearchParams (not React Router's [params, setParams] tuple). */
export function useSearchParams(): URLSearchParams {
  return useRouterSearchParams()[0];
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  return useRouterParams() as T;
}

export function redirect(url: string): never {
  throw routerRedirect(url);
}

export function permanentRedirect(url: string): never {
  throw routerRedirect(url, 308);
}

export function notFound(): never {
  throw new Response("Not Found", { status: 404, statusText: "Not Found" });
}
