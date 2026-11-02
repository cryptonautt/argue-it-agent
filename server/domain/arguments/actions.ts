"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, ok, type ActionResult } from "@domain/lib/action-result";
import { now } from "@domain/lib/time";
import { assertFound, parseInput, runAction } from "@domain/action";
import { writeAudit } from "@domain/audit";
import { requireUser } from "@domain/auth";
import { db, type DbOrTx } from "@domain/db";
import { argumentsTable, categories, type Argument } from "@domain/db/schema";
import { withIdempotency, idempotencyKeySchema } from "@domain/idempotency";
import { assertContentAllowed, assessContent, flagForReviewIfNeeded } from "@domain/moderation";
import { enforceRateLimit } from "@domain/rate-limit";
import { getFeedPage } from "./feed";
import { isFeedTab } from "./feed-params";
import { canDeleteArgument, canEditArgument } from "./policy";
import { ARGUMENT_DELETE_AUDIT_ACTION, hasAcceptedChallenge } from "./queries";
import type { FeedPage } from "./types";
import { argumentFieldsSchema } from "./validation";

const createArgumentSchema = argumentFieldsSchema.extend({ idempotencyKey: idempotencyKeySchema });
const updateArgumentSchema = argumentFieldsSchema.extend({ argumentId: z.uuid("That argument doesn't exist.") });
const deleteArgumentSchema = z.object({ argumentId: z.uuid("That argument doesn't exist.") });

export type CreateArgumentInput = z.input<typeof createArgumentSchema>;
export type UpdateArgumentInput = z.input<typeof updateArgumentSchema>;

async function findActiveCategory(slug: string, conn: DbOrTx) {
  const [category] = await conn
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.slug, slug), eq(categories.active, true)))
    .limit(1);
  if (!category) {
    throw new ActionError("VALIDATION", "Please fix the highlighted fields.", {
      categorySlug: ["Pick one of the listed categories."],
    });
  }
  return category;
}

/** The fields an author controls, for audit before/after snapshots. */
function editableSnapshot(argument: Pick<Argument, "title" | "categoryId" | "proposition" | "body" | "links">) {
  return {
    title: argument.title,
    categoryId: argument.categoryId,
    proposition: argument.proposition,
    body: argument.body,
    links: argument.links,
  };
}

/** Post a new argument (design §2 goal 1; PRD §8.2). Double-submit safe via the client's idempotency key. */
export async function createArgument(input: CreateArgumentInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(createArgumentSchema, input);

    const result = await withIdempotency(data.idempotencyKey, user.id, "argument.create", async () => {
      await enforceRateLimit(user.id, "argument");
      const category = await findActiveCategory(data.categorySlug, db);
      // Spam screening (moderation): "block" refuses the post, "review" posts it and opens an automatic report.
      const assessment = await assessContent(user.id, `${data.title}
${data.proposition}
${data.body}`, data.links);
      assertContentAllowed(assessment);
      const id = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(argumentsTable)
          .values({
            authorId: user.id,
            categoryId: category.id,
            title: data.title,
            proposition: data.proposition,
            body: data.body,
            links: data.links,
            createdAt: now(),
          })
          .returning({ id: argumentsTable.id });
        if (!row) throw new Error("argument insert returned no row");
        await flagForReviewIfNeeded(assessment, { type: "argument", id: row.id }, tx);
        await writeAudit(
          {
            actorId: user.id,
            action: "argument.create",
            targetType: "argument",
            targetId: row.id,
            after: { title: data.title, categoryId: category.id, proposition: data.proposition },
          },
          tx,
        );
        return row.id;
      });
      return ok({ id });
    });

    revalidatePath("/");
    return result;
  });
}

/**
 * Edit your own argument while it is unlocked (design §2: editing ends once a challenge is accepted).
 * Every edit is audited with before/after and stamps `edited_at`, which the page shows as "Edited".
 */
