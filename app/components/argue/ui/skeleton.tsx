import type { ComponentProps } from "react";
import { cn } from "@domain/lib/cn";

/** Loading placeholder block. Size it with className (e.g. "h-4 w-2/3"). */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("animate-[skeleton-pulse_1.6s_ease-in-out_infinite] rounded-[var(--radius-sm)] bg-surface-2", className)}
      {...props}
    />
  );
}

/** A card-shaped skeleton for feeds and lists. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-[var(--radius)] border border-line bg-surface p-4", className)} aria-hidden>
      <div className="flex items-center gap-2">
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-3 w-28" />
      </div>
      <Skeleton className="mt-4 h-6 w-4/5" />
      <Skeleton className="mt-2 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-2/3" />
      <Skeleton className="mt-4 h-3 w-full" />
    </div>
  );
}
