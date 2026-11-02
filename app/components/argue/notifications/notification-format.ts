/**
 * How each notification type reads and where it links (PRD §8.8). Pure — used by the /notifications page
 * and covered by tests. `Record<NotificationType, …>` makes the compiler insist every type in the schema
 * has copy and a destination; add new types to schema.ts AND here.
 *
 * Other teams' notify() calls: these optional `data` keys are used when present —
 *   excerpt (comment text), argumentTitle, proposition (challenge terms), reason (decline/cancel/moderation),
 *   round ("opening" | "rebuttal"), outcomeLabel (e.g. "You won", "Draw"),
 *   and link hints argumentId / commentId / competitionId / handle (normally resolved from the target row).
 */
import type { NotificationData } from "@domain/db/json-types";
import type { NotificationType } from "@domain/db/schema";
import type { NotificationRecord } from "@domain/notifications/queries";

export type NotificationKind = "discussion" | "social" | "challenge" | "verdict" | "moderation";

interface TypeSpec {
  kind: NotificationKind;
  /** `{actor}` is replaced by the actor's display name (or "Someone"). */
  text: string;
  /** Data keys to show as the quoted detail line, first present wins. */
  detail: readonly string[];
}

const SPECS: Record<NotificationType, TypeSpec> = {
  comment_reply: { kind: "discussion", text: "{actor} replied to your comment", detail: ["excerpt"] },
  argument_comment: { kind: "discussion", text: "{actor} commented on your argument", detail: ["excerpt", "argumentTitle"] },
  mention: { kind: "discussion", text: "{actor} mentioned you in a comment", detail: ["excerpt"] },
  follow: { kind: "social", text: "{actor} started following you", detail: [] },
  challenge_received: { kind: "challenge", text: "{actor} sent you a direct challenge", detail: ["proposition", "argumentTitle"] },
  challenge_accepted: { kind: "challenge", text: "{actor} accepted your challenge — the debate is on", detail: ["proposition"] },
  challenge_declined: { kind: "challenge", text: "{actor} declined your challenge", detail: ["reason", "proposition"] },
  challenge_expired: { kind: "challenge", text: "A challenge expired before it was accepted", detail: ["proposition"] },
  challenge_withdrawn: { kind: "challenge", text: "{actor} withdrew their challenge", detail: ["proposition"] },
  cancel_requested: {
    kind: "challenge",
    text: "{actor} asked to cancel your debate — it's only cancelled if you agree too",
    detail: ["reason", "proposition"],
  },
  competition_cancelled: { kind: "challenge", text: "Your debate was cancelled", detail: ["reason", "proposition"] },
  round_opened: { kind: "challenge", text: "A new round is open in your debate", detail: ["proposition"] },
  opponent_locked: { kind: "challenge", text: "Your opponent locked in their submission", detail: ["proposition"] },
  deadline_soon: { kind: "challenge", text: "A deadline in your debate is coming up", detail: ["proposition"] },
  forfeit: { kind: "challenge", text: "Your debate ended by forfeit (no opening submitted)", detail: ["outcomeLabel", "proposition"] },
  verdict_ready: { kind: "verdict", text: "The AI verdict is in", detail: ["outcomeLabel", "proposition"] },
  needs_review: {
    kind: "verdict",
    text: "Your debate needs a human review before a result is shown",
    detail: ["proposition"],
  },
  appeal_filed: { kind: "verdict", text: "An appeal was filed on your debate", detail: ["proposition"] },
  appeal_decided: { kind: "verdict", text: "The appeal on your debate has been decided", detail: ["outcomeLabel", "proposition"] },
  moderation_warning: { kind: "moderation", text: "You received a warning from the moderators", detail: ["reason"] },
  moderation_action: { kind: "moderation", text: "The moderators took action on your content", detail: ["reason"] },
};

/** Types whose destination is the verdict page rather than the competition room. */
const VERDICT_PAGE_TYPES: ReadonlySet<NotificationType> = new Set(["verdict_ready", "appeal_filed", "appeal_decided"]);

export function notificationKind(type: NotificationType): NotificationKind {
  return SPECS[type]?.kind ?? "social";
}

export interface NotificationMessage {
  /** The sentence, actor name included (render as text). */
  text: string;
  /** The actor's display name inside `text`, so the UI can emphasise it; null for system notifications. */
  actorName: string | null;
  /** Optional quoted context (comment excerpt, proposition, reason). */
  detail: string | null;
}

function dataText(data: NotificationData, key: string): string | null {
  const value = data[key];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

/** moderation_action copy per action (moderation sends data.action); the full reason is the detail line. */
const MODERATION_ACTION_TEXT: Readonly<Record<string, string>> = {
  hide: "The moderators hid some of your content while they review it",
  remove: "The moderators removed some of your content",
  restore: "The moderators restored your content",
  warn: "You received a warning from the moderators",
  suspend: "Your account was suspended",
  unsuspend: "Your suspension was lifted",
};

/**
 * Sentence for a type, adjusted by its data. Fairness: a verdict a HUMAN decided must never be announced
 * as "The AI verdict is in".
 */
function specText(record: Pick<NotificationRecord, "type" | "data">, spec: TypeSpec): string {
  if (record.type === "moderation_action") {
    const action = dataText(record.data, "action");
    if (action && MODERATION_ACTION_TEXT[action]) return MODERATION_ACTION_TEXT[action];
  }
  if (record.type === "verdict_ready" && dataText(record.data, "decidedBy") === "human") {
    return "A human reviewer has decided your debate";
  }
  return spec.text;
}

export function notificationMessage(record: Pick<NotificationRecord, "type" | "data" | "actor">): NotificationMessage {
  const found: TypeSpec | undefined = SPECS[record.type];
  if (!found) return { text: "You have a new notification", actorName: null, detail: null };
  const spec: TypeSpec = { ...found, text: specText(record, found) };
  const usesActor = spec.text.includes("{actor}");
  const actorName = usesActor ? (record.actor?.displayName ?? null) : null;
  const text = spec.text.replace("{actor}", actorName ?? "Someone");
  let detail: string | null = null;
  for (const key of spec.detail) {
    detail = dataText(record.data, key);
    if (detail) break;
  }
  return { text, actorName, detail };
}

function argumentHref(argumentId: string, commentId: string | undefined): string {
  return commentId ? `/a/${argumentId}#comment-${commentId}` : `/a/${argumentId}`;
}

/** Where tapping a notification goes. Always a same-site path; falls back to /notifications. */
export function notificationHref(record: Pick<NotificationRecord, "type" | "context" | "actor">): string {
  const { argumentId, commentId, competitionId, handle } = record.context;
  const kind = notificationKind(record.type);

  switch (kind) {
    case "discussion":
      if (argumentId) return argumentHref(argumentId, commentId);
      break;
    case "social": {
      const target = handle ?? record.actor?.handle;
      if (target) return `/u/${target}`;
      break;
    }
    case "challenge":
    case "verdict":
      if (competitionId) return VERDICT_PAGE_TYPES.has(record.type) ? `/c/${competitionId}/verdict` : `/c/${competitionId}`;
      break;
    case "moderation":
      if (argumentId) return argumentHref(argumentId, commentId);
      if (competitionId) return `/c/${competitionId}`;
      return "/rules";
  }

  if (argumentId) return argumentHref(argumentId, commentId);
  if (competitionId) return `/c/${competitionId}`;
  if (handle) return `/u/${handle}`;
  return "/notifications";
}
