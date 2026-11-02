/**
 * Owner: moderation. The moderation POLICY as pure data + pure functions (design §4.7, PRD §8.9, §15).
 * No DB, no "server-only": the report dialog and admin forms import labels from here, and every rule
 * the server enforces is unit-tested here first.
 *
 * Principles:
 *  - Content moderation is separate from AI judging. Nothing here touches competitions, verdicts,
 *    scores or ratings. Hiding a debate submission only changes what people see, never the verdict.
 *  - Least privilege: moderators act on ordinary users' content and accounts; only admins act on staff,
 *    change roles, cancel competitions or suspend indefinitely. Nobody moderates themselves.
 */
import type { CompetitionStatus, ContentStatus, ModerationActionType, ReportReason, ReportTarget, UserRole } from "@domain/db/schema";

// ---------------------------------------------------------------------------------------------------
// Report reasons
// ---------------------------------------------------------------------------------------------------

export interface ReasonInfo {
  label: string;
  /** One plain sentence shown under the option in the report dialog. */
  description: string;
  /** Lower = more urgent. Drives the order of the moderator queue. */
  severity: number;
}

export const REASON_INFO: Record<ReportReason, ReasonInfo> = {
  threats: { label: "Threats or violence", description: "Threatens to hurt someone or encourages violence.", severity: 0 },
  doxxing: {
    label: "Sharing private information",
    description: "Posts someone's address, phone number, ID or other private details.",
    severity: 0,
  },
  hate: { label: "Hate speech", description: "Attacks people for their tribe, religion, ethnicity, gender or similar.", severity: 1 },
  harassment: { label: "Harassment or bullying", description: "Insults, targets or keeps attacking a person.", severity: 1 },
  impersonation: { label: "Impersonation", description: "Pretends to be another person, club, brand or organisation.", severity: 2 },
  malicious_link: { label: "Scam or harmful link", description: "Links to scams, phishing, malware or fake giveaways.", severity: 2 },
  prompt_injection: {
    label: "Judge manipulation",
    description: "Text that tries to give instructions to the AI judge instead of arguing.",
    severity: 2,
  },
  spam: { label: "Spam", description: "Ads, repeated posts, or content unrelated to the debate.", severity: 3 },
  other: { label: "Something else", description: "Breaks the rules in another way. Tell us more below.", severity: 4 },
};

/** Reasons a person can pick in the report dialog (prompt_injection is raised automatically by the judge). */
export const USER_REPORT_REASONS = [
  "spam",
  "harassment",
  "hate",
  "threats",
  "doxxing",
  "impersonation",
  "malicious_link",
  "other",
] as const satisfies readonly ReportReason[];
export type UserReportReason = (typeof USER_REPORT_REASONS)[number];

/** All reason codes a moderator can cite for an action. */
export const MODERATION_REASON_CODES = [
  "spam",
  "harassment",
  "hate",
  "threats",
  "doxxing",
  "impersonation",
  "malicious_link",
  "prompt_injection",
  "other",
] as const satisfies readonly ReportReason[];

export const REPORT_DETAILS_MAX = 1000;
export const MODERATION_NOTE_MAX = 1000;

export const TARGET_LABEL: Record<ReportTarget, string> = {
  argument: "argument",
  comment: "comment",
  profile: "profile",
  submission: "debate submission",
};

// ---------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------

export const ACTION_LABEL: Record<ModerationActionType, string> = {
  hide: "Hide",
  remove: "Remove",
  restore: "Restore",
  warn: "Warn",
  suspend: "Suspend",
  unsuspend: "Lift suspension",
  dismiss_report: "Dismiss report",
};

export const ACTION_PAST: Record<ModerationActionType, string> = {
  hide: "hidden",
  remove: "removed",
  restore: "restored",
  warn: "warned",
  suspend: "suspended",
  unsuspend: "suspension lifted",
  dismiss_report: "dismissed",
};

/** Actions that change a piece of content's visibility. */
export const CONTENT_ACTIONS = ["hide", "remove", "restore"] as const;
export type ContentAction = (typeof CONTENT_ACTIONS)[number];

