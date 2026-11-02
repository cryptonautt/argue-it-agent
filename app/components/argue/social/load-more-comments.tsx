"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/argue/ui/button";
import { useToast } from "@/components/argue/ui/toast";
import { loadMoreComments } from "./comment-page-action";

export interface LoadMoreCommentsProps {
  argumentId: string;
  /** Cursor after the server-rendered first page. Give the component `key={cursor}` so it resets if page 1 shifts. */
  cursor: string;
}

/** Appends older comment pages (server-rendered) below the first page. */
export function LoadMoreComments({ argumentId, cursor: initialCursor }: LoadMoreCommentsProps) {
  const [pages, setPages] = useState<Array<{ cursor: string; node: ReactNode }>>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [pending, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const { error } = useToast();

  function load() {
    if (!cursor) return;
    const from = cursor;
    startTransition(async () => {
      const result = await loadMoreComments({ argumentId, cursor: from });
      if (!result.ok) {
        error(result.error);
        return;
      }
      setPages((list) => [...list, { cursor: from, node: result.data.node }]);
      setCursor(result.data.nextCursor);
      setAnnouncement(`Loaded ${result.data.count} more comments.`);
    });
  }

  return (
    <>
      {pages.map((page) => (
        <ol key={page.cursor} className="flex flex-col divide-y divide-line">
          {page.node}
        </ol>
      ))}
      {cursor ? (
        <Button variant="secondary" fullWidth loading={pending} onClick={load}>
          Load more comments
        </Button>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
