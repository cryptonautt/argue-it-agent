import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createArgument } from "@domain/arguments/actions";
import { argumentsTable } from "@domain/db/schema";
import { actAs } from "@domain/test-helpers/auth";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestUser } from "@domain/test-helpers/factories";

import { listMarketDebates } from "./debates";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const t = setupTestDb();

const input = (marketSlug?: string | null, who = "Adam Hamilton") => ({
  title: `${who} takes Kansas`,
  categorySlug: "sports",
  proposition: `${who} will win the Kansas Senate race this year.`,
  body: `The late polling swing and early vote both favour ${who}.`,
  links: [],
  idempotencyKey: randomUUID(),
  marketSlug,
});

describe("arguments linked to a Polymarket event", () => {
  it("stores the market slug and lists the argument on that market only", async () => {
    const { user } = await createTestUser(t.db);
    actAs(user.id);
    const linked = await createArgument(input("Kansas-Senate-Election-Winner"));
    const unlinked = await createArgument(input(null, "Roger Marshall"));
    expect([linked, unlinked]).toMatchObject([{ ok: true }, { ok: true }]);
    if (!linked.ok || !unlinked.ok) return;

    const [row] = await t.db.select().from(argumentsTable).where(eq(argumentsTable.id, linked.data.id));
    expect(row?.polymarketEventSlug).toBe("kansas-senate-election-winner");

    const cards = await listMarketDebates("kansas-senate-election-winner", user.id);
    expect(cards.map((c) => c.id)).toEqual([linked.data.id]);
    await expect(listMarketDebates("some-other-market", user.id)).resolves.toEqual([]);
  });

  it("rejects a malformed market slug", async () => {
    const { user } = await createTestUser(t.db);
    actAs(user.id);
    const result = await createArgument(input("https://polymarket.com/event/x"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("VALIDATION");
    expect(result.fieldErrors?.marketSlug).toBeTruthy();
  });
});