/** Actions on the author's account. */
export const ACCOUNT_ACTIONS = ["warn", "suspend", "unsuspend"] as const;
export type AccountAction = (typeof ACCOUNT_ACTIONS)[number];

export interface TargetState {
  type: ReportTarget;
  /** Null for profiles (no visibility column). */
  status: ContentStatus | null;
  /** Profiles only: whether there is a bio/avatar a moderator could clear. */
  hasProfileContent?: boolean;
}

/**
 * Which content actions are valid for a target in its current state.
 * - argument / comment / submission: visible → hide|remove; hidden → remove|restore; removed → restore.
 * - profile: no visibility state, so "remove" clears the bio and avatar (the parts a user wrote).
 *   Display name and handle stay (they identify the account); suspend the account for worse cases.
 */
export function allowedContentActions(target: TargetState): ContentAction[] {
  if (target.type === "profile") return target.hasProfileContent ? ["remove"] : [];
  switch (target.status) {
    case "visible":
      return ["hide", "remove"];
    case "hidden":
      return ["remove", "restore"];
    case "removed":
      return ["restore"];
    default:
      return [];
  }
}

/** The status a content action moves to (profiles have none). */
export function nextStatus(action: ContentAction): ContentStatus {
  return action === "restore" ? "visible" : action === "hide" ? "hidden" : "removed";
}

// ---------------------------------------------------------------------------------------------------
// Who may act on whom
// ---------------------------------------------------------------------------------------------------

export interface Actor {
  id: string;
  role: UserRole;
}

export interface Subject {
  id: string;
  role: UserRole;
}

export type Permission = { allowed: true } | { allowed: false; reason: string };

const ALLOWED: Permission = { allowed: true };

/**
 * May `actor` moderate content written by, or the account of, `subject`?
 * - Never yourself (no self-restores, no self-unsuspends).
 * - Moderators: ordinary users only. Staff content/accounts go to an admin.
 * - Admins: anyone else.
 */
export function canModerate(actor: Actor, subject: Subject): Permission {
  if (actor.role === "user") return { allowed: false, reason: "Only moderators can do that." };
  if (actor.id === subject.id) return { allowed: false, reason: "You can't moderate your own content or account." };
  if (actor.role === "moderator" && subject.role !== "user") {
    return { allowed: false, reason: "Only an admin can moderate a staff member." };
  }
  return ALLOWED;
}

/** Role changes: admins only, never their own role, and never removing the last admin. */
export function canChangeRole(
  actor: Actor,
  subject: Subject,
  nextRole: UserRole,
  adminCount: number,
): Permission {
  if (actor.role !== "admin") return { allowed: false, reason: "Only admins can change roles." };
  if (actor.id === subject.id) return { allowed: false, reason: "You can't change your own role. Ask another admin." };
  if (subject.role === nextRole) return { allowed: false, reason: `They are already ${articleRole(nextRole)}.` };
  if (subject.role === "admin" && adminCount <= 1) {
    return { allowed: false, reason: "This is the last admin. Make someone else an admin first." };
  }
  return ALLOWED;
}

function articleRole(role: UserRole): string {
  return role === "admin" ? "an admin" : role === "moderator" ? "a moderator" : "a regular user";
}

// ---------------------------------------------------------------------------------------------------
// Suspensions
// ---------------------------------------------------------------------------------------------------

export const SUSPENSION_DURATION_KEYS = ["24h", "72h", "7d", "30d", "indefinite"] as const;
export type SuspensionDurationKey = (typeof SUSPENSION_DURATION_KEYS)[number];

/** Durations offered to moderators. `null` hours = indefinite (admin only). */
export const SUSPENSION_DURATIONS: ReadonlyArray<{ key: SuspensionDurationKey; hours: number | null; label: string }> = [
  { key: "24h", hours: 24, label: "24 hours" },
  { key: "72h", hours: 72, label: "3 days" },
  { key: "7d", hours: 168, label: "7 days" },
  { key: "30d", hours: 720, label: "30 days" },
  { key: "indefinite", hours: null, label: "Until an admin lifts it" },
];

export function suspensionHours(key: SuspensionDurationKey): number | null {
  return SUSPENSION_DURATIONS.find((d) => d.key === key)?.hours ?? null;
}

