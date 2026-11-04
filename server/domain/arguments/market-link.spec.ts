import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { actAs } from "@domain/test-helpers/auth";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestUser } from "@domain/test-helpers/factories";

import { createArgument } from "./actions";
import { getArgumentDetail } from "./queries";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const t = setupTestDb();

// A distinct candidate per post, so the two arguments are never seen as duplicates.
const input = (marketSlug: string | null, who: string) => ({
  title: `${who} takes Kansas`,
  categorySlug: "sports",
  proposition: `${who} will win the Kansas Senate race this year.`,
  body: `The late polling swing and early vote both favour ${who}.`,
  links: [],
  idempotencyKey: randomUUID(),
  marketSlug,
});

describe("getArgumentDetail: Polymarket market link", () => {
  it("returns the market slug the argument was posted from, and null otherwise", async () => {
    const { user } = await createTestUser(t.db);
    actAs(user.id);
    const linked = await createArgument(input("Kansas-Senate-Election-Winner", "Adam Hamilton"));
    const unlinked = await createArgument(input(null, "Roger Marshall"));
    expect([linked, unlinked]).toMatchObject([{ ok: true }, { ok: true }]);
    if (!linked.ok || !unlinked.ok) return;

    expect((await getArgumentDetail(linked.data.id, user.id))?.polymarketEventSlug).toBe(
      "kansas-senate-election-winner",
    );
    expect((await getArgumentDetail(unlinked.data.id, user.id))?.polymarketEventSlug).toBeNull();
  });
});
