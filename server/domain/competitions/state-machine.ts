/**
 * Owner: challenges. The direct-challenge state machine (design §4.2) as a PURE module.
 *
 * - `TRANSITIONS` is the single table of what may happen in which phase, by whom.
 * - `advance(state, at)` applies time: expiry, round closes, no-show rule. Deterministic in `at`.
 * - `decide(state, command, at)` applies one participant/admin command (after time has been applied).
 *
 * Both return a new state plus a list of `Step`s, each carrying the side effects the DB layer must run
 * (notifications, freezing submissions, the forfeit verdict, queueing the AI judge). Nothing here
 * touches the database or the clock, which is what makes every rule exhaustively unit-testable.
 */
import { addHours, isPast } from "@domain/lib/time";
import type { CompetitionRound, CompetitionStatus, NotificationType } from "@domain/db/schema";

// ---------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------

export type ParticipantRole = "challenger" | "recipient";
export type CompetitionSide = "FOR" | "AGAINST";
export type AcceptanceStatus = "pending" | "accepted" | "declined";

/** Whether a side has a submission for a round, and whether it is locked (final). */
export type SubmissionMark = { present: false } | { present: true; lockedAt: Date | null };

export const NO_SUBMISSION: SubmissionMark = { present: false };

export interface ParticipantState {
  userId: string;
  role: ParticipantRole;
  side: CompetitionSide;
  acceptance: AcceptanceStatus;
  acceptedAt: Date | null;
  cancelRequestedAt: Date | null;
  opening: SubmissionMark;
  rebuttal: SubmissionMark;
}

export interface MachineState {
  status: CompetitionStatus;
  /** Only set while `active` — except that cancellation keeps the round it stopped in (for sealing). */
  round: CompetitionRound | null;
  roundDurationHours: number;
  acceptDeadline: Date;
  acceptedAt: Date | null;
  openingClosesAt: Date | null;
  rebuttalClosesAt: Date | null;
  lockedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  declineReason: string | null;
  challenger: ParticipantState;
  recipient: ParticipantState;
}

/** Status with the active round folded in — the unit the transition table is written in. */
export type Phase =
  | "pending_acceptance"
  | "opening"
  | "rebuttal"
  | "locked"
  | "evaluating"
  | "under_appeal"
  | "completed"
  | "needs_review"
  | "declined"
  | "expired"
  | "withdrawn"
  | "cancelled";

export const PHASES: readonly Phase[] = [
  "pending_acceptance",
  "opening",
  "rebuttal",
  "locked",
  "evaluating",
  "under_appeal",
  "completed",
  "needs_review",
  "declined",
  "expired",
  "withdrawn",
  "cancelled",
];

export class InvalidCompetitionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCompetitionStateError";
  }
}

export function phaseOf(state: Pick<MachineState, "status" | "round">): Phase {
  if (state.status !== "active") return state.status;
  if (state.round === "opening" || state.round === "rebuttal") return state.round;
  throw new InvalidCompetitionStateError("An active competition must be in the opening or rebuttal round.");
}

// ---------------------------------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------------------------------

export type TransitionName =
  | "accept"
  | "decline"
  | "withdraw"
  | "expire"
  | "save_submission"
  | "lock_submission"
  | "close_opening"
  | "close_rebuttal"
  | "request_cancel"
  | "retract_cancel"
  | "admin_cancel";

/** Who may trigger a transition. "system" = time (lazy enforcement / cron). */
export type TransitionActor = "challenger" | "recipient" | "participant" | "admin" | "system";

export interface TransitionSpec {
  from: readonly Phase[];
  /** Every phase this transition can end in (outcome-dependent ones list several). */
  to: readonly Phase[];
  by: TransitionActor;
  description: string;
}

