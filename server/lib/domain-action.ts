/**
 * Bridge between the ARGUE IT domain layer (reference server actions that return `ActionResult<T>`)
 * and Agent-Native actions (which return data and fail by throwing a typed action error).
 *
 *   run: async (args) => runDomain(createArgument(withIdempotencyKey(args)))
 *
 * Failure contract (shared with app/lib/server-actions.ts, see docs/port-notes.md):
 * - `errorCode` is the reference `ActionErrorCode` string unchanged ("VALIDATION", "SUSPENDED", ...).
 * - `details.fieldErrors` carries the per-field messages when the domain returned any.
 * - The message is the domain's user-facing sentence.
 * - A failure is NEVER returned as data.
 *
 * One extra code, `NEEDS_HANDLE`, replaces `UNAUTHENTICATED` when the caller is signed in to the
 * framework but has no ARGUE IT `users` row yet (the client sends them to /welcome).
 */
import { randomUUID } from "node:crypto";

import { defineActionErrors } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

import { ensureAppUser, requireRole } from "@domain/auth";
import {
  isActionError,
  type ActionErrorCode,
  type ActionFailure,
  type ActionResult,
  type FieldErrors,
} from "@domain/lib/action-result";

/** Signed in to the framework, but no ARGUE IT profile yet. Not part of the reference union. */
export const NEEDS_HANDLE = "NEEDS_HANDLE" as const;
export type DomainActionErrorCode = ActionErrorCode | typeof NEEDS_HANDLE;

interface ErrorMapping {
  /** HTTP status the framework sends with the error. */
  statusCode: number;
  /**
   * True when the domain raises this code before it writes anything that matters (parse, auth, lookup),
   * so the agent may retry with corrected arguments (framework `NoWriteError`).
   */
  noWrite: boolean;
}

/**
 * Every reference `ActionErrorCode`, one-to-one. `satisfies Record<ActionErrorCode, ...>` makes a code
 * added to the union (or removed from this table) a compile error.
 */
export const DOMAIN_ERROR_MAP = {
  VALIDATION: { statusCode: 400, noWrite: true },
  UNAUTHENTICATED: { statusCode: 401, noWrite: true },
  SUSPENDED: { statusCode: 403, noWrite: true },
  FORBIDDEN: { statusCode: 403, noWrite: true },
  NOT_FOUND: { statusCode: 404, noWrite: true },
  CONFLICT: { statusCode: 409, noWrite: false },
  RATE_LIMITED: { statusCode: 429, noWrite: false },
  IN_PROGRESS: { statusCode: 409, noWrite: false },
  INTERNAL: { statusCode: 500, noWrite: false },
} as const satisfies Record<ActionErrorCode, ErrorMapping>;

const NEEDS_HANDLE_MAPPING: ErrorMapping = { statusCode: 401, noWrite: true };

/** The closed error-code set every ARGUE IT action publishes (`errors: domainErrors`). */
export const domainErrors = defineActionErrors(
  "VALIDATION",
  "UNAUTHENTICATED",
  "SUSPENDED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "IN_PROGRESS",
  "INTERNAL",
  NEEDS_HANDLE,
);

// Compile-time: the published set and the map agree in both directions.
type PublishedCode = (typeof domainErrors.codes)[number];
const _everyDomainCodePublished: ActionErrorCode extends PublishedCode ? true : never = true;
const _nothingExtraPublished: Exclude<PublishedCode, DomainActionErrorCode> extends never ? true : never = true;
void _everyDomainCodePublished;
void _nothingExtraPublished;

const INTERNAL_MESSAGE = "Something went wrong on our side. Please try again.";

async function resolveCode(code: ActionErrorCode): Promise<DomainActionErrorCode> {
  if (code !== "UNAUTHENTICATED") return code;
  // Framework session present but no ARGUE IT user row: tell the client to onboard, not to sign in.
  try {
    const email = getRequestUserEmail();
    if (email && (await ensureAppUser(email)) === "needs-handle") return NEEDS_HANDLE;
  } catch {
    // Never mask the original failure with a lookup error.
  }
  return code;
}

