import { cn } from "@domain/lib/cn";
import { SideTag } from "@/components/argue/ui/side-tag";

export interface PropositionBlockProps {
  proposition: string;
  className?: string;
}

/**
 * The claim people take sides on, framed like a broadcast lower-third: the statement with the two
 * positions it splits the room into. Used on the argument page and the create-form preview.
 */
export function PropositionBlock({ proposition, className }: PropositionBlockProps) {
  return (
    <figure className={cn("overflow-hidden rounded-[var(--radius)] border border-line bg-surface-2", className)}>
      <figcaption className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs font-bold tracking-wide text-ink-3 uppercase">
        <span>The proposition</span>
        <span className="flex items-center gap-1.5" aria-hidden>
          <SideTag side="AGREE" size="sm" />
          <span className="font-display text-sm text-ink-3 italic">or</span>
          <SideTag side="AGAINST" size="sm" />
        </span>
      </figcaption>
      <blockquote className="px-4 py-4 font-display text-2xl leading-snug font-bold text-ink sm:text-3xl">
        {proposition}
      </blockquote>
    </figure>
  );
}