export const TRANSITIONS: Readonly<Record<TransitionName, TransitionSpec>> = {
  accept: {
    from: ["pending_acceptance"],
    to: ["opening"],
    by: "recipient",
    description: "Recipient accepts the exact frozen terms; the opening round starts.",
  },
  decline: {
    from: ["pending_acceptance"],
    to: ["declined"],
    by: "recipient",
    description: "Recipient declines (optional reason).",
  },
  withdraw: {
    from: ["pending_acceptance"],
    to: ["withdrawn"],
    by: "challenger",
    description: "Challenger withdraws before it is accepted.",
  },
  expire: {
    from: ["pending_acceptance"],
    to: ["expired"],
    by: "system",
    description: "Nobody accepted within the acceptance window.",
  },
  save_submission: {
    from: ["opening", "rebuttal"],
    to: ["opening", "rebuttal"],
    by: "participant",
    description: "Save (or edit) your draft for the current round.",
  },
  lock_submission: {
    from: ["opening", "rebuttal"],
    to: ["opening", "rebuttal", "locked"],
    by: "participant",
    description: "Lock in your entry for the current round. When both sides lock, the round closes early.",
  },
  close_opening: {
    from: ["opening"],
    to: ["rebuttal", "completed", "cancelled"],
    by: "system",
    description: "Opening deadline: rebuttals start; or forfeit if one side has no opening; or cancel if neither does.",
  },
  close_rebuttal: {
    from: ["rebuttal"],
    to: ["locked"],
    by: "system",
    description: "Rebuttal deadline: entries freeze and the AI judge is queued.",
  },
  request_cancel: {
    from: ["opening", "rebuttal"],
    to: ["opening", "rebuttal", "cancelled"],
    by: "participant",
    description: "Ask to cancel. When both sides have asked, the challenge is cancelled.",
  },
  retract_cancel: {
    from: ["opening", "rebuttal"],
    to: ["opening", "rebuttal"],
    by: "participant",
    description: "Take back your cancel request.",
  },
  admin_cancel: {
    from: ["pending_acceptance", "opening", "rebuttal", "locked", "needs_review"],
    to: ["cancelled"],
    by: "admin",
    description: "An admin cancels with a recorded reason.",
  },
};

export function isAllowedIn(transition: TransitionName, phase: Phase): boolean {
  return TRANSITIONS[transition].from.includes(phase);
}

/** Phases from which nothing in this module can move the competition any more. */
export function isFinalForLifecycle(phase: Phase): boolean {
  return (Object.keys(TRANSITIONS) as TransitionName[]).every((name) => !isAllowedIn(name, phase));
}

// ---------------------------------------------------------------------------------------------------
// Commands, effects, results
// ---------------------------------------------------------------------------------------------------

export type Command =
  | { type: "accept"; actorId: string }
  | { type: "decline"; actorId: string; reason: string | null }
  | { type: "withdraw"; actorId: string }
  | { type: "save_submission"; actorId: string; round: CompetitionRound }
  | { type: "lock_submission"; actorId: string; round: CompetitionRound }
  | { type: "request_cancel"; actorId: string; reason: string | null }
  | { type: "retract_cancel"; actorId: string }
  /** The caller has already verified the actor is an admin. */
  | { type: "admin_cancel"; actorId: string; reason: string };

export type CommandType = Command["type"];
export const COMMAND_TYPES: readonly CommandType[] = [
  "accept",
  "decline",
  "withdraw",
  "save_submission",
  "lock_submission",
  "request_cancel",
  "retract_cancel",
  "admin_cancel",
];

export type NotifyTarget = ParticipantRole | "both";
export type EffectData = Record<string, string | number | boolean | null>;

export type Effect =
  | { kind: "notify"; to: NotifyTarget; type: NotificationType; actorId: string | null; data?: EffectData }
  /** Lock every not-yet-locked submission of `round` at `at` (the round closed). */
  | { kind: "freeze_round"; round: CompetitionRound; at: Date }
  /** Lock one participant's submission. */
  | { kind: "lock_submission"; userId: string; round: CompetitionRound; at: Date }
  /** Write the forfeit verdict for `winner` and apply the (half-weight) rating result. */
  | { kind: "forfeit"; winner: ParticipantRole }
  /** Hand the frozen competition to the AI judge. */
  | { kind: "enqueue_evaluation" };

