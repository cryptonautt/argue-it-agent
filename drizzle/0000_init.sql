CREATE TYPE "public"."acceptance_status" AS ENUM('pending', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."appeal_ground" AS ENUM('evidence_overlooked', 'factual_error', 'wrong_rubric', 'submission_excluded', 'technical_failure');--> statement-breakpoint
CREATE TYPE "public"."appeal_status" AS ENUM('open', 'upheld', 'reevaluated', 'overturned');--> statement-breakpoint
CREATE TYPE "public"."competition_format" AS ENUM('direct_v1');--> statement-breakpoint
CREATE TYPE "public"."competition_round" AS ENUM('opening', 'rebuttal');--> statement-breakpoint
CREATE TYPE "public"."competition_side" AS ENUM('FOR', 'AGAINST');--> statement-breakpoint
CREATE TYPE "public"."competition_status" AS ENUM('pending_acceptance', 'declined', 'expired', 'withdrawn', 'active', 'locked', 'evaluating', 'under_appeal', 'completed', 'cancelled', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('visible', 'hidden', 'removed');--> statement-breakpoint
CREATE TYPE "public"."decided_by" AS ENUM('ai', 'human', 'system');--> statement-breakpoint
CREATE TYPE "public"."evaluation_job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."evaluation_reason" AS ENUM('close', 'appeal');--> statement-breakpoint
CREATE TYPE "public"."evaluation_run_status" AS ENUM('running', 'succeeded', 'needs_review', 'failed');--> statement-breakpoint
CREATE TYPE "public"."idempotency_status" AS ENUM('pending', 'completed');--> statement-breakpoint
CREATE TYPE "public"."moderation_action" AS ENUM('hide', 'remove', 'restore', 'warn', 'suspend', 'unsuspend', 'dismiss_report');--> statement-breakpoint
CREATE TYPE "public"."participant_role" AS ENUM('challenger', 'recipient');--> statement-breakpoint
CREATE TYPE "public"."pass_order" AS ENUM('AB', 'BA');--> statement-breakpoint
CREATE TYPE "public"."position_side" AS ENUM('AGREE', 'AGAINST');--> statement-breakpoint
CREATE TYPE "public"."reaction_target" AS ENUM('argument', 'comment');--> statement-breakpoint
CREATE TYPE "public"."reaction_type" AS ENUM('fire', 'facts', 'funny', 'respect');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('spam', 'harassment', 'hate', 'threats', 'doxxing', 'impersonation', 'malicious_link', 'prompt_injection', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_target" AS ENUM('argument', 'comment', 'profile', 'submission');--> statement-breakpoint
CREATE TYPE "public"."reputation_event_kind" AS ENUM('result', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."rubric_status" AS ENUM('draft', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'moderator', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."verdict_outcome" AS ENUM('A', 'B', 'draw', 'inconclusive', 'forfeit');--> statement-breakpoint
CREATE TABLE "appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"verdict_id" uuid NOT NULL,
	"appellant_id" uuid NOT NULL,
	"ground" "appeal_ground" NOT NULL,
	"text" text NOT NULL,
	"status" "appeal_status" DEFAULT 'open' NOT NULL,
	"reviewer_id" uuid,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appeals_one_per_participant_uq" UNIQUE("competition_id","appellant_id"),
	CONSTRAINT "appeals_text_len" CHECK (char_length("appeals"."text") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "argument_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"argument_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"side" "position_side" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "argument_positions_argument_user_uq" UNIQUE("argument_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "arguments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_argument_id" uuid,
	"category_id" uuid NOT NULL,
	"title" text NOT NULL,
	"proposition" text NOT NULL,
	"body" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "content_status" DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(proposition, '')), 'B') || setweight(to_tsvector('english', coalesce(body, '')), 'C')) STORED,
	CONSTRAINT "arguments_title_len" CHECK (char_length("arguments"."title") between 1 and 120),
	CONSTRAINT "arguments_proposition_len" CHECK (char_length("arguments"."proposition") between 1 and 280),
	CONSTRAINT "arguments_body_len" CHECK (char_length("arguments"."body") between 1 and 5000)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "blocks_not_self" CHECK ("blocks"."blocker_id" <> "blocks"."blocked_id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rubric_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"argument_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"position_tag" "position_side",
	"status" "content_status" DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	CONSTRAINT "comments_body_len" CHECK (char_length("comments"."body") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "competition_participants" (
	"competition_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"side" "competition_side" NOT NULL,
	"role" "participant_role" NOT NULL,
	"acceptance_status" "acceptance_status" DEFAULT 'pending' NOT NULL,
	"accepted_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_participants_competition_id_user_id_pk" PRIMARY KEY("competition_id","user_id"),
	CONSTRAINT "competition_participants_side_uq" UNIQUE("competition_id","side"),
	CONSTRAINT "competition_participants_role_uq" UNIQUE("competition_id","role")
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root_argument_id" uuid NOT NULL,
	"source_comment_id" uuid,
	"creator_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"format" "competition_format" DEFAULT 'direct_v1' NOT NULL,
	"status" "competition_status" DEFAULT 'pending_acceptance' NOT NULL,
	"round" "competition_round",
	"rules_snapshot" jsonb NOT NULL,
	"terms_hash" text NOT NULL,
	"rubric_id" text NOT NULL,
	"rubric_version" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accept_deadline" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"opening_closes_at" timestamp with time zone,
	"rebuttal_closes_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"reason" "evaluation_reason" NOT NULL,
	"status" "evaluation_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "evaluation_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"evaluation_run_id" uuid NOT NULL,
	"pass_no" integer NOT NULL,
	"order" "pass_order" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"rubric_id" text NOT NULL,
	"rubric_version" integer NOT NULL,
	"case_hash" text NOT NULL,
	"output" jsonb,
	"confidence" real,
	"invalid_quote_count" integer DEFAULT 0 NOT NULL,
	"usage" jsonb,
	"latency_ms" integer,
	"stop_reason" text,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "evaluation_passes_run_pass_uq" UNIQUE("evaluation_run_id","pass_no")
);
--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"job_id" uuid,
	"reason" "evaluation_reason" NOT NULL,
	"status" "evaluation_run_status" DEFAULT 'running' NOT NULL,
	"rubric_id" text NOT NULL,
	"rubric_version" integer NOT NULL,
	"case_hash" text NOT NULL,
	"injection_findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comparison" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" uuid NOT NULL,
	"following_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_following_id_pk" PRIMARY KEY("follower_id","following_id"),
	CONSTRAINT "follows_not_self" CHECK ("follows"."follower_id" <> "follows"."following_id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"status" "idempotency_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "idempotency_keys_user_key_uq" UNIQUE("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"moderator_id" uuid NOT NULL,
	"action" "moderation_action" NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"report_id" uuid,
	"reason_code" "report_reason" NOT NULL,
	"note" text,
	"duration_hours" integer,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"actor_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"avatar_url" text,
	"interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_handle_unique" UNIQUE("handle"),
	CONSTRAINT "profiles_handle_format" CHECK ("profiles"."handle" ~ '^[a-z0-9_]{3,20}$'),
	CONSTRAINT "profiles_display_name_len" CHECK (char_length("profiles"."display_name") between 1 and 50),
	CONSTRAINT "profiles_bio_len" CHECK ("profiles"."bio" is null or char_length("profiles"."bio") <= 280)
);
--> statement-breakpoint
CREATE TABLE "rate_limit_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" "reaction_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"type" "reaction_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_user_target_type_uq" UNIQUE("user_id","target_type","target_id","type")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid,
	"target_type" "report_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" "report_reason" NOT NULL,
	"details" text,
	"is_automatic" boolean DEFAULT false NOT NULL,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_details_len" CHECK ("reports"."details" is null or char_length("reports"."details") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "reputation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"verdict_id" uuid,
	"category_id" uuid,
	"kind" "reputation_event_kind" DEFAULT 'result' NOT NULL,
	"score" real NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"rating_before" double precision NOT NULL,
	"rating_after" double precision NOT NULL,
	"rd_before" double precision NOT NULL,
	"rd_after" double precision NOT NULL,
	"volatility_before" double precision NOT NULL,
	"volatility_after" double precision NOT NULL,
	"delta" double precision NOT NULL,
	"reverses_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubrics" (
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"category_slugs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criteria" jsonb NOT NULL,
	"status" "rubric_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rubrics_id_version_pk" PRIMARY KEY("id","version")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"side" "competition_side" NOT NULL,
	"round" "competition_round" NOT NULL,
	"body" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "content_status" DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	CONSTRAINT "submissions_competition_author_round_uq" UNIQUE("competition_id","author_id","round"),
	CONSTRAINT "submissions_body_len" CHECK (char_length("submissions"."body") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "user_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid,
	"rating" double precision DEFAULT 1500 NOT NULL,
	"rd" double precision DEFAULT 350 NOT NULL,
	"volatility" double precision DEFAULT 0.06 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_ratings_user_category_uq" UNIQUE NULLS NOT DISTINCT("user_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"suspended_until" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verdicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"run_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"outcome" "verdict_outcome" NOT NULL,
	"winner_user_id" uuid,
	"scores" jsonb,
	"explanation" jsonb,
	"confidence" real,
	"is_current" boolean DEFAULT true NOT NULL,
	"decided_by" "decided_by" DEFAULT 'ai' NOT NULL,
	"reviewer_id" uuid,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verdicts_competition_version_uq" UNIQUE("competition_id","version")
);
--> statement-breakpoint
CREATE TABLE "decision_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	"recommendation" text NOT NULL,
	"outcome" text,
	"note" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"drafted_by_email" text NOT NULL,
	"decided_by" text,
	"edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "decision_drafts_kind_chk" CHECK ("decision_drafts"."kind" in ('appeal', 'review')),
	CONSTRAINT "decision_drafts_status_chk" CHECK ("decision_drafts"."status" in ('draft', 'approved', 'discarded')),
	CONSTRAINT "decision_drafts_confidence_chk" CHECK ("decision_drafts"."confidence" in ('low', 'medium', 'high')),
	CONSTRAINT "decision_drafts_recommendation_chk" CHECK (("decision_drafts"."kind" = 'appeal' and "decision_drafts"."recommendation" in ('uphold', 'reevaluate', 'overturn')) or ("decision_drafts"."kind" = 'review' and "decision_drafts"."recommendation" in ('A', 'B', 'draw', 'inconclusive', 'retry'))),
	CONSTRAINT "decision_drafts_outcome_chk" CHECK ("decision_drafts"."outcome" is null or "decision_drafts"."outcome" in ('A', 'B', 'draw', 'inconclusive')),
	CONSTRAINT "decision_drafts_note_len" CHECK (char_length("decision_drafts"."note") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_verdict_id_verdicts_id_fk" FOREIGN KEY ("verdict_id") REFERENCES "public"."verdicts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_appellant_id_users_id_fk" FOREIGN KEY ("appellant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "argument_positions" ADD CONSTRAINT "argument_positions_argument_id_arguments_id_fk" FOREIGN KEY ("argument_id") REFERENCES "public"."arguments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "argument_positions" ADD CONSTRAINT "argument_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arguments" ADD CONSTRAINT "arguments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arguments" ADD CONSTRAINT "arguments_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arguments" ADD CONSTRAINT "arguments_parent_fk" FOREIGN KEY ("parent_argument_id") REFERENCES "public"."arguments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_argument_id_arguments_id_fk" FOREIGN KEY ("argument_id") REFERENCES "public"."arguments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_participants" ADD CONSTRAINT "competition_participants_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_participants" ADD CONSTRAINT "competition_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_root_argument_id_arguments_id_fk" FOREIGN KEY ("root_argument_id") REFERENCES "public"."arguments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_source_comment_id_comments_id_fk" FOREIGN KEY ("source_comment_id") REFERENCES "public"."comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_jobs" ADD CONSTRAINT "evaluation_jobs_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_passes" ADD CONSTRAINT "evaluation_passes_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_passes" ADD CONSTRAINT "evaluation_passes_evaluation_run_id_evaluation_runs_id_fk" FOREIGN KEY ("evaluation_run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_job_id_evaluation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."evaluation_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_users_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_moderator_id_users_id_fk" FOREIGN KEY ("moderator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_notifications" ADD CONSTRAINT "ai_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_notifications" ADD CONSTRAINT "ai_notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limit_hits" ADD CONSTRAINT "rate_limit_hits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_events" ADD CONSTRAINT "reputation_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_events" ADD CONSTRAINT "reputation_events_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_events" ADD CONSTRAINT "reputation_events_verdict_id_verdicts_id_fk" FOREIGN KEY ("verdict_id") REFERENCES "public"."verdicts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_events" ADD CONSTRAINT "reputation_events_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ratings" ADD CONSTRAINT "user_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ratings" ADD CONSTRAINT "user_ratings_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_run_id_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_winner_user_id_users_id_fk" FOREIGN KEY ("winner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appeals_status_created_idx" ON "appeals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "argument_positions_argument_side_idx" ON "argument_positions" USING btree ("argument_id","side");--> statement-breakpoint
CREATE INDEX "argument_positions_user_idx" ON "argument_positions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "argument_positions_updated_idx" ON "argument_positions" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "arguments_status_created_idx" ON "arguments" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "arguments_category_created_idx" ON "arguments" USING btree ("category_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "arguments_author_created_idx" ON "arguments" USING btree ("author_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "arguments_parent_idx" ON "arguments" USING btree ("parent_argument_id");--> statement-breakpoint
CREATE INDEX "arguments_search_idx" ON "arguments" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "blocks_blocked_idx" ON "blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "comments_argument_created_idx" ON "comments" USING btree ("argument_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE INDEX "comments_author_idx" ON "comments" USING btree ("author_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "comments_created_idx" ON "comments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "competition_participants_user_idx" ON "competition_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "competitions_status_idx" ON "competitions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "competitions_accept_deadline_idx" ON "competitions" USING btree ("status","accept_deadline");--> statement-breakpoint
CREATE INDEX "competitions_opening_closes_idx" ON "competitions" USING btree ("status","opening_closes_at");--> statement-breakpoint
CREATE INDEX "competitions_rebuttal_closes_idx" ON "competitions" USING btree ("status","rebuttal_closes_at");--> statement-breakpoint
CREATE INDEX "competitions_root_argument_idx" ON "competitions" USING btree ("root_argument_id");--> statement-breakpoint
CREATE INDEX "competitions_creator_idx" ON "competitions" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "competitions_category_idx" ON "competitions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "evaluation_jobs_status_run_after_idx" ON "evaluation_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "evaluation_jobs_competition_idx" ON "evaluation_jobs" USING btree ("competition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_jobs_one_live_per_competition" ON "evaluation_jobs" USING btree ("competition_id") WHERE "evaluation_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "evaluation_passes_competition_idx" ON "evaluation_passes" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "evaluation_runs_competition_idx" ON "evaluation_runs" USING btree ("competition_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "follows_following_idx" ON "follows" USING btree ("following_id");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "moderation_actions_target_idx" ON "moderation_actions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "moderation_actions_created_idx" ON "moderation_actions" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "ai_notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "ai_notifications" USING btree ("user_id") WHERE "ai_notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_dedupe_idx" ON "ai_notifications" USING btree ("user_id","type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "rate_limit_hits_user_action_created_idx" ON "rate_limit_hits" USING btree ("user_id","action","created_at");--> statement-breakpoint
CREATE INDEX "reactions_target_idx" ON "reactions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "reactions_created_idx" ON "reactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "reports_status_created_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_one_open_per_reporter_target" ON "reports" USING btree ("reporter_id","target_type","target_id") WHERE "reports"."status" = 'open' and "reports"."reporter_id" is not null;--> statement-breakpoint
CREATE INDEX "reputation_events_user_created_idx" ON "reputation_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reputation_events_competition_idx" ON "reputation_events" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "submissions_competition_idx" ON "submissions" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "user_ratings_category_rating_idx" ON "user_ratings" USING btree ("category_id","rating" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "verdicts_one_current_per_competition" ON "verdicts" USING btree ("competition_id") WHERE "verdicts"."is_current";--> statement-breakpoint
CREATE INDEX "verdicts_created_idx" ON "verdicts" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "decision_drafts_one_open_per_target" ON "decision_drafts" USING btree ("kind","target_id") WHERE "decision_drafts"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "decision_drafts_status_created_idx" ON "decision_drafts" USING btree ("status","created_at");