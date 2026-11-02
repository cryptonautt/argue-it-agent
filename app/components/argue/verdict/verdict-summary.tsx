// Owner: verdict. Compact "The AI verdict is in" card for the argument page and profiles.
// Async Server Component: callers pass only the competition id (CONVENTIONS §8).
import Link from "@/shims/next-link";
import { ChevronRight, Gavel, Hourglass, UserCheck } from "lucide-react";
import { Badge } from "@/components/argue/ui/badge";
import { SplitBar } from "@/components/argue/ui/score-bar";
import { SideTag } from "@/components/argue/ui/side-tag";
import { cn } from "@domain/lib/cn";
import { getVerdictSummaryData } from "@domain/appeals/queries";
import { verdictKicker } from "@domain/appeals/verdict-view";
import { ConfidenceMeter } from "./confidence";

export interface VerdictSummaryProps {
  competitionId: string;
}

const nf = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Compact verdict card (outcome, both names, totals, confidence) linking to /c/[id]/verdict. */
export async function VerdictSummary({ competitionId }: VerdictSummaryProps) {
  if (!UUID.test(competitionId)) return null;
  const data = await getVerdictSummaryData(competitionId);
  if (!data) return null;
  const href = `/c/${competitionId}/verdict`;
  const { A, B } = data.sides;
  const v = data.verdict;

  if (!v) {
    if (data.status !== "evaluating" && data.status !== "locked" && data.status !== "needs_review") return null;
    const reviewing = data.status === "needs_review";
    return (
      <Link
        href={href}
        className="flex items-center gap-3 rounded-[var(--radius)] border border-dashed border-judge bg-judge-soft p-3 text-on-judge hover:brightness-[0.98]"
      >
        {reviewing ? <UserCheck aria-hidden className="size-5 shrink-0" /> : <Hourglass aria-hidden className="size-5 shrink-0" />}
        <span className="min-w-0 flex-1 text-sm">
          <span className="block font-semibold">{reviewing ? "A human is checking this result" : "The AI judge is reviewing"}</span>
          <span className="block truncate">
            {A.displayName} vs {B.displayName}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0" />
      </Link>
    );
  }

  const winner = v.outcomeView.winnerSide;
  // Totals only for a settled AI result: never next to "inconclusive" or a human decision that replaced them.
  const totals = v.outcome === "inconclusive" || v.decidedBy === "human" ? null : v.totals;
  return (
    <Link
      href={href}
      aria-label={`Verdict: ${v.outcomeView.headline}. ${A.displayName} versus ${B.displayName}. Open the full verdict.`}
      className="group block rounded-[var(--radius)] border-2 border-judge bg-surface p-3 transition-colors hover:bg-judge-soft"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wider text-ink">
          <Gavel aria-hidden className="size-4" />
          {verdictKicker(v.outcome, v.decidedBy)}
        </span>
        <span className="flex items-center gap-1.5">
          {data.status === "under_appeal" ? <Badge tone="warning">Under appeal</Badge> : null}
          {data.status === "evaluating" ? <Badge tone="warning">Being re-evaluated</Badge> : null}
          {data.status === "needs_review" ? <Badge tone="warning">Human review</Badge> : null}
          <ChevronRight aria-hidden className="size-4 text-ink-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>

      <p className="mt-1.5 font-display text-2xl font-bold leading-tight text-ink">{v.outcomeView.headline}</p>

      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
        <span className={cn("flex min-w-0 items-center gap-1.5", winner === "B" && "opacity-70")}>
          <SideTag side="FOR" size="sm" />
          <span className="truncate font-semibold text-ink">{A.displayName}</span>
          {totals ? <span className="tabular font-display text-lg text-for-strong">{nf.format(totals.A)}</span> : null}
        </span>
        <span className={cn("flex min-w-0 items-center justify-end gap-1.5", winner === "A" && "opacity-70")}>
          {totals ? <span className="tabular font-display text-lg text-against-strong">{nf.format(totals.B)}</span> : null}
          <span className="truncate font-semibold text-ink">{B.displayName}</span>
          <SideTag side="AGAINST" size="sm" />
        </span>
      </div>
      {totals ? (
        <SplitBar
          className="mt-2"
          size="sm"
          forValue={totals.A}
          againstValue={totals.B}
          forLabel={A.displayName}
          againstLabel={B.displayName}
          showLegend={false}
        />
      ) : null}
      {v.confidenceLabel ? <ConfidenceMeter label={v.confidenceLabel} className="mt-2" /> : null}
    </Link>
  );
}
