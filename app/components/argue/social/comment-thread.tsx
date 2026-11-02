import { eq } from "drizzle-orm";
import { getSession, isSuspended } from "@domain/auth";
import { db } from "@domain/db";
import { argumentsTable } from "@domain/db/schema";
import { isBlocked } from "@domain/social/blocks";
import { getCommentCounts, listCommentThreads } from "@domain/social/comments";
import { getUserPosition } from "@domain/social/positions";
import { CommentThreadItems, type ThreadRenderContext } from "./comment-thread-items";
import { CommentsProvider } from "./comments-context";
import { LoadMoreComments } from "./load-more-comments";
import { NewComments } from "./new-comments";

export interface CommentThreadProps {
  argumentId: string;
}

const nf = new Intl.NumberFormat("en-GB");

/**
 * Comments + one level of replies, with the composer ("Comment (free discussion — not judged)").
 * Newest top-level comments first, 20 per page; replies oldest first. Blocked users' content is hidden
 * both ways; removed comments leave a placeholder while their replies remain.
 */
export async function CommentThread({ argumentId }: CommentThreadProps) {
  const viewer = await getSession();
  const argument = await db.query.argumentsTable.findFirst({
    where: eq(argumentsTable.id, argumentId),
    columns: { id: true, status: true, authorId: true },
  });
  if (!argument) return null;

  const viewerId = viewer?.id ?? null;
  const [page, counts, viewerSide, blocked] = await Promise.all([
    listCommentThreads({ argumentId: argument.id, viewerId }),
    getCommentCounts([argument.id]),
    viewerId ? getUserPosition(argument.id, viewerId) : Promise.resolve(null),
    viewerId ? isBlocked(viewerId, argument.authorId) : Promise.resolve(false),
  ]);

  const argumentOpen = argument.status === "visible";
  let closedReason: string | null = null;
  if (!argumentOpen) closedReason = "This argument is closed to new comments.";
  else if (blocked) closedReason = "You can't comment on this argument.";
  else if (viewer && isSuspended(viewer)) closedReason = "Your account is suspended. You can read, but not post.";
  const signInHref = `/sign-in?next=${encodeURIComponent(`/a/${argument.id}`)}`;
  const ctx: ThreadRenderContext = { viewerId, argumentId: argument.id, argumentOpen: argumentOpen && !blocked, signInHref };
  const count = counts.get(argument.id) ?? 0;

  return (
    <section aria-labelledby={`comments-${argument.id}`} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={`comments-${argument.id}`} className="text-2xl text-ink">
          Comments <span className="tabular text-ink-3">{nf.format(count)}</span>
        </h2>
        <p className="text-xs font-semibold text-ink-3">Free discussion · not judged</p>
      </div>
      <CommentsProvider
        argumentId={argument.id}
        viewer={
          viewer && viewer.handle
            ? { id: viewer.id, handle: viewer.handle, displayName: viewer.displayName ?? viewer.handle, avatarUrl: viewer.avatarUrl }
            : null
        }
        canComment={viewer !== null && closedReason === null}
        closedReason={closedReason}
        signInHref={signInHref}
        initialViewerSide={viewerSide}
      >
        <NewComments serverTopIds={page.threads.map((thread) => thread.comment.id)} />
        {page.threads.length > 0 ? (
          <ol className="flex flex-col divide-y divide-line">
            <CommentThreadItems threads={page.threads} ctx={ctx} />
          </ol>
        ) : null}
        {page.nextCursor ? (
          <LoadMoreComments key={page.nextCursor} argumentId={argument.id} cursor={page.nextCursor} />
        ) : null}
      </CommentsProvider>
    </section>
  );
}
