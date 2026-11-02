/**
 * Client-side data shaping for the 5a screens (`_index`, `a.$id`, `new`, `challenge.new`).
 * Pure and client-safe: only `import type` from the domain layer plus the code rubrics
 * (`judging/rubrics/v1`, no database import). `callAction` returns JSON: only the reference type that
 * really holds `Date`s (`ArgumentDetail`) is revived; the feed/social view models are ISO strings by design.
 */
import { reviveDates } from "@/lib/server-actions-dates";
import type { ArgumentDetail } from "@domain/arguments/queries";
import type { ArgumentCardData, CategoryOption } from "@domain/arguments/types";
import type { ChallengeListItem } from "@domain/competitions/queries";
import type { RubricView } from "@domain/competitions/terms";
import { ALL_RUBRICS } from "@domain/judging/rubrics/v1";
import type { CommentPage, PositionSummary, ReactionSummary } from "@domain/social/types";

// ---------------------------------------------------------------------------------------------------
// list-feed / list-categories
// ---------------------------------------------------------------------------------------------------

export interface FeedPageData {
  items: ArgumentCardData[];
  nextCursor: string | null;
}

export function normaliseFeedPage(raw: unknown): FeedPageData {
  const value = (raw ?? {}) as Partial<FeedPageData>;
  return {
    items: Array.isArray(value.items) ? (value.items as ArgumentCardData[]) : [],
    nextCursor: typeof value.nextCursor === "string" ? value.nextCursor : null,
  };
}

export function normaliseCategories(raw: unknown): CategoryOption[] {
  const list = (raw as { categories?: unknown } | null)?.categories;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (c): c is CategoryOption =>
      !!c && typeof c === "object" && typeof (c as CategoryOption).slug === "string" && typeof (c as CategoryOption).name === "string",
  );
}

// ---------------------------------------------------------------------------------------------------
// get-argument
// ---------------------------------------------------------------------------------------------------

export type ArgumentVisibility = "full" | "revealed" | "placeholder";

/** A placeholder (hidden/removed, not revealed to this viewer) carries only these fields. */
export type ArgumentPlaceholder = Pick<
  ArgumentDetail,
  "id" | "status" | "removedBy" | "createdAt" | "category" | "author" | "locked"
>;

export interface ArgumentPageData {
  visibility: ArgumentVisibility;
  /** Full detail unless `visibility === "placeholder"`. */
  argument: ArgumentDetail | ArgumentPlaceholder;
  /** Optional extras: a missing one means "not returned by get-argument", never "zero". */
  positions: PositionSummary | null;
  challenges: ChallengeListItem[] | null;
  comments: CommentPage | null;
  /** Total visible comments (reference `getCommentCounts`), when returned. */
  commentTotal: number | null;
  reaction: Pick<ReactionSummary, "count" | "viewerReacted"> | null;
  /** The id of the viewer get-argument resolved (it requires a signed-in user). */
  viewerId: string | null;
}

export function isFullArgument(data: ArgumentPageData): data is ArgumentPageData & { argument: ArgumentDetail } {
  return data.visibility !== "placeholder" && typeof (data.argument as ArgumentDetail).title === "string";
}

export function normaliseArgumentPage(raw: unknown): ArgumentPageData | null {
  const value = (raw ?? null) as Record<string, unknown> | null;
  if (!value || typeof value !== "object") return null;
  const argument = reviveDates(value.argument) as ArgumentPageData["argument"] | undefined;
  if (!argument || typeof argument !== "object" || typeof argument.id !== "string") return null;
  const visibility: ArgumentVisibility =
    value.visibility === "revealed" || value.visibility === "placeholder" ? value.visibility : "full";
  const comments = value.comments as (CommentPage & { total?: unknown }) | undefined;
  const reaction = value.reaction as ReactionSummary | null | undefined;
  const viewer = value.viewer as { id?: unknown } | null | undefined;
  return {
    visibility,
    argument,
    positions: (value.positions as PositionSummary | undefined) ?? null,
    challenges: Array.isArray(value.challenges) ? (value.challenges as ChallengeListItem[]) : null,
    comments: comments && Array.isArray(comments.threads) ? { threads: comments.threads, nextCursor: comments.nextCursor ?? null } : null,
    commentTotal: comments && typeof comments.total === "number" ? comments.total : null,
    reaction: reaction && typeof reaction.count === "number" ? { count: reaction.count, viewerReacted: !!reaction.viewerReacted } : null,
    viewerId: viewer && typeof viewer.id === "string" ? viewer.id : null,
  };
}

// ---------------------------------------------------------------------------------------------------
// /challenge/new
// ---------------------------------------------------------------------------------------------------

