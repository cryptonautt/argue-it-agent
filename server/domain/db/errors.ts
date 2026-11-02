/**
 * Postgres error helpers that work for postgres-js, PGlite and drizzle-wrapped errors
 * (drizzle wraps driver errors in DrizzleQueryError with the original on `.cause`).
 */

interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
  constraint_name?: unknown;
  cause?: unknown;
}

function* errorChain(error: unknown): Generator<PgErrorLike> {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    yield current as PgErrorLike;
    current = (current as PgErrorLike).cause;
  }
}

/** The SQLSTATE code of a Postgres error (e.g. "23505"), if any. */
export function pgErrorCode(error: unknown): string | undefined {
  for (const e of errorChain(error)) {
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  }
  return undefined;
}

function pgConstraint(error: unknown): string | undefined {
  for (const e of errorChain(error)) {
    if (typeof e.constraint === "string") return e.constraint;
    if (typeof e.constraint_name === "string") return e.constraint_name;
  }
  return undefined;
}

/** True for unique_violation (23505), optionally only for the named constraint/index. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (pgErrorCode(error) !== "23505") return false;
  if (!constraint) return true;
  const actual = pgConstraint(error);
  // Some drivers omit the constraint name; fall back to matching the message.
  if (actual) return actual === constraint;
  return error instanceof Error && JSON.stringify(error, Object.getOwnPropertyNames(error)).includes(constraint);
}

/** True for check_violation (23514). */
export function isCheckViolation(error: unknown): boolean {
  return pgErrorCode(error) === "23514";
}

/** True for foreign_key_violation (23503). */
export function isForeignKeyViolation(error: unknown): boolean {
  return pgErrorCode(error) === "23503";
}
