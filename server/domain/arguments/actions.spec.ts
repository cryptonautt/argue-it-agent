import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actAs, actAsSignedOut } from "@domain/test-helpers/auth";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestArgument, createTestUser, getCategory } from "@domain/test-helpers/factories";
import { MINUTE_MS, advanceClock, resetClock, setClock } from "@domain/lib/time";
import { argumentsTable, auditLogs, competitions, users } from "@domain/db/schema";
import { createArgument, deleteArgument, updateArgument } from "./actions";
import { getArgumentDetail } from "./queries";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const t = setupTestDb();

afterEach(() => resetClock());

const validInput = () => ({
  title: "  Messi   is the GOAT ",
  categorySlug: "sports",
  proposition: "Lionel Messi is a better footballer than Cristiano Ronaldo.",
  body: "Eight Ballon d'Ors.\n\n\n\nA World Cup. More assists than anyone.",
  links: ["https://example.com/stats", ""],
  idempotencyKey: randomUUID(),
});

/** Insert a competition on the argument; `accepted` marks it as an accepted challenge. */
async function addCompetition(argumentId: string, creatorId: string, accepted: boolean) {
  const category = await getCategory(t.db, "sports");
  const at = new Date("2026-10-30T10:00:00Z");
  await t.db.insert(competitions).values({
    rootArgumentId: argumentId,
    creatorId,
    categoryId: category.id,
    status: accepted ? "active" : "pending_acceptance",
    round: accepted ? "opening" : null,
    rulesSnapshot: {} as never,
    termsHash: "x",
    rubricId: "sports",
    rubricVersion: 1,
    acceptDeadline: new Date("2026-11-01T10:00:00Z"),
    acceptedAt: accepted ? at : null,
  });
}

