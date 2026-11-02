/**
 * Owner: verdict. Read models for the verdict page, VerdictSummary, the share card and the admin queues.
 * Everything returned is plain JSON-friendly data (ISO strings for dates) ready to hand to components.
 */
import "server-only";

import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { now } from "@domain/lib/time";
import { hasRole, type SessionUser } from "@domain/auth";
import { db } from "@domain/db";
import type { ConfidenceLabel, SideLabel, VerdictExplanation, VerdictScores } from "@domain/db/json-types";
import {
  appeals,
  competitions,
  evaluationJobs,
  evaluationPasses,
  evaluationRuns,
  submissions,
  type AppealGround,
  type AppealStatus,
  type CompetitionStatus,
  type DecidedBy,
  type Verdict,
  type VerdictOutcome,
} from "@domain/db/schema";
import { getCurrentVerdict, getVerdictHistory, loadCompetitionCore, type CompetitionCore } from "./core";
import { getAppealEligibility, type AppealEligibility } from "./eligibility";
import { readComparison, readPassOutput, type ComparisonView, type PassOutputView } from "./pass-output";
import { appealGroundLabel } from "./rules";
import {
  confidenceLabelFor,
  describeOutcome,
  hideModeratedQuotes,
  type OutcomeView,
  type SidePair,
} from "./verdict-view";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface VerdictRecord {
  id: string;
  version: number;
  isCurrent: boolean;
  outcome: VerdictOutcome;
  outcomeView: OutcomeView;
  decidedBy: DecidedBy;
  confidence: number | null;
  confidenceLabel: ConfidenceLabel | null;
  scores: VerdictScores | null;
  explanation: VerdictExplanation | null;
  /** Quotes withheld because their submission was hidden by moderation. */
  hiddenQuoteCount: number;
  reviewNote: string | null;
  createdAt: string;
}

export interface AppealRecord {
  id: string;
  appellantSide: SideLabel;
  ground: AppealGround;
  groundLabel: string;
  status: AppealStatus;
  /** Only shown to the two participants and staff. */
  text: string | null;
  decisionNote: string | null;
  verdictId: string;
  createdAt: string;
  decidedAt: string | null;
}

export interface CompetitionHeader {
  competitionId: string;
  status: CompetitionStatus;
  proposition: string;
  category: { slug: string; name: string };
  argument: { id: string; title: string; removed: boolean } | null;
  sides: SidePair;
  rubric: { id: string; version: number };
}

export type SerializedEligibility =
  | { eligible: true; closesAt: string }
  | { eligible: false; reason: string; message: string; closesAt: string | null };

export interface VerdictPageData extends CompetitionHeader {
  current: VerdictRecord | null;
  /** Every verdict, newest version first (includes current). */
  history: VerdictRecord[];
  appeals: AppealRecord[];
  viewer: { userId: string | null; side: SideLabel | null; isStaff: boolean };
  eligibility: SerializedEligibility;
  /** A re-evaluation (appeal) is running; the current verdict may be replaced. */
  reevaluating: boolean;
}

function header(core: CompetitionCore): CompetitionHeader {
  const { competition } = core;
  return {
    competitionId: competition.id,
    status: competition.status,
    proposition: competition.rulesSnapshot.proposition,
    category: { slug: core.category.slug, name: core.category.name },
    argument: core.argument,
    sides: core.sides,
    rubric: { id: competition.rubricId, version: competition.rubricVersion },
  };
}

function serializeEligibility(e: AppealEligibility): SerializedEligibility {
  return e.eligible
    ? { eligible: true, closesAt: e.closesAt.toISOString() }
    : { eligible: false, reason: e.reason, message: e.message, closesAt: e.closesAt?.toISOString() ?? null };
}

function sanitizeExplanation(
  explanation: VerdictExplanation | null,
  hidden: { A: string[]; B: string[] },
): { explanation: VerdictExplanation | null; hiddenQuoteCount: number } {
  if (!explanation) return { explanation: null, hiddenQuoteCount: 0 };
  let hiddenQuoteCount = 0;
  const perCriterion = explanation.perCriterion.map((c) => {
    const a = hideModeratedQuotes(c.A.quotes, hidden.A);
    const b = hideModeratedQuotes(c.B.quotes, hidden.B);
    hiddenQuoteCount += a.hiddenCount + b.hiddenCount;
    return { ...c, A: { ...c.A, quotes: a.visible }, B: { ...c.B, quotes: b.visible } };
  });
  return { explanation: { ...explanation, perCriterion }, hiddenQuoteCount };
}

