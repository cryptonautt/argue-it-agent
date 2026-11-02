import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actAs, actAsSignedOut } from "@domain/test-helpers/auth";
import { setupTestDb } from "@domain/test-helpers/db";
import { createTestArgument, createTestUser, type TestUser } from "@domain/test-helpers/factories";
import { HOUR_MS, addHours, advanceClock, now, resetClock, setClock } from "@domain/lib/time";
import {
  auditLogs,
  blocks,
  competitions,
  notifications,
  submissions,
  users,
  verdicts,
  type Argument,
} from "@domain/db/schema";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const judging = vi.hoisted(() => {
  const rubric = (id: string, version: number) => ({
    id,
    version,
    name: `Rubric ${id}`,
    description: "Test rubric",
    categorySlugs: [],
    criteria: [
      { key: "evidence", label: "Evidence", weight: 60, guidance: "Use facts." },
      { key: "reasoning", label: "Reasoning", weight: 40, guidance: "Be logical." },
    ],
  });
  return {
    enqueueEvaluation: vi.fn<(competitionId: string, reason: "close" | "appeal") => Promise<void>>(async () => {}),
    getRubric: vi.fn(rubric),
    getLatestRubric: vi.fn((id: string) => rubric(id, 1)),
  };
});
vi.mock("@domain/judging", () => judging);

const reputation = vi.hoisted(() => ({
  applyCompetitionResult: vi.fn<(competitionId: string) => Promise<void>>(async () => {}),
}));
vi.mock("@domain/reputation", () => reputation);

// Imported after the mocks are registered.
const actions = await import("./actions");
const { advanceCompetition, onUsersBlocked, performCommand, sweepDeadlines } = await import("./lifecycle");
const { getCompetitionRoom, listArgumentChallenges } = await import("./queries");
const { getSessionUserById } = await import("@domain/auth");

const t = setupTestDb();
const T0 = new Date("2026-11-02T09:00:00.000Z");
const key = () => crypto.randomUUID();

let challenger: TestUser;
let recipient: TestUser;
let outsider: TestUser;
let argument: Argument;

beforeEach(async () => {
  setClock(T0);
  vi.clearAllMocks();
  challenger = await createTestUser(t.db, { handle: "chidi" });
  recipient = await createTestUser(t.db, { handle: "amaka" });
  outsider = await createTestUser(t.db, { handle: "tunde" });
  argument = await createTestArgument(t.db, recipient.user.id);
});

afterEach(() => {
  resetClock();
});

async function send(overrides: Partial<Parameters<typeof actions.sendChallenge>[0]> = {}): Promise<string> {
  actAs(challenger.user.id);
  const result = await actions.sendChallenge({
    argumentId: argument.id,
    proposition: argument.proposition,
    challengerSide: "AGAINST",
    roundDurationHours: 24,
    idempotencyKey: key(),
    ...overrides,
  });
  if (!result.ok) throw new Error(`send failed: ${result.error}`);
  return result.data.competitionId;
}

async function competition(id: string) {
  const [row] = await t.db.select().from(competitions).where(eq(competitions.id, id));
  if (!row) throw new Error("missing competition");
  return row;
}

async function startedCompetition(): Promise<string> {
  const id = await send();
  const row = await competition(id);
  actAs(recipient.user.id);
  const accepted = await actions.acceptChallenge({ competitionId: id, termsHash: row.termsHash, idempotencyKey: key() });
  expect(accepted.ok).toBe(true);
  return id;
}

async function submit(
  as: TestUser,
  id: string,
  round: "opening" | "rebuttal",
  mode: "save" | "lock",
  body = `${as.profile.handle}'s ${round}: argument text.`,
) {
  actAs(as.user.id);
  const input = { competitionId: id, round, body, links: [], idempotencyKey: key() };
  return mode === "save" ? actions.saveSubmission(input) : actions.lockSubmission(input);
}

