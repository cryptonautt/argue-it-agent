/**
 * Alias target for `next/navigation` in server (domain) code.
 *
 * - `notFound()` throws ActionError("NOT_FOUND"), so `runAction()` turns it into a normal failure result.
 * - `redirect()` / `permanentRedirect()` throw `RedirectNotSupportedError` on purpose. The only reference call
 *   site was `requirePageUser`, which the auth bridge removed; any other call is a porting bug and must fail
 *   loudly instead of becoming a failure result.
 * - `unstable_rethrow(e)` rethrows only that error (mirroring Next, where it rethrows its control-flow errors),
 *   so `runAction()` lets it escape instead of returning `{ ok: false, code: "INTERNAL" }`. Anything else: no-op.
 */
import { ActionError } from "@domain/lib/action-result";

export class RedirectNotSupportedError extends Error {
  constructor(name = "redirect") {
    super(`${name}() is not supported in domain code`);
    this.name = "RedirectNotSupportedError";
  }
}

export function notFound(): never {
  throw new ActionError("NOT_FOUND", "We couldn't find that.");
}

export function unstable_rethrow(error: unknown): void {
  if (error instanceof RedirectNotSupportedError) throw error;
}

export function redirect(_url?: string, _type?: string): never {
  throw new RedirectNotSupportedError("redirect");
}

export function permanentRedirect(_url?: string, _type?: string): never {
  throw new RedirectNotSupportedError("permanentRedirect");
}