function toRecord(v: Verdict, sides: SidePair, hidden: { A: string[]; B: string[] }): VerdictRecord {
  const { explanation, hiddenQuoteCount } = sanitizeExplanation(v.explanation, hidden);
  return {
    id: v.id,
    version: v.version,
    isCurrent: v.isCurrent,
    outcome: v.outcome,
    outcomeView: describeOutcome(v.outcome, v.winnerUserId, sides),
    decidedBy: v.decidedBy,
    confidence: v.confidence,
    confidenceLabel:
      v.decidedBy === "human" || v.outcome === "forfeit"
        ? null
        : confidenceLabelFor(v.confidence, explanation?.confidenceLabel ?? null),
    scores: v.scores,
    explanation,
    hiddenQuoteCount,
    reviewNote: v.reviewNote,
    createdAt: v.createdAt.toISOString(),
  };
}

/** Texts of hidden/removed submissions per side (their quotes are withheld from public view). */
async function hiddenSubmissionTexts(competitionId: string): Promise<{ A: string[]; B: string[] }> {
  const rows = await db
    .select({ side: submissions.side, body: submissions.body })
    .from(submissions)
    .where(and(eq(submissions.competitionId, competitionId), ne(submissions.status, "visible")));
  return {
    A: rows.filter((r) => r.side === "FOR").map((r) => r.body),
    B: rows.filter((r) => r.side === "AGAINST").map((r) => r.body),
  };
}

// ---------------------------------------------------------------------------
// Verdict page
// ---------------------------------------------------------------------------

export async function getVerdictPageData(
  competitionId: string,
  viewer: SessionUser | null,
): Promise<VerdictPageData | null> {
  const core = await loadCompetitionCore(competitionId);
  if (!core) return null;
  const [history, appealRows, hidden] = await Promise.all([
    getVerdictHistory(competitionId),
    db.select().from(appeals).where(eq(appeals.competitionId, competitionId)).orderBy(asc(appeals.createdAt)),
    hiddenSubmissionTexts(competitionId),
  ]);

  const viewerSide: SideLabel | null =
    viewer?.id === core.sides.A.userId ? "A" : viewer?.id === core.sides.B.userId ? "B" : null;
  const isStaff = viewer ? hasRole(viewer.role, "moderator") : false;
  const canSeeAppealText = viewerSide !== null || isStaff;

  const records = history.map((v) => toRecord(v, core.sides, hidden));
  const current = records.find((r) => r.isCurrent) ?? null;
  const currentRow = history.find((v) => v.isCurrent);

  const eligibility = getAppealEligibility({
    viewerId: viewer?.id ?? null,
    participantIds: [core.sides.A.userId, core.sides.B.userId],
    competitionStatus: core.competition.status,
    currentVerdict: currentRow ? { id: currentRow.id, createdAt: currentRow.createdAt } : null,
    appeals: appealRows,
    at: now(),
  });

  return {
    ...header(core),
    current,
    history: records,
    appeals: appealRows.map((a) => ({
      id: a.id,
      appellantSide: a.appellantId === core.sides.A.userId ? "A" : "B",
      ground: a.ground,
      groundLabel: appealGroundLabel(a.ground),
      status: a.status,
      text: canSeeAppealText ? a.text : null,
      decisionNote: a.decisionNote,
      verdictId: a.verdictId,
      createdAt: a.createdAt.toISOString(),
      decidedAt: a.decidedAt?.toISOString() ?? null,
    })),
    viewer: { userId: viewer?.id ?? null, side: viewerSide, isStaff },
    eligibility: serializeEligibility(eligibility),
    reevaluating: core.competition.status === "evaluating" && current !== null,
  };
}

// ---------------------------------------------------------------------------
// Compact summary (VerdictSummary + share card)
// ---------------------------------------------------------------------------

export interface VerdictSummaryData extends CompetitionHeader {
  verdict: {
    id: string;
    outcome: VerdictOutcome;
    outcomeView: OutcomeView;
    totals: { A: number; B: number } | null;
    confidenceLabel: ConfidenceLabel | null;
    decidedBy: DecidedBy;
    summary: string | null;
    createdAt: string;
  } | null;
}

