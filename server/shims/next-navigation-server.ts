/**
 * Alias target for `next/navigation` in server (domain) code.
 *
 * - `notFound()` throws ActionError("NOT_FOUND"), so `runAction()` turns it into a normal failure result.
 * - `unstable_rethrow()` is a no-op: there are no Next.js control-flow errors to let through.
 * - `redirect()` throws a plain Error on purpose. The only reference call site was `requirePageUser`,
 *   which the auth bridge removed; any other call is a porting bug and must fail loudly instead of
 *   becoming a failure result.
 */
import { ActionError } from "@domain/lib/action-result";

export function notFound(): never {
  throw new ActionError("NOT_FOUND", "We couldn't find that.");
}

export function unstable_rethrow(_error: unknown): void {}

export function redirect(_url?: string, _type?: string): never {
  throw new Error("redirect() is not supported in domain code");
}

export function permanentRedirect(_url?: string, _type?: string): never {
  throw new Error("permanentRedirect() is not supported in domain code");
}
