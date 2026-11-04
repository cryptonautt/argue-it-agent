/**
 * ARGUE IT v1 — complete database schema (design.md §5.3). Owned by Foundation and FROZEN:
 * other teams request changes in docs/requests.md instead of editing this file.
 *
 * Conventions: uuid ids (gen_random_uuid()), timestamptz everywhere (UTC), snake_case columns,
 * camelCase TypeScript keys. Length limits are enforced both by zod (UX) and CHECK constraints (truth).
 */
import { relations, sql, type SQL } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  InjectionFinding,
  NotificationData,
  RubricCriterion,
  RulesSnapshot,
  TokenUsage,
  VerdictExplanation,
  VerdictScores,
} from "./json-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tstz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tstz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const id = () => uuid("id").primaryKey().defaultRandom();

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", ["user", "moderator", "admin"]);
export const userStatusEnum = pgEnum("user_status", ["active", "suspended", "deleted"]);
export const contentStatusEnum = pgEnum("content_status", ["visible", "hidden", "removed"]);
export const positionSideEnum = pgEnum("position_side", ["AGREE", "AGAINST"]);
export const competitionSideEnum = pgEnum("competition_side", ["FOR", "AGAINST"]);
export const competitionFormatEnum = pgEnum("competition_format", ["direct_v1"]);
export const competitionStatusEnum = pgEnum("competition_status", [
  "pending_acceptance",
  "declined",
  "expired",
  "withdrawn",
  "active",
  "locked",
  "evaluating",
  "under_appeal",
  "completed",
  "cancelled",
  "needs_review",
]);
export const competitionRoundEnum = pgEnum("competition_round", ["opening", "rebuttal"]);
export const participantRoleEnum = pgEnum("participant_role", ["challenger", "recipient"]);
export const acceptanceStatusEnum = pgEnum("acceptance_status", ["pending", "accepted", "declined"]);
export const rubricStatusEnum = pgEnum("rubric_status", ["draft", "active", "retired"]);
export const evaluationReasonEnum = pgEnum("evaluation_reason", ["close", "appeal"]);
export const evaluationJobStatusEnum = pgEnum("evaluation_job_status", ["queued", "running", "done", "failed"]);
export const evaluationRunStatusEnum = pgEnum("evaluation_run_status", [
  "running",
  "succeeded",
  "needs_review",
  "failed",
]);
export const passOrderEnum = pgEnum("pass_order", ["AB", "BA"]);
export const verdictOutcomeEnum = pgEnum("verdict_outcome", ["A", "B", "draw", "inconclusive", "forfeit"]);
/** `system` = decided by a published rule with no judging at all (no-show forfeit, design §4.2). */
export const decidedByEnum = pgEnum("decided_by", ["ai", "human", "system"]);
export const appealGroundEnum = pgEnum("appeal_ground", [
  "evidence_overlooked",
  "factual_error",
  "wrong_rubric",
  "submission_excluded",
  "technical_failure",
]);
export const appealStatusEnum = pgEnum("appeal_status", ["open", "upheld", "reevaluated", "overturned"]);
export const reactionTargetEnum = pgEnum("reaction_target", ["argument", "comment"]);
export const reactionTypeEnum = pgEnum("reaction_type", ["fire", "facts", "funny", "respect"]);
export const reportTargetEnum = pgEnum("report_target", ["argument", "comment", "profile", "submission"]);
export const reportReasonEnum = pgEnum("report_reason", [
  "spam",
  "harassment",
  "hate",
  "threats",
  "doxxing",
  "impersonation",
  "malicious_link",
  "prompt_injection",
  "other",
]);
export const reportStatusEnum = pgEnum("report_status", ["open", "actioned", "dismissed"]);
export const moderationActionEnum = pgEnum("moderation_action", [
  "hide",
  "remove",
  "restore",
  "warn",
  "suspend",
  "unsuspend",
  "dismiss_report",
]);
export const reputationEventKindEnum = pgEnum("reputation_event_kind", ["result", "reversal"]);
export const idempotencyStatusEnum = pgEnum("idempotency_status", ["pending", "completed"]);

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type ContentStatus = (typeof contentStatusEnum.enumValues)[number];
export type PositionSide = (typeof positionSideEnum.enumValues)[number];
export type CompetitionSide = (typeof competitionSideEnum.enumValues)[number];
export type CompetitionStatus = (typeof competitionStatusEnum.enumValues)[number];
export type CompetitionRound = (typeof competitionRoundEnum.enumValues)[number];
export type VerdictOutcome = (typeof verdictOutcomeEnum.enumValues)[number];
export type AppealGround = (typeof appealGroundEnum.enumValues)[number];
export type AppealStatus = (typeof appealStatusEnum.enumValues)[number];
export type ReactionTarget = (typeof reactionTargetEnum.enumValues)[number];
export type ReactionType = (typeof reactionTypeEnum.enumValues)[number];
export type ReportTarget = (typeof reportTargetEnum.enumValues)[number];
export type ReportReason = (typeof reportReasonEnum.enumValues)[number];
export type ModerationActionType = (typeof moderationActionEnum.enumValues)[number];
export type DecidedBy = (typeof decidedByEnum.enumValues)[number];

