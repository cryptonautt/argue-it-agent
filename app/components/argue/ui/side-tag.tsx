import type { ReactNode } from "react";
import { cn } from "@domain/lib/cn";

/** FOR/AGAINST (competition sides) and AGREE/AGAINST (free positions) share the same two colours. */
export type Side = "FOR" | "AGAINST" | "AGREE";

export function sideTone(side: Side): "for" | "against" {
  return side === "AGAINST" ? "against" : "for";
}

const solid = { for: "bg-for text-on-for", against: "bg-against text-on-against" } as const;
const soft = { for: "bg-for-soft text-for-strong", against: "bg-against-soft text-against-strong" } as const;
const sizes = {
  sm: "h-5 px-2 text-[0.7rem]",
  md: "h-7 px-3 text-sm",
  lg: "h-10 px-4 text-xl",
} as const;

export interface SideTagProps {
  side: Side;
  size?: keyof typeof sizes;
  variant?: "solid" | "soft";
  /** Override the label (default: the side word). E.g. "FOR · Side A". */
  children?: ReactNode;
  className?: string;
}

/**
 * The slanted broadcast chyron that marks a side everywhere in the product. Always pair colour with the
 * word (never colour alone) so the meaning survives colour blindness and greyscale screens.
 */
export function SideTag({ side, size = "md", variant = "solid", children, className }: SideTagProps) {
  const tone = sideTone(side);
  return (
    <span
      className={cn(
        "slant inline-flex shrink-0 items-center rounded-[3px] font-display font-bold tracking-wide",
        sizes[size],
        variant === "solid" ? solid[tone] : soft[tone],
        className,
      )}
    >
      <span className="unslant">{children ?? side}</span>
    </span>
  );
}
