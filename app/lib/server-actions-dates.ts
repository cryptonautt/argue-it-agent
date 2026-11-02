/**
 * Action results cross the wire as JSON, so the `Date`s the reference components expect (they call
 * `.toISOString()`, compare deadlines, ...) arrive as ISO strings. `reviveDates` turns them back into
 * `Date`s, but only for keys that name a moment (`...At`, `...Until`, `...Deadline`, `deadline`) AND whose
 * value is a full ISO-8601 timestamp, so user text that merely looks like a date is never touched.
 */
const DATE_KEY = /(At|Until|Deadline)$|^deadline$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function reviveDates<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => reviveDates(item)) as T;
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (typeof inner === "string" && DATE_KEY.test(key) && ISO_TIMESTAMP.test(inner)) {
      const date = new Date(inner);
      out[key] = Number.isNaN(date.getTime()) ? inner : date;
    } else {
      out[key] = reviveDates(inner);
    }
  }
  return out as T;
}