async function notificationsFor(userId: string, type?: string) {
  const rows = await t.db.select().from(notifications).where(eq(notifications.userId, userId));
  return type ? rows.filter((n) => n.type === type) : rows;
}

async function audits(action: string) {
  return t.db.select().from(auditLogs).where(eq(auditLogs.action, action));
}

// ---------------------------------------------------------------------------------------------------

describe("sending a challenge", () => {
  it("freezes the terms, defaults the opponent to the author and notifies them", async () => {
    const id = await send({ proposition: "  Messi is a better footballer than Cristiano Ronaldo.  " });
    const row = await competition(id);
    expect(row).toMatchObject({
      status: "pending_acceptance",
      round: null,
      rubricId: "sports",
      rubricVersion: 1,
      sentAt: T0,
      acceptDeadline: addHours(T0, 48),
    });
    expect(row.rulesSnapshot).toMatchObject({
      proposition: "Messi is a better footballer than Cristiano Ronaldo.",
      challengerId: challenger.user.id,
      recipientId: recipient.user.id,
      challengerSide: "AGAINST",
      recipientSide: "FOR",
      roundDurationHours: 24,
      rubric: { id: "sports", version: 1 },
    });
    expect(row.termsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await notificationsFor(recipient.user.id, "challenge_received")).toHaveLength(1);
    expect(await audits("competition.send")).toHaveLength(1);
  });

  it("is idempotent: a double-submitted send creates one challenge", async () => {
    actAs(challenger.user.id);
    const input = {
      argumentId: argument.id,
      proposition: argument.proposition,
      challengerSide: "FOR" as const,
      idempotencyKey: key(),
    };
    const first = await actions.sendChallenge(input);
    const second = await actions.sendChallenge(input);
    expect(first).toEqual(second);
    expect(await t.db.select().from(competitions)).toHaveLength(1);
  });

  it("refuses self-challenges, blocks in either direction, hidden arguments and duplicates", async () => {
    actAs(recipient.user.id); // the author, with nobody picked
    const noOpponent = await actions.sendChallenge({
      argumentId: argument.id,
      proposition: argument.proposition,
      challengerSide: "FOR",
      idempotencyKey: key(),
    });
    expect(noOpponent).toMatchObject({ ok: false, code: "VALIDATION" });
    const self = await actions.sendChallenge({
      argumentId: argument.id,
      opponentId: recipient.user.id,
      proposition: argument.proposition,
      challengerSide: "FOR",
      idempotencyKey: key(),
    });
    expect(self).toMatchObject({ ok: false, code: "FORBIDDEN" });

    await t.db.insert(blocks).values({ blockerId: recipient.user.id, blockedId: challenger.user.id });
    await expect(send()).rejects.toThrow(/can't challenge this person/);
    await t.db.delete(blocks);
    await t.db.insert(blocks).values({ blockerId: challenger.user.id, blockedId: recipient.user.id });
    await expect(send()).rejects.toThrow(/You've blocked/);
    await t.db.delete(blocks);

    await send();
    await expect(send()).rejects.toThrow(/already have an open challenge/);

    const hidden = await createTestArgument(t.db, recipient.user.id, { status: "hidden" });
    await expect(send({ argumentId: hidden.id })).rejects.toThrow(/hidden/);
  });

  it("can target any user by handle", async () => {
    const id = await send({ opponentHandle: "@Tunde" });
    expect((await competition(id)).rulesSnapshot.recipientId).toBe(outsider.user.id);
  });
});

describe("accepting, declining, withdrawing, expiring", () => {
  it("accept requires the exact terms hash and starts the opening round", async () => {
    const id = await send();
    const row = await competition(id);
    actAs(recipient.user.id);

    const wrong = await actions.acceptChallenge({ competitionId: id, termsHash: "0".repeat(64), idempotencyKey: key() });
    expect(wrong).toMatchObject({ ok: false, code: "CONFLICT" });
    expect((await competition(id)).status).toBe("pending_acceptance");

    advanceClock(HOUR_MS);
    const accepted = await actions.acceptChallenge({ competitionId: id, termsHash: row.termsHash, idempotencyKey: key() });
    expect(accepted).toEqual({ ok: true, data: { competitionId: id, status: "active", round: "opening" } });
    expect(await competition(id)).toMatchObject({
      status: "active",
      round: "opening",
      acceptedAt: addHours(T0, 1),
      openingClosesAt: addHours(T0, 25),
      rebuttalClosesAt: addHours(T0, 49),
    });
    expect(await notificationsFor(challenger.user.id, "challenge_accepted")).toHaveLength(1);
  });

  it("refuses tampered stored terms even with the stored hash", async () => {
    const id = await send();
    const row = await competition(id);
    await t.db
      .update(competitions)
      .set({ rulesSnapshot: { ...row.rulesSnapshot, roundDurationHours: 72 } })
      .where(eq(competitions.id, id));
    actAs(recipient.user.id);
    const result = await actions.acceptChallenge({ competitionId: id, termsHash: row.termsHash, idempotencyKey: key() });
    expect(result).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("only the recipient can accept or decline; only the challenger can withdraw", async () => {
    const id = await send();
    const { termsHash } = await competition(id);
    for (const user of [challenger, outsider]) {
      actAs(user.user.id);
      expect(await actions.acceptChallenge({ competitionId: id, termsHash, idempotencyKey: key() })).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
      expect(await actions.declineChallenge({ competitionId: id, idempotencyKey: key() })).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
    }
    actAs(recipient.user.id);
    expect(await actions.withdrawChallenge({ competitionId: id, idempotencyKey: key() })).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    actAsSignedOut();
    expect(await actions.withdrawChallenge({ competitionId: id, idempotencyKey: key() })).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
    });
  });

  it("decline records the reason and notifies the challenger", async () => {
    const id = await send();
    actAs(recipient.user.id);
    const result = await actions.declineChallenge({ competitionId: id, reason: " Not this week ", idempotencyKey: key() });
    expect(result).toMatchObject({ ok: true, data: { status: "declined" } });
    expect(await competition(id)).toMatchObject({ status: "declined", declineReason: "Not this week" });
    const [declined] = await notificationsFor(challenger.user.id, "challenge_declined");
    expect(declined).toMatchObject({ actorId: recipient.user.id, targetType: "competition", targetId: id });
    expect(declined?.data).toMatchObject({ reason: "Not this week", proposition: argument.proposition });
    expect(await listArgumentChallenges(argument.id)).toEqual([]);
  });

  it("withdraw by the challenger notifies the recipient", async () => {
    const id = await send();
    actAs(challenger.user.id);
    expect(await actions.withdrawChallenge({ competitionId: id, idempotencyKey: key() })).toMatchObject({
      ok: true,
      data: { status: "withdrawn" },
    });
    expect(await notificationsFor(recipient.user.id, "challenge_withdrawn")).toHaveLength(1);
  });

  it("expires lazily on read after 48h, and late accepts are refused", async () => {
    const id = await send();
    const { termsHash } = await competition(id);
    setClock(addHours(T0, 48));
    actAs(recipient.user.id);
    const late = await actions.acceptChallenge({ competitionId: id, termsHash, idempotencyKey: key() });
    expect(late).toMatchObject({ ok: false, code: "CONFLICT" });
    expect((await competition(id)).status).toBe("expired"); // the expiry was committed despite the rejection
    expect(await notificationsFor(challenger.user.id, "challenge_expired")).toHaveLength(1);
  });

  it("expires via the cron sweep", async () => {
    const id = await send();
    setClock(addHours(T0, 49));
    expect(await sweepDeadlines()).toBe(1);
    expect((await competition(id)).status).toBe("expired");
    expect(await sweepDeadlines()).toBe(0);
  });
});

describe("rounds, sealing and locking", () => {
  it("runs the full two-round flow with sealed openings and hands off to the judge", async () => {
    const id = await startedCompetition();
    expect((await submit(challenger, id, "opening", "save", "Challenger draft one")).ok).toBe(true);
    expect((await submit(challenger, id, "opening", "save", "Challenger draft two")).ok).toBe(true);
    expect((await submit(recipient, id, "opening", "save", "Recipient opening")).ok).toBe(true);

    // Sealed: each side sees only their own; spectators see nothing.
    const asChallenger = await getCompetitionRoom(id, await getSessionUserById(challenger.user.id));
    expect(asChallenger?.submissions.opening.challenger).toMatchObject({
      visibility: "visible",
      body: "Challenger draft two",
      lockedAt: null,
    });
    expect(asChallenger?.submissions.opening.recipient).toEqual({ visibility: "sealed" });
    const asSpectator = await getCompetitionRoom(id, null);
    expect(asSpectator?.submissions.opening.challenger).toEqual({ visibility: "sealed" });
    expect(JSON.stringify(asSpectator)).not.toContain("Recipient opening");

    // First lock notifies the opponent; second lock starts the rebuttal round early.
    advanceClock(2 * HOUR_MS);
    expect((await submit(challenger, id, "opening", "lock", "Challenger final opening")).ok).toBe(true);
    expect(await notificationsFor(recipient.user.id, "opponent_locked")).toHaveLength(1);
    advanceClock(HOUR_MS);
    const second = await submit(recipient, id, "opening", "lock", "Recipient final opening");
    expect(second).toMatchObject({ ok: true, data: { status: "active", round: "rebuttal" } });
    const early = await competition(id);
    expect(early.openingClosesAt).toEqual(now());
    expect(early.rebuttalClosesAt).toEqual(addHours(now(), 24));
    expect(await notificationsFor(challenger.user.id, "round_opened")).toHaveLength(1);

    // Openings are now revealed to everyone.
    const revealed = await getCompetitionRoom(id, null);
    expect(revealed?.submissions.opening.recipient).toMatchObject({ visibility: "visible", body: "Recipient final opening" });
    expect(revealed?.submissions.rebuttal.challenger).toEqual({ visibility: "sealed" });

    // Opening can no longer be edited.
    expect(await submit(challenger, id, "opening", "save")).toMatchObject({ ok: false, code: "CONFLICT" });

    // One rebuttal locked, one left as a draft; the deadline freezes the draft and locks the debate.
    expect((await submit(challenger, id, "rebuttal", "lock", "Challenger rebuttal")).ok).toBe(true);
    expect((await submit(recipient, id, "rebuttal", "save", "Recipient rebuttal draft")).ok).toBe(true);
    const rebuttalDeadline = early.rebuttalClosesAt;
    if (!rebuttalDeadline) throw new Error("no rebuttal deadline");
    setClock(addHours(rebuttalDeadline, 1));
    expect(await advanceCompetition(id)).toEqual({ status: "locked", round: null, changed: true });
    expect(judging.enqueueEvaluation).toHaveBeenCalledWith(id, "close");
    const frozen = await t.db
      .select()
      .from(submissions)
      .where(and(eq(submissions.competitionId, id), eq(submissions.authorId, recipient.user.id), eq(submissions.round, "rebuttal")));
    expect(frozen[0]?.lockedAt).toEqual(rebuttalDeadline);

    const locked = await getCompetitionRoom(id, null);
    expect(locked?.submissions.rebuttal.recipient).toMatchObject({ visibility: "visible", body: "Recipient rebuttal draft" });
    expect((await audits("competition.close_rebuttal"))[0]?.actorId).toBeNull();
  });

  it("rejects a late submission and commits the round close", async () => {
    const id = await startedCompetition();
    expect((await submit(challenger, id, "opening", "save")).ok).toBe(true);
    setClock(addHours(T0, 24)); // exactly the opening deadline
    const late = await submit(recipient, id, "opening", "save", "Too late");
    expect(late).toMatchObject({ ok: false, code: "CONFLICT" });
    const rows = await t.db.select().from(submissions).where(eq(submissions.authorId, recipient.user.id));
    expect(rows).toHaveLength(0);
    expect((await competition(id)).status).toBe("completed"); // forfeit applied by the same request
  });

  it("enforces the frozen character and link limits", async () => {
    const id = await startedCompetition();
    actAs(challenger.user.id);
    const tooLong = await actions.saveSubmission({
      competitionId: id,
      round: "opening",
      body: "x".repeat(4001),
      links: [],
      idempotencyKey: key(),
    });
    expect(tooLong).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(tooLong.ok === false && tooLong.fieldErrors?.body).toBeTruthy();
    const badLink = await actions.saveSubmission({
      competitionId: id,
      round: "opening",
      body: "Fine",
      links: ["javascript:alert(1)"],
      idempotencyKey: key(),
    });
    expect(badLink).toMatchObject({ ok: false, code: "VALIDATION" });

    await submit(challenger, id, "opening", "lock");
    await submit(recipient, id, "opening", "lock");
    actAs(challenger.user.id);
    const longRebuttal = await actions.saveSubmission({
      competitionId: id,
      round: "rebuttal",
      body: "y".repeat(2501),
      links: [],
      idempotencyKey: key(),
    });
    expect(longRebuttal).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("double-submitting a lock is safe: same key replays, new key is refused", async () => {
    const id = await startedCompetition();
    actAs(challenger.user.id);
    const input = { competitionId: id, round: "opening" as const, body: "Final", links: [], idempotencyKey: key() };
    const first = await actions.lockSubmission(input);
    const replay = await actions.lockSubmission(input);
    expect(first.ok).toBe(true);
    expect(replay).toEqual(first);
    expect(await audits("competition.lock_submission")).toHaveLength(1);
    expect(await notificationsFor(recipient.user.id, "opponent_locked")).toHaveLength(1);
    const again = await actions.lockSubmission({ ...input, idempotencyKey: key() });
    expect(again).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("non-participants and suspended participants cannot submit", async () => {
    const id = await startedCompetition();
    expect(await submit(outsider, id, "opening", "save")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await t.db.update(users).set({ status: "suspended", suspendedUntil: null }).where(eq(users.id, challenger.user.id));
    expect(await submit(challenger, id, "opening", "save")).toMatchObject({ ok: false, code: "SUSPENDED" });
  });
});

describe("no-show rule", () => {
  it("one opening → forfeit verdict for that side, half-weight rating via reputation", async () => {
    const id = await startedCompetition();
    await submit(recipient, id, "opening", "save");
    setClock(addHours(T0, 30));
    expect(await sweepDeadlines()).toBe(1);

    expect(await competition(id)).toMatchObject({ status: "completed", lockedAt: addHours(T0, 24) });
    const [verdict] = await t.db.select().from(verdicts).where(eq(verdicts.competitionId, id));
    expect(verdict).toMatchObject({
      outcome: "forfeit",
      winnerUserId: recipient.user.id,
      decidedBy: "system",
      isCurrent: true,
      runId: null,
      scores: null,
    });
    expect(verdict?.explanation?.method).toBeNull();
    expect(verdict?.explanation?.summary).toMatch(/forfeit/);
    expect(reputation.applyCompetitionResult).toHaveBeenCalledWith(id);
    expect(judging.enqueueEvaluation).not.toHaveBeenCalled();
    expect((await notificationsFor(challenger.user.id, "forfeit"))[0]?.data.outcomeLabel).toMatch(/lost/);
    expect((await notificationsFor(recipient.user.id, "forfeit"))[0]?.data.outcomeLabel).toMatch(/won/);
  });

  it("no openings → cancelled with no verdict and no rating change", async () => {
    const id = await startedCompetition();
    setClock(addHours(T0, 24));
    expect(await advanceCompetition(id)).toMatchObject({ status: "cancelled", changed: true });
    expect(await t.db.select().from(verdicts)).toHaveLength(0);
    expect(reputation.applyCompetitionResult).not.toHaveBeenCalled();
  });

  it("survives a failing reputation hand-off (logged, competition still completed)", async () => {
    reputation.applyCompetitionResult.mockRejectedValueOnce(new Error("not implemented"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await startedCompetition();
    await submit(challenger, id, "opening", "save");
    setClock(addHours(T0, 25));
    expect((await advanceCompetition(id)).status).toBe("completed");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("cancellation", () => {
  it("mutual cancel: needs both sides; openings stay sealed", async () => {
    const id = await startedCompetition();
    await submit(challenger, id, "opening", "save", "Secret opening");
    actAs(challenger.user.id);
    expect(await actions.requestCancel({ competitionId: id, reason: "Exams", idempotencyKey: key() })).toMatchObject({
      ok: true,
      data: { status: "active" },
    });
    expect(await notificationsFor(recipient.user.id, "cancel_requested")).toHaveLength(1);
    expect(await submit(outsider, id, "opening", "save")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    actAs(outsider.user.id);
    expect(await actions.requestCancel({ competitionId: id, idempotencyKey: key() })).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });

    actAs(recipient.user.id);
    expect(await actions.requestCancel({ competitionId: id, idempotencyKey: key() })).toMatchObject({
      ok: true,
      data: { status: "cancelled" },
    });
    const room = await getCompetitionRoom(id, await getSessionUserById(recipient.user.id));
    expect(room?.submissions.opening.challenger).toEqual({ visibility: "sealed" });
    expect(await notificationsFor(challenger.user.id, "competition_cancelled")).toHaveLength(1);
  });

  it("retracting a cancel request keeps the debate going", async () => {
    const id = await startedCompetition();
    actAs(challenger.user.id);
    await actions.requestCancel({ competitionId: id, idempotencyKey: key() });
    expect(await actions.retractCancel({ competitionId: id, idempotencyKey: key() })).toMatchObject({ ok: true });
    actAs(recipient.user.id);
    expect(await actions.requestCancel({ competitionId: id, idempotencyKey: key() })).toMatchObject({
      ok: true,
      data: { status: "active" },
    });
  });

  it("admin cancel requires the admin role and is audited with the reason", async () => {
    const id = await startedCompetition();
    const moderator = await createTestUser(t.db, { handle: "modd", role: "moderator" });
    const admin = await createTestUser(t.db, { handle: "boss", role: "admin" });
    for (const user of [challenger, moderator]) {
      actAs(user.user.id);
      expect(
        await actions.adminCancelCompetition({ competitionId: id, reason: "Abuse in submissions", idempotencyKey: key() }),
      ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    actAs(admin.user.id);
    expect(
      await actions.adminCancelCompetition({ competitionId: id, reason: "Abuse in submissions", idempotencyKey: key() }),
    ).toMatchObject({ ok: true, data: { status: "cancelled" } });
    expect(await competition(id)).toMatchObject({ cancelReason: "Abuse in submissions", cancelledBy: admin.user.id });
    const [audit] = await audits("competition.admin_cancel");
    expect(audit).toMatchObject({ actorId: admin.user.id, targetId: id });
    expect(await notificationsFor(challenger.user.id, "competition_cancelled")).toHaveLength(1);
    expect(await notificationsFor(recipient.user.id, "competition_cancelled")).toHaveLength(1);
  });
});

describe("blocking", () => {
  it("a block closes pending challenges between the two (withdraw or decline) but not active ones", async () => {
    const sent = await send();
    const other = await createTestArgument(t.db, challenger.user.id);
    actAs(recipient.user.id);
    const received = await actions.sendChallenge({
      argumentId: other.id,
      proposition: other.proposition,
      challengerSide: "FOR",
      idempotencyKey: key(),
    });
    if (!received.ok) throw new Error(received.error);
    const third = await createTestArgument(t.db, outsider.user.id);
    const active = await send({ argumentId: third.id, opponentId: recipient.user.id });
    actAs(recipient.user.id);
    await actions.acceptChallenge({ competitionId: active, termsHash: (await competition(active)).termsHash, idempotencyKey: key() });

    const closed = await t.db.transaction((tx) => onUsersBlocked(challenger.user.id, recipient.user.id, tx));
    expect(closed).toBe(2);
    expect((await competition(sent)).status).toBe("withdrawn");
    expect((await competition(received.data.competitionId)).status).toBe("declined");
    expect((await competition(active)).status).toBe("active");
  });
});

describe("concurrency", () => {
  it("both sides locking at the same moment closes the round exactly once", async () => {
    const id = await startedCompetition();
    await submit(challenger, id, "opening", "save");
    await submit(recipient, id, "opening", "save");
    const results = await Promise.all([
      performCommand(id, { type: "lock_submission", actorId: challenger.user.id, round: "opening" }),
      performCommand(id, { type: "lock_submission", actorId: recipient.user.id, round: "opening" }),
    ]);
    expect(results.map((r) => r.round).sort()).toEqual(["opening", "rebuttal"]);
    expect(await audits("competition.close_opening")).toHaveLength(1);
    expect((await competition(id)).round).toBe("rebuttal");
  });

  it("concurrent lazy reads past a deadline apply it once", async () => {
    const id = await startedCompetition();
    await submit(challenger, id, "opening", "save");
    setClock(addHours(T0, 25));
    const [first, second, swept] = await Promise.all([advanceCompetition(id), advanceCompetition(id), sweepDeadlines()]);
    expect(Number(first.changed) + Number(second.changed) + swept).toBe(1);
    expect(await audits("competition.close_opening")).toHaveLength(1);
    expect(await t.db.select().from(verdicts)).toHaveLength(1);
    expect(reputation.applyCompetitionResult).toHaveBeenCalledTimes(1);
  });
});

describe("cron sweep extras", () => {
  it("nudges unlocked participants once per round when < 2h remain", async () => {
    const id = await startedCompetition();
    await submit(challenger, id, "opening", "lock");
    setClock(addHours(T0, 23));
    await sweepDeadlines();
    await sweepDeadlines();
    setClock(addHours(T0, 23.5));
    await sweepDeadlines();
    expect(await notificationsFor(recipient.user.id, "deadline_soon")).toHaveLength(1);
    expect(await notificationsFor(challenger.user.id, "deadline_soon")).toHaveLength(0);
  });

  it("retries the judge hand-off for competitions stuck in locked", async () => {
    judging.enqueueEvaluation.mockRejectedValueOnce(new Error("judge down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await startedCompetition();
    await submit(challenger, id, "opening", "lock");
    await submit(recipient, id, "opening", "lock");
    await submit(challenger, id, "rebuttal", "lock");
    await submit(recipient, id, "rebuttal", "lock");
    expect((await competition(id)).status).toBe("locked");
    expect(judging.enqueueEvaluation).toHaveBeenCalledTimes(1);
    await sweepDeadlines();
    expect(judging.enqueueEvaluation).toHaveBeenCalledTimes(2);
    expect(judging.enqueueEvaluation).toHaveBeenLastCalledWith(id, "close");
    spy.mockRestore();
  });

  it("lists active challenges on the argument and hides private outcomes", async () => {
    const id = await startedCompetition();
    const list = await listArgumentChallenges(argument.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id,
      phase: "opening",
      challenger: { handle: "chidi", side: "AGAINST" },
      recipient: { handle: "amaka", side: "FOR" },
      deadline: addHours(T0, 24).toISOString(),
    });
  });
});