export interface Step {
  transition: TransitionName;
  from: Phase;
  to: Phase;
  effects: Effect[];
}

export interface Transitioned {
  state: MachineState;
  steps: Step[];
}

export type RejectionCode = "FORBIDDEN" | "CONFLICT" | "DEADLINE_PASSED";

export type Decision = ({ ok: true } & Transitioned) | { ok: false; code: RejectionCode; message: string };

const reject = (code: RejectionCode, message: string): Decision => ({ ok: false, code, message });

// ---------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------

export function roleOf(state: MachineState, userId: string): ParticipantRole | null {
  if (state.challenger.userId === userId) return "challenger";
  if (state.recipient.userId === userId) return "recipient";
  return null;
}

export function otherRole(role: ParticipantRole): ParticipantRole {
  return role === "challenger" ? "recipient" : "challenger";
}

export function participantBySide(state: MachineState, side: CompetitionSide): ParticipantState {
  return state.challenger.side === side ? state.challenger : state.recipient;
}

function isLocked(mark: SubmissionMark): boolean {
  return mark.present && mark.lockedAt !== null;
}

function freezeMark(mark: SubmissionMark, at: Date): SubmissionMark {
  return mark.present && mark.lockedAt === null ? { present: true, lockedAt: at } : mark;
}

function withParticipant(state: MachineState, role: ParticipantRole, patch: Partial<ParticipantState>): MachineState {
  return { ...state, [role]: { ...state[role], ...patch } };
}

function freezeRound(state: MachineState, round: CompetitionRound, at: Date): MachineState {
  return {
    ...state,
    challenger: { ...state.challenger, [round]: freezeMark(state.challenger[round], at) },
    recipient: { ...state.recipient, [round]: freezeMark(state.recipient[round], at) },
  };
}

export type DeadlineFields = Pick<
  MachineState,
  "status" | "round" | "acceptDeadline" | "openingClosesAt" | "rebuttalClosesAt"
>;

/** The deadline that is currently running, if any. */
export function currentDeadline(state: DeadlineFields): Date | null {
  switch (phaseOf(state)) {
    case "pending_acceptance":
      return state.acceptDeadline;
    case "opening":
      return state.openingClosesAt;
    case "rebuttal":
      return state.rebuttalClosesAt;
    default:
      return null;
  }
}

/** True when a deadline has passed and `advance()` would change the state. */
export function isDue(state: DeadlineFields, at: Date): boolean {
  const deadline = currentDeadline(state);
  return deadline !== null && isPast(deadline, at);
}

function requireDate(value: Date | null, what: string): Date {
  if (!value) throw new InvalidCompetitionStateError(`Active competition is missing ${what}.`);
  return value;
}

// ---------------------------------------------------------------------------------------------------
// Time: advance()
// ---------------------------------------------------------------------------------------------------

/**
 * Apply every deadline that has passed by `at`, in order (a competition nobody looked at for days may
 * expire, or close both rounds, in one call). Rounds close AT their deadline instant: drafts are frozen
 * with that timestamp and a scheduled rebuttal deadline is kept, so a late sweep changes nothing.
 */
export function advance(initial: MachineState, at: Date): Transitioned {
  let state = initial;
  const steps: Step[] = [];
  // Each iteration either applies one deadline or stops; there are at most two (opening, rebuttal).
  for (let guard = 0; guard < 4; guard++) {
    const next = advanceOnce(state, at);
    if (!next) break;
    state = next.state;
    steps.push(next.step);
  }
  return { state, steps };
}

