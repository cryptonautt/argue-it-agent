/**
 * Client stubs for the reference ARGUE IT server actions (Task 6).
 *
 * Every export keeps the reference name and signature (`(input) => Promise<ActionResult<T>>`), so
 * copied components keep working unchanged. Each one calls the matching Agent-Native action
 * (Task 5) through `callAction`, which is the same code path the agent uses.
 *
 * Contract with `server/lib/domain-action.ts` (runDomain):
 * - success: the action returns the bare `T`; we wrap it back into `{ ok: true, data }`.
 * - failure: the action throws a typed error; `callAction` rejects with an Error carrying
 *   `errorCode` (a reference `ActionErrorCode`, any case), `actionMessage`, `status`, and
 *   `details.fieldErrors`. We convert it back into the reference `ActionFailure` shape.
 *
 * Reference operations with no Agent-Native action yet return an explicit failure (never a fake
 * success). They are listed in `UNPORTED_ACTIONS` and in docs/port-notes.md.
 *
 * Only `import type` from `@domain/...` here: nothing from the server domain reaches the client.
 */
import { callAction, signOut as frameworkSignOut } from "@agent-native/core/client/hooks";

import type * as AppealActions from "@domain/appeals/actions";
import type * as ArgumentActions from "@domain/arguments/actions";
import type * as CompetitionActions from "@domain/competitions/actions";
import type {
  ActionErrorCode,
  ActionFailure,
  ActionResult,
  FieldErrors,
} from "@domain/lib/action-result";
import type * as ModerationActions from "@domain/moderation/actions";
import type * as NotificationActions from "@domain/notifications/actions";
import type * as ProfileActions from "@domain/profiles/actions";
import type * as SocialActions from "@domain/social/actions";

export type { CreateArgumentInput, UpdateArgumentInput } from "@domain/arguments/actions";
export type {
  CompetitionStateResult,
  SendChallengeInput,
  SubmissionInput,
} from "@domain/competitions/actions";

// ---------------------------------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------------------------------

type AnyFn = (...args: any[]) => any;
type In<F extends AnyFn> = Parameters<F>[0];
type Out<F extends AnyFn> = Awaited<ReturnType<F>>;
type DataOf<F extends AnyFn> = Out<F> extends ActionResult<infer T> ? T : never;

const ACTION_ERROR_CODES: readonly ActionErrorCode[] = [
  "VALIDATION",
  "UNAUTHENTICATED",
  "SUSPENDED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "IN_PROGRESS",
  "INTERNAL",
];

const STATUS_CODES: Record<number, ActionErrorCode> = {
  400: "VALIDATION",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "VALIDATION",
  423: "SUSPENDED",
  429: "RATE_LIMITED",
};

const GENERIC_ERROR = "Something went wrong. Please try again.";
export const NOT_PORTED_MESSAGE = "This isn't available in this version of ARGUE IT yet.";

function failure(error: string, code?: ActionErrorCode, fieldErrors?: FieldErrors): ActionFailure {
  return {
    ok: false,
    error,
    ...(fieldErrors ? { fieldErrors } : {}),
    ...(code ? { code } : {}),
  };
}

function normaliseCode(raw: unknown, status: unknown): ActionErrorCode {
  if (typeof raw === "string") {
    const upper = raw.trim().toUpperCase().replace(/[\s-]+/g, "_") as ActionErrorCode;
    if (ACTION_ERROR_CODES.includes(upper)) return upper;
  }
  if (typeof status === "number" && STATUS_CODES[status]) return STATUS_CODES[status];
  return "INTERNAL";
}

