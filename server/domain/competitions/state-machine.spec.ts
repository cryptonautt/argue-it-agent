import { describe, expect, it } from "vitest";
import { HOUR_MS, addHours, addMs } from "@domain/lib/time";
import {
  COMMAND_TYPES,
  InvalidCompetitionStateError,
  NO_SUBMISSION,
  PHASES,
  TRANSITIONS,
  advance,
  decide,
  isAllowedIn,
  isDue,
  isFinalForLifecycle,
  phaseOf,
  type Command,
  type CommandType,
  type Decision,
  type Effect,
  type MachineState,
  type ParticipantState,
  type Phase,
  type SubmissionMark,
  type TransitionName,
} from "./state-machine";

const CH = "11111111-1111-4111-8111-111111111111";
const RE = "22222222-2222-4222-8222-222222222222";
const OUTSIDER = "33333333-3333-4333-8333-333333333333";
const ADMIN = "44444444-4444-4444-8444-444444444444";
const T0 = new Date("2026-11-01T12:00:00.000Z");
const DURATION = 24;

const draft: SubmissionMark = { present: true, lockedAt: null };
const lockedAt = (at: Date): SubmissionMark => ({ present: true, lockedAt: at });

function participant(role: "challenger" | "recipient", patch: Partial<ParticipantState> = {}): ParticipantState {
  return {
    userId: role === "challenger" ? CH : RE,
    role,
    side: role === "challenger" ? "FOR" : "AGAINST",
    acceptance: role === "challenger" ? "accepted" : "pending",
    acceptedAt: role === "challenger" ? T0 : null,
    cancelRequestedAt: null,
    opening: NO_SUBMISSION,
    rebuttal: NO_SUBMISSION,
    ...patch,
  };
}

function pending(patch: Partial<MachineState> = {}): MachineState {
  return {
    status: "pending_acceptance",
    round: null,
    roundDurationHours: DURATION,
    acceptDeadline: addHours(T0, 48),
    acceptedAt: null,
    openingClosesAt: null,
    rebuttalClosesAt: null,
    lockedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    cancelledBy: null,
    declineReason: null,
    challenger: participant("challenger"),
    recipient: participant("recipient"),
    ...patch,
  };
}

/** Accepted at T0: opening closes T0+24h, rebuttal T0+48h. */
function opening(patch: Partial<MachineState> = {}): MachineState {
  return pending({
    status: "active",
    round: "opening",
    acceptedAt: T0,
    openingClosesAt: addHours(T0, DURATION),
    rebuttalClosesAt: addHours(T0, 2 * DURATION),
    recipient: participant("recipient", { acceptance: "accepted", acceptedAt: T0 }),
    ...patch,
  });
}

function rebuttal(patch: Partial<MachineState> = {}): MachineState {
  const closed = addHours(T0, DURATION);
  return opening({
    round: "rebuttal",
    challenger: participant("challenger", { opening: lockedAt(closed) }),
    recipient: participant("recipient", { acceptance: "accepted", acceptedAt: T0, opening: lockedAt(closed) }),
    ...patch,
  });
}

function withSides(state: MachineState, ch: Partial<ParticipantState>, re: Partial<ParticipantState>): MachineState {
  return { ...state, challenger: { ...state.challenger, ...ch }, recipient: { ...state.recipient, ...re } };
}

/** A state in each phase, with deadlines in the future relative to `T0 + 1h`. */
function stateIn(phase: Phase): MachineState {
  switch (phase) {
    case "pending_acceptance":
      return pending();
    case "opening":
      return opening();
    case "rebuttal":
      return rebuttal();
    case "locked":
      return rebuttal({ status: "locked", round: null, lockedAt: addHours(T0, 48) });
    case "completed":
    case "evaluating":
    case "under_appeal":
    case "needs_review":
      return rebuttal({ status: phase, round: null, lockedAt: addHours(T0, 48) });
    case "declined":
    case "expired":
    case "withdrawn":
    case "cancelled":
      return pending({ status: phase });
  }
}

const NOW = addHours(T0, 1);

function okDecision(decision: Decision): Extract<Decision, { ok: true }> {
  if (!decision.ok) throw new Error(`expected ok, got ${decision.code}: ${decision.message}`);
  return decision;
}

function effectsOf(decision: { steps: { effects: Effect[] }[] }): Effect[] {
  return decision.steps.flatMap((s) => s.effects);
}

