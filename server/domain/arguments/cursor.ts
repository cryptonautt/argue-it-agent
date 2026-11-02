/**
 * Opaque keyset cursors for the feed (design §4.6 "cursor pagination").
 *
 * A cursor pins: the tab + category it belongs to (so it can't be replayed elsewhere), the sort key and id of
 * the last item served, and — for score-ranked tabs — the `asOf` instant and affinity multipliers used to
 * score page one, so later pages are ranked against the same snapshot and don't reshuffle under the reader.
 *
 * Sort keys are strings with full database precision (timestamptz::text / numeric::text) because
 * JavaScript Dates drop microseconds, which would break keyset comparisons.
 */
import { z } from "zod";
import { roundMultiplier } from "./ranking";
import { isFeedTab, type FeedTab } from "./feed-params";

const cursorSchema = z.object({
  v: z.literal(1),
  t: z.string().refine(isFeedTab),
  c: z.string().max(64).nullable(),
  k: z.string().min(1).max(64),
  id: z.uuid(),
  asOf: z.iso.datetime().optional(),
  aff: z
    .array(z.tuple([z.uuid(), z.number().finite()]))
    .max(50)
    .optional(),
});

export interface FeedCursor {
  tab: FeedTab;
  categorySlug: string | null;
  /** Sort key of the last item (text form of a timestamptz or numeric). */
  key: string;
  id: string;
  /** Scoring snapshot instant (score-ranked tabs). */
  asOf?: Date;
  /** Category multipliers used on page one (For You). */
  affinity?: Map<string, number>;
}

export function encodeCursor(cursor: FeedCursor): string {
  const payload: z.input<typeof cursorSchema> = {
    v: 1,
    t: cursor.tab,
    c: cursor.categorySlug,
    k: cursor.key,
    id: cursor.id,
    ...(cursor.asOf ? { asOf: cursor.asOf.toISOString() } : {}),
    ...(cursor.affinity && cursor.affinity.size > 0 ? { aff: [...cursor.affinity.entries()] } : {}),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Decode a client-supplied cursor. Returns null for anything malformed (never throws). */
export function decodeCursor(raw: string): FeedCursor | null {
  if (raw.length === 0 || raw.length > 4096) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = cursorSchema.safeParse(json);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    tab: data.t as FeedTab,
    categorySlug: data.c,
    key: data.k,
    id: data.id,
    ...(data.asOf ? { asOf: new Date(data.asOf) } : {}),
    // Client-controlled: clamp so a forged cursor can only reorder the forger's own feed, within bounds.
    ...(data.aff ? { affinity: new Map(data.aff.map(([id, m]) => [id, roundMultiplier(m)])) } : {}),
  };
}