/** Reference `getCurrentRubric` for a category, from the code rubrics (no DB import on the client). */
export function rubricForCategory(categorySlug: string): RubricView | null {
  let latest: (typeof ALL_RUBRICS)[number] | undefined;
  for (const rubric of ALL_RUBRICS) {
    if (rubric.categorySlugs.includes(categorySlug) && (!latest || rubric.version > latest.version)) latest = rubric;
  }
  return latest
    ? { id: latest.id, version: latest.version, name: latest.name, description: latest.description, criteria: latest.criteria }
    : null;
}

export interface OpponentSummary {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface ChallengeTargetView {
  argument: { id: string; title: string; proposition: string };
  category: { id: string; slug: string; name: string };
  comment: { id: string; excerpt: string } | null;
  opponent: OpponentSummary | null;
  opponentFixed: boolean;
}

export function excerpt(text: string, max = 220): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Client approximation of the reference `resolveChallengeTarget` from the get-argument payload. The
 * server's `send-challenge` runs the real `resolveChallengeTarget` (self-challenge, blocks, suspended
 * opponent, duplicates), so anything this can't see is still enforced on send.
 * Returns a plain-English reason string when the challenge can't be set up from here.
 */
export function challengeTargetFrom(
  data: ArgumentPageData,
  query: { commentId: string | null; opponentId: string | null },
  viewerId: string | null = null,
): ChallengeTargetView | string {
  if (!isFullArgument(data) || data.argument.status !== "visible") {
    return "This argument isn't open for challenges.";
  }
  const a = data.argument;
  if (a.authorBlockedViewer || a.viewerBlockedAuthor) return "You can't challenge this person.";
  const base = {
    argument: { id: a.id, title: a.title, proposition: a.proposition },
    category: { id: a.category.id, slug: a.category.slug, name: a.category.name },
  };

  if (query.commentId) {
    const all = (data.comments?.threads ?? []).flatMap((t) => [t.comment, ...t.replies]);
    const comment = all.find((c) => c.id === query.commentId);
    if (!comment || comment.body === null || !comment.author) {
      return "We couldn't find that comment on this argument. Open it from the comment's Challenge button.";
    }
    if (comment.isOwn) return "You can't challenge your own comment.";
    return {
      ...base,
      comment: { id: comment.id, excerpt: excerpt(comment.body) },
      opponent: {
        userId: comment.author.id,
        handle: comment.author.handle,
        displayName: comment.author.displayName,
        avatarUrl: comment.author.avatarUrl,
      },
      opponentFixed: true,
    };
  }

  const author = a.author;
  const authorChip: OpponentSummary | null =
    author.handle !== null
      ? { userId: author.id, handle: author.handle, displayName: author.displayName, avatarUrl: author.avatarUrl }
      : null;
  // Default opponent is the argument's author (reference); `?opponent=` other than the author is typed in.
  // Challenging from your own argument: no default opponent, you type a handle (reference behaviour).
  const isAuthor = viewerId !== null && viewerId === a.authorId;
  const opponent = !isAuthor && (!query.opponentId || query.opponentId === a.authorId) ? authorChip : null;
  return { ...base, comment: null, opponent, opponentFixed: false };
}

// ---------------------------------------------------------------------------------------------------
// The viewer (who-am-I)
// ---------------------------------------------------------------------------------------------------

export interface ArgueViewer {
  id: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
  suspendedUntil: Date | null;
}

/**
 * Shapes the `get-session` GET action result (`{ id, role, status, suspendedUntil, handle, displayName,
 * avatarUrl } | null`). `undefined` = unknown (the call failed): screens then leave out the
 * viewer-dependent controls instead of guessing.
 */
export function normaliseViewer(raw: unknown): ArgueViewer | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const v = ((raw as { user?: unknown }).user ?? raw) as Partial<ArgueViewer> | null;
  if (v === null) return null;
  if (!v || typeof v.id !== "string") return undefined;
  return {
    id: v.id,
    handle: typeof v.handle === "string" ? v.handle : null,
    displayName: typeof v.displayName === "string" ? v.displayName : null,
    avatarUrl: typeof v.avatarUrl === "string" ? v.avatarUrl : null,
    role: typeof v.role === "string" ? v.role : "user",
    status: typeof v.status === "string" ? v.status : "active",
    suspendedUntil: parseDate((v as { suspendedUntil?: unknown }).suspendedUntil),
  };
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Reference `isSuspended` (auth/roles), on the shaped viewer. */
export function isViewerSuspended(viewer: ArgueViewer | null | undefined, at: Date = new Date()): boolean {
  if (!viewer || viewer.status !== "suspended") return false;
  return viewer.suspendedUntil === null || viewer.suspendedUntil.getTime() > at.getTime();
}
