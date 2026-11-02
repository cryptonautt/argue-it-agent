/**
 * Route data loading for the ARGUE IT screens (Task 6, "Loader rule").
 *
 * Why a clientLoader and not a server `loader`: the framework renders SSR HTML and `.data` responses as
 * one impersonal public shell with cookies stripped (core docs, ssr-caching.mdx). A server loader never
 * sees the signed-in user, and anything per-user it returned would be cached for everyone. So every
 * per-user screen loads in the browser through the same Task 5 GET actions the agent calls, and
 * `useRevalidator().revalidate()` (Task 6 `useRevalidateOnAgentWrites`) re-runs these loaders.
 *
 * The rule itself, translated to the client:
 * - the action's `requireUser()` fails with UNAUTHENTICATED → framework sign-in (full document load,
 *   because `/sign-in` is served by the framework, not by a React Router route);
 * - signed in to the framework but no ARGUE IT `users` row ("needs-handle") → `/welcome`;
 * - NOT_FOUND → a 404 route error response (rendered by the route's ErrorBoundary);
 * - FORBIDDEN → a 403 route error response, or a typed "forbidden" result for staff screens that want to
 *   render their own state. Either way no case material is returned.
 *
 * This folder has no `route.tsx`/`index.tsx`, so React Router's flatRoutes ignores it.
 */
import { callAction } from "@agent-native/core/client/hooks";
import { appPath } from "@agent-native/core/client/api-path";
import { buildSignInReturnHref } from "@agent-native/core/client/sign-in-return";
import { data, redirect, redirectDocument } from "react-router";

/** Error code the actions use (or may use) when the email has no ARGUE IT `users` row yet. */
export const NEEDS_HANDLE_CODE = "NEEDS_HANDLE";
export const SESSION_PATH = "/_agent-native/auth/session";
const GENERIC_ERROR = "Something went wrong. Please try again.";

export interface LoadError {
  /** Upper-snake error code (reference `ActionErrorCode`, or `NEEDS_HANDLE`), `INTERNAL` if unknown. */
  code: string;
  message: string;
  status?: number;
}

const STATUS_CODES: Record<number, string> = {
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  423: "SUSPENDED",
  429: "RATE_LIMITED",
};

/** Read anything `callAction` throws (an Error carrying `errorCode`, `status`, `actionMessage`). */
export function readLoadError(error: unknown): LoadError {
  const e = (error ?? {}) as { errorCode?: unknown; status?: unknown; actionMessage?: unknown; message?: unknown };
  const status = typeof e.status === "number" ? e.status : undefined;
  let code = "INTERNAL";
  if (typeof e.errorCode === "string" && e.errorCode.trim()) {
    code = e.errorCode.trim().toUpperCase().replace(/[\s-]+/g, "_");
  } else if (status && STATUS_CODES[status]) {
    code = STATUS_CODES[status];
  }
  const message =
    typeof e.actionMessage === "string" && e.actionMessage.trim() ? e.actionMessage : GENERIC_ERROR;
  return { code, message, ...(status ? { status } : {}) };
}

/** The framework session's email, or null when signed out / unreachable. Never throws. */
export async function getFrameworkEmail(): Promise<string | null> {
  try {
    const res = await fetch(appPath(SESSION_PATH), {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { email?: unknown } | null;
    return body && typeof body.email === "string" && body.email ? body.email : null;
  } catch {
    return null;
  }
}

/** Path + query of the page being loaded, for return-to links. */
export function returnPathOf(request: Request): string {
  const url = new URL(request.url);
  return url.pathname + url.search;
}

export function welcomeHref(next: string): string {
  return `/welcome?${new URLSearchParams({ setup: "1", next }).toString()}`;
}

export function signInHref(returnTo: string): string {
  return buildSignInReturnHref({ returnTo });
}

/**
 * Turn a failed action call into the response the route should throw. Returns `null` for FORBIDDEN
 * when the caller asked to handle it (staff screens render their own "not allowed" state).
 */
export async function responseForLoadError(
  error: LoadError,
  request: Request,
  options: { handleForbidden?: boolean } = {},
): Promise<Response | ReturnType<typeof data> | null> {
  const here = returnPathOf(request);
  switch (error.code) {
    case NEEDS_HANDLE_CODE:
      return redirect(welcomeHref(here));
    case "UNAUTHENTICATED": {
      // Signed in to the framework but unknown to ARGUE IT means "pick a handle", not "sign in again".
      const email = await getFrameworkEmail();
      return email ? redirect(welcomeHref(here)) : redirectDocument(signInHref(here));
    }
    case "NOT_FOUND":
      return data({ message: error.message }, { status: 404 });
    case "FORBIDDEN":
      return options.handleForbidden ? null : data({ message: error.message }, { status: 403 });
    case "SUSPENDED":
      return data({ message: error.message }, { status: 423 });
    default:
      return data({ message: error.message }, { status: error.status && error.status >= 400 ? error.status : 500 });
  }
}

/**
 * Call a Task 5 GET action for a route's clientLoader. Throws a redirect or an error response on failure
 * (see the file comment), never returns a failure as data. A `null` result is treated as NOT_FOUND,
 * matching the reference pages' `if (!data) notFound()`.
 */
export async function loadAction<T>(
  name: string,
  params: Record<string, unknown>,
  request: Request,
): Promise<NonNullable<T>> {
  let result: T;
  try {
    result = (await callAction(name, params as Record<string, any>, { method: "GET" })) as T;
  } catch (error) {
    throw (await responseForLoadError(readLoadError(error), request)) ?? new Error(GENERIC_ERROR);
  }
  if (result === null || result === undefined) {
    throw data({ message: "Not found" }, { status: 404 });
  }
  return result as NonNullable<T>;
}

export type StaffLoad<T> = { ok: true; data: T } | { ok: false; forbidden: string };

/** Like `loadAction`, but FORBIDDEN comes back as `{ ok: false }` so the screen can say why. */
export async function loadStaffAction<T>(
  name: string,
  params: Record<string, unknown>,
  request: Request,
): Promise<StaffLoad<NonNullable<T>>> {
  try {
    const result = (await callAction(name, params as Record<string, any>, { method: "GET" })) as T;
    if (result === null || result === undefined) throw data({ message: "Not found" }, { status: 404 });
    return { ok: true, data: result as NonNullable<T> };
  } catch (error) {
    if (error instanceof Response || isDataWithResponseInit(error)) throw error;
    const loadError = readLoadError(error);
    const response = await responseForLoadError(loadError, request, { handleForbidden: true });
    if (response === null) return { ok: false, forbidden: loadError.message };
    throw response;
  }
}

function isDataWithResponseInit(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "DataWithResponseInit"
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reference pages 404 a malformed id before touching the database. */
export function requireUuid(id: string | undefined): string {
  if (!id || !UUID.test(id)) throw data({ message: "Not found" }, { status: 404 });
  return id;
}
