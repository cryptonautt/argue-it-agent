/**
 * Turns fairness cases into real blind case files using the production code path. Owner: fairness.
 *
 * Each case is written into an isolated in-memory PGlite database exactly as the product would store it
 * (users + profiles with the participants' real handles and names, the argument, a competition with frozen
 * terms, both participants and their frozen submissions). The judge's own `buildCaseFile(competitionId)`
 * then loads, redacts, scans and hashes it. Nothing about blinding is re-implemented here, so the suite
 * measures what production actually sends to the model.
 */
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { setTestDb, type Db } from "@domain/db";
import { CATEGORY_SEED, seedCategories } from "@domain/db/categories-seed";
import type { RulesSnapshot } from "@domain/db/json-types";
import * as schema from "@domain/db/schema";
import { buildCaseFile, getRubric, type BuiltCaseFile, type RubricDef } from "@domain/judging";
import type { FairnessCase } from "./case-schema";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** v1 rubrics are all version 1 (design §4.3.5); the category seed names the rubric id. */
export const FAIRNESS_RUBRIC_VERSION = 1;

/** A fixed reference time so seeded rows (and therefore case hashes) are reproducible. */
const SEED_TIME = new Date("2026-10-01T12:00:00.000Z");

export interface PreparedCase {
  fairnessCase: FairnessCase;
  rubric: RubricDef;
  competitionId: string;
  built: BuiltCaseFile;
}

export function rubricForCategory(slug: FairnessCase["category"]): RubricDef {
  const seed = CATEGORY_SEED.find((c) => c.slug === slug);
  if (!seed) throw new Error(`fairness: unknown category "${slug}"`);
  const rubric = getRubric(seed.rubricId, FAIRNESS_RUBRIC_VERSION);
  if (!rubric) throw new Error(`fairness: rubric ${seed.rubricId}@${FAIRNESS_RUBRIC_VERSION} is not defined`);
  return rubric;
}

/** An isolated, migrated, category-seeded in-memory database that judging code is routed to. */
export class FairnessDatabase {
  private constructor(
    readonly db: Db,
    private readonly client: PGlite,
  ) {}

  static async open(): Promise<FairnessDatabase> {
    const client = new PGlite();
    const pglite = drizzle({ client, schema });
    await migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER });
    const db = pglite as unknown as Db;
    await seedCategories(db);
    setTestDb(db); // route `@domain/db` (used by buildCaseFile) to this database
    return new FairnessDatabase(db, client);
  }

  async close(): Promise<void> {
    setTestDb(null);
    await this.client.close();
  }

  /** Store the case as a locked competition and build its blind case file with the judge's code. */
  async prepare(fairnessCase: FairnessCase): Promise<PreparedCase> {
    const rubric = rubricForCategory(fairnessCase.category);
    const competitionId = await this.insertCompetition(fairnessCase, rubric);
    const built = await buildCaseFile(competitionId);
    return { fairnessCase, rubric, competitionId, built };
  }

  private async insertCompetition(c: FairnessCase, rubric: RubricDef): Promise<string> {
    return this.db.transaction(async (tx) => {
      const [category] = await tx.select().from(schema.categories).where(eq(schema.categories.slug, c.category)).limit(1);
      if (!category) throw new Error(`fairness: category "${c.category}" was not seeded`);

      const insertParticipant = async (label: "A" | "B") => {
        const p = c.participants[label];
        const [user] = await tx
          .insert(schema.users)
          .values({
            name: p.displayName,
            email: `${p.handle}.${c.id}@fairness.test`,
            emailVerified: true,
          })
          .returning({ id: schema.users.id });
        if (!user) throw new Error("fairness: user insert failed");
        await tx
          .insert(schema.profiles)
          .values({ userId: user.id, handle: p.handle, displayName: p.displayName });
        return user.id;
      };
      // Handles are unique and must stay exact (they are what redaction looks for). Style variants reuse
      // the same participants, so an existing user with that handle is reused rather than duplicated.
      const userFor = async (label: "A" | "B") => {
        const existing = await tx
          .select({ userId: schema.profiles.userId, displayName: schema.profiles.displayName })
          .from(schema.profiles)
          .where(eq(schema.profiles.handle, c.participants[label].handle))
          .limit(1);
        const row = existing[0];
        if (row) {
          if (row.displayName !== c.participants[label].displayName) {
            throw new Error(`fairness: handle "${c.participants[label].handle}" is used with two display names`);
          }
          return row.userId;
        }
        return insertParticipant(label);
      };
      const forUserId = await userFor("A");
      const againstUserId = await userFor("B");

      const [argument] = await tx
        .insert(schema.argumentsTable)
        .values({
          authorId: againstUserId,
          categoryId: category.id,
          title: c.title.slice(0, 120),
          proposition: c.proposition,
          body: c.proposition,
          links: [],
        })
        .returning({ id: schema.argumentsTable.id });
      if (!argument) throw new Error("fairness: argument insert failed");

      const snapshot: RulesSnapshot = {
        snapshotVersion: 1,
        format: "direct_v1",
        proposition: c.proposition,
        argumentId: argument.id,
        sourceCommentId: null,
        category: { id: category.id, slug: category.slug, name: category.name },
        rubric: { id: rubric.id, version: rubric.version },
        challengerId: forUserId,
        recipientId: againstUserId,
        challengerSide: "FOR",
        recipientSide: "AGAINST",
        roundDurationHours: 24,
        acceptWindowHours: 48,
        limits: { openingMaxChars: 4000, rebuttalMaxChars: 2500, maxLinksPerSubmission: 5 },
        rulesText: { noShow: "fairness fixture", late: "fairness fixture", cancellation: "fairness fixture", appeal: "fairness fixture" },
        sentAt: SEED_TIME.toISOString(),
      };

      const [competition] = await tx
        .insert(schema.competitions)
        .values({
          rootArgumentId: argument.id,
          creatorId: forUserId,
          categoryId: category.id,
          status: "evaluating",
          rulesSnapshot: snapshot,
          termsHash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
          rubricId: rubric.id,
          rubricVersion: rubric.version,
          sentAt: SEED_TIME,
          acceptDeadline: SEED_TIME,
          acceptedAt: SEED_TIME,
          lockedAt: SEED_TIME,
        })
        .returning({ id: schema.competitions.id });
      if (!competition) throw new Error("fairness: competition insert failed");

      await tx.insert(schema.competitionParticipants).values([
        { competitionId: competition.id, userId: forUserId, side: "FOR", role: "challenger", acceptanceStatus: "accepted", acceptedAt: SEED_TIME },
        { competitionId: competition.id, userId: againstUserId, side: "AGAINST", role: "recipient", acceptanceStatus: "accepted", acceptedAt: SEED_TIME },
      ]);

      const submissionRows: Array<typeof schema.submissions.$inferInsert> = [];
      for (const [label, side, authorId] of [
        ["A", "FOR", forUserId],
        ["B", "AGAINST", againstUserId],
      ] as const) {
        for (const round of ["opening", "rebuttal"] as const) {
          const sub = c.sides[label][round];
          if (!sub) continue;
          submissionRows.push({
            competitionId: competition.id,
            authorId,
            side,
            round,
            body: sub.text,
            links: sub.links,
            lockedAt: SEED_TIME,
          });
        }
      }
      if (submissionRows.length > 0) await tx.insert(schema.submissions).values(submissionRows);
      return competition.id;
    });
  }
}
