"use client";

import { useState, useTransition, type ReactNode } from "react";
import { ArgumentCard } from "@/components/argue/arguments/argument-card";
import { Button } from "@/components/argue/ui/button";
import { useToast } from "@/components/argue/ui/toast";
import { loadFeedPage } from "@/lib/server-actions";
import type { FeedTab } from "@domain/arguments/feed-params";
import type { ArgumentCardData } from "@domain/arguments/types";

export interface FeedListProps {
  tab: FeedTab;
  categorySlug: string | null;
  initialItems: ArgumentCardData[];
  initialCursor: string | null;
  /** Rendered when the first page is empty. */
  empty: ReactNode;
  /** Rendered after the last page. */
  end?: ReactNode;
}

/**
 * The feed: server-rendered first page, then "Load more" fetches the next cursor page and appends it
 * (de-duplicated by id). A button rather than infinite scroll: predictable on slow connections and data plans.
 */
export function FeedList({ tab, categorySlug, initialItems, initialCursor, empty, end }: FeedListProps) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState("");
  const { error } = useToast();

  if (items.length === 0) return <>{empty}</>;

  function loadMore() {
    if (!cursor) return;
    startTransition(async () => {
      const result = await loadFeedPage({ tab, category: categorySlug, cursor });
      if (!result.ok) {
        error(result.error);
        return;
      }
      setItems((current) => {
        const seen = new Set(current.map((i) => i.id));
        return [...current, ...result.data.items.filter((i) => !seen.has(i.id))];
      });
      setCursor(result.data.nextCursor);
      setStatus(`Loaded ${result.data.items.length} more arguments.`);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id}>
            <ArgumentCard argument={item} showDeadline={tab === "ending" || tab === "active"} />
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
      {cursor ? (
        <Button variant="secondary" fullWidth onClick={loadMore} loading={pending} className="mt-2">
          Load more
        </Button>
      ) : (
        end
      )}
    </div>
  );
}
