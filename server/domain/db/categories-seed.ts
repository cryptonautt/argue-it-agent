import type { DbOrTx } from "./index";
import { categories } from "./schema";

/**
 * The v1 launch categories (design §2, §4.3.5). Rubric ids map to src/server/judging/rubrics/.
 * Seeding is idempotent and never overwrites admin edits (ON CONFLICT DO NOTHING on slug).
 */
export const CATEGORY_SEED = [
  {
    slug: "sports",
    name: "Sports & Football",
    description: "Football, the Premier League, AFCON, the GOAT debate and every other sport.",
    rubricId: "sports",
    sort: 10,
  },
  {
    slug: "entertainment",
    name: "Entertainment",
    description: "Music, Afrobeats, Nollywood, film, TV and celebrity takes.",
    rubricId: "subjective",
    sort: 20,
  },
  {
    slug: "gaming",
    name: "Gaming",
    description: "Games, consoles, esports and who would win.",
    rubricId: "analytical",
    sort: 30,
  },
  {
    slug: "technology",
    name: "Technology",
    description: "Phones, AI, software, startups and the tech that runs our lives.",
    rubricId: "technology",
    sort: 40,
  },
  {
    slug: "crypto",
    name: "Crypto",
    description: "Bitcoin, blockchains, tokens and the claims people make about them.",
    rubricId: "factual",
    sort: 50,
  },
] as const satisfies ReadonlyArray<{
  slug: string;
  name: string;
  description: string;
  rubricId: string;
  sort: number;
}>;

export type CategorySlug = (typeof CATEGORY_SEED)[number]["slug"];

export async function seedCategories(db: DbOrTx): Promise<void> {
  await db
    .insert(categories)
    .values(CATEGORY_SEED.map((c) => ({ ...c })))
    .onConflictDoNothing({ target: categories.slug });
}
