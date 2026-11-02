import "server-only";

import { and, eq, sql, type SQL } from "drizzle-orm";
import { argumentsTable, users } from "@domain/db/schema";
import { notBlockedWith } from "@domain/social/blocks";

/**
 * SQL predicates for "may this argument appear in a list for this viewer?" (design §4.6, §4.7):
 * visible status only (hidden/removed never listed), author account not deleted, and no block in either
 * direction between viewer and author (block semantics are owned by social: `notBlockedWith`).
 * Correlated on `arguments`, so use in queries over `argumentsTable`.
 */
export function listableArgument(viewerId: string | null): SQL {
  const conditions: SQL[] = [eq(argumentsTable.status, "visible"), authorIsActive()];
  if (viewerId) conditions.push(notBlockedWith(viewerId, argumentsTable.authorId));
  return and(...conditions) as SQL;
}

export function authorIsActive(): SQL {
  return sql`exists (select 1 from ${users} where ${users.id} = ${argumentsTable.authorId} and ${users.status} <> 'deleted')`;
}
