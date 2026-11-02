import type { ComponentProps } from "react";
import { cn } from "@domain/lib/cn";

export type BadgeTone = "neutral" | "outline" | "for" | "against" | "judge" | "success" | "danger" | "warning";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  outline: "border border-line-strong text-ink-2",
  for: "bg-for-soft text-for-strong",
  against: "bg-against-soft text-against-strong",
  judge: "bg-judge text-on-judge",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
};

export interface BadgeProps extends ComponentProps<"span"> {
  tone?: BadgeTone;
}

/** Small status label: categories, "Provisional", "Under appeal", counts. */
export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
