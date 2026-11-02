"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/argue/ui/button";
import { Dialog } from "@/components/argue/ui/dialog";
import { Textarea } from "@/components/argue/ui/textarea";
import { useToast } from "@/components/argue/ui/toast";
import { cn } from "@domain/lib/cn";
import { deleteComment, editComment } from "@/lib/server-actions";
import type { CommentView } from "@domain/social/types";
import { CommentCard, CommentPlaceholder } from "./comment-card";
import { COMMENT_MAX_CHARS } from "./comment-composer";
import { ReactionToggle } from "./reaction-toggle";
import { ReplyButton, commentActionClass as actionClass } from "./reply-button";

/** The viewer's own comment: edit in place, delete with confirmation. */
export function OwnComment({ comment: initial }: { comment: CommentView }) {
  const [comment, setComment] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial.body ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [pending, startTransition] = useTransition();
  const { success, error } = useToast();

  if (deleted || comment.state === "removed") return <CommentPlaceholder comment={{ ...comment, state: "removed" }} />;

  const hidden = comment.state === "hidden";

  function save() {
    const text = draft.trim();
    if (!text) return;
    startTransition(async () => {
      const result = await editComment({ commentId: comment.id, body: text });
      if (!result.ok) {
        error(result.error);
        return;
      }
      setComment(result.data);
      setEditing(false);
      success("Comment updated");
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteComment({ commentId: comment.id });
      if (!result.ok) {
        error(result.error);
        return;
      }
      setConfirmDelete(false);
      setDeleted(true);
      success("Comment deleted");
    });
  }

  return (
    <>
      <CommentCard
        comment={comment}
        notice={
          hidden ? (
            <p className="rounded-[var(--radius)] bg-warning-soft px-2.5 py-1.5 text-xs font-semibold text-warning">
              Hidden by the moderators — only you can see this.
            </p>
          ) : null
        }
        body={
          editing ? (
            <div className="mt-1 flex flex-col gap-2">
              <Textarea
                label="Edit your comment (free discussion — not judged)"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={COMMENT_MAX_CHARS}
                showCount
                rows={3}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Escape") setEditing(false);
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) save();
                }}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button size="sm" loading={pending} onClick={save} disabled={!draft.trim()}>
                  Save
                </Button>
              </div>
            </div>
          ) : undefined
        }
        actions={
          editing ? null : (
            <>
              <ReactionToggle
                targetType="comment"
                targetId={comment.id}
                initialCount={comment.reactions.count}
                initialReacted={false}
                mode="own"
              />
              {!hidden && comment.author ? (
                <ReplyButton commentId={comment.id} handle={comment.parentCommentId ? comment.author.handle : null} />
              ) : null}
              {!hidden ? (
                <button
                  type="button"
                  className={actionClass}
                  onClick={() => {
                    setDraft(comment.body ?? "");
                    setEditing(true);
                  }}
                >
                  <Pencil aria-hidden className="size-4" />
                  Edit
                </button>
              ) : null}
              <button type="button" className={cn(actionClass, "hover:text-danger")} onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden className="size-4" />
                Delete
              </button>
            </>
          )
        }
      />
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this comment?"
        description="It will show as “This comment was removed.” Replies stay. This can't be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="danger" loading={pending} onClick={remove}>
              Delete
            </Button>
          </>
        }
      />
    </>
  );
}