function transitions(decision: { steps: { transition: TransitionName }[] }): TransitionName[] {
  return decision.steps.map((s) => s.transition);
}

/** The natural command (with the right actor) for exercising `type` in `phase`. */
function commandFor(type: CommandType, phase: Phase): { command: Command; state: MachineState } {
  const state = stateIn(phase);
  const round = phase === "rebuttal" ? "rebuttal" : "opening";
  switch (type) {
    case "accept":
      return { state, command: { type, actorId: RE } };
    case "decline":
      return { state, command: { type, actorId: RE, reason: null } };
    case "withdraw":
      return { state, command: { type, actorId: CH } };
    case "save_submission":
    case "lock_submission":
      return {
        state: phase === "rebuttal" ? state : withSides(state, { opening: NO_SUBMISSION }, {}),
        command: { type, actorId: CH, round },
      };
    case "request_cancel":
      return { state, command: { type, actorId: CH, reason: null } };
    case "retract_cancel":
      return { state: withSides(state, { cancelRequestedAt: T0 }, {}), command: { type, actorId: CH } };
    case "admin_cancel":
      return { state, command: { type, actorId: ADMIN, reason: "Broke the rules" } };
  }
}

// ---------------------------------------------------------------------------------------------------

describe("transition table", () => {
  it("only references known phases", () => {
    for (const spec of Object.values(TRANSITIONS)) {
      expect(spec.from.length).toBeGreaterThan(0);
      for (const phase of [...spec.from, ...spec.to]) expect(PHASES).toContain(phase);
    }
  });

  it("treats only the hand-off phases as final for the lifecycle", () => {
    const final = PHASES.filter(isFinalForLifecycle);
    expect(final.sort()).toEqual(
      ["cancelled", "completed", "declined", "evaluating", "expired", "under_appeal", "withdrawn"].sort(),
    );
  });

  describe.each(PHASES)("in phase %s", (phase) => {
    it.each(COMMAND_TYPES)("%s is accepted iff the table allows it", (type) => {
      const { state, command } = commandFor(type, phase);
      const decision = decide(state, command, NOW);
      if (isAllowedIn(type, phase)) {
        expect(okDecision(decision).steps[0]?.transition).toBe(type);
        for (const step of okDecision(decision).steps) expect(TRANSITIONS[step.transition].to).toContain(step.to);
      } else {
        expect(decision).toMatchObject({ ok: false, code: "CONFLICT" });
      }
    });
  });

  it("never mutates its input", () => {
    const state = opening({ challenger: participant("challenger", { opening: draft }) });
    const snapshot = structuredClone(state);
    decide(state, { type: "lock_submission", actorId: CH, round: "opening" }, NOW);
    advance(state, addHours(T0, 100));
    expect(state).toEqual(snapshot);
  });
});

describe("phaseOf", () => {
  it("folds the round into active", () => {
    expect(phaseOf({ status: "active", round: "opening" })).toBe("opening");
    expect(phaseOf({ status: "active", round: "rebuttal" })).toBe("rebuttal");
    expect(phaseOf({ status: "completed", round: null })).toBe("completed");
  });

  it("rejects an active competition without a round", () => {
    expect(() => phaseOf({ status: "active", round: null })).toThrow(InvalidCompetitionStateError);
  });
});

