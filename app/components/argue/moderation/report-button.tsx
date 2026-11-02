"use client";

// Owner: moderation. Report content or a profile (design §4.7). A client component so it works inside both
// Server and Client Components; the server action decides who may report (signed in, not suspended,
// not your own content, can see it).
import { useState } from "react";
import { Flag } from "lucide-react";
import { cn } from "@domain/lib/cn";
import type { ReportTarget } from "@domain/db/schema";
import { ReportDialog } from "./report-dialog";

export interface ReportButtonProps {
  targetType: ReportTarget;
  /** Content id; for `profile`, the user's id. */
  targetId: string;
  className?: string;
}

/** Report content or a profile (opens the reason picker). */
export function ReportButton({ targetType, targetId, className }: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex h-9 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm text-ink-3",
          "transition-colors hover:bg-surface-2 hover:text-ink",
          className,
        )}
      >
        <Flag aria-hidden className="size-4" />
        <span>Report</span>
      </button>
      {open ? <ReportDialog targetType={targetType} targetId={targetId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
