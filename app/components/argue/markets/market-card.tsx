import type { MarketEventSummary } from "@domain/polymarket/markets";
import Link from "@/shims/next-link";

import { formatMarketDate, formatPercent, formatUsd } from "./format";

/** One Polymarket event in the /markets grid. The title is the single stretched link. */
export function MarketCard({ event }: { event: MarketEventSummary }) {
  const ends = formatMarketDate(event.endDate);
  return (
    <article className="relative flex flex-col gap-3 rounded-[var(--radius)] border border-line bg-surface p-4 transition-colors hover:border-line-strong">
      <div className="flex items-start gap-3">
        {event.image ? (
          <img src={event.image} alt="" className="size-11 shrink-0 rounded-[var(--radius-sm)] object-cover" />
        ) : null}
        <h2 className="text-base leading-snug font-semibold text-ink">
          <Link href={`/markets/${encodeURIComponent(event.slug)}`} className="after:absolute after:inset-0">
            {event.title}
          </Link>
        </h2>
      </div>
      <ul className="flex flex-col gap-1.5">
        {event.leaders.map((leader) => (
          <li key={leader.marketId} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-ink-2">{leader.label}</span>
            <span className="shrink-0 font-semibold text-ink">{formatPercent(leader.yesPrice)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-auto text-xs text-ink-3">
        {formatUsd(event.volume, { compact: true })} vol
        {event.outcomeCount > event.leaders.length ? ` · ${event.outcomeCount} options` : ""}
        {ends ? ` · ends ${ends}` : ""}
      </p>
    </article>
  );
}
