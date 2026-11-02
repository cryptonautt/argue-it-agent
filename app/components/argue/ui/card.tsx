import type { ComponentProps } from "react";
import { cn } from "@domain/lib/cn";

export interface CardProps extends ComponentProps<"div"> {
  /** "flat" (default) bordered surface; "inset" a recessed well; "judge" the AI-verdict surface. */
  tone?: "flat" | "inset" | "judge";
  /** Remove internal padding (for edge-to-edge content like lists). */
  flush?: boolean;
}

const tones = {
  flat: "bg-surface border border-line",
  inset: "bg-surface-2 border border-transparent",
  judge: "bg-judge-soft border border-judge",
} as const;

export function Card({ tone = "flat", flush = false, className, ...props }: CardProps) {
  return <div className={cn("rounded-[var(--radius)]", tones[tone], !flush && "p-4 sm:p-5", className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mb-3 flex items-start justify-between gap-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"h3">) {
  return <h3 className={cn("text-xl text-ink", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3", className)} {...props} />;
}
