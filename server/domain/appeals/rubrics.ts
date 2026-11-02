/**
 * Owner: verdict. Rubric lookups for /rules and the "How this was judged" panel. Code rubrics
 * (src/server/judging/rubrics/) are the source of truth; if a pinned id@version isn't in code any more
 * we fall back to the `rubrics` table mirror, and finally to nothing (pages degrade gracefully).
 */
import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@domain/db";
import { categories, rubrics } from "@domain/db/schema";
import { getRubric as getCodeRubric, listCurrentRubrics } from "@domain/judging/rubrics";
import type { RubricDef } from "@domain/judging/types";

export interface RubricWithCategories extends RubricDef {
  /** Display names of the active categories judged with this rubric. */
  categoryNames: string[];
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (error) {
    console.error("[appeals] rubric lookup failed", error);
    return fallback;
  }
}

export async function findRubric(id: string, version: number): Promise<RubricDef | null> {
  const fromCode = safe(() => getCodeRubric(id, version), undefined);
  if (fromCode) return fromCode;
  const [row] = await db
    .select()
    .from(rubrics)
    .where(and(eq(rubrics.id, id), eq(rubrics.version, version)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    description: "",
    categorySlugs: row.categorySlugs,
    criteria: row.criteria,
  };
}

/** Current rubrics with the categories that use them, in category order. */
export async function listRubricsForRules(): Promise<RubricWithCategories[]> {
  const cats = await db
    .select({ name: categories.name, slug: categories.slug, rubricId: categories.rubricId })
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.sort));

  let list: RubricDef[] = safe(() => listCurrentRubrics(), []);
  if (list.length === 0) {
    const rows = await db.select().from(rubrics).where(eq(rubrics.status, "active"));
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const seen = latest.get(row.id);
      if (!seen || row.version > seen.version) latest.set(row.id, row);
    }
    list = [...latest.values()].map((row) => ({
      id: row.id,
      version: row.version,
      name: row.name,
      description: "",
      categorySlugs: row.categorySlugs,
      criteria: row.criteria,
    }));
  }

  const order = (r: RubricDef) => {
    const index = cats.findIndex((c) => c.rubricId === r.id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return list
    .map((r) => ({
      ...r,
      categoryNames: cats.filter((c) => c.rubricId === r.id || r.categorySlugs.includes(c.slug)).map((c) => c.name),
    }))
    .sort((a, b) => order(a) - order(b));
}
