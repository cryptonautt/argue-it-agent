import { EyeOff, Trash2 } from "lucide-react";
import { cn } from "@domain/lib/cn";

export interface RemovedArgumentNoticeProps {
  /** removed: gone for good; hidden: under moderator review. */
  status: "removed" | "hidden";
  /** For removed arguments: who removed it. */
  removedBy?: "author" | "moderators" | null;
  /** The viewer can still see the content below (author or staff). */
  revealed?: boolean;
  className?: string;
}

/**
 * Placeholder for an argument that is no longer public (design §4.7). Comments and challenges linked to it
 * are kept and still shown under this notice. Reusable by any team that renders a root argument.
 */
export function RemovedArgumentNotice({ status, removedBy = null, revealed = false, className }: RemovedArgumentNoticeProps) {
  const Icon = status === "hidden" ? EyeOff : Trash2;
  let title: string;
  let body: string;
  if (status === "hidden") {
    title = "This argument is hidden";
    body = revealed
      ? "Moderators are reviewing it. Only you and the moderation team can see it until then."
      : "Moderators are reviewing it. The discussion and any debates on it are kept.";
  } else {
    title = removedBy === "author" ? "This argument was deleted by its author" : "This argument was removed";
    body = revealed
      ? "It's no longer public. You can see it because you're on the moderation team."
      : "The original post is gone, but the discussion and any debates on it are kept.";
  }

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-[var(--radius)] border border-dashed border-line-strong bg-surface-2 px-4 py-4",
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-3" />
      <div>
        <p className="font-display text-xl text-ink">{title}</p>
        <p className="mt-0.5 text-sm text-ink-2">{body}</p>
      </div>
    </div>
  );
}