/** Notification types (text column so new types need no migration — add here + render in NotificationBell). */
export const NOTIFICATION_TYPES = [
  "comment_reply",
  "argument_comment",
  "mention",
  "follow",
  "challenge_received",
  "challenge_accepted",
  "challenge_declined",
  "challenge_expired",
  "challenge_withdrawn",
  "cancel_requested",
  "competition_cancelled",
  "round_opened",
  "opponent_locked",
  "deadline_soon",
  "forfeit",
  "verdict_ready",
  "needs_review",
  "appeal_filed",
  "appeal_decided",
  "moderation_warning",
  "moderation_action",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** What a notification/audit row points at. */
export const TARGET_TYPES = [
  "user",
  "profile",
  "argument",
  "comment",
  "competition",
  "submission",
  "verdict",
  "appeal",
  "report",
  "category",
  "rubric",
  "evaluation_job",
] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

// ---------------------------------------------------------------------------
// Users (ARGUE IT profile/role table, keyed by email). The framework's Better Auth owns sign-in and
// sessions, so the reference `sessions`, `accounts` and `verifications` tables are not ported (Task 2).
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // ARGUE IT role/moderation state
    role: userRoleEnum("role").notNull().default("user"),
    status: userStatusEnum("status").notNull().default("active"),
    suspendedUntil: tstz("suspended_until"),
  },
  (t) => [index("users_role_idx").on(t.role), index("users_status_idx").on(t.status)],
);

// ---------------------------------------------------------------------------
// Profiles & social graph
// ---------------------------------------------------------------------------

export const profiles = pgTable(
  "profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Lowercase, ^[a-z0-9_]{3,20}$ (see src/lib/handles.ts). */
    handle: text("handle").notNull().unique(),
    displayName: text("display_name").notNull(),
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    /** Category slugs picked during onboarding (/welcome); a For You signal. */
    interests: jsonb("interests").$type<string[]>().notNull().default([]),
    /**
     * Per-type opt-outs for in-app notifications: `{ follow: false }` mutes follows. Only the social types in
     * MUTABLE_NOTIFICATION_TYPES (src/server/notifications) can be muted; challenge, verdict, appeal and
     * moderation notifications are always delivered.
     */
    notificationPrefs: jsonb("notification_prefs").$type<Partial<Record<NotificationType, boolean>>>().notNull().default({}),
    onboardedAt: tstz("onboarded_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("profiles_handle_format", sql`${t.handle} ~ '^[a-z0-9_]{3,20}$'`),
    check("profiles_display_name_len", sql`char_length(${t.displayName}) between 1 and 50`),
    check("profiles_bio_len", sql`${t.bio} is null or char_length(${t.bio}) <= 280`),
  ],
);

export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followingId: uuid("following_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followingId] }),
    index("follows_following_idx").on(t.followingId),
    check("follows_not_self", sql`${t.followerId} <> ${t.followingId}`),
  ],
);