export async function updateArgument(input: UpdateArgumentInput): Promise<ActionResult<{ id: string; changed: boolean }>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(updateArgumentSchema, input);

    const outcome = await db.transaction(async (tx) => {
      const argument = assertFound(
        (
          await tx.select().from(argumentsTable).where(eq(argumentsTable.id, data.argumentId)).limit(1).for("update")
        )[0],
        "That argument no longer exists.",
      );
      const decision = canEditArgument(argument, user.id, await hasAcceptedChallenge(argument.id, tx));
      if (!decision.allowed) {
        throw new ActionError(decision.reason === "not_author" ? "FORBIDDEN" : "CONFLICT", decision.message);
      }

      const category = await findActiveCategory(data.categorySlug, tx);
      const before = editableSnapshot(argument);
      const after = {
        title: data.title,
        categoryId: category.id,
        proposition: data.proposition,
        body: data.body,
        links: data.links,
      };
      if (JSON.stringify(before) === JSON.stringify(after)) return { changed: false };
      const assessment = await assessContent(user.id, `${data.title}
${data.proposition}
${data.body}`, data.links, tx, {
        excludeArgumentId: argument.id,
      });
      assertContentAllowed(assessment);

      await tx
        .update(argumentsTable)
        .set({ ...after, editedAt: now() })
        .where(eq(argumentsTable.id, argument.id));
      await flagForReviewIfNeeded(assessment, { type: "argument", id: argument.id }, tx);
      await writeAudit(
        { actorId: user.id, action: "argument.edit", targetType: "argument", targetId: argument.id, before, after },
        tx,
      );
      return { changed: true };
    });

    revalidatePath(`/a/${data.argumentId}`);
    revalidatePath("/");
    return ok({ id: data.argumentId, changed: outcome.changed });
  });
}

/**
 * Delete your own argument. Soft delete (status → removed): comments, positions and any debates on it are
 * kept and the page shows "This argument was removed" (design §4.7). Repeating the call is a no-op.
 */
export async function deleteArgument(
  input: z.input<typeof deleteArgumentSchema>,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parseInput(deleteArgumentSchema, input);

    await db.transaction(async (tx) => {
      const argument = assertFound(
        (
          await tx.select().from(argumentsTable).where(eq(argumentsTable.id, data.argumentId)).limit(1).for("update")
        )[0],
        "That argument no longer exists.",
      );
      if (argument.authorId === user.id && argument.status === "removed") return;
      const decision = canDeleteArgument(argument, user.id);
      if (!decision.allowed) {
        throw new ActionError(decision.reason === "not_author" ? "FORBIDDEN" : "CONFLICT", decision.message);
      }
      await tx.update(argumentsTable).set({ status: "removed" }).where(eq(argumentsTable.id, argument.id));
      await writeAudit(
        {
          actorId: user.id,
          action: ARGUMENT_DELETE_AUDIT_ACTION,
          targetType: "argument",
          targetId: argument.id,
          before: { status: argument.status },
          after: { status: "removed" },
        },
        tx,
      );
    });

    revalidatePath(`/a/${data.argumentId}`);
    revalidatePath("/");
    return ok({ id: data.argumentId });
  });
}

const loadFeedSchema = z.object({
  tab: z.string().refine(isFeedTab, "Unknown feed."),
  category: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/)
    .nullable()
    .optional(),
  cursor: z.string().min(1).max(4096),
});

/** "Load more" for the signed-in feed. Read-only, so suspended users may use it. */
export async function loadFeedPage(input: z.input<typeof loadFeedSchema>): Promise<ActionResult<FeedPage>> {
  return runAction(async () => {
    const user = await requireUser({ allowSuspended: true });
    const data = parseInput(loadFeedSchema, input);
    if (!isFeedTab(data.tab)) throw new ActionError("VALIDATION", "Unknown feed.");
    const page = await getFeedPage({
      tab: data.tab,
      viewerId: user.id,
      categorySlug: data.category ?? null,
      cursor: data.cursor,
    });
    return ok(page);
  });
}
