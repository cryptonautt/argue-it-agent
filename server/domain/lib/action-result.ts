/**
 * The return shape of EVERY server action (design §5.4). Safe to import from client components.
 *
 *   const result = await createArgument(input);
 *   if (!result.ok) { show(result.error); highlight(result.fieldErrors); return; }
 *   use(result.data);
 */
import type { ZodError } from "zod";

export type FieldErrors = Partial<Record<string, string[]>>;

export type ActionErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "SUSPENDED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "IN_PROGRESS"
  | "INTERNAL";

export type ActionSuccess<T> = { ok: true; data: T };
export type ActionFailure = {
  ok: false;
  /** One plain-language sentence a user can act on. Never a stack trace or SQL error. */
  error: string;
  /** Per-field messages keyed by input field name (dot-paths for nested fields, "_form" for root). */
  fieldErrors?: FieldErrors;
  /** Stable machine code for client branching. */
  code?: ActionErrorCode;
};
export type ActionResult<T = void> = ActionSuccess<T> | ActionFailure;

export function ok(): ActionSuccess<void>;
export function ok<T>(data: T): ActionSuccess<T>;
export function ok<T>(data?: T): ActionSuccess<T | undefined> {
  return { ok: true, data };
}

export function fail(
  error: string,
  options: { fieldErrors?: FieldErrors; code?: ActionErrorCode } = {},
): ActionFailure {
  return {
    ok: false,
    error,
    ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
    ...(options.code ? { code: options.code } : {}),
  };
}

/** Convert a zod error into an ActionFailure with per-field messages. */
export function fromZodError(error: ZodError, message = "Please fix the highlighted fields."): ActionFailure {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fail(message, { fieldErrors, code: "VALIDATION" });
}

/**
 * An expected, user-facing failure thrown from server code (auth, rate limit, not found, conflict…).
 * `runAction()` (src/server/action.ts) converts it into an ActionFailure; any other thrown error becomes
 * a generic failure and is logged server-side.
 */
export class ActionError extends Error {
  readonly code: ActionErrorCode;
  readonly fieldErrors?: FieldErrors;

  constructor(code: ActionErrorCode, message: string, fieldErrors?: FieldErrors) {
    super(message);
    this.name = "ActionError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }

  toResult(): ActionFailure {
    return fail(this.message, { code: this.code, fieldErrors: this.fieldErrors });
  }
}

export function isActionError(error: unknown): error is ActionError {
  return error instanceof ActionError;
}

/** For tests and trusted callers: return the data or throw with the failure message. */
export function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`ActionResult failed: ${result.error}`);
  return result.data;
}
