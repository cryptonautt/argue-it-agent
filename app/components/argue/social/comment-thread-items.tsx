import { ChallengeButton } from "@/components/argue/competitions/challenge-button";
import { ReportButton } from "@/components/argue/moderation/report-button";
import type { CommentThreadView, CommentView } from "@domain/social/types";
import { CommentCard, CommentPlaceholder } from "./comment-card";
import { OwnComment } from "./own-comment";
import { ReactionToggle } from "./reaction-toggle";
import { ReplyButton } from "./reply-button";
import { ThreadScope } from "./thread-scope";

/** What the server renderer needs to know about the viewer and the argument. */
export interface ThreadRenderContext {
  viewerId: string | null;
  argumentId: string;
  argumentOpen: boolean;
  signInHref: string;
}

function CommentItem({ comment, ctx }: { comment: CommentView; ctx: ThreadRenderContext }) {
  if (comment.body === null) return <CommentPlaceholder comment={comment} />;
  if (comment.isOwn) return <OwnComment comment={comment} />;
  const author = comment.author;
  return (
    <CommentCard
      comment={comment}
      actions={
        <>
          <ReactionToggle
            targetType="comment"
            targetId={comment.id}
            initialCount={comment.reactions.count}
            initialReacted={comment.reactions.viewerReacted}
            mode={!ctx.viewerId ? "signed-out" : ctx.argumentOpen ? "open" : "disabled"}
            signInHref={ctx.signInHref}
          />
          {author ? <ReplyButton commentId={comment.id} handle={comment.parentCommentId ? author.handle : null} /> : null}
          <ReportButton targetType="comment" targetId={comment.id} />
          {author && ctx.argumentOpen ? (
            <span className="ml-auto pl-2">
              <ChallengeButton argumentId={ctx.argumentId} commentId={comment.id} opponentId={author.id} />
            </span>
          ) : null}
        </>
      }
    />
  );
}

/** Server-rendered threads (used for the first page and for "Load more" pages). */
export function CommentThreadItems({ threads, ctx }: { threads: CommentThreadView[]; ctx: ThreadRenderContext }) {
  return (
    <>
      {threads.map((thread) => (
        <ThreadScope
          key={thread.comment.id}
          topLevelId={thread.comment.id}
          top={<CommentItem comment={thread.comment} ctx={ctx} />}
          replies={thread.replies.map((reply) => (
            <CommentItem key={reply.id} comment={reply} ctx={ctx} />
          ))}
          serverReplyIds={thread.replies.map((reply) => reply.id)}
        />
      ))}
    </>
  );
}
