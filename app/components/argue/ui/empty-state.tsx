import type { ReactNode } from "react";
import { cn } from "@domain/lib/cn";

export interface EmptyStateProps {
  /** A lucide icon element, e.g. <MessageSquare />. */
  icon?: ReactNode;
  title: string;
  /** One sentence pointing to the next action. */
  description?: ReactNode;
  /** Usually a ButtonLink. */
  action?: ReactNode;
  className?: string;
}

/** Empty screens are invitations to act: say what's missing and offer the next step. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-[var(--radius)] border border-dashed border-line-strong px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? <div className="text-ink-3 [&_svg]:size-8">{icon}</div> : null}
      <h2 className="text-2xl text-ink">{title}</h2>
      {description ? <p className="max-w-sm text-sm text-ink-2">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