function advanceOnce(state: MachineState, at: Date): { state: MachineState; step: Step } | null {
  const phase = phaseOf(state);
  if (phase === "pending_acceptance" && isPast(state.acceptDeadline, at)) {
    return {
      state: { ...state, status: "expired", round: null },
      step: {
        transition: "expire",
        from: phase,
        to: "expired",
        effects: [{ kind: "notify", to: "challenger", type: "challenge_expired", actorId: null }],
      },
    };
  }
  if (phase === "opening") {
    const closesAt = requireDate(state.openingClosesAt, "opening_closes_at");
    if (isPast(closesAt, at)) return closeOpening(state, closesAt, at, false);
  }
  if (phase === "rebuttal") {
    const closesAt = requireDate(state.rebuttalClosesAt, "rebuttal_closes_at");
    if (isPast(closesAt, at)) return closeRebuttal(state, closesAt);
  }
  return null;
}

export const NO_SHOW_CANCEL_REASON = "Neither side submitted an opening before the deadline.";

/**
 * Close the opening round at `closeAt` (the deadline, or now when both locked early).
 * No-show rule (design §4.2): one opening → that side wins by forfeit; none → cancelled.
 */
function closeOpening(
  state: MachineState,
  closeAt: Date,
  processedAt: Date,
  early: boolean,
): { state: MachineState; step: Step } {
  const frozen = freezeRound(state, "opening", closeAt);
  const challengerHas = state.challenger.opening.present;
  const recipientHas = state.recipient.opening.present;
  const freeze: Effect = { kind: "freeze_round", round: "opening", at: closeAt };

  if (challengerHas && recipientHas) {
    const duration = state.roundDurationHours;
    return {
      state: {
        ...frozen,
        round: "rebuttal",
        openingClosesAt: early ? closeAt : state.openingClosesAt,
        // Early start: the rebuttal round gets its full duration from now (design §4.2).
        rebuttalClosesAt: early ? addHours(closeAt, duration) : requireDate(state.rebuttalClosesAt, "rebuttal_closes_at"),
      },
      step: {
        transition: "close_opening",
        from: "opening",
        to: "rebuttal",
        effects: [
          freeze,
          { kind: "notify", to: "both", type: "round_opened", actorId: null, data: { round: "rebuttal" } },
        ],
      },
    };
  }

  if (challengerHas || recipientHas) {
    const winner: ParticipantRole = challengerHas ? "challenger" : "recipient";
    return {
      state: { ...frozen, status: "completed", round: null, lockedAt: closeAt, completedAt: processedAt },
      step: {
        transition: "close_opening",
        from: "opening",
        to: "completed",
        effects: [
          freeze,
          { kind: "forfeit", winner },
          { kind: "notify", to: winner, type: "forfeit", actorId: null, data: { outcomeLabel: "You won by forfeit" } },
          {
            kind: "notify",
            to: otherRole(winner),
            type: "forfeit",
            actorId: null,
            data: { outcomeLabel: "You lost by forfeit (no opening)" },
          },
        ],
      },
    };
  }

  const reason = NO_SHOW_CANCEL_REASON;
  return {
    state: {
      ...frozen,
      status: "cancelled",
      round: null,
      lockedAt: closeAt,
      cancelledAt: processedAt,
      cancelledBy: null,
      cancelReason: reason,
    },
    step: {
      transition: "close_opening",
      from: "opening",
      to: "cancelled",
      effects: [freeze, { kind: "notify", to: "both", type: "competition_cancelled", actorId: null, data: { reason } }],
    },
  };
}

