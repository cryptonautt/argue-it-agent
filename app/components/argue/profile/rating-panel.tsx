import { Gavel } from "lucide-react";
import { Badge } from "@/components/argue/ui/badge";
import { Card } from "@/components/argue/ui/card";
import type { CriterionAverage } from "@domain/reputation/criteria";
import type { UserRatingSummary } from "@domain/reputation/types";
import { formatCount, formatRating, formatRecord, formatScore } from "./format";

export interface RatingPanelProps {
  summary: UserRatingSummary;
  criteria: readonly CriterionAverage[];
  strongest: CriterionAverage | null;
}

/**
 * The debate record: rating, W/L/D, category breakdown and rubric averages. Everything here comes from
 * judged challenges only — the community panel is deliberately separate.
 */
export function RatingPanel({ summary, criteria, strongest }: RatingPanelProps) {
  const { overall } = summary;
  const record = formatRecord(overall);
  const played = overall.wins + overall.losses + overall.draws;

  return (
    <section aria-labelledby="debate-record-heading" className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="slant inline-flex h-7 items-center rounded-[3px] bg-ink px-3 font-display font-bold tracking-wide text-ink-inverse">
          <span id="debate-record-heading" className="unslant">
            DEBATE RECORD
          </span>
        </span>
        <span className="text-xs text-ink-3">From AI-judged challenges only</span>
      </div>

      <Card className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
        <div>
          <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Debate rating</p>
          <p className="flex items-baseline gap-2">
            <span className="tabular font-display text-6xl leading-none text-ink">{formatRating(overall.rating)}</span>
            {overall.provisional ? (
              <Badge tone="outline" title="Ratings settle after a few judged debates.">
                Provisional
              </Badge>
            ) : null}
          </p>
          {overall.provisional ? (
            <p className="mt-1 text-xs text-ink-3">Settles after a few more judged debates.</p>
          ) : null}
        </div>

        <dl className="grid grid-cols-3 gap-2 text-center" aria-label={`Record: ${record.long}`}>
          <RecordStat label="Wins" value={overall.wins} className="text-success" />
          <RecordStat label="Losses" value={overall.losses} className="text-danger" />
          <RecordStat label="Draws" value={overall.draws} className="text-ink-2" />
        </dl>
      </Card>

      {played === 0 ? (
        <p className="text-sm text-ink-2">No judged debates yet. The rating starts at 1,500 and moves only with challenge results.</p>
      ) : null}

      {summary.categories.length > 0 ? (
        <Card>
          <h3 className="mb-3 text-xl text-ink">By category</h3>
          <ul className="divide-y divide-line">
            {summary.categories.map((c) => (
              <li key={c.categoryId} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{c.name}</span>
                  <span className="tabular text-xs text-ink-3" aria-label={formatRecord(c).long}>
                    {formatRecord(c).short}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {c.provisional ? <Badge tone="outline">Provisional</Badge> : null}
                  <span className="tabular font-display text-2xl text-ink">{formatRating(c.rating)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {criteria.length > 0 ? (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xl text-ink">Average judge scores</h3>
            {strongest ? (
              <Badge tone="judge">
                <Gavel aria-hidden className="size-3.5" />
                Strongest at: {strongest.label}
              </Badge>
            ) : null}
          </div>
          <ul className="space-y-3">
            {criteria.map((c) => (
              <li key={c.key}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold text-ink-2">{c.label}</span>
                  <span className="text-ink-3">
                    <span className="tabular font-display text-lg text-ink">{formatScore(c.average)}</span>
                    <span className="text-xs"> / 10 · {formatCount(c.count)} {c.count === 1 ? "debate" : "debates"}</span>
                  </span>
                </div>
                <div
                  role="img"
                  aria-label={`${c.label}: average ${formatScore(c.average)} out of 10 over ${c.count} judged ${c.count === 1 ? "debate" : "debates"}`}
                  className="h-2.5 overflow-hidden rounded-full bg-surface-2"
                >
                  <div className="h-full rounded-full bg-ink-2" style={{ width: `${Math.min(100, Math.max(0, c.average * 10))}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-3">
            Per-criterion scores the AI judge gave this debater&apos;s side, averaged across judged debates. Rubrics vary by category.
          </p>
        </Card>
      ) : null}

      <details className="rounded-[var(--radius)] border border-line px-4 py-3 text-sm text-ink-2">
        <summary className="cursor-pointer font-semibold text-ink">How the rating works</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Everyone starts at 1,500. Beating a higher-rated debater moves you more than beating a lower-rated one.</li>
          <li>Wins, losses and draws come only from AI-judged challenges. A no-show forfeit counts at half weight.</li>
          <li>Inconclusive and cancelled debates don&apos;t change anyone&apos;s rating. If an appeal changes a verdict, the rating is recalculated.</li>
          <li>Followers, reactions, positions and comments never affect the rating.</li>
        </ul>
      </details>
    </section>
  );
}

function RecordStat({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] bg-surface-2 px-2 py-2">
      <dt className="text-[0.7rem] font-semibold tracking-wide text-ink-3 uppercase">{label}</dt>
      <dd className={`tabular font-display text-3xl leading-tight ${className}`}>{formatCount(value)}</dd>
    </div>
  );
}
