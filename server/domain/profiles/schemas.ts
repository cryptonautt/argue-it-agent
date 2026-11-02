/**
 * Input schemas for profile actions. Pure (no server-only) so client forms can share limits/messages.
 */
import { z } from "zod";
import { displayNameSchema, normalizeHandle } from "@domain/lib/handles";
import { validateLink } from "@domain/lib/links";

export const BIO_MAX = 280;
export const MAX_INTERESTS = 5;

/**
 * Display names that would let someone pose as the platform or the AI judge. Trust in verdicts is the
 * product, so nobody gets to be "AI Judge" in a comment thread.
 */
const RESERVED_DISPLAY_NAMES = new Set([
  "admin",
  "administrator",
  "moderator",
  "argue it",
  "argueit",
  "argue it official",
  "official",
  "ai judge",
  "the judge",
  "judge",
  "the ai judge",
  "ai verdict",
  "system",
  "deleted user",
]);

export function isReservedDisplayName(name: string): boolean {
  const normalised = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return RESERVED_DISPLAY_NAMES.has(normalised);
}

const bioSchema = z
  .string()
  .transform((s) => s.replace(/\r\n/g, "\n").trim())
  .pipe(z.string().max(BIO_MAX, `Keep your bio under ${BIO_MAX} characters.`))
  .transform((s) => (s.length === 0 ? null : s));

const avatarUrlSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value.length === 0) return null;
    const result = validateLink(value);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.error });
      return z.NEVER;
    }
    if (!result.url.startsWith("https://")) {
      ctx.addIssue({ code: "custom", message: "Use an image link that starts with https://." });
      return z.NEVER;
    }
    return result.url;
  });

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.refine((n) => !isReservedDisplayName(n), "That name is reserved. Pick another."),
  bio: bioSchema.optional().default(""),
  avatarUrl: avatarUrlSchema.optional().default(""),
});
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;

export const saveInterestsSchema = z.object({
  categorySlugs: z
    .array(z.string().trim().min(1).max(40))
    .max(MAX_INTERESTS, `Pick up to ${MAX_INTERESTS} categories.`)
    .transform((slugs) => [...new Set(slugs)]),
  /** Onboarding sets this to mark /welcome as done. */
  completeOnboarding: z.boolean().optional().default(false),
});
export type SaveInterestsInput = z.input<typeof saveInterestsSchema>;

export const deleteAccountSchema = z.object({
  confirmHandle: z.string().transform(normalizeHandle).pipe(z.string().min(1, "Type your handle to confirm.")),
});
export type DeleteAccountInput = z.input<typeof deleteAccountSchema>;

/** Handle given to an anonymised (soft-deleted) account: `deleted_` + 12 hex chars of the user id. */
export function deletedHandleFor(userId: string): string {
  return `deleted_${userId.replace(/-/g, "").slice(0, 12).toLowerCase()}`;
}

export const DELETED_DISPLAY_NAME = "Deleted user";