function closeRebuttal(state: MachineState, closeAt: Date): { state: MachineState; step: Step } {
  return {
    state: { ...freezeRound(state, "rebuttal", closeAt), status: "locked", round: null, lockedAt: closeAt },
    step: {
      transition: "close_rebuttal",
      from: "rebuttal",
      to: "locked",
      effects: [{ kind: "freeze_round", round: "rebuttal", at: closeAt }, { kind: "enqueue_evaluation" }],
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Commands: decide()
// ---------------------------------------------------------------------------------------------------

const PHASE_MESSAGES: Record<Phase, string> = {
  pending_acceptance: "This challenge hasn't been accepted yet.",
  opening: "The opening round is in progress.",
  rebuttal: "The rebuttal round is in progress.",
  locked: "Entries are locked and waiting for the AI judge.",
  evaluating: "The AI judge is reviewing this debate.",
  under_appeal: "This debate is under appeal.",
  completed: "This debate is finished.",
  needs_review: "This debate is waiting for a human reviewer.",
  declined: "This challenge was declined.",
  expired: "This challenge expired before it was accepted.",
  withdrawn: "This challenge was withdrawn.",
  cancelled: "This challenge was cancelled.",
};

const ROUND_LABEL: Record<CompetitionRound, string> = { opening: "opening", rebuttal: "rebuttal" };

/**
 * Apply one command at `at`. The caller should run `advance()` first (lazy enforcement); `decide` also
 * refuses to act on a state whose running deadline has passed, so a late command can never slip in.
 */
export function decide(state: MachineState, command: Command, at: Date): Decision {
  const phase = phaseOf(state);
  const spec = TRANSITIONS[command.type];

  // 1. Who is asking?
  const role = roleOf(state, command.actorId);
  if (spec.by === "challenger" && role !== "challenger") {
    return reject("FORBIDDEN", "Only the challenger can do that.");
  }
  if (spec.by === "recipient" && role !== "recipient") {
    return reject("FORBIDDEN", "Only the person who was challenged can do that.");
  }
  if (spec.by === "participant" && role === null) {
    return reject("FORBIDDEN", "Only the two people in this debate can do that.");
  }

  // 2. Is it allowed now?
  if (!isAllowedIn(command.type, phase)) return reject("CONFLICT", PHASE_MESSAGES[phase]);
  if (command.type !== "admin_cancel" && isDue(state, at)) {
    return reject(
      "DEADLINE_PASSED",
      phase === "pending_acceptance" ? "This challenge has expired." : `The ${phase} round has closed.`,
    );
  }

  switch (command.type) {
    case "accept":
      return accept(state, command.actorId, at);
    case "decline":
      return single(
        {
          ...withParticipant(state, "recipient", { acceptance: "declined" }),
          status: "declined",
          round: null,
          declineReason: command.reason,
        },
        "decline",
        phase,
        [
          {
            kind: "notify",
            to: "challenger",
            type: "challenge_declined",
            actorId: command.actorId,
            ...(command.reason ? { data: { reason: command.reason } } : {}),
          },
        ],
      );
    case "withdraw":
      return single(
        { ...state, status: "withdrawn", round: null, cancelledAt: at, cancelledBy: command.actorId },
        "withdraw",
        phase,
        [{ kind: "notify", to: "recipient", type: "challenge_withdrawn", actorId: command.actorId }],
      );
    case "save_submission":
      return saveSubmission(state, assertRole(role), command.round, phase);
    case "lock_submission":
      return lockSubmission(state, assertRole(role), command.actorId, command.round, phase, at);
    case "request_cancel":
      return requestCancel(state, assertRole(role), command.actorId, command.reason, phase, at);
    case "retract_cancel": {
      const own = state[assertRole(role)];
      if (own.cancelRequestedAt === null) return reject("CONFLICT", "You haven't asked to cancel.");
      return single(withParticipant(state, own.role, { cancelRequestedAt: null }), "retract_cancel", phase, []);
    }
    case "admin_cancel":
      return single(
        {
          ...state,
          status: "cancelled",
          cancelledAt: at,
          cancelledBy: command.actorId,
          cancelReason: command.reason,
        },
        "admin_cancel",
        phase,
        [
          {
            kind: "notify",
            to: "both",
            type: "competition_cancelled",
            actorId: command.actorId,
            data: { reason: `Cancelled by an admin: ${command.reason}` },
          },
        ],
      );
  }
}

function assertRole(role: ParticipantRole | null): ParticipantRole {
  if (role === null) throw new InvalidCompetitionStateError("participant role expected");
  return role;
}

function single(state: MachineState, transition: TransitionName, from: Phase, effects: Effect[]): Decision {
  return { ok: true, state, steps: [{ transition, from, to: phaseOf(state), effects }] };
}

function accept(state: MachineState, actorId: string, at: Date): Decision {
  const openingClosesAt = addHours(at, state.roundDurationHours);
  const next: MachineState = {
    ...withParticipant(state, "recipient", { acceptance: "accepted", acceptedAt: at }),
    status: "active",
    round: "opening",
    acceptedAt: at,
    openingClosesAt,
    rebuttalClosesAt: addHours(openingClosesAt, state.roundDurationHours),
  };
  return single(next, "accept", "pending_acceptance", [
    { kind: "notify", to: "challenger", type: "challenge_accepted", actorId },
  ]);
}

function checkRound(phase: Phase, round: CompetitionRound): Decision | null {
  if (phase === round) return null;
  return reject(
    phase === "rebuttal" && round === "opening" ? "DEADLINE_PASSED" : "CONFLICT",
    phase === "rebuttal" && round === "opening"
      ? "The opening round has closed. You're in the rebuttal round now."
      : `The ${ROUND_LABEL[round]} round hasn't started yet.`,
  );
}

function saveSubmission(state: MachineState, role: ParticipantRole, round: CompetitionRound, phase: Phase): Decision {
  const wrongRound = checkRound(phase, round);
  if (wrongRound) return wrongRound;
  const mark = state[role][round];
  if (isLocked(mark)) return reject("CONFLICT", `Your ${ROUND_LABEL[round]} is locked in and can't be edited.`);
  return single(withParticipant(state, role, { [round]: { present: true, lockedAt: null } }), "save_submission", phase, []);
}

function lockSubmission(
  state: MachineState,
  role: ParticipantRole,
  actorId: string,
  round: CompetitionRound,
  phase: Phase,
  at: Date,
): Decision {
  const wrongRound = checkRound(phase, round);
  if (wrongRound) return wrongRound;
  if (isLocked(state[role][round])) return reject("CONFLICT", `Your ${ROUND_LABEL[round]} is already locked in.`);

  const locked = withParticipant(state, role, { [round]: { present: true, lockedAt: at } });
  const lockEffect: Effect = { kind: "lock_submission", userId: actorId, round, at };
  const opponent = otherRole(role);
  const bothLocked = isLocked(locked[opponent][round]);

  if (!bothLocked) {
    return single(locked, "lock_submission", phase, [
      lockEffect,
      { kind: "notify", to: opponent, type: "opponent_locked", actorId, data: { round } },
    ]);
  }

  // Both sides locked: the round closes now (early start of the rebuttal round, or lock for judging).
  const lockStep: Step = { transition: "lock_submission", from: phase, to: phase, effects: [lockEffect] };
  const closed = round === "opening" ? closeOpening(locked, at, at, true) : closeRebuttal(locked, at);
  return { ok: true, state: closed.state, steps: [lockStep, closed.step] };
}

function requestCancel(
  state: MachineState,
  role: ParticipantRole,
  actorId: string,
  reason: string | null,
  phase: Phase,
  at: Date,
): Decision {
  if (state[role].cancelRequestedAt !== null) return reject("CONFLICT", "You've already asked to cancel.");
  const opponent = otherRole(role);
  const requested = withParticipant(state, role, { cancelRequestedAt: at });

  if (state[opponent].cancelRequestedAt === null) {
    return single(requested, "request_cancel", phase, [
      { kind: "notify", to: opponent, type: "cancel_requested", actorId, data: reason ? { reason } : undefined },
    ]);
  }

  // Mutual agreement: both have now asked. Keep `round` so sealed openings stay sealed.
  const cancelReason = reason ? `Both sides agreed to cancel. ${reason}` : "Both sides agreed to cancel.";
  return single(
    { ...requested, status: "cancelled", cancelledAt: at, cancelledBy: actorId, cancelReason },
    "request_cancel",
    phase,
    [{ kind: "notify", to: "both", type: "competition_cancelled", actorId, data: { reason: cancelReason } }],
  );
}
