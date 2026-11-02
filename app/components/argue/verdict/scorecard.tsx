// Owner: verdict. "Tale of the tape": one ScoreBar per rubric criterion, with the judge's reason and the
// verbatim quotes it relied on for each side.
import { ChevronDown, Quote } from "lucide-react";
import { ScoreBar } from "@/components/argue/ui/score-bar";
import { SideTag } from "@/components/argue/ui/side-tag";
import { cn } from "@domain/lib/cn";
import type { SideLabel, VerdictExplanation, VerdictScores } from "@domain/db/json-types";
import type { SidePair } from "@domain/appeals/verdict-view";

export function QuoteList({ quotes, side, name }: { quotes: readonly string[]; side: SideLabel; name: string }) {
  if (quotes.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-2" aria-label={`Quotes from ${name}`}>
      {quotes.map((quote, i) => (
        <li key={`${i}-${quote.slice(0, 24)}`}>
          <blockquote
            className={cn(
              "relative rounded-r-[var(--radius-sm)] border-l-4 bg-surface-2 py-2 pr-3 pl-8 text-sm text-ink",
              side === "A" ? "border-for" : "border-against-bright",
            )}
          >
            <Quote aria-hidden className="absolute top-2.5 left-2.5 size-3.5 text-ink-3" />
            {quote}
          </blockquote>
        </li>
      ))}
    </ul>
  );
}

function SideReason({
  side,
  sides,
  reason,
  quotes,
}: {
  side: SideLabel;
  sides: SidePair;
  reason: string;
  quotes: string[];
}) {
  const person = sides[side];
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <SideTag side={person.stance} size="sm" />
        <span className="truncate text-sm font-semibold text-ink">{person.displayName}</span>
      </div>
      <p className="mt-1.5 text-sm text-ink-2">{reason || "No reason recorded."}</p>
      <QuoteList quotes={quotes} side={side} name={person.displayName} />
    </div>
  );
}

export interface ScorecardProps {
  scores: VerdictScores;
  explanation: VerdictExplanation | null;
  sides: SidePair;
  hiddenQuoteCount?: number;
  /** A human replaced the AI's outcome; these are the AI's original scores. */
  aiScoresOnly?: boolean;
  /** The result is inconclusive: explain that these averages don't make a winner. */
  inconclusive?: boolean;
}

export function Scorecard({
  scores,
  explanation,
  sides,
  hiddenQuoteCount = 0,
  aiScoresOnly = false,
  inconclusive = false,
}: ScorecardProps) {
  const reasons = new Map((explanation?.perCriterion ?? []).map((c) => [c.key, c]));
  return (
    <section aria-labelledby="scorecard-title" className="flex flex-col gap-4">
      <div>
        <h2 id="scorecard-title" className="text-3xl text-ink">
          {aiScoresOnly ? "The AI's scorecard" : "Tale of the tape"}
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          {aiScoresOnly
            ? "A human reviewer replaced the AI's outcome. These are the AI's original scores, kept for transparency."
            : "Both sides scored 0–10 on the same criteria. The percentage is how much each criterion counts."}
          {inconclusive
            ? " These are averages across judging passes that didn't agree confidently, so they don't add up to a winner."
            : ""}
        </p>
      </div>

      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="truncate text-for-strong">{sides.A.displayName}</span>
        <span className="truncate text-against-strong">{sides.B.displayName}</span>
      </div>

      <ol className="flex flex-col gap-3">
        {scores.criteria.map((criterion) => {
          const detail = reasons.get(criterion.key);
          return (
            <li key={criterion.key} className="rounded-[var(--radius)] border border-line bg-surface p-3">
              <ScoreBar label={criterion.label} weight={criterion.weight} forValue={criterion.A} againstValue={criterion.B} />
              {detail ? (
                <details className="group mt-2">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-1 rounded-[var(--radius-sm)] text-sm font-semibold text-ink-2 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                    Why these scores
                    <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2">
                    <SideReason side="A" sides={sides} reason={detail.A.reason} quotes={detail.A.quotes} />
                    <SideReason side="B" sides={sides} reason={detail.B.reason} quotes={detail.B.quotes} />
                  </div>
                </details>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-ink-3">
        Quotes are copied word-for-word from each side&rsquo;s submission and checked by the system; a quote the judge
        couldn&rsquo;t find in the text is thrown out and lowers its confidence.
        {hiddenQuoteCount > 0
          ? ` ${hiddenQuoteCount} quote${hiddenQuoteCount === 1 ? " is" : "s are"} hidden because the submission was removed by moderators (the scores are unchanged).`
          : ""}
      </p>
    </section>
  );
}
