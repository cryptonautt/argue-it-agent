/**
 * Agent-drafted moderation decisions (plan Task 8). The agent drafts; a human moderator approves.
 *
 * Re-exported from `@domain/db/schema` so it is part of the drizzle schema object and the generated migration.
 * Plain text columns + CHECK constraints (no new pg enums) keep the migration simple.
 */
import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const DRAFT_KINDS = ["appeal", "review"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const APPEAL_RECOMMENDATIONS = ["uphold", "reevaluate", "overturn"] as const;
export type AppealRecommendation = (typeof APPEAL_RECOMMENDATIONS)[number];

export const REVIEW_RECOMMENDATIONS = ["A", "B", "draw", "inconclusive", "retry"] as const;
export type ReviewRecommendation = (typeof REVIEW_RECOMMENDATIONS)[number];

export type DraftRecommendation = AppealRecommendation | ReviewRecommendation;

/** For an "overturn" appeal recommendation: the result the agent proposes instead. */
export const DRAFT_OUTCOMES = ["A", "B", "draw", "inconclusive"] as const;
export type DraftOutcome = (typeof DRAFT_OUTCOMES)[number];

export const DRAFT_CONFIDENCE = ["low", "medium", "high"] as const;
export type DraftConfidence = (typeof DRAFT_CONFIDENCE)[number];

export const DRAFT_STATUSES = ["draft", "approved", "discarded"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const DRAFT_NOTE_MAX = 1000;

export interface DraftCitation {
  side: "A" | "B";
  quote: string;
  criterion: string;
}

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const decisionDrafts = pgTable(
  "decision_drafts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    kind: text("kind").$type<DraftKind>().notNull(),
    /** appealId (kind = appeal) or competitionId (kind = review). */
    targetId: text("target_id").notNull(),
    recommendation: text("recommendation").$type<DraftRecommendation>().notNull(),
    /** Only for appeal "overturn": the outcome the agent proposes. */
    outcome: text("outcome").$type<DraftOutcome>(),
    note: text("note").notNull(),
    citations: jsonb("citations").$type<DraftCitation[]>().notNull().default([]),
    confidence: text("confidence").$type<DraftConfidence>().notNull(),
    status: text("status").$type<DraftStatus>().notNull().default("draft"),
    draftedByEmail: text("drafted_by_email").notNull(),
    /** users.id of the moderator who approved or discarded it. */
    decidedBy: text("decided_by"),
    edited: boolean("edited").notNull().default(false),
    createdAt: tstz("created_at").notNull().defaultNow(),
    decidedAt: tstz("decided_at"),
  },
  (t) => [
    uniqueIndex("decision_drafts_one_open_per_target")
      .on(t.kind, t.targetId)
      .where(sql`${t.status} = 'draft'`),
    index("decision_drafts_status_created_idx").on(t.status, t.createdAt),
    check("decision_drafts_kind_chk", sql`${t.kind} in ('appeal', 'review')`),
    check("decision_drafts_status_chk", sql`${t.status} in ('draft', 'approved', 'discarded')`),
    check("decision_drafts_confidence_chk", sql`${t.confidence} in ('low', 'medium', 'high')`),
    check(
      "decision_drafts_recommendation_chk",
      sql`(${t.kind} = 'appeal' and ${t.recommendation} in ('uphold', 'reevaluate', 'overturn')) or (${t.kind} = 'review' and ${t.recommendation} in ('A', 'B', 'draw', 'inconclusive', 'retry'))`,
    ),
    check(
      "decision_drafts_outcome_chk",
      sql`${t.outcome} is null or ${t.outcome} in ('A', 'B', 'draw', 'inconclusive')`,
    ),
    check("decision_drafts_note_len", sql`char_length(${t.note}) between 1 and 1000`),
  ],
);

export type DecisionDraft = typeof decisionDrafts.$inferSelect;
export type NewDecisionDraft = typeof decisionDrafts.$inferInsert;