describe("createArgument", () => {
  it("creates a normalised argument and audits it", async () => {
    const { user } = await createTestUser(t.db);
    actAs(user.id);
    const result = await createArgument(validInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await t.db.select().from(argumentsTable).where(eq(argumentsTable.id, result.data.id));
    expect(row?.title).toBe("Messi is the GOAT");
    expect(row?.body).toBe("Eight Ballon d'Ors.\n\nA World Cup. More assists than anyone.");
    expect(row?.links).toEqual(["https://example.com/stats"]);
    expect(row?.authorId).toBe(user.id);
    const audits = await t.db.select().from(auditLogs).where(eq(auditLogs.targetId, result.data.id));
    expect(audits.map((a) => a.action)).toEqual(["argument.create"]);
  });

  it("requires sign-in", async () => {
    actAsSignedOut();
    const result = await createArgument(validInput());
    expect(result).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("rejects suspended users", async () => {
    const { user } = await createTestUser(t.db);
    await t.db
      .update(users)
      .set({ status: "suspended", suspendedUntil: new Date(Date.now() + 86_400_000) })
      .where(eq(users.id, user.id));
    actAs(user.id);
    const result = await createArgument(validInput());
    expect(result).toMatchObject({ ok: false, code: "SUSPENDED" });
  });

  it("returns field errors for invalid input", async () => {
    const { user } = await createTestUser(t.db);
    actAs(user.id);
    const result = await createArgument({
      ...validInput(),
      title: "x",
      proposition: "short",
      body: "",
      links: ["javascript:alert(1)"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("VALIDATION");
    expect(Object.keys(result.fieldErrors ?? {})).toEqual(expect.arrayContaining(["title", "proposition", "body", "links.0"]));
  });

  it("rejects unknown or inactive categories", async () => {
    const { user } = await createTestUser(t.db);
    actAs(user.id);
    const result = await createArgument({ ...validInput(), categorySlug: "politics" });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { categorySlug: expect.any(Array) } });
  });

  it("is double-submit safe: the same key creates one argument", async () => {
    const { user } = await createTestUser(t.db);
    actAs(user.id);
    const input = validInput();
    const first = await createArgument(input);
    const second = await createArgument(input);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data.id).toBe(first.data.id);
    const rows = await t.db.select().from(argumentsTable).where(eq(argumentsTable.authorId, user.id));
    expect(rows).toHaveLength(1);
  });

  it("enforces 10 arguments per hour", async () => {
    const { user } = await createTestUser(t.db);
    actAs(user.id);
    setClock(new Date("2026-10-31T12:00:00Z"));
    // Ten genuinely different takes, a few minutes apart (identical copies would trip the spam screen instead).
    const topics = ["Osimhen", "Lookman", "Afrobeats", "Burna", "eFootball", "iPhone", "Bitcoin", "Wizkid", "Arsenal", "PS5"];
    const distinct = (i: number) => ({
      ...validInput(),
      title: `${topics[i]} take ${i}`,
      proposition: `${topics[i]} is clearly overrated by fans in ${2015 + i}.`,
      body: `Point ${i}: ${topics[i]} ${"evidence ".repeat(i + 1)}`,
      links: [],
    });
    for (let i = 0; i < 10; i++) {
      expect((await createArgument(distinct(i))).ok).toBe(true);
      advanceClock(5 * MINUTE_MS);
    }
    const blocked = await createArgument({ ...distinct(0), title: "One more", proposition: "Jollof from Lagos beats every other jollof." });
    expect(blocked).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  it("screens new arguments for spam: an exact repeat of your own post is refused", async () => {
    const { user } = await createTestUser(t.db);
    actAs(user.id);
    expect((await createArgument(validInput())).ok).toBe(true);
    const repeat = await createArgument(validInput());
    expect(repeat).toMatchObject({ ok: false });
    expect(await t.db.select().from(argumentsTable).where(eq(argumentsTable.authorId, user.id))).toHaveLength(1);
  });
});

describe("updateArgument", () => {
  const edit = (argumentId: string) => ({
    argumentId,
    title: "Messi is still the GOAT",
    categorySlug: "sports",
    proposition: "Lionel Messi is the greatest footballer of all time.",
    body: "Updated reasoning with more detail.",
    links: [],
  });

  it("lets the author edit, stamps edited_at and audits before/after", async () => {
    const { user } = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, user.id);
    actAs(user.id);
    const result = await updateArgument(edit(argument.id));
    expect(result).toMatchObject({ ok: true, data: { changed: true } });

    const [row] = await t.db.select().from(argumentsTable).where(eq(argumentsTable.id, argument.id));
    expect(row?.title).toBe("Messi is still the GOAT");
    expect(row?.editedAt).not.toBeNull();
    const [audit] = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, argument.id), eq(auditLogs.action, "argument.edit")));
    expect(audit?.before).toMatchObject({ title: argument.title });
    expect(audit?.after).toMatchObject({ title: "Messi is still the GOAT" });
  });

  it("treats an unchanged submit as a no-op", async () => {
    const { user } = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, user.id);
    actAs(user.id);
    const result = await updateArgument({
      argumentId: argument.id,
      title: argument.title,
      categorySlug: "sports",
      proposition: argument.proposition,
      body: argument.body,
      links: [],
    });
    expect(result).toMatchObject({ ok: true, data: { changed: false } });
    const [row] = await t.db.select().from(argumentsTable).where(eq(argumentsTable.id, argument.id));
    expect(row?.editedAt).toBeNull();
  });

  it("forbids editing someone else's argument", async () => {
    const { user: author } = await createTestUser(t.db);
    const { user: other } = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, author.id);
    actAs(other.id);
    expect(await updateArgument(edit(argument.id))).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("forbids moderators editing user content through this action", async () => {
    const { user: author } = await createTestUser(t.db);
    const { user: admin } = await createTestUser(t.db, { role: "admin" });
    const argument = await createTestArgument(t.db, author.id);
    actAs(admin.id);
    expect(await updateArgument(edit(argument.id))).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("allows edits while a challenge is only pending", async () => {
    const { user: author } = await createTestUser(t.db);
    const { user: challenger } = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, author.id);
    await addCompetition(argument.id, challenger.id, false);
    actAs(author.id);
    expect((await updateArgument(edit(argument.id))).ok).toBe(true);
  });

  it("locks once a challenge has been accepted", async () => {
    const { user: author } = await createTestUser(t.db);
    const { user: challenger } = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, author.id);
    await addCompetition(argument.id, challenger.id, true);
    actAs(author.id);
    expect(await updateArgument(edit(argument.id))).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("respects locked_at even without a competition row", async () => {
    const { user } = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, user.id);
    await t.db.update(argumentsTable).set({ lockedAt: new Date() }).where(eq(argumentsTable.id, argument.id));
    actAs(user.id);
    expect(await updateArgument(edit(argument.id))).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("refuses edits to hidden arguments", async () => {
    const { user } = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, user.id, { status: "hidden" });
    actAs(user.id);
    expect(await updateArgument(edit(argument.id))).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("returns NOT_FOUND for unknown ids", async () => {
    const { user } = await createTestUser(t.db);
    actAs(user.id);
    expect(await updateArgument(edit(randomUUID()))).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("deleteArgument", () => {
  it("soft-deletes, audits, and the detail page attributes it to the author", async () => {
    const { user } = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, user.id);
    actAs(user.id);
    expect(await deleteArgument({ argumentId: argument.id })).toMatchObject({ ok: true });
    expect(await deleteArgument({ argumentId: argument.id })).toMatchObject({ ok: true });

    const [row] = await t.db.select().from(argumentsTable).where(eq(argumentsTable.id, argument.id));
    expect(row?.status).toBe("removed");
    const audits = await t.db.select().from(auditLogs).where(eq(auditLogs.action, "argument.delete"));
    expect(audits).toHaveLength(1);
    const detail = await getArgumentDetail(argument.id, null);
    expect(detail?.removedBy).toBe("author");
  });

  it("still works after the argument is locked (debates keep their frozen terms)", async () => {
    const { user: author } = await createTestUser(t.db);
    const { user: challenger } = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, author.id);
    await addCompetition(argument.id, challenger.id, true);
    actAs(author.id);
    expect((await deleteArgument({ argumentId: argument.id })).ok).toBe(true);
  });

  it("forbids deleting someone else's argument", async () => {
    const { user: author } = await createTestUser(t.db);
    const { user: other } = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, author.id);
    actAs(other.id);
    expect(await deleteArgument({ argumentId: argument.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("does not let authors erase an argument under moderator review", async () => {
    const { user } = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, user.id, { status: "hidden" });
    actAs(user.id);
    expect(await deleteArgument({ argumentId: argument.id })).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("attributes non-author removals to moderators", async () => {
    const { user } = await createTestUser(t.db);
    const argument = await createTestArgument(t.db, user.id, { status: "removed" });
    const detail = await getArgumentDetail(argument.id, null);
    expect(detail?.removedBy).toBe("moderators");
  });
});
