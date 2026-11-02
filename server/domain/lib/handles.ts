import { z } from "zod";

/** Handle rules (design: ^[a-z0-9_]{3,20}$, unique). Stored lowercase without "@". */
export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

/** Handles that would collide with routes or impersonate staff/the judge. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "moderator",
  "mod",
  "staff",
  "support",
  "help",
  "argueit",
  "argue_it",
  "official",
  "system",
  "judge",
  "ai_judge",
  "settings",
  "notifications",
  "explore",
  "new",
  "rules",
  "welcome",
  "api",
  "null",
  "undefined",
  "me",
]);

/** Prefix of the anonymised handle given to deleted accounts. */
export const DELETED_HANDLE_PREFIX = "deleted_";

export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export const handleSchema = z
  .string()
  .transform(normalizeHandle)
  .pipe(
    z
      .string()
      .regex(HANDLE_PATTERN, "Use 3–20 characters: lowercase letters, numbers or underscores.")
      .refine((h) => !RESERVED_HANDLES.has(h), "That handle is reserved. Try another.")
      // Deleted accounts are anonymised to `deleted_<hex>` (src/server/profiles/schemas.ts); nobody may pose as one.
      .refine((h) => !h.startsWith(DELETED_HANDLE_PREFIX), "That handle is reserved. Try another."),
  );

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a display name.")
  .max(50, "Keep your display name under 50 characters.");
