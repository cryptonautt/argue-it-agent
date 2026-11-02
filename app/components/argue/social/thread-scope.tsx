"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { CommentView } from "@domain/social/types";
import { CommentComposer } from "./comment-composer";
import { ThreadContext, type ThreadContextValue } from "./comments-context";
import { OwnComment } from "./own-comment";

export interface ThreadScopeProps {
  topLevelId: string;
  /** The server-rendered top-level comment. */
  top: ReactNode;
  /** Server-rendered replies, oldest first. */
  replies: ReactNode[];
  /** Ids of the server-rendered replies (to drop local copies once the server has them). */
  serverReplyIds: string[];
  /** Replies shown before "Show N more replies". */
  collapseAfter?: number;
}

/**
 * One top-level comment with its replies (one level deep) and the reply composer. Replies the viewer
 * posts appear immediately; when the server re-renders the thread with them, the local copy is dropped.
 */
export function ThreadScope({ topLevelId, top, replies, serverReplyIds, collapseAfter = 3 }: ThreadScopeProps) {
  const [target, setTarget] = useState<{ commentId: string; handle: string | null } | null>(null);
  const [posted, setPosted] = useState<CommentView[]>([]);
  const [expanded, setExpanded] = useState(false);

  const startReply = useCallback<ThreadContextValue["startReply"]>((next) => setTarget(next), []);
  const context = useMemo(() => ({ topLevelId, startReply }), [topLevelId, startReply]);

  const serverIds = new Set(serverReplyIds);
  const localOnly = posted.filter((c) => !serverIds.has(c.id));
  const visibleReplies = expanded ? replies : replies.slice(0, collapseAfter);
  const hiddenCount = replies.length - visibleReplies.length;
  const hasReplyArea = replies.length > 0 || localOnly.length > 0 || target !== null;

  return (
    <ThreadContext value={context}>
      <li className="flex flex-col gap-3 py-4">
        {top}
        {hasReplyArea ? (
          <div className="ml-4 flex flex-col gap-4 border-l-2 border-line pl-3 sm:ml-11 sm:pl-4">
            {visibleReplies}
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="-ml-1 inline-flex h-9 items-center self-start rounded-full px-2 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink"
              >
                Show {hiddenCount} more {hiddenCount === 1 ? "reply" : "replies"}
              </button>
            ) : null}
            {localOnly.map((comment) => (
              <OwnComment key={comment.id} comment={comment} />
            ))}
            {target ? (
              <CommentComposer
                key={target.commentId}
                parentCommentId={target.commentId}
                initialBody={target.handle ? `@${target.handle} ` : ""}
                autoFocus
                onCancel={() => setTarget(null)}
                onPosted={(comment) => {
                  setPosted((list) => [...list, comment]);
                  setExpanded(true);
                  setTarget(null);
                }}
              />
            ) : null}
          </div>
        ) : null}
      </li>
    </ThreadContext>
  );
}
