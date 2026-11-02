/**
 * Argument input rules (design §2 goal 1, §5.3; PRD §8.2). Pure and client-safe: the create/edit form
 * imports the limits and hints from here so the UI and the server can never disagree.
 *
 * Length limits mirror the CHECK constraints on `arguments` (title ≤ 120, proposition ≤ 280, body ≤ 5,000);
 * the minimums are UX rules so a post is something people can actually take a position on.
 */
import { z } from "zod";
import { linksSchema } from "@domain/lib/links";

export const ARGUMENT_LIMITS = {
  titleMin: 3,
  titleMax: 120,
  propositionMin: 10,
  propositionMax: 280,
  bodyMin: 10,
  bodyMax: 5000,
} as const;

/** Collapse runs of whitespace (incl. newlines) into single spaces: titles/propositions are one line. */
export function normalizeInline(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Trim the body and cap blank-line runs at one empty line; keeps the author's paragraphs intact. */
export function normalizeBody(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const inline = (min: number, max: number, tooShort: string, tooLong: string) =>
  z
    .string({ error: tooShort })
    .transform(normalizeInline)
    .pipe(z.string().min(min, tooShort).max(max, tooLong));

export const argumentFieldsSchema = z.object({
  title: inline(
    ARGUMENT_LIMITS.titleMin,
    ARGUMENT_LIMITS.titleMax,
    "Give your argument a title (at least 3 characters).",
    "Keep the title under 120 characters.",
  ),
  categorySlug: z.string({ error: "Pick a category." }).trim().min(1, "Pick a category.").max(64, "Pick a category."),
  proposition: inline(
    ARGUMENT_LIMITS.propositionMin,
    ARGUMENT_LIMITS.propositionMax,
    "State your proposition in at least 10 characters.",
    "Keep the proposition under 280 characters.",
  ),
  body: z
    .string({ error: "Explain your argument." })
    .transform(normalizeBody)
    .pipe(
      z
        .string()
        .min(ARGUMENT_LIMITS.bodyMin, "Back it up with at least a sentence (10+ characters).")
        .max(ARGUMENT_LIMITS.bodyMax, "Keep the body under 5,000 characters."),
    ),
  links: linksSchema,
});

export type ArgumentFieldsInput = z.input<typeof argumentFieldsSchema>;
export type ArgumentFields = z.output<typeof argumentFieldsSchema>;

/**
 * Non-blocking guidance for the proposition (PRD §8.2: "the interface must avoid ambiguous wording").
 * A good proposition is a single statement a reader can AGREE with or be AGAINST.
 */
export function propositionHints(raw: string): string[] {
  const text = normalizeInline(raw);
  if (text.length === 0) return [];
  const hints: string[] = [];
  const words = text.split(" ").filter(Boolean);

  if (/\?\s*$/.test(text) || /^(who|which|what|is|are|should|can|does|do|will|would)\b/i.test(text)) {
    hints.push("Write it as a statement, not a question, so people can clearly AGREE or be AGAINST.");
  }
  if (/\b(vs\.?|versus)\b/i.test(text)) {
    hints.push("Say which side you back — e.g. “Messi is better than Ronaldo”, not “Messi vs Ronaldo”.");
  }
  if (/^(i think|i believe|i feel|in my opinion|imo|personally)\b/i.test(text)) {
    hints.push("Drop “I think” — state the claim itself. Everyone knows it's your take.");
  }
  if (words.length < 4) {
    hints.push("Add a little more so it's clear exactly what you're claiming.");
  }
  return hints;
}
