/**
 * Minimal row factories for tests. They insert directly (no auth flow) and return the inserted rows.
 * Extend in your own test files rather than editing this one; ask Foundation for shared additions.
 */
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@domain/db";
import {
  argumentsTable,
  categories,
  profiles,
  users,
  type Argument,
  type Category,
  type Profile,
  type User,
  type UserRole,
} from "@domain/db/schema";

let counter = 0;
const nextId = () => `${Date.now().toString(36)}${(counter++).toString(36)}`.slice(-8);

export interface TestUser {
  user: User;
  profile: Profile;
}

export async function createTestUser(
  db: DbOrTx,
  overrides: { handle?: string; displayName?: string; email?: string; role?: UserRole } = {},
): Promise<TestUser> {
  const suffix = nextId();
  const handle = overrides.handle ?? `user_${suffix}`;
  const [user] = await db
    .insert(users)
    .values({
      name: overrides.displayName ?? `User ${suffix}`,
      email: overrides.email ?? `${handle}@example.test`,
      emailVerified: true,
      role: overrides.role ?? "user",
    })
    .returning();
  if (!user) throw new Error("createTestUser: insert failed");
  const [profile] = await db
    .insert(profiles)
    .values({ userId: user.id, handle, displayName: overrides.displayName ?? `User ${suffix}` })
    .returning();
  if (!profile) throw new Error("createTestUser: profile insert failed");
  return { user, profile };
}

export async function getCategory(db: DbOrTx, slug = "sports"): Promise<Category> {
  const [category] = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1);
  if (!category) throw new Error(`getCategory: no category "${slug}" (did seedCategories run?)`);
  return category;
}

export async function createTestArgument(
  db: DbOrTx,
  authorId: string,
  overrides: Partial<Pick<Argument, "title" | "proposition" | "body" | "links" | "status">> & {
    categorySlug?: string;
  } = {},
): Promise<Argument> {
  const category = await getCategory(db, overrides.categorySlug ?? "sports");
  const [argument] = await db
    .insert(argumentsTable)
    .values({
      authorId,
      categoryId: category.id,
      title: overrides.title ?? "Messi is the greatest footballer of all time",
      proposition: overrides.proposition ?? "Lionel Messi is a better footballer than Cristiano Ronaldo.",
      body: overrides.body ?? "Eight Ballon d'Ors, a World Cup, and more assists than anyone in history.",
      links: overrides.links ?? [],
      status: overrides.status ?? "visible",
    })
    .returning();
  if (!argument) throw new Error("createTestArgument: insert failed");
  return argument;
}
