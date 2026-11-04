/** Polymarket event slug validation. Pure; safe to import from client code. */
import { z } from "zod";

export const MARKET_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,199}$/;

export const marketSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(MARKET_SLUG_PATTERN, "That market link isn't valid.");

export function parseMarketSlug(value: string | null | undefined): string | null {
  const parsed = marketSlugSchema.safeParse(value ?? "");
  return parsed.success ? parsed.data : null;
}
