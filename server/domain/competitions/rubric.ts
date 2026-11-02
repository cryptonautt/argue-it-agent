/**
 * Owner: challenges. Resolve the rubric a challenge pins (design §4.3.5) and the details shown in the
 * terms preview. Code rubrics (judge team: `getLatestRubric` / `getRubric`) are the source of truth;
 * the `rubrics` table mirror is only a fallback. Never invents a rubric: if none can be found the
 * caller must refuse to send the challenge (both sides must see the rubric before accepting).
 */
import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@domain/db";
import { rubrics } from "@domain/db/schema";
import { getLatestRubric, getRubric, type RubricDef } from "@domain/judging";
import type { RubricView } from "./terms";

export type { RubricView };

const toView = (def: RubricDef): RubricView => ({
  id: def.id,
  version: def.version,
  name: def.name,
  description: def.description,
  criteria: def.criteria,
});

/** The exact rubric version a competition pinned (for the terms panel). */
export async function getPinnedRubric(id: string, version: number, conn: DbOrTx = db): Promise<RubricView | null> {
  const def = getRubric(id, version);
  if (def) return toView(def);
  const [row] = await conn
    .select()
    .from(rubrics)
    .where(and(eq(rubrics.id, id), eq(rubrics.version, version)))
    .limit(1);
  return row ? { id: row.id, version: row.version, name: row.name, description: "", criteria: row.criteria } : null;
}

/** The current version of rubric `id` (the category's configured rubric), pinned when a challenge is sent. */
export async function getCurrentRubric(id: string, conn: DbOrTx = db): Promise<RubricView | null> {
  const def = getLatestRubric(id);
  if (def) return toView(def);
  const [row] = await conn
    .select()
    .from(rubrics)
    .where(and(eq(rubrics.id, id), eq(rubrics.status, "active")))
    .orderBy(desc(rubrics.version))
    .limit(1);
  return row ? { id: row.id, version: row.version, name: row.name, description: "", criteria: row.criteria } : null;
}
