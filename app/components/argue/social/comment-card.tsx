/**
 * Presentational comment pieces shared by server-rendered threads and client-side (own/new) comments.
 * No hooks and no server imports, so it can render on either side. All user text is rendered as text.
 */
import Link from "@/shims/next-link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/argue/ui/avatar";
import { SideTag } from "@/components/argue/ui/side-tag";
import { cn } from "@domain/lib/cn";
import { formatDateTime, formatRelative } from "@domain/lib/time";
import { tokenizeMentions } from "@domain/social/mentions";
import type { CommentState, CommentView } from "@domain/social/types";

/** Comment text with @mentions linked to profiles. */
export function MentionText({ text }: { text: string }) {
  return (
    <>
      {tokenizeMentions(text).map((token, i) =>
        token.kind === "mention" ? (
          <Link key={i} href={`/u/${token.handle}`} className="font-semibold text-ink underline-offset-2 hover:underline">
            {token.text}
          </Link>
        ) : (
          <span key={i}>{token.text}</span>
        ),
      )}
    </>
  );
}

export function commentAnchorId(commentId: string): string {
  return `comment-${commentId}`;
}

const PLACEHOLDER_COPY: Record<Exclude<CommentState, "visible">, string> = {
  removed: "This comment was removed.",
  hidden: "This comment was hidden by the moderators.",
  unavailable: "This comment isn't available.",
};

export function CommentPlaceholder({ comment }: { comment: CommentView }) {
  const copy = comment.state === "visible" ? "This comment isn't available." : PLACEHOLDER_COPY[comment.state];
  return (
    <div
      id={commentAnchorId(comment.id)}
      className="scroll-mt-24 rounded-[var(--radius)] bg-surface-2 px-3 py-2.5 text-sm text-ink-3 italic"
    >
      {copy}
    </div>
  );
}

export interface CommentCardProps {
  comment: CommentView;
  /** Replaces the rendered text (e.g. the edit form). */
  body?: ReactNode;
  /** Footer controls: reaction, reply, challenge, report, edit/delete. */
  actions?: ReactNode;
  /** Small note above the body, e.g. "Only you can see this". */
  notice?: ReactNode;
  className?: string;
}

export function CommentCard({ comment, body, actions, notice, className }: CommentCardProps) {
  const author = comment.author;
  const name = author?.displayName ?? "Deleted account";
  return (
    <article
      id={commentAnchorId(comment.id)}
      aria-label={`Comment by ${name}`}
      className={cn("flex scroll-mt-24 gap-3", className)}
    >
      <Avatar name={name} src={author?.avatarUrl} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-tight">
          {author ? (
            <Link href={`/u/${author.handle}`} className="font-semibold text-ink hover:underline">
              {author.displayName}
            </Link>
          ) : (
            <span className="font-semibold text-ink-2">{name}</span>
          )}
          {author ? <span className="text-ink-3">@{author.handle}</span> : null}
          {comment.positionTag ? (
            <SideTag side={comment.positionTag} size="sm" variant="soft">
              <span className="sr-only">Position: </span>
              {comment.positionTag}
            </SideTag>
          ) : null}
          <span className="text-ink-3">
            <time dateTime={comment.createdAt} title={formatDateTime(comment.createdAt)} suppressHydrationWarning>
              {formatRelative(comment.createdAt)}
            </time>
            {comment.editedAt ? <span> · edited</span> : null}
          </span>
        </header>
        {notice ? <div className="mt-1.5">{notice}</div> : null}
        <div className="mt-1 text-[0.95rem] leading-relaxed break-words whitespace-pre-wrap text-ink">
          {body ?? (comment.body !== null ? <MentionText text={comment.body} /> : null)}
        </div>
        {actions ? <div className="mt-1 -ml-3 flex flex-wrap items-center gap-0.5">{actions}</div> : null}
      </div>
    </article>
  );
}
