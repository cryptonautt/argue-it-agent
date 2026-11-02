/**
 * The four draft actions as the agent calls them (`caller: "tool"`), plus decide-appeal/resolve-review with an
 * optional draftId. Direct `.run()` skips the framework approval gate (not under test here).
 */
import { isActionContractError, type ActionContractError, type ActionRunContext } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DbOrTx } from "@domain/db";
import { appeals, auditLogs } from "@domain/db/schema";
import { decisionDrafts } from "@domain/drafts/schema";
import { addSubmissions, createJudgedCompetition, type AppealFixture } from "@domain/appeals/test-fixtures";
import { HOUR_MS, resetClock, setClock } from "@domain/lib/time";
import { actAs } from "@domain/test-helpers/auth";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestUser } from "@domain/test-helpers/factories";

import discardDecisionDraft from "./discard-decision-draft";
import getReviewCase from "./get-review-case";
import listDecisionDrafts from "./list-decision-drafts";
import saveDecisionDraft from "./save-decision-draft";

const mocks = vi.hoisted(() => ({
  enqueueEvaluation: vi.fn<(competitionId: string, reason: "close" | "appeal", tx?: DbOrTx) => Promise<void>>(),
  applyCompetitionResult: vi.fn<(competitionId: string) => Promise<void>>(),
}));
vi.mock("@domain/judging", () => ({ enqueueEvaluation: mocks.enqueueEvaluation }));
vi.mock("@domain/reputation", () => ({ applyCompetitionResult: mocks.applyCompetitionResult }));

const t = setupTestDb();
const tool: ActionRunContext = { caller: "tool" };
const VERDICT_AT = new Date("2026-10-05T10:00:00Z");

beforeEach(() => {
  setClock(new Date(VERDICT_AT.getTime() + 2 * HOUR_MS));
  mocks.enqueueEvaluation.mockReset().mockResolvedValue(undefined);
  mocks.applyCompetitionResult.mockReset().mockResolvedValue(undefined);
});
afterEach(() => resetClock());

async function caught(promise: unknown): Promise<ActionContractError> {
  try {
    await promise;
  } catch (error) {
    if (isActionContractError(error)) return error;
    throw error;
  }
  throw new Error("expected the action to fail");
}

async function openAppeal(): Promise<AppealFixture & { appealId: string }> {
  const f = await createJudgedCompetition(t.db, { status: "under_appeal" });
  await addSubmissions(t.db, f);
  const [appeal] = await t.db
    .insert(appeals)
    .values({
      competitionId: f.competitionId,
      verdictId: f.verdictId,
      appellantId: f.againstUser.user.id,
      ground: "evidence_overlooked",
      text: "The verdict ignored my 850 goals point, which is in my opening.",
    })
    .returning({ id: appeals.id });
  return { ...f, appealId: appeal!.id };
}

const draftArgs = (appealId: string) => ({
  kind: "appeal" as const,
  targetId: appealId,
  recommendation: "uphold" as const,
  note: "The verdict weighed the goals point under Evidence.",
  citations: [{ side: "B" as const, quote: "Ronaldo has scored over 850 official goals", criterion: "evidence" }],
  confidence: "medium" as const,
});

describe("draft actions", () => {
  it("a moderator can read a case, save, list and discard a draft", async () => {
    const f = await openAppeal();
    actAs(f.reviewer.user.id);

    const reviewCase = await getReviewCase.run({ kind: "appeal", targetId: f.appealId }, tool);
    expect(reviewCase.submissions.every((s) => s.untrusted === true)).toBe(true);

    const saved = await saveDecisionDraft.run(draftArgs(f.appealId), tool);
    expect(saved.id).toBeTruthy();

    const list = await listDecisionDrafts.run({}, tool);
    expect(list.map((d) => d.id)).toEqual([saved.id]);
    expect(list[0]?.target.title).toBeTruthy();

    await discardDecisionDraft.run({ id: saved.id }, tool);
    expect(await listDecisionDrafts.run({}, tool)).toEqual([]);
  });

  it("every draft action rejects a non-staff user with FORBIDDEN and writes no row", async () => {
    const f = await openAppeal();
    const plain = await createTestUser(t.db, { role: "user" });
    actAs(plain.user.id);
    expect((await caught(getReviewCase.run({ kind: "appeal", targetId: f.appealId }, tool))).errorCode).toBe(
      "FORBIDDEN",
    );
    expect((await caught(saveDecisionDraft.run(draftArgs(f.appealId), tool))).errorCode).toBe("FORBIDDEN");
    expect((await caught(listDecisionDrafts.run({}, tool))).errorCode).toBe("FORBIDDEN");
    expect((await caught(discardDecisionDraft.run({ id: "x" }, tool))).errorCode).toBe("FORBIDDEN");
    expect(await t.db.select().from(decisionDrafts)).toHaveLength(0);
  });

  it("a misattributed citation fails with VALIDATION naming the quote", async () => {
    const f = await openAppeal();
    actAs(f.reviewer.user.id);
    const quote = "Ronaldo has scored over 850 official goals";
    const error = await caught(
      saveDecisionDraft.run({ ...draftArgs(f.appealId), citations: [{ side: "A", quote, criterion: "evidence" }] }, tool),
    );
    expect(error.errorCode).toBe("VALIDATION");
    expect(error.message).toContain(quote);
  });
});

describe("deciding with a draftId", () => {
  it("decide-appeal with draftId approves the draft and records edited", async () => {
    const decideAppeal = (await import("./decide-appeal")).default;
    const f = await openAppeal();
    actAs(f.reviewer.user.id);
    const { id: draftId } = await saveDecisionDraft.run(draftArgs(f.appealId), tool);

    const note = "The verdict stands. The goals point was weighed under Evidence.";
    await decideAppeal.run({ appealId: f.appealId, decision: "uphold", note, draftId } as never, tool);

    const [row] = await t.db.select().from(decisionDrafts).where(eq(decisionDrafts.id, draftId));
    expect(row).toMatchObject({ status: "approved", edited: true, decidedBy: f.reviewer.user.id });
    const audit = await t.db.select().from(auditLogs).where(eq(auditLogs.action, "appeal.decide"));
    expect(audit[0]?.after).toMatchObject({ draftId, edited: true });
  });

  it("decide-appeal refuses a draft that recommends something else, and decides nothing", async () => {
    const decideAppeal = (await import("./decide-appeal")).default;
    const f = await openAppeal();
    actAs(f.reviewer.user.id);
    const { id: draftId } = await saveDecisionDraft.run(draftArgs(f.appealId), tool);
    const error = await caught(
      decideAppeal.run(
        { appealId: f.appealId, decision: "reevaluate", note: "Re-run the judge please.", draftId } as never,
        tool,
      ),
    );
    expect(error.errorCode).toBe("CONFLICT");
    const [appeal] = await t.db.select().from(appeals).where(eq(appeals.id, f.appealId));
    expect(appeal?.status).toBe("open");
  });
});
