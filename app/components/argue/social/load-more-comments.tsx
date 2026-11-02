import { Button } from "@/components/argue/ui/button";

export interface LoadMoreCommentsProps {
  argumentId: string;
  /** Cursor after the first page. Give the component `key={cursor}` so it resets if page 1 shifts. */
  cursor: string;
}

/**
 * Older comment pages. The reference loaded these through a `"use server"` action that returned
 * server-rendered JSX (`comment-page-action.tsx`), which has no equivalent here, and there is no
 * comments-page action in the port yet. Shown disabled with a plain note rather than pretending to load.
 */
export function LoadMoreComments(_props: LoadMoreCommentsProps) {
  return (
    <div className="flex flex-col gap-1">
      <Button variant="secondary" fullWidth disabled>
        Load more comments
      </Button>
      <p className="text-center text-xs text-ink-3">Older comments aren&apos;t available in this version yet.</p>
    </div>
  );
}