/** Throw the framework typed error for a domain failure. Never returns. */
export async function throwDomainFailure(failure: Pick<ActionFailure, "error" | "code" | "fieldErrors">): Promise<never> {
  const code = await resolveCode(failure.code ?? "INTERNAL");
  const mapping: ErrorMapping = code === NEEDS_HANDLE ? NEEDS_HANDLE_MAPPING : DOMAIN_ERROR_MAP[code];
  const message =
    code === NEEDS_HANDLE ? "Pick a handle to finish setting up your ARGUE IT profile." : failure.error || INTERNAL_MESSAGE;
  const details: Record<string, unknown> | undefined = hasFieldErrors(failure.fieldErrors)
    ? { fieldErrors: failure.fieldErrors }
    : undefined;
  const options = { statusCode: mapping.statusCode, ...(details ? { details } : {}) };
  if (mapping.noWrite) return domainErrors.noWrite(message, code, options);
  return domainErrors.fail(message, code, options);
}

function hasFieldErrors(fieldErrors: FieldErrors | undefined): fieldErrors is FieldErrors {
  return fieldErrors !== undefined && Object.keys(fieldErrors).length > 0;
}

/** Map a thrown error: domain `ActionError` → typed action error; anything else is rethrown unchanged. */
async function rethrow(error: unknown): Promise<never> {
  if (isActionError(error)) {
    return throwDomainFailure({ error: error.message, code: error.code, fieldErrors: error.fieldErrors });
  }
  throw error;
}

/**
 * Unwrap a reference server action's result: `{ ok: true, data }` → `data`; `{ ok: false }` → throws the
 * framework typed error (see the header). A domain `ActionError` that escapes as a rejection is mapped too.
 */
export async function runDomain<T>(result: Promise<ActionResult<T>>): Promise<T> {
  let settled: ActionResult<T>;
  try {
    settled = await result;
  } catch (error) {
    return rethrow(error);
  }
  if (settled.ok) return settled.data;
  return throwDomainFailure(settled);
}

/**
 * For read models that return `T | null` and call `requireUser()`/`requireRole()` themselves:
 * `null`/`undefined` → NOT_FOUND, a thrown domain `ActionError` → its mapped code.
 */
export async function runDomainQuery<T>(
  fn: () => Promise<T | null | undefined>,
  notFoundMessage = "We couldn't find that.",
): Promise<T> {
  let value: T | null | undefined;
  try {
    value = await fn();
  } catch (error) {
    return rethrow(error);
  }
  if (value === null || value === undefined) return throwDomainFailure({ error: notFoundMessage, code: "NOT_FOUND" });
  return value;
}

/** `authorize` gate for staff-only actions: domain `requireRole("moderator")`, mapped to FORBIDDEN etc. */
export async function authorizeModerator(): Promise<void> {
  try {
    await requireRole("moderator");
  } catch (error) {
    await rethrow(error);
  }
}

/**
 * The reference write schemas require a client-made uuid `idempotencyKey`. Agents can't mint reliable
 * UUIDs, so the action schemas make it optional and the server fills one in.
 */
export function withIdempotencyKey<T extends { idempotencyKey?: string | undefined }>(
  args: T,
): T & { idempotencyKey: string } {
  return { ...args, idempotencyKey: args.idempotencyKey ?? randomUUID() };
}

/** `T` after a JSON round trip: Dates become ISO strings. */
export type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends readonly (infer U)[]
      ? readonly Jsonify<U>[]
      : T extends object
        ? { [K in keyof T]: Jsonify<T[K]> }
        : T;

/** JSON-safe copy (Dates → ISO strings), so agent, HTTP and in-process callers see the same shape. */
export function toJson<T>(value: T): Jsonify<T> {
  return JSON.parse(JSON.stringify(value)) as Jsonify<T>;
}
