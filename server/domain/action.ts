import "server-only";

import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { ActionError, fail, fromZodError, isActionError, type ActionResult } from "@domain/lib/action-result";

/**
 * Wrap the body of every server action. Converts thrown `ActionError`s (from requireUser, rate limits,
 * parseInput, your own domain checks…) into `{ ok: false }` results, lets Next.js control-flow errors
 * (redirect(), notFound()) propagate, and turns anything unexpected into a generic failure (logged).
 */
export async function runAction<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    unstable_rethrow(error);
    if (isActionError(error)) return error.toResult();
    console.error("[action] unexpected error", error);
    return fail("Something went wrong on our side. Please try again.", { code: "INTERNAL" });
  }
}

/** Parse untrusted input with zod; throws ActionError("VALIDATION") with per-field messages on failure. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const failure = fromZodError(result.error);
    throw new ActionError("VALIDATION", failure.error, failure.fieldErrors);
  }
  return result.data;
}

/** Throw a NOT_FOUND ActionError unless `value` is present. */
export function assertFound<T>(value: T | null | undefined, message = "We couldn't find that."): T {
  if (value === null || value === undefined) throw new ActionError("NOT_FOUND", message);
  return value;
}
