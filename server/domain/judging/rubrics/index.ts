/**
 * Rubric registry (design §4.3.5). Code is the source of truth; `syncRubrics()` mirrors it into the
 * `rubrics` table idempotently (never overwriting an existing id@version — versions are immutable).
 */
import type { DbOrTx } from "@domain/db";
import { rubrics } from "@domain/db/schema";
import type { RubricDef } from "../types";
import { ALL_RUBRICS } from "./v1";

export { ALL_RUBRICS, ANALYTICAL_V1, FACTUAL_V1, SPORTS_V1, SUBJECTIVE_V1, TECHNOLOGY_V1 } from "./v1";

const key = (id: string, version: number) => `${id}@${version}`;
const BY_KEY = new Map(ALL_RUBRICS.map((r) => [key(r.id, r.version), r]));

/** Look up a rubric by id + version (e.g. getRubric("sports", 1)). Undefined if unknown. */
export function getRubric(id: string, version: number): RubricDef | undefined {
  return BY_KEY.get(key(id, version));
}

/** The newest version of a rubric id — what a NEW challenge should pin. Undefined if unknown. */
export function getLatestRubric(id: string): RubricDef | undefined {
  let latest: RubricDef | undefined;
  for (const rubric of ALL_RUBRICS) {
    if (rubric.id === id && (!latest || rubric.version > latest.version)) latest = rubric;
  }
  return latest;
}

/** The newest rubric that applies to a category slug (sports → sports@1, crypto → factual@1, …). */
export function getRubricForCategory(categorySlug: string): RubricDef | undefined {
  let latest: RubricDef | undefined;
  for (const rubric of ALL_RUBRICS) {
    if (rubric.categorySlugs.includes(categorySlug) && (!latest || rubric.version > latest.version)) latest = rubric;
  }
  return latest;
}

/** All rubrics, latest version of each id (for /rules). */
export function listCurrentRubrics(): RubricDef[] {
  const ids = [...new Set(ALL_RUBRICS.map((r) => r.id))];
  return ids.map((id) => getLatestRubric(id)).filter((r): r is RubricDef => r !== undefined);
}

/** Total of a rubric's weights (must be 100; asserted in tests). */
export function rubricWeightTotal(rubric: RubricDef): number {
  return rubric.criteria.reduce((sum, c) => sum + c.weight, 0);
}

/**
 * Mirror the code rubrics into the `rubrics` table. Idempotent: existing id@version rows are left
 * untouched (ON CONFLICT DO NOTHING). Returns the number of rows inserted.
 */
export async function syncRubrics(db: DbOrTx): Promise<number> {
  const inserted = await db
    .insert(rubrics)
    .values(
      ALL_RUBRICS.map((r) => ({
        id: r.id,
        version: r.version,
        name: r.name,
        categorySlugs: [...r.categorySlugs],
        criteria: r.criteria.map((c) => ({ ...c })),
        status: "active" as const,
      })),
    )
    .onConflictDoNothing({ target: [rubrics.id, rubrics.version] })
    .returning({ id: rubrics.id });
  return inserted.length;
}