export async function getVerdictSummaryData(competitionId: string): Promise<VerdictSummaryData | null> {
  const core = await loadCompetitionCore(competitionId);
  if (!core) return null;
  const v = await getCurrentVerdict(competitionId);
  return {
    ...header(core),
    verdict: v
      ? {
          id: v.id,
          outcome: v.outcome,
          outcomeView: describeOutcome(v.outcome, v.winnerUserId, core.sides),
          totals: v.scores?.totals ?? null,
          confidenceLabel:
            v.decidedBy === "human" || v.outcome === "forfeit"
              ? null
              : confidenceLabelFor(v.confidence, v.explanation?.confidenceLabel ?? null),
          decidedBy: v.decidedBy,
          summary: v.decidedBy === "human" ? v.reviewNote : (v.explanation?.summary ?? null),
          createdAt: v.createdAt.toISOString(),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Admin: blind case material shared by both queues
// ---------------------------------------------------------------------------

export interface BlindSubmission {
  round: "opening" | "rebuttal";
  body: string;
  links: string[];
  status: "visible" | "hidden" | "removed";
}

export type BlindSubmissions = Record<SideLabel, BlindSubmission[]>;

async function blindSubmissions(competitionId: string): Promise<BlindSubmissions> {
  const rows = await db
    .select({
      side: submissions.side,
      round: submissions.round,
      body: submissions.body,
      links: submissions.links,
      status: submissions.status,
    })
    .from(submissions)
    .where(eq(submissions.competitionId, competitionId))
    .orderBy(asc(submissions.round));
  const pick = (side: "FOR" | "AGAINST") =>
    rows
      .filter((r) => r.side === side)
      .map((r) => ({ round: r.round, body: r.body, links: r.links, status: r.status }))
      .sort((x, y) => (x.round === y.round ? 0 : x.round === "opening" ? -1 : 1));
  return { A: pick("FOR"), B: pick("AGAINST") };
}

// ---------------------------------------------------------------------------
// Admin: appeals queue
// ---------------------------------------------------------------------------

export interface AppealQueueItem {
  appeal: AppealRecord & { text: string };
  header: CompetitionHeader;
  current: VerdictRecord | null;
  submissions: BlindSubmissions;
  /** Re-evaluation already used for this competition (max one). */
  reevaluationUsed: boolean;
}

export interface AppealQueue {
  open: AppealQueueItem[];
  recent: Array<{ appeal: AppealRecord & { text: string }; header: CompetitionHeader; reviewerId: string | null }>;
}

const NO_HIDDEN = { A: [], B: [] };

export async function getAppealQueue(options: { recentLimit?: number } = {}): Promise<AppealQueue> {
  const openRows = await db.select().from(appeals).where(eq(appeals.status, "open")).orderBy(asc(appeals.createdAt));
  const recentRows = await db
    .select()
    .from(appeals)
    .where(ne(appeals.status, "open"))
    .orderBy(desc(appeals.decidedAt))
    .limit(options.recentLimit ?? 20);

  const competitionIds = [...new Set([...openRows, ...recentRows].map((a) => a.competitionId))];
  const reevaluated =
    competitionIds.length === 0
      ? []
      : await db
          .select({ competitionId: appeals.competitionId })
          .from(appeals)
          .where(and(inArray(appeals.competitionId, competitionIds), eq(appeals.status, "reevaluated")));
  const reevaluatedSet = new Set(reevaluated.map((r) => r.competitionId));

  const cores = new Map<string, CompetitionCore>();
  for (const id of competitionIds) {
    const core = await loadCompetitionCore(id);
    if (core) cores.set(id, core);
  }

  const toAppeal = (a: typeof appeals.$inferSelect, core: CompetitionCore): AppealRecord & { text: string } => ({
    id: a.id,
    appellantSide: a.appellantId === core.sides.A.userId ? "A" : "B",
    ground: a.ground,
    groundLabel: appealGroundLabel(a.ground),
    status: a.status,
    text: a.text,
    decisionNote: a.decisionNote,
    verdictId: a.verdictId,
    createdAt: a.createdAt.toISOString(),
    decidedAt: a.decidedAt?.toISOString() ?? null,
  });

  const open: AppealQueueItem[] = [];
  for (const a of openRows) {
    const core = cores.get(a.competitionId);
    if (!core) continue;
    const [current, subs] = await Promise.all([getCurrentVerdict(a.competitionId), blindSubmissions(a.competitionId)]);
    open.push({
      appeal: toAppeal(a, core),
      header: header(core),
      current: current ? toRecord(current, core.sides, NO_HIDDEN) : null,
      submissions: subs,
      reevaluationUsed: reevaluatedSet.has(a.competitionId),
    });
  }

  const recent = recentRows.flatMap((a) => {
    const core = cores.get(a.competitionId);
    return core ? [{ appeal: toAppeal(a, core), header: header(core), reviewerId: a.reviewerId }] : [];
  });
  return { open, recent };
}

// ---------------------------------------------------------------------------
// Admin: needs-review queue
// ---------------------------------------------------------------------------

export interface PassRecord {
  id: string;
  passNo: number;
  order: "AB" | "BA";
  provider: string;
  model: string;
  promptVersion: string;
  rubric: { id: string; version: number };
  confidence: number | null;
  invalidQuoteCount: number;
  latencyMs: number | null;
  stopReason: string | null;
  error: string | null;
  parsed: PassOutputView | null;
  /** Pretty JSON of the raw output (rendered as text) when it couldn't be parsed. */
  rawJson: string | null;
}

export interface RunRecord {
  id: string;
  reason: "close" | "appeal";
  status: string;
  error: string | null;
  caseHash: string;
  injectionFindingCount: number;
  comparison: ComparisonView | null;
  startedAt: string;
  finishedAt: string | null;
  passes: PassRecord[];
}

export interface ReviewQueueItem {
  header: CompetitionHeader;
  current: VerdictRecord | null;
  runs: RunRecord[];
  lastJobError: string | null;
  submissions: BlindSubmissions;
  /** The latest run failed outright (no result) — a retry of the AI is allowed. */
  canRetry: boolean;
}

function safeJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

async function loadRuns(competitionId: string): Promise<RunRecord[]> {
  const runs = await db
    .select()
    .from(evaluationRuns)
    .where(eq(evaluationRuns.competitionId, competitionId))
    .orderBy(desc(evaluationRuns.startedAt));
  if (runs.length === 0) return [];
  const passes = await db
    .select()
    .from(evaluationPasses)
    .where(eq(evaluationPasses.competitionId, competitionId))
    .orderBy(asc(evaluationPasses.passNo));
  return runs.map((run) => ({
    id: run.id,
    reason: run.reason,
    status: run.status,
    error: run.error,
    caseHash: run.caseHash,
    injectionFindingCount: run.injectionFindings.length,
    comparison: readComparison(run.comparison),
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    passes: passes
      .filter((p) => p.evaluationRunId === run.id)
      .map((p) => {
        const parsed = readPassOutput(p.output);
        return {
          id: p.id,
          passNo: p.passNo,
          order: p.order,
          provider: p.provider,
          model: p.model,
          promptVersion: p.promptVersion,
          rubric: { id: p.rubricId, version: p.rubricVersion },
          confidence: p.confidence,
          invalidQuoteCount: p.invalidQuoteCount,
          latencyMs: p.latencyMs,
          stopReason: p.stopReason,
          error: p.error,
          parsed,
          rawJson: parsed ? null : safeJson(p.output),
        };
      }),
  }));
}

export async function getReviewQueue(): Promise<ReviewQueueItem[]> {
  const rows = await db
    .select({ id: competitions.id })
    .from(competitions)
    .where(eq(competitions.status, "needs_review"))
    .orderBy(asc(competitions.updatedAt));

  const items: ReviewQueueItem[] = [];
  for (const { id } of rows) {
    const core = await loadCompetitionCore(id);
    if (!core) continue;
    const [current, runs, subs, lastJob] = await Promise.all([
      getCurrentVerdict(id),
      loadRuns(id),
      blindSubmissions(id),
      db
        .select({ lastError: evaluationJobs.lastError })
        .from(evaluationJobs)
        .where(eq(evaluationJobs.competitionId, id))
        .orderBy(desc(evaluationJobs.createdAt))
        .limit(1),
    ]);
    const latest = runs[0];
    items.push({
      header: header(core),
      current: current ? toRecord(current, core.sides, NO_HIDDEN) : null,
      runs,
      lastJobError: lastJob[0]?.lastError ?? null,
      submissions: subs,
      canRetry: !latest || latest.status === "failed",
    });
  }
  return items;
}

export async function countOpenQueues(): Promise<{ appeals: number; review: number }> {
  const [a, r] = await Promise.all([
    db.select({ id: appeals.id }).from(appeals).where(eq(appeals.status, "open")),
    db.select({ id: competitions.id }).from(competitions).where(eq(competitions.status, "needs_review")),
  ]);
  return { appeals: a.length, review: r.length };
}
