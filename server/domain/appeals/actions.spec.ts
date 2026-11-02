import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS, resetClock, setClock } from "@domain/lib/time";
import { appeals, users } from "@domain/db/schema";
import { actAs, actAsSignedOut } from "@domain/test-helpers/auth";
import { setupTestDb } from "@domain/test-helpers/db";
import { decideAppeal, fileAppeal, resolveReview } from "./actions";
import { createJudgedCompetition } from "./test-fixtures";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));
vi.mock("@domain/judging", () => ({ enqueueEvaluation: vi.fn(async () => undefined) }));
vi.mock("@domain/reputation", () => ({ applyCompetitionResult: vi.fn(async () => undefined) }));

const t = setupTestDb();
const TEXT = "My rebuttal was cut off halfway, the quotes stop mid-sentence in the verdict.";

beforeEach(() => setClock(new Date(new Date("2026-10-05T10:00:00Z").getTime() + 2 * HOUR_MS)));
afterEach(() => resetClock());

describe("fileAppeal action", () => {
  it("requires sign-in", async () => {
    const f = await createJudgedCompetition(t.db);
    actAsSignedOut();
    const result = await fileAppeal({
      competitionId: f.competitionId,
      ground: "submission_excluded",
      text: TEXT,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(result).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("validates the ground and text length", async () => {
    const f = await createJudgedCompetition(t.db);
    actAs(f.forUser.user.id);
    const result = await fileAppeal({
      competitionId: f.competitionId,
      ground: "i_just_disagree" as never,
      text: "bad",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("VALIDATION");
    expect(Object.keys(result.fieldErrors ?? {})).toEqual(expect.arrayContaining(["ground", "text"]));
  });

  it("is safe to double-submit with the same key", async () => {
    const f = await createJudgedCompetition(t.db);
    actAs(f.forUser.user.id);
    const input = {
      competitionId: f.competitionId,
      ground: "submission_excluded" as const,
      text: TEXT,
      idempotencyKey: crypto.randomUUID(),
    };
    const first = await fileAppeal(input);
    const second = await fileAppeal(input);
    expect(first.ok && second.ok).toBe(true);
    expect(second).toEqual(first);
    expect(await t.db.select().from(appeals).where(eq(appeals.competitionId, f.competitionId))).toHaveLength(1);
  });

  it("blocks suspended users", async () => {
    const f = await createJudgedCompetition(t.db);
    await t.db.update(users).set({ status: "suspended", suspendedUntil: null }).where(eq(users.id, f.forUser.user.id));
    actAs(f.forUser.user.id);
    const result = await fileAppeal({
      competitionId: f.competitionId,
      ground: "technical_failure",
      text: TEXT,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(result).toMatchObject({ ok: false, code: "SUSPENDED" });
  });
});

describe("staff actions", () => {
  it("only moderators and admins can decide appeals or reviews", async () => {
    const f = await createJudgedCompetition(t.db);
    actAs(f.forUser.user.id);
    const filed = await fileAppeal({
      competitionId: f.competitionId,
      ground: "technical_failure",
      text: TEXT,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!filed.ok) throw new Error(filed.error);

    actAs(f.againstUser.user.id);
    const decided = await decideAppeal({
      appealId: filed.data.appealId,
      decision: "uphold",
      note: "Looks fine to me.",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(decided).toMatchObject({ ok: false, code: "FORBIDDEN" });

    const reviewed = await resolveReview({
      competitionId: f.competitionId,
      outcome: "B",
      note: "I want to win this.",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(reviewed).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("requires a written reason for every decision", async () => {
    const f = await createJudgedCompetition(t.db);
    actAs(f.forUser.user.id);
    const filed = await fileAppeal({
      competitionId: f.competitionId,
      ground: "technical_failure",
      text: TEXT,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!filed.ok) throw new Error(filed.error);

    actAs(f.reviewer.user.id);
    const result = await decideAppeal({
      appealId: filed.data.appealId,
      decision: "overturn",
      outcome: "B",
      note: "  ",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });

    const okResult = await decideAppeal({
      appealId: filed.data.appealId,
      decision: "uphold",
      note: "No technical failure found in the logs.",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(okResult).toMatchObject({ ok: true, data: { status: "upheld" } });
  });
});
