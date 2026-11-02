import type { PositionSide } from "@domain/db/schema";
import type { CommentPage } from "@domain/social/types";
import { CommentThreadItems, type ThreadRenderContext } from "./comment-thread-items";
import { CommentsProvider, type CommentsContextValue } from "./comments-context";
import { LoadMoreComments } from "./load-more-comments";
import { NewComments } from "./new-comments";
import { signInHrefFor } from "./view-modes";

export interface CommentThreadProps {
  argumentId: string;
  /** Loader-fed: the first page (reference `listCommentThreads({ argumentId, viewerId })`). */
  page: CommentPage;
  /** Loader-fed: total visible comments (reference `getCommentCounts([argumentId])`); hidden when unknown. */
  count?: number | null;
  /**
   * The signed-in viewer as a chip (id, handle, display name, avatar), or null when signed out.
   * `undefined` = not known (no who-am-I action yet): threads render read-only, with no composer, rather
   * than wrongly asking a signed-in user to sign in.
   */
  viewer: CommentsContextValue["viewer"] | undefined;
  /** `argument.status === "visible"`. */
  argumentOpen: boolean;
  /** The viewer and the author have blocked each other (either way). */
  blocked: boolean;
  /** Loader-fed; compute with `commentClosedReason` from ./view-modes. */
  closedReason: string | null;
  /** The viewer's current free position on the argument (reference `getUserPosition`). */
  viewerSide: PositionSide | null;
}

const nf = new Intl.NumberFormat("en-GB");

/**
 * Comments + one level of replies, with the composer ("Comment (free discussion — not judged)").
 * Newest top-level comments first, 20 per page; replies oldest first. Blocked users' content is hidden
 * both ways; removed comments leave a placeholder while their replies remain.
 * Ported from an async server component: data now arrives as props from the route loader.
 */
export function CommentThread({
  argumentId,
  page,
  count,
  viewer,
  argumentOpen,
  blocked,
  closedReason,
  viewerSide,
}: CommentThreadProps) {
  const viewerKnown = viewer !== undefined;
  const viewerId = viewer?.id ?? null;
  const signInHref = signInHrefFor(argumentId);
  const ctx: ThreadRenderContext = { viewerId, argumentId, argumentOpen: argumentOpen && !blocked, signInHref };

  return (
    <section aria-labelledby={`comments-${argumentId}`} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={`comments-${argumentId}`} className="text-2xl text-ink">
          Comments{typeof count === "number" ? <> <span className="tabular text-ink-3">{nf.format(count)}</span></> : null}
        </h2>
        <p className="text-xs font-semibold text-ink-3">Free discussion · not judged</p>
      </div>
      <CommentsProvider
        argumentId={argumentId}
        viewer={viewer ?? null}
        canComment={!!viewer && closedReason === null}
        closedReason={closedReason}
        signInHref={signInHref}
        initialViewerSide={viewerSide}
      >
        {viewerKnown ? (
          <NewComments serverTopIds={page.threads.map((thread) => thread.comment.id)} />
        ) : (
          <p className="text-sm text-ink-3">Posting comments from this page isn&apos;t available in this version yet.</p>
        )}
        {page.threads.length > 0 ? (
          <ol className="flex flex-col divide-y divide-line">
            <CommentThreadItems threads={page.threads} ctx={ctx} />
          </ol>
        ) : null}
        {page.nextCursor ? <LoadMoreComments key={page.nextCursor} argumentId={argumentId} cursor={page.nextCursor} /> : null}
      </CommentsProvider>
    </section>
  );
}
