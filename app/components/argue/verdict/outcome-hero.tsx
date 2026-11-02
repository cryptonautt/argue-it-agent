// Owner: verdict. The verdict hero: proposition, the two named sides, the outcome, totals and confidence.
import { Flag, Gavel, Handshake, Scale, UserCheck } from "lucide-react";
import { Badge } from "@/components/argue/ui/badge";
import { SplitBar } from "@/components/argue/ui/score-bar";
import { cn } from "@domain/lib/cn";
import type { CompetitionHeader, VerdictRecord } from "@domain/appeals/queries";
import { verdictKicker } from "@domain/appeals/verdict-view";
import { ConfidenceMeter } from "./confidence";
import { Matchup } from "./matchup";

const nf = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

const KIND_ICON = { win: Gavel, draw: Handshake, inconclusive: Scale, forfeit: Flag } as const;

export interface OutcomeHeroProps {
  header: CompetitionHeader;
  verdict: VerdictRecord;
  underAppeal?: boolean;
  reevaluating?: boolean;
}

export function OutcomeHero({ header, verdict, underAppeal = false, reevaluating = false }: OutcomeHeroProps) {
  const { outcomeView, scores } = verdict;
  const Icon = KIND_ICON[outcomeView.kind];
  const human = verdict.decidedBy === "human";
  const { A, B } = header.sides;

  return (
    <section aria-labelledby="verdict-headline" className="overflow-hidden rounded-[var(--radius-lg)] border-2 border-judge bg-surface">
      <div className="flex items-center justify-between gap-2 bg-judge px-4 py-2 text-on-judge">
        <span className="inline-flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wider">
          {human ? (
            <UserCheck aria-hidden className="size-5" />
          ) : verdict.outcome === "forfeit" ? (
            <Flag aria-hidden className="size-5" />
          ) : (
            <Gavel aria-hidden className="size-5" />
          )}
          {verdictKicker(verdict.outcome, verdict.decidedBy)}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide">{header.category.name}</span>
      </div>

      <div className="flex flex-col gap-5 p-4 sm:p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">The proposition</p>
          <p className="mt-1 font-display text-2xl font-bold leading-tight text-ink sm:text-3xl">
            &ldquo;{header.proposition}&rdquo;
          </p>
        </div>

        <Matchup sides={header.sides} winnerSide={outcomeView.winnerSide} />

        <div className={cn("rounded-[var(--radius)] p-4", outcomeView.winnerSide ? "bg-judge-soft" : "bg-surface-2")}>
          <div className="flex items-start gap-3">
            <Icon aria-hidden className="mt-1 size-7 shrink-0 text-ink" />
            <div className="min-w-0">
              <h1 id="verdict-headline" className="text-4xl text-ink sm:text-5xl">
                {outcomeView.headline}
              </h1>
              <p className="mt-1 text-ink-2">{outcomeView.subline}</p>
            </div>
          </div>
        </div>

        {/* Big totals only for a settled AI result: on "inconclusive" they'd suggest a winner the judge didn't
            pick, and after a human decision they're the AI's replaced numbers (still shown in the scorecard). */}
        {scores && verdict.outcome !== "inconclusive" && !human ? (
          <div>
            <div className="flex items-end justify-between gap-3">
              <div>
                <span className="tabular font-display text-4xl font-bold text-for-strong">{nf.format(scores.totals.A)}</span>
                <span className="ml-1 text-xs text-ink-3">/ {scores.maxTotal}</span>
              </div>
              <span className="pb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">
                Weighted score
              </span>
              <div className="text-right">
                <span className="tabular font-display text-4xl font-bold text-against-strong">{nf.format(scores.totals.B)}</span>
                <span className="ml-1 text-xs text-ink-3">/ {scores.maxTotal}</span>
              </div>
            </div>
            <SplitBar
              className="mt-2"
              size="lg"
              forValue={scores.totals.A}
              againstValue={scores.totals.B}
              forLabel={A.displayName}
              againstLabel={B.displayName}
              showLegend={false}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          {verdict.confidenceLabel ? <ConfidenceMeter label={verdict.confidenceLabel} className="mr-2" /> : null}
          {human ? <Badge tone="outline">Decided by a human reviewer</Badge> : null}
          {underAppeal ? <Badge tone="warning">Under appeal</Badge> : null}
          {reevaluating ? <Badge tone="warning">Re-evaluation in progress</Badge> : null}
          {verdict.version > 1 ? <Badge tone="neutral">Revised verdict · v{verdict.version}</Badge> : null}
        </div>
      </div>
    </section>
  );
}
