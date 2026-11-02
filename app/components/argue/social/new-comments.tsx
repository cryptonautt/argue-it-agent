"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { EmptyState } from "@/components/argue/ui/empty-state";
import type { CommentView } from "@domain/social/types";
import { CommentComposer } from "./comment-composer";
import { OwnComment } from "./own-comment";

export interface NewCommentsProps {
  /** Ids of the server-rendered first page (local copies are dropped once the server shows them). */
  serverTopIds: string[];
}

/** Top-level composer plus the viewer's just-posted comments until the server re-render includes them. */
export function NewComments({ serverTopIds }: NewCommentsProps) {
  const [posted, setPosted] = useState<CommentView[]>([]);
  const serverIds = new Set(serverTopIds);
  const localOnly = posted.filter((comment) => !serverIds.has(comment.id));

  return (
    <>
      <CommentComposer onPosted={(comment) => setPosted((list) => [comment, ...list])} />
      {localOnly.length > 0 ? (
        <ol aria-label="Your new comments" className="flex flex-col divide-y divide-line">
          {localOnly.map((comment) => (
            <li key={comment.id} className="py-4">
              <OwnComment comment={comment} />
            </li>
          ))}
        </ol>
      ) : null}
      {serverTopIds.length === 0 && localOnly.length === 0 ? (
        <EmptyState
          icon={<MessageSquare />}
          title="No comments yet"
          description="Start the discussion. Comments are free and never judged."
        />
      ) : null}
    </>
  );
}
