"use client";

import Link from "@/shims/next-link";
import { Reply } from "lucide-react";
import { useComments, useThread } from "./comments-context";

export const commentActionClass =
  "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink";

export interface ReplyButtonProps {
  commentId: string;
  /** Author handle when answering a reply (prefilled as @handle); null for top-level comments. */
  handle: string | null;
}

/** Opens the thread's reply composer. Only meaningful inside a ThreadScope. */
export function ReplyButton({ commentId, handle }: ReplyButtonProps) {
  const thread = useThread();
  const { viewer, canComment, signInHref } = useComments();
  if (!thread) return null;
  if (!viewer) {
    return (
      <Link href={signInHref} className={commentActionClass}>
        <Reply aria-hidden className="size-4" />
        Reply
      </Link>
    );
  }
  if (!canComment) return null;
  return (
    <button type="button" className={commentActionClass} onClick={() => thread.startReply({ commentId, handle })}>
      <Reply aria-hidden className="size-4" />
      Reply
    </button>
  );
}