export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index("blocks_blocked_idx").on(t.blockedId),
    check("blocks_not_self", sql`${t.blockerId} <> ${t.blockedId}`),
  ],
);

// ---------------------------------------------------------------------------
// Categories & arguments
// ---------------------------------------------------------------------------

export const categories = pgTable("categories", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** Rubric id (e.g. "sports"); the version is pinned per competition in rules_snapshot. */
  rubricId: text("rubric_id").notNull(),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
});

export const argumentsTable = pgTable(
  "arguments",
  {
    id: id(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    parentArgumentId: uuid("parent_argument_id"),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    title: text("title").notNull(),
    proposition: text("proposition").notNull(),
    body: text("body").notNull(),
    links: jsonb("links").$type<string[]>().notNull().default([]),
    status: contentStatusEnum("status").notNull().default("visible"),
    createdAt: createdAt(),
    editedAt: tstz("edited_at"),
    /** Set when engagement/competition locks editing of the proposition. */
    lockedAt: tstz("locked_at"),
    /** Polymarket event slug this argument debates (set at creation from /markets/<slug>); null otherwise. */
    polymarketEventSlug: text("polymarket_event_slug"),
    /** Full-text search vector (maintained by Postgres). Query with websearch_to_tsquery('english', q). */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(proposition, '')), 'B') || setweight(to_tsvector('english', coalesce(body, '')), 'C')`,
    ),
  },
  (t) => [
    index("arguments_status_created_idx").on(t.status, t.createdAt.desc()),
    index("arguments_category_created_idx").on(t.categoryId, t.createdAt.desc()),
    index("arguments_author_created_idx").on(t.authorId, t.createdAt.desc()),
    index("arguments_parent_idx").on(t.parentArgumentId),
    foreignKey({ name: "arguments_parent_fk", columns: [t.parentArgumentId], foreignColumns: [t.id] }),
    index("arguments_search_idx").using("gin", t.searchVector),
    index("arguments_market_created_idx").on(t.polymarketEventSlug, t.createdAt.desc()),
    check("arguments_title_len", sql`char_length(${t.title}) between 1 and 120`),
    check("arguments_proposition_len", sql`char_length(${t.proposition}) between 1 and 280`),
    check("arguments_body_len", sql`char_length(${t.body}) between 1 and 5000`),
  ],
);

export const argumentPositions = pgTable(
  "argument_positions",
  {
    id: id(),
    argumentId: uuid("argument_id")
      .notNull()
      .references(() => argumentsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    side: positionSideEnum("side").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("argument_positions_argument_user_uq").on(t.argumentId, t.userId),
    index("argument_positions_argument_side_idx").on(t.argumentId, t.side),
    index("argument_positions_user_idx").on(t.userId),
    index("argument_positions_updated_idx").on(t.updatedAt),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: id(),
    argumentId: uuid("argument_id")
      .notNull()
      .references(() => argumentsTable.id, { onDelete: "cascade" }),
    /** Top-level parent only (replies are one level deep). */
    parentCommentId: uuid("parent_comment_id"),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    positionTag: positionSideEnum("position_tag"),
    status: contentStatusEnum("status").notNull().default("visible"),
    createdAt: createdAt(),
    editedAt: tstz("edited_at"),
  },
  (t) => [
    index("comments_argument_created_idx").on(t.argumentId, t.createdAt),
    index("comments_parent_idx").on(t.parentCommentId),
    foreignKey({ name: "comments_parent_fk", columns: [t.parentCommentId], foreignColumns: [t.id] }),
    index("comments_author_idx").on(t.authorId, t.createdAt.desc()),
    index("comments_created_idx").on(t.createdAt),
    check("comments_body_len", sql`char_length(${t.body}) between 1 and 2000`),
  ],
);

export const reactions = pgTable(
  "reactions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: reactionTargetEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    type: reactionTypeEnum("type").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("reactions_user_target_type_uq").on(t.userId, t.targetType, t.targetId, t.type),
    index("reactions_target_idx").on(t.targetType, t.targetId),
    index("reactions_created_idx").on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Competitions (direct challenges)
// ---------------------------------------------------------------------------

export const competitions = pgTable(
  "competitions",
  {
    id: id(),
    rootArgumentId: uuid("root_argument_id")
      .notNull()
      .references(() => argumentsTable.id),
    sourceCommentId: uuid("source_comment_id").references(() => comments.id),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    format: competitionFormatEnum("format").notNull().default("direct_v1"),
    status: competitionStatusEnum("status").notNull().default("pending_acceptance"),
    /** Only meaningful while status = 'active'. */
    round: competitionRoundEnum("round"),
    rulesSnapshot: jsonb("rules_snapshot").$type<RulesSnapshot>().notNull(),
    /** sha256 hex of the canonical rules_snapshot JSON; accept must submit the same hash. */
    termsHash: text("terms_hash").notNull(),
    rubricId: text("rubric_id").notNull(),
    rubricVersion: integer("rubric_version").notNull(),
    sentAt: tstz("sent_at").notNull().defaultNow(),
    acceptDeadline: tstz("accept_deadline").notNull(),
    acceptedAt: tstz("accepted_at"),
    openingClosesAt: tstz("opening_closes_at"),
    rebuttalClosesAt: tstz("rebuttal_closes_at"),
    lockedAt: tstz("locked_at"),
    completedAt: tstz("completed_at"),
    cancelledAt: tstz("cancelled_at"),
    cancelReason: text("cancel_reason"),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    declineReason: text("decline_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("competitions_status_idx").on(t.status),
    index("competitions_accept_deadline_idx").on(t.status, t.acceptDeadline),
    index("competitions_opening_closes_idx").on(t.status, t.openingClosesAt),
    index("competitions_rebuttal_closes_idx").on(t.status, t.rebuttalClosesAt),
    index("competitions_root_argument_idx").on(t.rootArgumentId),
    index("competitions_creator_idx").on(t.creatorId),
    index("competitions_category_idx").on(t.categoryId),
  ],
);

export const competitionParticipants = pgTable(
  "competition_participants",
  {
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    side: competitionSideEnum("side").notNull(),
    role: participantRoleEnum("role").notNull(),
    acceptanceStatus: acceptanceStatusEnum("acceptance_status").notNull().default("pending"),
    acceptedAt: tstz("accepted_at"),
    cancelRequestedAt: tstz("cancel_requested_at"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.competitionId, t.userId] }),
    unique("competition_participants_side_uq").on(t.competitionId, t.side),
    unique("competition_participants_role_uq").on(t.competitionId, t.role),
    index("competition_participants_user_idx").on(t.userId),
  ],
);

export const submissions = pgTable(
  "submissions",
  {
    id: id(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    side: competitionSideEnum("side").notNull(),
    round: competitionRoundEnum("round").notNull(),
    body: text("body").notNull(),
    links: jsonb("links").$type<string[]>().notNull().default([]),
    /** Display moderation only — never affects judging (design §4.7). */
    status: contentStatusEnum("status").notNull().default("visible"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lockedAt: tstz("locked_at"),
  },
  (t) => [
    unique("submissions_competition_author_round_uq").on(t.competitionId, t.authorId, t.round),
    index("submissions_competition_idx").on(t.competitionId),
    check("submissions_body_len", sql`char_length(${t.body}) <= 4000`),
  ],
);

// ---------------------------------------------------------------------------
// Judging
// ---------------------------------------------------------------------------

/** Mirror of the code rubrics in src/server/judging/rubrics/ (code is the source of truth). */
export const rubrics = pgTable(
  "rubrics",
  {
    id: text("id").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    categorySlugs: jsonb("category_slugs").$type<string[]>().notNull().default([]),
    criteria: jsonb("criteria").$type<RubricCriterion[]>().notNull(),
    status: rubricStatusEnum("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.id, t.version] })],
);

export const evaluationJobs = pgTable(
  "evaluation_jobs",
  {
    id: id(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    reason: evaluationReasonEnum("reason").notNull(),
    status: evaluationJobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: tstz("run_after").notNull().defaultNow(),
    /** Set when a worker claims the job; used to recover jobs stuck in 'running'. */
    claimedAt: tstz("claimed_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: tstz("finished_at"),
  },
  (t) => [
    index("evaluation_jobs_status_run_after_idx").on(t.status, t.runAfter),
    index("evaluation_jobs_competition_idx").on(t.competitionId),
    // At most one live job per competition (prevents double-enqueue races).
    uniqueIndex("evaluation_jobs_one_live_per_competition")
      .on(t.competitionId)
      .where(sql`${t.status} in ('queued', 'running')`),
  ],
);

/** One full evaluation attempt (2–3 passes + comparison) for a competition. */
export const evaluationRuns = pgTable(
  "evaluation_runs",
  {
    id: id(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => evaluationJobs.id),
    reason: evaluationReasonEnum("reason").notNull(),
    status: evaluationRunStatusEnum("status").notNull().default("running"),
    rubricId: text("rubric_id").notNull(),
    rubricVersion: integer("rubric_version").notNull(),
    /** sha256 of the canonical blind case file. */
    caseHash: text("case_hash").notNull(),
    injectionFindings: jsonb("injection_findings").$type<InjectionFinding[]>().notNull().default([]),
    /** Output of comparePasses() (decision + per-pass totals). */
    comparison: jsonb("comparison").$type<unknown>(),
    error: text("error"),
    startedAt: tstz("started_at").notNull().defaultNow(),
    finishedAt: tstz("finished_at"),
  },
  (t) => [index("evaluation_runs_competition_idx").on(t.competitionId, t.startedAt.desc())],
);

export const evaluationPasses = pgTable(
  "evaluation_passes",
  {
    id: id(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    evaluationRunId: uuid("evaluation_run_id")
      .notNull()
      .references(() => evaluationRuns.id, { onDelete: "cascade" }),
    passNo: integer("pass_no").notNull(),
    order: passOrderEnum("order").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    rubricId: text("rubric_id").notNull(),
    rubricVersion: integer("rubric_version").notNull(),
    caseHash: text("case_hash").notNull(),
    /** Raw structured output exactly as returned (validated on read). Null if the pass failed. */
    output: jsonb("output").$type<unknown>(),
    confidence: real("confidence"),
    invalidQuoteCount: integer("invalid_quote_count").notNull().default(0),
    usage: jsonb("usage").$type<TokenUsage>(),
    latencyMs: integer("latency_ms"),
    stopReason: text("stop_reason"),
    error: text("error"),
    startedAt: tstz("started_at").notNull().defaultNow(),
    finishedAt: tstz("finished_at"),
  },
  (t) => [
    unique("evaluation_passes_run_pass_uq").on(t.evaluationRunId, t.passNo),
    index("evaluation_passes_competition_idx").on(t.competitionId),
  ],
);

export const verdicts = pgTable(
  "verdicts",
  {
    id: id(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    /** Null for forfeits and human-decided verdicts without a run. */
    runId: uuid("run_id").references(() => evaluationRuns.id),
    version: integer("version").notNull().default(1),
    outcome: verdictOutcomeEnum("outcome").notNull(),
    winnerUserId: uuid("winner_user_id").references(() => users.id),
    scores: jsonb("scores").$type<VerdictScores>(),
    explanation: jsonb("explanation").$type<VerdictExplanation>(),
    /** 0–1; null for forfeits. */
    confidence: real("confidence"),
    isCurrent: boolean("is_current").notNull().default(true),
    decidedBy: decidedByEnum("decided_by").notNull().default("ai"),
    reviewerId: uuid("reviewer_id").references(() => users.id),
    reviewNote: text("review_note"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("verdicts_competition_version_uq").on(t.competitionId, t.version),
    uniqueIndex("verdicts_one_current_per_competition")
      .on(t.competitionId)
      .where(sql`${t.isCurrent}`),
    index("verdicts_created_idx").on(t.createdAt.desc()),
  ],
);

export const appeals = pgTable(
  "appeals",
  {
    id: id(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    verdictId: uuid("verdict_id")
      .notNull()
      .references(() => verdicts.id),
    appellantId: uuid("appellant_id")
      .notNull()
      .references(() => users.id),
    ground: appealGroundEnum("ground").notNull(),
    text: text("text").notNull(),
    status: appealStatusEnum("status").notNull().default("open"),
    reviewerId: uuid("reviewer_id").references(() => users.id),
    decisionNote: text("decision_note"),
    decidedAt: tstz("decided_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("appeals_one_per_participant_uq").on(t.competitionId, t.appellantId),
    index("appeals_status_created_idx").on(t.status, t.createdAt),
    check("appeals_text_len", sql`char_length(${t.text}) between 1 and 1000`),
  ],
);

// ---------------------------------------------------------------------------
// Reputation
// ---------------------------------------------------------------------------

export const reputationEvents = pgTable(
  "reputation_events",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competitions.id),
    verdictId: uuid("verdict_id").references(() => verdicts.id),
    /** Null = overall rating; otherwise the category rating. */
    categoryId: uuid("category_id").references(() => categories.id),
    kind: reputationEventKindEnum("kind").notNull().default("result"),
    /** 1 win / 0.5 draw / 0 loss. */
    score: real("score").notNull(),
    /** 1 normally, 0.5 for forfeits. */
    weight: real("weight").notNull().default(1),
    ratingBefore: doublePrecision("rating_before").notNull(),
    ratingAfter: doublePrecision("rating_after").notNull(),
    rdBefore: doublePrecision("rd_before").notNull(),
    rdAfter: doublePrecision("rd_after").notNull(),
    volatilityBefore: doublePrecision("volatility_before").notNull(),
    volatilityAfter: doublePrecision("volatility_after").notNull(),
    delta: doublePrecision("delta").notNull(),
    /** For kind = 'reversal': the event being reversed. */
    reversesEventId: uuid("reverses_event_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("reputation_events_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("reputation_events_competition_idx").on(t.competitionId),
  ],
);

export const userRatings = pgTable(
  "user_ratings",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null = overall. */
    categoryId: uuid("category_id").references(() => categories.id),
    rating: doublePrecision("rating").notNull().default(1500),
    rd: doublePrecision("rd").notNull().default(350),
    volatility: doublePrecision("volatility").notNull().default(0.06),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    draws: integer("draws").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("user_ratings_user_category_uq").on(t.userId, t.categoryId).nullsNotDistinct(),
    index("user_ratings_category_rating_idx").on(t.categoryId, t.rating.desc()),
  ],
);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  // SQL name prefixed: the framework already owns a `notifications` table (port Task 1 Step 0).
  "ai_notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<NotificationType>().notNull(),
    targetType: text("target_type").$type<TargetType>().notNull(),
    targetId: uuid("target_id").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    data: jsonb("data").$type<NotificationData>().notNull().default({}),
    readAt: tstz("read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("notifications_user_unread_idx")
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
    index("notifications_dedupe_idx").on(t.userId, t.type, t.targetId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Moderation, audit, infrastructure
// ---------------------------------------------------------------------------

export const reports = pgTable(
  "reports",
  {
    id: id(),
    /** Null for automatic reports (e.g. prompt-injection pre-scan). */
    reporterId: uuid("reporter_id").references(() => users.id),
    targetType: reportTargetEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    reason: reportReasonEnum("reason").notNull(),
    details: text("details"),
    isAutomatic: boolean("is_automatic").notNull().default(false),
    status: reportStatusEnum("status").notNull().default("open"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: tstz("resolved_at"),
    resolutionNote: text("resolution_note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("reports_status_created_idx").on(t.status, t.createdAt),
    index("reports_target_idx").on(t.targetType, t.targetId),
    // One open report per reporter per target.
    uniqueIndex("reports_one_open_per_reporter_target")
      .on(t.reporterId, t.targetType, t.targetId)
      .where(sql`${t.status} = 'open' and ${t.reporterId} is not null`),
    check("reports_details_len", sql`${t.details} is null or char_length(${t.details}) <= 1000`),
  ],
);

export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: id(),
    moderatorId: uuid("moderator_id")
      .notNull()
      .references(() => users.id),
    action: moderationActionEnum("action").notNull(),
    targetType: text("target_type").$type<ReportTarget | "user">().notNull(),
    targetId: uuid("target_id").notNull(),
    reportId: uuid("report_id").references(() => reports.id),
    reasonCode: reportReasonEnum("reason_code").notNull(),
    note: text("note"),
    /** For suspensions. */
    durationHours: integer("duration_hours"),
    expiresAt: tstz("expires_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("moderation_actions_target_idx").on(t.targetType, t.targetId),
    index("moderation_actions_created_idx").on(t.createdAt.desc()),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    /** Null = system (cron, judge, automatic). */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    /** Dotted verb, e.g. "competition.accept", "moderation.suspend", "verdict.override". */
    action: text("action").notNull(),
    targetType: text("target_type").$type<TargetType>().notNull(),
    targetId: text("target_id").notNull(),
    before: jsonb("before").$type<unknown>(),
    after: jsonb("after").$type<unknown>(),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt.desc()),
    index("audit_logs_target_idx").on(t.targetType, t.targetId),
    index("audit_logs_actor_idx").on(t.actorId, t.createdAt.desc()),
    index("audit_logs_action_idx").on(t.action),
  ],
);

export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("rate_limit_hits_user_action_created_idx").on(t.userId, t.action, t.createdAt)],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: id(),
    key: text("key").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    status: idempotencyStatusEnum("status").notNull().default("pending"),
    result: jsonb("result").$type<unknown>(),
    createdAt: createdAt(),
    completedAt: tstz("completed_at"),
  },
  (t) => [
    unique("idempotency_keys_user_key_uq").on(t.userId, t.key),
    index("idempotency_keys_created_idx").on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Relations (for db.query.* relational queries)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles, { fields: [users.id], references: [profiles.userId] }),
  arguments: many(argumentsTable),
  ratings: many(userRatings),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, { fields: [profiles.userId], references: [users.id] }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  arguments: many(argumentsTable),
}));

export const argumentsRelations = relations(argumentsTable, ({ one, many }) => ({
  author: one(users, { fields: [argumentsTable.authorId], references: [users.id] }),
  authorProfile: one(profiles, { fields: [argumentsTable.authorId], references: [profiles.userId] }),
  category: one(categories, { fields: [argumentsTable.categoryId], references: [categories.id] }),
  parent: one(argumentsTable, {
    fields: [argumentsTable.parentArgumentId],
    references: [argumentsTable.id],
    relationName: "argument_parent",
  }),
  children: many(argumentsTable, { relationName: "argument_parent" }),
  positions: many(argumentPositions),
  comments: many(comments),
  competitions: many(competitions),
}));

export const argumentPositionsRelations = relations(argumentPositions, ({ one }) => ({
  argument: one(argumentsTable, { fields: [argumentPositions.argumentId], references: [argumentsTable.id] }),
  user: one(users, { fields: [argumentPositions.userId], references: [users.id] }),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  argument: one(argumentsTable, { fields: [comments.argumentId], references: [argumentsTable.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
  authorProfile: one(profiles, { fields: [comments.authorId], references: [profiles.userId] }),
  parent: one(comments, {
    fields: [comments.parentCommentId],
    references: [comments.id],
    relationName: "comment_parent",
  }),
  replies: many(comments, { relationName: "comment_parent" }),
}));

export const competitionsRelations = relations(competitions, ({ one, many }) => ({
  rootArgument: one(argumentsTable, { fields: [competitions.rootArgumentId], references: [argumentsTable.id] }),
  sourceComment: one(comments, { fields: [competitions.sourceCommentId], references: [comments.id] }),
  creator: one(users, { fields: [competitions.creatorId], references: [users.id] }),
  category: one(categories, { fields: [competitions.categoryId], references: [categories.id] }),
  participants: many(competitionParticipants),
  submissions: many(submissions),
  verdicts: many(verdicts),
  appeals: many(appeals),
  evaluationJobs: many(evaluationJobs),
  evaluationRuns: many(evaluationRuns),
}));

export const competitionParticipantsRelations = relations(competitionParticipants, ({ one }) => ({
  competition: one(competitions, {
    fields: [competitionParticipants.competitionId],
    references: [competitions.id],
  }),
  user: one(users, { fields: [competitionParticipants.userId], references: [users.id] }),
  profile: one(profiles, { fields: [competitionParticipants.userId], references: [profiles.userId] }),
}));

export const submissionsRelations = relations(submissions, ({ one }) => ({
  competition: one(competitions, { fields: [submissions.competitionId], references: [competitions.id] }),
  author: one(users, { fields: [submissions.authorId], references: [users.id] }),
}));

export const evaluationJobsRelations = relations(evaluationJobs, ({ one }) => ({
  competition: one(competitions, { fields: [evaluationJobs.competitionId], references: [competitions.id] }),
}));

export const evaluationRunsRelations = relations(evaluationRuns, ({ one, many }) => ({
  competition: one(competitions, { fields: [evaluationRuns.competitionId], references: [competitions.id] }),
  job: one(evaluationJobs, { fields: [evaluationRuns.jobId], references: [evaluationJobs.id] }),
  passes: many(evaluationPasses),
}));

export const evaluationPassesRelations = relations(evaluationPasses, ({ one }) => ({
  run: one(evaluationRuns, { fields: [evaluationPasses.evaluationRunId], references: [evaluationRuns.id] }),
  competition: one(competitions, { fields: [evaluationPasses.competitionId], references: [competitions.id] }),
}));

export const verdictsRelations = relations(verdicts, ({ one }) => ({
  competition: one(competitions, { fields: [verdicts.competitionId], references: [competitions.id] }),
  run: one(evaluationRuns, { fields: [verdicts.runId], references: [evaluationRuns.id] }),
  winner: one(users, { fields: [verdicts.winnerUserId], references: [users.id] }),
}));

export const appealsRelations = relations(appeals, ({ one }) => ({
  competition: one(competitions, { fields: [appeals.competitionId], references: [competitions.id] }),
  verdict: one(verdicts, { fields: [appeals.verdictId], references: [verdicts.id] }),
  appellant: one(users, { fields: [appeals.appellantId], references: [users.id] }),
}));

export const userRatingsRelations = relations(userRatings, ({ one }) => ({
  user: one(users, { fields: [userRatings.userId], references: [users.id] }),
  category: one(categories, { fields: [userRatings.categoryId], references: [categories.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  actor: one(users, { fields: [notifications.actorId], references: [users.id] }),
  actorProfile: one(profiles, { fields: [notifications.actorId], references: [profiles.userId] }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  reporter: one(users, { fields: [reports.reporterId], references: [users.id] }),
}));

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Argument = typeof argumentsTable.$inferSelect;
export type NewArgument = typeof argumentsTable.$inferInsert;
export type ArgumentPosition = typeof argumentPositions.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Reaction = typeof reactions.$inferSelect;
export type Competition = typeof competitions.$inferSelect;
export type CompetitionParticipant = typeof competitionParticipants.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type Rubric = typeof rubrics.$inferSelect;
export type EvaluationJob = typeof evaluationJobs.$inferSelect;
export type EvaluationRun = typeof evaluationRuns.$inferSelect;
export type EvaluationPass = typeof evaluationPasses.$inferSelect;
export type Verdict = typeof verdicts.$inferSelect;
export type Appeal = typeof appeals.$inferSelect;
export type ReputationEvent = typeof reputationEvents.$inferSelect;
export type UserRating = typeof userRatings.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type ModerationAction = typeof moderationActions.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;

// Agent-drafted moderation decisions (Task 8, owned by 7-moderator-agent).
export * from "../drafts/schema";
