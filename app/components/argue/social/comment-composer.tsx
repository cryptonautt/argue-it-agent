"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { ButtonLink, Button } from "@/components/argue/ui/button";
import { Textarea } from "@/components/argue/ui/textarea";
import { useToast } from "@/components/argue/ui/toast";
import type { FieldErrors } from "@domain/lib/action-result";
import { createComment } from "@domain/lib/server-actions";
import type { CommentView } from "@domain/social/types";
import { useComments } from "./comments-context";

export const COMMENT_MAX_CHARS = 2000;

export interface CommentComposerProps {
  /** Set for replies: the comment being answered. */
  parentCommentId?: string;
  /** Prefill (e.g. "@handle " when answering a reply). */
  initialBody?: string;
  onPosted: (comment: CommentView) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

/**
 * "Comment (free discussion — not judged)". Comments never reach the AI judge; the label says so every
 * time so nobody mistakes a comment for a competition entry (design §4.1, PRD §8.4).
 */
export function CommentComposer({ parentCommentId, initialBody = "", onPosted, onCancel, autoFocus }: CommentComposerProps) {
  const { argumentId, viewerSide, canComment, closedReason, signInHref, viewer } = useComments();
  const [body, setBody] = useState(initialBody);
  const [showPosition, setShowPosition] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const checkboxId = useId();
  const { error } = useToast();
  const isReply = parentCommentId !== undefined;

  useEffect(() => {
    if (!autoFocus) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  if (!viewer) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-dashed border-line-strong px-4 py-3">
        <p className="text-sm text-ink-2">Sign in to join the discussion. Comments are free and never judged.</p>
        <ButtonLink href={signInHref} variant="secondary" size="sm">
          Sign in to comment
        </ButtonLink>
      </div>
    );
  }
  if (!canComment) {
    return <p className="rounded-[var(--radius)] bg-surface-2 px-4 py-3 text-sm text-ink-2">{closedReason}</p>;
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (pending) return;
    const text = body.trim();
    if (!text) {
      setFieldErrors({ body: ["Write something first."] });
      return;
    }
    startTransition(async () => {
      const result = await createComment({ argumentId, parentCommentId, body: text, showPosition, idempotencyKey });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        error(result.error);
        return;
      }
      setFieldErrors({});
      setBody("");
      setIdempotencyKey(crypto.randomUUID());
      onPosted(result.data);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
    if (event.key === "Escape" && onCancel) onCancel();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" aria-busy={pending || undefined}>
      <Textarea
        ref={textareaRef}
        label={isReply ? "Reply (free discussion — not judged)" : "Comment (free discussion — not judged)"}
        hint={isReply ? undefined : "Comments are never sent to the AI judge. For a judged debate, use Challenge this."}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
        maxLength={COMMENT_MAX_CHARS}
        showCount
        rows={isReply ? 3 : 4}
        error={fieldErrors.body}
        placeholder={isReply ? "Write a reply…" : "What do you think?"}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {viewerSide ? (
          <label htmlFor={checkboxId} className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-2">
            <input
              id={checkboxId}
              type="checkbox"
              checked={showPosition}
              onChange={(event) => setShowPosition(event.target.checked)}
              className="size-4 accent-[var(--ink)]"
            />
            Show my position ({viewerSide})
          </label>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {onCancel ? (
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" variant="primary" size="sm" loading={pending}>
            {isReply ? "Post reply" : "Post comment"}
          </Button>
        </div>
      </div>
    </form>
  );
}
