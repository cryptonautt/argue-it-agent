import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { loadCards } from "@domain/arguments/cards";
import type { ArgumentCardData } from "@domain/arguments/types";
import { listableArgument } from "@domain/arguments/visibility";
import { db } from "@domain/db";
import { argumentsTable } from "@domain/db/schema";

const MARKET_DEBATES_LIMIT = 20;

/** Arguments posted about a Polymarket event, newest first, as feed cards the viewer may see. */
export async function listMarketDebates(slug: string, viewerId: string | null): Promise<ArgumentCardData[]> {
  const rows = await db
    .select({ id: argumentsTable.id })
    .from(argumentsTable)
    .where(and(eq(argumentsTable.polymarketEventSlug, slug), listableArgument(viewerId)))
    .orderBy(desc(argumentsTable.createdAt))
    .limit(MARKET_DEBATES_LIMIT);
  return loadCards(
    rows.map((r) => r.id),
    viewerId,
  );
}