describe("accept / decline / withdraw", () => {
  it("accept starts the opening round with server-computed deadlines", () => {
    const at = addHours(T0, 5);
    const decision = okDecision(decide(pending({ roundDurationHours: 48 }), { type: "accept", actorId: RE }, at));
    expect(decision.state).toMatchObject({
      status: "active",
      round: "opening",
      acceptedAt: at,
      openingClosesAt: addHours(at, 48),
      rebuttalClosesAt: addHours(at, 96),
    });
    expect(decision.state.recipient).toMatchObject({ acceptance: "accepted", acceptedAt: at });
    expect(effectsOf(decision)).toEqual([{ kind: "notify", to: "challenger", type: "challenge_accepted", actorId: RE }]);
  });

  it("only the recipient can accept or decline", () => {
    for (const actorId of [CH, OUTSIDER]) {
      expect(decide(pending(), { type: "accept", actorId }, NOW)).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(decide(pending(), { type: "decline", actorId, reason: null }, NOW)).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
    }
  });

  it("only the challenger can withdraw", () => {
    for (const actorId of [RE, OUTSIDER]) {
      expect(decide(pending(), { type: "withdraw", actorId }, NOW)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    const decision = okDecision(decide(pending(), { type: "withdraw", actorId: CH }, NOW));
    expect(decision.state).toMatchObject({ status: "withdrawn", cancelledAt: NOW, cancelledBy: CH });
    expect(effectsOf(decision)).toEqual([{ kind: "notify", to: "recipient", type: "challenge_withdrawn", actorId: CH }]);
  });

  it("decline records the reason and tells the challenger", () => {
    const decision = okDecision(decide(pending(), { type: "decline", actorId: RE, reason: "Busy this week" }, NOW));
    expect(decision.state).toMatchObject({ status: "declined", declineReason: "Busy this week" });
    expect(decision.state.recipient.acceptance).toBe("declined");
    expect(effectsOf(decision)).toEqual([
      { kind: "notify", to: "challenger", type: "challenge_declined", actorId: RE, data: { reason: "Busy this week" } },
    ]);
  });

  it("cannot accept at or after the acceptance deadline", () => {
    const deadline = addHours(T0, 48);
    expect(okDecision(decide(pending(), { type: "accept", actorId: RE }, addMs(deadline, -1))).state.status).toBe("active");
    expect(decide(pending(), { type: "accept", actorId: RE }, deadline)).toMatchObject({
      ok: false,
      code: "DEADLINE_PASSED",
    });
  });
});

describe("advance (deadlines)", () => {
  it("does nothing before a deadline", () => {
    expect(advance(pending(), addMs(addHours(T0, 48), -1)).steps).toEqual([]);
    expect(advance(opening(), addMs(addHours(T0, DURATION), -1)).steps).toEqual([]);
    expect(advance(stateIn("completed"), addHours(T0, 1000)).steps).toEqual([]);
  });

  it("expires a pending challenge exactly at its deadline", () => {
    const result = advance(pending(), addHours(T0, 48));
    expect(result.state.status).toBe("expired");
    expect(result.steps).toEqual([
      {
        transition: "expire",
        from: "pending_acceptance",
        to: "expired",
        effects: [{ kind: "notify", to: "challenger", type: "challenge_expired", actorId: null }],
      },
    ]);
  });

  it("opens the rebuttal round when both sides have an opening, freezing drafts at the deadline", () => {
    const closesAt = addHours(T0, DURATION);
    const state = withSides(opening(), { opening: draft }, { opening: lockedAt(addHours(T0, 2)) });
    const result = advance(state, addHours(closesAt, 3)); // swept 3h late
    expect(result.state).toMatchObject({
      status: "active",
      round: "rebuttal",
      openingClosesAt: closesAt,
      rebuttalClosesAt: addHours(T0, 2 * DURATION), // the scheduled deadline is kept
    });
    expect(result.state.challenger.opening).toEqual(lockedAt(closesAt));
    expect(result.state.recipient.opening).toEqual(lockedAt(addHours(T0, 2)));
    expect(effectsOf(result)).toEqual([
      { kind: "freeze_round", round: "opening", at: closesAt },
      { kind: "notify", to: "both", type: "round_opened", actorId: null, data: { round: "rebuttal" } },
    ]);
  });

  it.each([
    ["challenger", { opening: draft }, {}],
    ["recipient", {}, { opening: lockedAt(T0) }],
  ] as const)("no-show: only the %s has an opening → they win by forfeit", (winner, ch, re) => {
    const closesAt = addHours(T0, DURATION);
    const at = addHours(closesAt, 1);
    const result = advance(withSides(opening(), ch, re), at);
    expect(result.state).toMatchObject({ status: "completed", round: null, lockedAt: closesAt, completedAt: at });
    expect(transitions(result)).toEqual(["close_opening"]);
    expect(effectsOf(result)).toContainEqual({ kind: "forfeit", winner });
    expect(effectsOf(result)).toContainEqual({
      kind: "notify",
      to: winner,
      type: "forfeit",
      actorId: null,
      data: { outcomeLabel: "You won by forfeit" },
    });
    expect(effectsOf(result)).toContainEqual({
      kind: "notify",
      to: winner === "challenger" ? "recipient" : "challenger",
      type: "forfeit",
      actorId: null,
      data: { outcomeLabel: "You lost by forfeit (no opening)" },
    });
    expect(effectsOf(result)).not.toContainEqual({ kind: "enqueue_evaluation" });
  });

  it("no-show: neither side has an opening → cancelled, no verdict", () => {
    const result = advance(opening(), addHours(T0, DURATION));
    expect(result.state).toMatchObject({ status: "cancelled", round: null, cancelledBy: null });
    expect(result.state.cancelReason).toMatch(/neither side/i);
    expect(effectsOf(result).map((e) => e.kind)).toEqual(["freeze_round", "notify"]);
  });

  it("closes the rebuttal round → locked and queues the AI judge (missing rebuttal allowed)", () => {
    const closesAt = addHours(T0, 2 * DURATION);
    const state = withSides(rebuttal(), { rebuttal: draft }, {});
    const result = advance(state, closesAt);
    expect(result.state).toMatchObject({ status: "locked", round: null, lockedAt: closesAt });
    expect(result.state.challenger.rebuttal).toEqual(lockedAt(closesAt));
    expect(result.state.recipient.rebuttal).toEqual(NO_SUBMISSION);
    expect(effectsOf(result)).toEqual([
      { kind: "freeze_round", round: "rebuttal", at: closesAt },
      { kind: "enqueue_evaluation" },
    ]);
  });

  it("applies several passed deadlines in order when nobody looked for days", () => {
    const state = withSides(opening(), { opening: draft }, { opening: draft });
    const result = advance(state, addHours(T0, 30 * 24));
    expect(transitions(result)).toEqual(["close_opening", "close_rebuttal"]);
    expect(result.state.status).toBe("locked");
  });

  it("isDue matches the running deadline", () => {
    expect(isDue(pending(), addHours(T0, 48))).toBe(true);
    expect(isDue(opening(), addHours(T0, 23))).toBe(false);
    expect(isDue(opening(), addHours(T0, 24))).toBe(true);
    expect(isDue(rebuttal(), addHours(T0, 48))).toBe(true);
    expect(isDue(stateIn("locked"), addHours(T0, 1000))).toBe(false);
  });
});

describe("submissions", () => {
  it("saving marks a draft without effects", () => {
    const decision = okDecision(decide(opening(), { type: "save_submission", actorId: CH, round: "opening" }, NOW));
    expect(decision.state.challenger.opening).toEqual(draft);
    expect(effectsOf(decision)).toEqual([]);
  });

  it("the first lock tells the opponent", () => {
    const decision = okDecision(decide(opening(), { type: "lock_submission", actorId: RE, round: "opening" }, NOW));
    expect(decision.state.recipient.opening).toEqual(lockedAt(NOW));
    expect(decision.state.round).toBe("opening");
    expect(effectsOf(decision)).toEqual([
      { kind: "lock_submission", userId: RE, round: "opening", at: NOW },
      { kind: "notify", to: "challenger", type: "opponent_locked", actorId: RE, data: { round: "opening" } },
    ]);
  });

  it("early start: when both lock openings the rebuttal round starts now with a full duration", () => {
    const state = withSides(opening(), { opening: lockedAt(T0) }, {});
    const decision = okDecision(decide(state, { type: "lock_submission", actorId: RE, round: "opening" }, NOW));
    expect(decision.state).toMatchObject({
      status: "active",
      round: "rebuttal",
      openingClosesAt: NOW,
      rebuttalClosesAt: addHours(NOW, DURATION),
    });
    expect(transitions(decision)).toEqual(["lock_submission", "close_opening"]);
    expect(effectsOf(decision)).toContainEqual({
      kind: "notify",
      to: "both",
      type: "round_opened",
      actorId: null,
      data: { round: "rebuttal" },
    });
    expect(effectsOf(decision).some((e) => e.kind === "notify" && e.type === "opponent_locked")).toBe(false);
  });

  it("when both lock rebuttals the debate locks and goes to the judge", () => {
    const state = withSides(rebuttal(), { rebuttal: lockedAt(addHours(T0, 25)) }, {});
    const at = addHours(T0, 26);
    const decision = okDecision(decide(state, { type: "lock_submission", actorId: RE, round: "rebuttal" }, at));
    expect(decision.state).toMatchObject({ status: "locked", round: null, lockedAt: at });
    expect(effectsOf(decision)).toContainEqual({ kind: "enqueue_evaluation" });
  });

  it("double lock and edit-after-lock are refused (state machine is not idempotent by itself)", () => {
    const state = withSides(opening(), { opening: lockedAt(T0) }, {});
    expect(decide(state, { type: "lock_submission", actorId: CH, round: "opening" }, NOW)).toMatchObject({
      ok: false,
      code: "CONFLICT",
    });
    expect(decide(state, { type: "save_submission", actorId: CH, round: "opening" }, NOW)).toMatchObject({
      ok: false,
      code: "CONFLICT",
    });
  });

  it("rejects late submissions at the deadline instant, even without advancing first", () => {
    const deadline = addHours(T0, DURATION);
    for (const type of ["save_submission", "lock_submission"] as const) {
      expect(decide(opening(), { type, actorId: CH, round: "opening" }, deadline)).toMatchObject({
        ok: false,
        code: "DEADLINE_PASSED",
      });
      expect(okDecision(decide(opening(), { type, actorId: CH, round: "opening" }, addMs(deadline, -1))).ok).toBe(true);
    }
  });

  it("rejects an opening sent after the round moved on", () => {
    const decision = decide(rebuttal(), { type: "save_submission", actorId: CH, round: "opening" }, NOW);
    expect(decision).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
  });

  it("rejects a rebuttal before the rebuttal round", () => {
    const decision = decide(opening(), { type: "save_submission", actorId: CH, round: "rebuttal" }, NOW);
    expect(decision).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("non-participants cannot submit, lock or ask to cancel", () => {
    const commands: Command[] = [
      { type: "save_submission", actorId: OUTSIDER, round: "opening" },
      { type: "lock_submission", actorId: OUTSIDER, round: "opening" },
      { type: "request_cancel", actorId: OUTSIDER, reason: null },
      { type: "retract_cancel", actorId: OUTSIDER },
    ];
    for (const command of commands) {
      expect(decide(opening(), command, NOW)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
  });
});

describe("cancellation", () => {
  it("one request notifies the other side; a second makes it mutual and cancels", () => {
    const first = okDecision(decide(opening(), { type: "request_cancel", actorId: CH, reason: "Family emergency" }, NOW));
    expect(first.state.status).toBe("active");
    expect(first.state.challenger.cancelRequestedAt).toEqual(NOW);
    expect(effectsOf(first)).toEqual([
      {
        kind: "notify",
        to: "recipient",
        type: "cancel_requested",
        actorId: CH,
        data: { reason: "Family emergency" },
      },
    ]);

    const at = addMs(NOW, HOUR_MS);
    const second = okDecision(decide(first.state, { type: "request_cancel", actorId: RE, reason: null }, at));
    expect(second.state).toMatchObject({ status: "cancelled", round: "opening", cancelledAt: at, cancelledBy: RE });
    expect(second.state.cancelReason).toMatch(/both sides agreed/i);
    expect(effectsOf(second)).toEqual([
      {
        kind: "notify",
        to: "both",
        type: "competition_cancelled",
        actorId: RE,
        data: { reason: "Both sides agreed to cancel." },
      },
    ]);
  });

  it("cannot ask twice; can take it back", () => {
    const requested = withSides(rebuttal(), { cancelRequestedAt: T0 }, {});
    expect(decide(requested, { type: "request_cancel", actorId: CH, reason: null }, NOW)).toMatchObject({
      ok: false,
      code: "CONFLICT",
    });
    const retracted = okDecision(decide(requested, { type: "retract_cancel", actorId: CH }, NOW));
    expect(retracted.state.challenger.cancelRequestedAt).toBeNull();
    expect(decide(opening(), { type: "retract_cancel", actorId: CH }, NOW)).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it.each(["pending_acceptance", "opening", "rebuttal", "locked", "needs_review"] as const)(
    "admin can cancel from %s with a recorded reason",
    (phase) => {
      const decision = okDecision(decide(stateIn(phase), { type: "admin_cancel", actorId: ADMIN, reason: "Harassment" }, NOW));
      expect(decision.state).toMatchObject({ status: "cancelled", cancelReason: "Harassment", cancelledBy: ADMIN });
      expect(effectsOf(decision)).toEqual([
        {
          kind: "notify",
          to: "both",
          type: "competition_cancelled",
          actorId: ADMIN,
          data: { reason: "Cancelled by an admin: Harassment" },
        },
      ]);
    },
  );
});
