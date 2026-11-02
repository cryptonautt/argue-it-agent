import Link from "@/shims/next-link";
import { MessageSquare, Swords, Users } from "lucide-react";
import { cn } from "@domain/lib/cn";
import { formatRelative } from "@domain/lib/time";
import { Avatar } from "@/components/argue/ui/avatar";
import { Badge } from "@/components/argue/ui/badge";
import { Countdown } from "@/components/argue/ui/countdown";
import { SplitBar } from "@/components/argue/ui/score-bar";
import { SideTag } from "@/components/argue/ui/side-tag";
import type { ArgumentCardData } from "@domain/arguments/types";

const nf = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });

export interface ArgumentCardProps {
  argument: ArgumentCardData;
  /** Emphasise the nearest debate deadline (Ending Soon tab). */
  showDeadline?: boolean;
  /** Heading level for the title (default h2 — feed pages have an h1 above). */
  headingLevel?: "h2" | "h3";
  className?: string;
}

/**
 * Feed/search card. One stretched link (the title) makes the whole card tappable without nesting
 * interactive elements; the author link sits above it. All user text is rendered as text.
 */
export function ArgumentCard({ argument, showDeadline = false, headingLevel = "h2", className }: ArgumentCardProps) {
  const Heading = headingLevel;
  const { counts } = argument;
  const positions = counts.agree + counts.against;
  const href = `/a/${argument.id}`;

  return (
    <article
      className={cn(
        "group relative flex flex-col gap-3 rounded-[var(--radius)] border border-line bg-surface p-4 transition-colors",
        "focus-within:border-line-strong hover:border-line-strong sm:p-5",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3 text-sm">
        <AuthorLine argument={argument} />
        <Badge tone="outline" className="shrink-0">
          {argument.category.name}
        </Badge>
      </header>

      <div>
        <Heading className="text-2xl leading-tight text-ink sm:text-[1.7rem]">
          <Link
            href={href}
            className="outline-none after:absolute after:inset-0 after:rounded-[var(--radius)] after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus"
          >
            {argument.title}
          </Link>
        </Heading>
        <p className="mt-1.5 line-clamp-3 text-[0.95rem] text-ink-2">
          <span className="sr-only">Proposition: </span>
          {argument.proposition}
        </p>
      </div>

      <SplitBar
        forValue={counts.agree}
        againstValue={counts.against}
        size="sm"
        showLegend={positions > 0}
        className={positions === 0 ? "opacity-60" : undefined}
      />

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <Users aria-hidden className="size-4" />
          <span className="tabular">{nf.format(positions)}</span>
          <span className="sr-only">{positions === 1 ? "position" : "positions"}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MessageSquare aria-hidden className="size-4" />
          <span className="tabular">{nf.format(counts.comments)}</span>
          <span className="sr-only">{counts.comments === 1 ? "comment" : "comments"}</span>
        </span>
        {counts.liveDebates > 0 ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <Swords aria-hidden className="size-4" />
            {counts.liveDebates === 1 ? "Live debate" : `${counts.liveDebates} live debates`}
          </span>
        ) : null}
        {showDeadline && argument.nextDeadline ? (
          <Countdown deadline={argument.nextDeadline} label="Round closes in" className="font-semibold text-warning" />
        ) : null}
        {argument.viewerSide ? (
          <span className="ml-auto inline-flex items-center gap-1.5">
            <span className="text-xs">You:</span>
            <SideTag side={argument.viewerSide} size="sm" variant="soft" />
          </span>
        ) : null}
      </footer>
    </article>
  );
}

function AuthorLine({ argument }: { argument: ArgumentCardData }) {
  const { author } = argument;
  const time = (
    <time dateTime={argument.createdAt} suppressHydrationWarning className="text-ink-3">
      {formatRelative(argument.createdAt)}
    </time>
  );
  const identity = (
    <>
      <Avatar name={author.displayName} src={author.avatarUrl} size="xs" />
      <span className="truncate font-semibold text-ink">{author.displayName}</span>
    </>
  );
  return (
    <div className="flex min-w-0 items-center gap-2">
      {author.handle ? (
        <Link
          href={`/u/${author.handle}`}
          className="relative z-10 flex min-w-0 items-center gap-2 rounded-full hover:underline"
        >
          {identity}
        </Link>
      ) : (
        <span className="flex min-w-0 items-center gap-2">{identity}</span>
      )}
      <span aria-hidden className="text-ink-3">
        ·
      </span>
      {time}
    </div>
  );
}
