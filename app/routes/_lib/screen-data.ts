/**
 * Pure shaping helpers for the 5b screens. Client-safe: only `import type` from the domain layer, plus the
 * code rubrics (`judging/rubrics/v1`, no database import), so nothing here pulls pglite/drizzle into the
 * browser bundle.
 */
import type { AppealQueue, ReviewQueueItem } from "@domain/appeals/queries";
import type { RubricWithCategories } from "@domain/appeals/rubrics";
import { ALL_RUBRICS } from "@domain/judging/rubrics/v1";
import type { RubricDef } from "@domain/judging/types";
import type { DebateHistoryItem, PostedArgument, PublicProfile } from "@domain/profiles/queries";
import type { CriterionAverage } from "@domain/reputation/criteria";
import type { UserRatingSummary } from "@domain/reputation/types";

// ---------------------------------------------------------------------------------------------------
// /rules
// ---------------------------------------------------------------------------------------------------

export interface RulesCategory {
  slug: string;
  name: string;
  rubricId?: string | null;
}

/** Latest version of each code rubric (reference `listCurrentRubrics`, without the DB-importing module). */
export function currentRubrics(all: readonly RubricDef[] = ALL_RUBRICS): RubricDef[] {
  const latest = new Map<string, RubricDef>();
  for (const rubric of all) {
    const seen = latest.get(rubric.id);
    if (!seen || rubric.version > seen.version) latest.set(rubric.id, rubric);
  }
  return [...latest.values()];
}

/**
 * Reference `listRubricsForRules`, client side: current code rubrics, each with the names of the active
 * categories it judges, ordered by the first category that uses it. `categories` comes from the
 * `list-categories` action, already in category order.
 */
export function rubricsForRules(
  categories: readonly RulesCategory[],
  all: readonly RubricDef[] = ALL_RUBRICS,
): RubricWithCategories[] {
  const uses = (r: RubricDef, c: RulesCategory) => c.rubricId === r.id || r.categorySlugs.includes(c.slug);
  const order = (r: RubricDef) => {
    const index = categories.findIndex((c) => uses(r, c));
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return currentRubrics(all)
    .map((r) => ({ ...r, categoryNames: categories.filter((c) => uses(r, c)).map((c) => c.name) }))
    .sort((a, b) => order(a) - order(b));
}

/** The rubric a verdict pinned (reference `findRubric`, code rubrics only; null degrades the panel). */
export function findCodeRubric(id: string, version: number, all: readonly RubricDef[] = ALL_RUBRICS): RubricDef | null {
  return all.find((r) => r.id === id && r.version === version) ?? null;
}

// ---------------------------------------------------------------------------------------------------
// /admin/review
// ---------------------------------------------------------------------------------------------------

export type QueueTab = "review" | "appeals";

export function queueTab(search: string | URLSearchParams): QueueTab {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get("tab") === "appeals" ? "appeals" : "review";
}

export interface ReviewQueueData {
  review: ReviewQueueItem[];
  appeals: AppealQueue;
  /** The signed-in reviewer's ARGUE IT user id, to hide decision forms on their own debates. */
  viewerId: string | null;
}

/**
 * Accept the `list-review-queue` output in the shapes 4-actions may reasonably return:
 * `{ review, appeals, viewerId? }` (preferred), `{ reviewQueue, appealQueue }`, or `{ review, appeals: { open, recent } }`.
 */
export function normaliseReviewQueue(raw: unknown): ReviewQueueData {
  const r = (raw ?? {}) as Record<string, unknown>;
  const review = (r.review ?? r.reviewQueue ?? r.items ?? []) as ReviewQueueItem[];
  const appealsRaw = (r.appeals ?? r.appealQueue ?? {}) as Partial<AppealQueue> | AppealQueue["open"];
  const appeals: AppealQueue = Array.isArray(appealsRaw)
    ? { open: appealsRaw, recent: [] }
    : { open: appealsRaw.open ?? [], recent: appealsRaw.recent ?? [] };
  const viewer = r.viewer as { id?: unknown } | undefined;
  const viewerId =
    typeof r.viewerId === "string" ? r.viewerId : typeof viewer?.id === "string" ? viewer.id : null;
  return { review: Array.isArray(review) ? review : [], appeals, viewerId };
}

/** True when the reviewer took part in the debate (reference `isOwn`). Unknown viewer → false; the action re-checks. */
export function isOwnCase(
  header: { sides: { A: { userId: string | null }; B: { userId: string | null } } },
  viewerId: string | null,
): boolean {
  if (!viewerId) return false;
  return header.sides.A.userId === viewerId || header.sides.B.userId === viewerId;
}

// ---------------------------------------------------------------------------------------------------
// /u/$handle
// ---------------------------------------------------------------------------------------------------

export type ProfileTab = "debates" | "arguments";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ProfilePageData {
  profile: PublicProfile;
  viewer: { signedIn: boolean; isOwnProfile: boolean; blockedEitherWay: boolean; viewerBlocks: boolean };
  record: { summary: UserRatingSummary; criteria: CriterionAverage[] } | null;
  follows: { followers: number; following: number } | null;
  commentCount: number | null;
  argumentCount: number | null;
  history: Page<DebateHistoryItem> | null;
  posted: Page<PostedArgument> | null;
}

/**
 * Accept the `get-profile` output either as the full page bundle (preferred; see port-notes) or as a bare
 * `PublicProfile`. Missing parts become null and the screen leaves those panels out.
 */
export function normaliseProfile(raw: unknown): ProfilePageData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const profile = (r.profile ?? (typeof r.handle === "string" ? r : null)) as PublicProfile | null;
  if (!profile) return null;
  const v = (r.viewer ?? {}) as Partial<ProfilePageData["viewer"]>;
  const num = (x: unknown) => (typeof x === "number" ? x : null);
  return {
    profile,
    viewer: {
      signedIn: Boolean(v.signedIn),
      isOwnProfile: Boolean(v.isOwnProfile),
      blockedEitherWay: Boolean(v.blockedEitherWay),
      viewerBlocks: Boolean(v.viewerBlocks),
    },
    record: (r.record as ProfilePageData["record"]) ?? null,
    follows: (r.follows as ProfilePageData["follows"]) ?? null,
    commentCount: num(r.commentCount),
    argumentCount: num(r.argumentCount),
    history: (r.history as ProfilePageData["history"]) ?? null,
    posted: (r.posted as ProfilePageData["posted"]) ?? null,
  };
}

export function profileTab(search: URLSearchParams): ProfileTab {
  return search.get("tab") === "arguments" ? "arguments" : "debates";
}