export function canSuspendFor(actor: Actor, key: SuspensionDurationKey): Permission {
  if (key === "indefinite" && actor.role !== "admin") {
    return { allowed: false, reason: "Only admins can suspend without an end date." };
  }
  return ALLOWED;
}

// ---------------------------------------------------------------------------------------------------
// Admin sections (least privilege, PRD §15: content moderation separate from AI evaluation admin)
// ---------------------------------------------------------------------------------------------------

export const SECTION_ROLE = {
  overview: "moderator",
  reports: "moderator",
  users: "moderator",
  competitions: "moderator",
  evaluations: "admin",
  audit: "admin",
} as const satisfies Record<string, Exclude<UserRole, "user">>;

// ---------------------------------------------------------------------------------------------------
// Notification copy for the person affected (plain, non-accusatory, no moderator identity)
// ---------------------------------------------------------------------------------------------------

export function describeActionForAuthor(
  action: ModerationActionType,
  targetType: ReportTarget | "user",
  reason: ReportReason,
): string {
  const what = targetType === "user" ? "your account" : `your ${TARGET_LABEL[targetType]}`;
  const why = REASON_INFO[reason].label.toLowerCase();
  switch (action) {
    case "hide":
      return `A moderator hid ${what} for ${why}.`;
    case "remove":
      return targetType === "profile"
        ? `A moderator cleared your bio and photo for ${why}.`
        : `A moderator removed ${what} for ${why}.`;
    case "restore":
      return `A moderator restored ${what}.`;
    case "warn":
      return `You received a warning for ${why}. Repeated problems can lead to a suspension.`;
    case "suspend":
      return `Your account was suspended for ${why}. You can still read, but not post.`;
    case "unsuspend":
      return "Your suspension was lifted. You can post again.";
    case "dismiss_report":
      return "";
  }
}

// ---------------------------------------------------------------------------------------------------
// What the admin UI offers (mirrors the server checks so staff never see a button that will fail)
// ---------------------------------------------------------------------------------------------------

export type PanelAction = ContentAction | AccountAction | "dismiss";

export interface PanelContext {
  actor: Actor;
  author: Subject & { status: "active" | "suspended" | "deleted"; suspended: boolean };
  /** Omit for account-only panels (user page). */
  target?: TargetState;
  /** The report being handled, if any. */
  report?: { open: boolean; reporterId: string | null };
}

export function panelActions(ctx: PanelContext): { actions: PanelAction[]; restriction: string | null } {
  const permission = canModerate(ctx.actor, ctx.author);
  const actions: PanelAction[] = [];
  const reportHandleable = ctx.report?.open === true && ctx.report.reporterId !== ctx.actor.id;
  if (!permission.allowed) {
    return { actions: [], restriction: permission.reason };
  }
  if (ctx.target) actions.push(...allowedContentActions(ctx.target));
  if (ctx.author.status !== "deleted") {
    actions.push("warn");
    actions.push(ctx.author.suspended ? "unsuspend" : "suspend");
    // A lapsed suspension still shows as status 'suspended' until the cron tidies it; offer suspend again.
    if (!ctx.author.suspended && ctx.author.status === "suspended") actions.push("unsuspend");
  }
  if (reportHandleable) actions.push("dismiss");
  const restriction = ctx.report?.open && !reportHandleable ? "You filed this report, so another moderator must handle it." : null;
  return { actions: ctx.report?.open && !reportHandleable ? [] : actions, restriction };
}

// ---------------------------------------------------------------------------------------------------
// Competitions (cancel itself is the challenges team's adminCancelCompetition)
// ---------------------------------------------------------------------------------------------------

/** Statuses the challenges state machine lets an admin cancel from (mirrors its admin_cancel spec). */
export const ADMIN_CANCELLABLE_STATUSES = ["pending_acceptance", "active", "locked", "needs_review"] as const satisfies readonly CompetitionStatus[];

export function canAdminCancel(status: CompetitionStatus): boolean {
  return (ADMIN_CANCELLABLE_STATUSES as readonly CompetitionStatus[]).includes(status);
}