function readFieldErrors(details: unknown): FieldErrors | undefined {
  if (!details || typeof details !== "object") return undefined;
  const fe = (details as { fieldErrors?: unknown }).fieldErrors;
  if (!fe || typeof fe !== "object" || Array.isArray(fe)) return undefined;
  const out: FieldErrors = {};
  for (const [key, value] of Object.entries(fe as Record<string, unknown>)) {
    if (Array.isArray(value)) out[key] = value.map(String);
    else if (typeof value === "string") out[key] = [value];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Convert anything `callAction` throws into the reference `ActionFailure` shape. */
export function toActionFailure(error: unknown): ActionFailure {
  const e = (error ?? {}) as {
    errorCode?: unknown;
    actionMessage?: unknown;
    status?: unknown;
    details?: unknown;
  };
  const code = normaliseCode(e.errorCode, e.status);
  const message =
    typeof e.actionMessage === "string" && e.actionMessage.trim() ? e.actionMessage : GENERIC_ERROR;
  return failure(message, code, readFieldErrors(e.details));
}

type Method = "GET" | "POST";

async function invoke<T>(name: string, input: unknown, method: Method = "POST"): Promise<ActionResult<T>> {
  try {
    const data = await callAction<T>(
      name,
      (input ?? {}) as Record<string, any>,
      method === "GET" ? { method: "GET" } : undefined,
    );
    return { ok: true, data: data as T };
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Reference operations that have no Agent-Native action yet. Calling one returns a plain failure. */
export const UNPORTED_ACTIONS = new Set<string>();

function notPorted<F extends AnyFn>(name: string) {
  UNPORTED_ACTIONS.add(name);
  return async (_input?: In<F>): Promise<ActionResult<DataOf<F>>> =>
    failure(NOT_PORTED_MESSAGE, "INTERNAL");
}

// ---------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------

export function createArgument(input: In<typeof ArgumentActions.createArgument>) {
  return invoke<DataOf<typeof ArgumentActions.createArgument>>("create-argument", input);
}

export function loadFeedPage(input: In<typeof ArgumentActions.loadFeedPage>) {
  return invoke<DataOf<typeof ArgumentActions.loadFeedPage>>("list-feed", input, "GET");
}

export const updateArgument = notPorted<typeof ArgumentActions.updateArgument>("updateArgument");
export const deleteArgument = notPorted<typeof ArgumentActions.deleteArgument>("deleteArgument");

// ---------------------------------------------------------------------------------------------------
// Competitions
// ---------------------------------------------------------------------------------------------------

export function sendChallenge(input: In<typeof CompetitionActions.sendChallenge>) {
  return invoke<DataOf<typeof CompetitionActions.sendChallenge>>("send-challenge", input);
}

export function acceptChallenge(input: In<typeof CompetitionActions.acceptChallenge>) {
  return invoke<DataOf<typeof CompetitionActions.acceptChallenge>>("respond-to-challenge", {
    ...input,
    response: "accept",
  });
}

export function declineChallenge(input: In<typeof CompetitionActions.declineChallenge>) {
  return invoke<DataOf<typeof CompetitionActions.declineChallenge>>("respond-to-challenge", {
    ...input,
    response: "decline",
  });
}

export function saveSubmission(input: In<typeof CompetitionActions.saveSubmission>) {
  return invoke<DataOf<typeof CompetitionActions.saveSubmission>>("save-submission", input);
}

export function lockSubmission(input: In<typeof CompetitionActions.lockSubmission>) {
  return invoke<DataOf<typeof CompetitionActions.lockSubmission>>("lock-submission", input);
}

export const withdrawChallenge = notPorted<typeof CompetitionActions.withdrawChallenge>("withdrawChallenge");
export const requestCancel = notPorted<typeof CompetitionActions.requestCancel>("requestCancel");
export const retractCancel = notPorted<typeof CompetitionActions.retractCancel>("retractCancel");
export const adminCancelCompetition = notPorted<typeof CompetitionActions.adminCancelCompetition>(
  "adminCancelCompetition",
);

// ---------------------------------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------------------------------

export function setPosition(input: In<typeof SocialActions.setPosition>) {
  return invoke<DataOf<typeof SocialActions.setPosition>>("set-position", input);
}

export function createComment(input: In<typeof SocialActions.createComment>) {
  return invoke<DataOf<typeof SocialActions.createComment>>("create-comment", input);
}

export const removePosition = notPorted<typeof SocialActions.removePosition>("removePosition");
export const editComment = notPorted<typeof SocialActions.editComment>("editComment");
export const deleteComment = notPorted<typeof SocialActions.deleteComment>("deleteComment");
export const setReaction = notPorted<typeof SocialActions.setReaction>("setReaction");
export const followUser = notPorted<typeof SocialActions.followUser>("followUser");
export const unfollowUser = notPorted<typeof SocialActions.unfollowUser>("unfollowUser");
export const blockUser = notPorted<typeof SocialActions.blockUser>("blockUser");
export const unblockUser = notPorted<typeof SocialActions.unblockUser>("unblockUser");

// ---------------------------------------------------------------------------------------------------
// Appeals & review
// ---------------------------------------------------------------------------------------------------

export function fileAppeal(input: In<typeof AppealActions.fileAppeal>) {
  return invoke<DataOf<typeof AppealActions.fileAppeal>>("file-appeal", input);
}

/** `draftId` is optional (Task 8): approving an agent draft passes it through. */
export function decideAppeal(input: In<typeof AppealActions.decideAppeal> & { draftId?: string }) {
  return invoke<DataOf<typeof AppealActions.decideAppeal>>("decide-appeal", input);
}

/** `draftId` is optional (Task 8): approving an agent draft passes it through. */
export function resolveReview(input: In<typeof AppealActions.resolveReview> & { draftId?: string }) {
  return invoke<DataOf<typeof AppealActions.resolveReview>>("resolve-review", input);
}

export function retryFailedEvaluation(input: In<typeof AppealActions.retryFailedEvaluation>) {
  return invoke<DataOf<typeof AppealActions.retryFailedEvaluation>>("retry-evaluation", input);
}

export const retryReputation = notPorted<typeof AppealActions.retryReputation>("retryReputation");

// ---------------------------------------------------------------------------------------------------
// Profiles, moderation, notifications (not part of the port's core loop)
// ---------------------------------------------------------------------------------------------------

export const updateProfile = notPorted<typeof ProfileActions.updateProfile>("updateProfile");
export const saveInterests = notPorted<typeof ProfileActions.saveInterests>("saveInterests");
export const saveNotificationPrefs = notPorted<typeof ProfileActions.saveNotificationPrefs>(
  "saveNotificationPrefs",
);
export const deleteAccount = notPorted<typeof ProfileActions.deleteAccount>("deleteAccount");

export const fileReport = notPorted<typeof ModerationActions.fileReport>("fileReport");
export const moderateContent = notPorted<typeof ModerationActions.moderateContent>("moderateContent");
export const warnUser = notPorted<typeof ModerationActions.warnUser>("warnUser");
export const suspendUser = notPorted<typeof ModerationActions.suspendUser>("suspendUser");
export const unsuspendUser = notPorted<typeof ModerationActions.unsuspendUser>("unsuspendUser");
export const dismissReport = notPorted<typeof ModerationActions.dismissReport>("dismissReport");
export const changeUserRole = notPorted<typeof ModerationActions.changeUserRole>("changeUserRole");

export const markNotificationsRead = notPorted<typeof NotificationActions.markNotificationsRead>(
  "markNotificationsRead",
);
export const markAllNotificationsRead = notPorted<typeof NotificationActions.markAllNotificationsRead>(
  "markAllNotificationsRead",
);
export const getUnreadNotificationCount = notPorted<typeof NotificationActions.getUnreadNotificationCount>(
  "getUnreadNotificationCount",
);

// ---------------------------------------------------------------------------------------------------
// Auth: the framework owns sessions; only sign-out is used by the shell's profile menu.
// ---------------------------------------------------------------------------------------------------

export async function signOut(): Promise<ActionResult<void>> {
  try {
    await frameworkSignOut();
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionFailure(error);
  }
}
