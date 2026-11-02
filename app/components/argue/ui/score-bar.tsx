import { cn } from "@domain/lib/cn";

const nf = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

export interface SplitBarProps {
  /** Left (blue) value, e.g. AGREE count. */
  forValue: number;
  /** Right (orange) value, e.g. AGAINST count. */
  againstValue: number;
  forLabel?: string;
  againstLabel?: string;
  /** Show labels + percentages under the bar (default true). */
  showLegend?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const heights = { sm: "h-2", md: "h-3.5", lg: "h-6" } as const;

/**
 * Tug-of-war bar: one track split between the two sides at a slanted seam. Used for positions
 * (AGREE vs AGAINST) and verdict totals.
 */
export function SplitBar({
  forValue,
  againstValue,
  forLabel = "AGREE",
  againstLabel = "AGAINST",
  showLegend = true,
  size = "md",
  className,
}: SplitBarProps) {
  const total = forValue + againstValue;
  const forPct = total === 0 ? 50 : (forValue / total) * 100;
  const againstPct = 100 - forPct;
  const label =
    total === 0
      ? `No ${forLabel} or ${againstLabel} yet`
      : `${forLabel} ${Math.round(forPct)}%, ${againstLabel} ${Math.round(againstPct)}%`;

  return (
    <div className={className}>
      <div role="img" aria-label={label} className={cn("relative flex w-full overflow-hidden rounded-full bg-surface-2", heights[size])}>
        {total > 0 ? (
          <>
            <div className="h-full bg-for transition-[width] duration-500 ease-[var(--ease-out)]" style={{ width: `${forPct}%` }} />
            <div className="h-full flex-1 bg-against-bright" />
            {forValue > 0 && againstValue > 0 ? (
              <span
                aria-hidden
                className="slant absolute inset-y-[-2px] w-[3px] bg-surface"
                style={{ left: `calc(${forPct}% - 1.5px)` }}
              />
            ) : null}
          </>
        ) : null}
      </div>
      {showLegend ? (
        <div className="mt-1.5 flex justify-between text-xs font-semibold">
          <span className="text-for-strong">
            {forLabel} <span className="tabular">{total === 0 ? "–" : `${Math.round(forPct)}%`}</span>
          </span>
          <span className="text-against-strong">
            <span className="tabular">{total === 0 ? "–" : `${Math.round(againstPct)}%`}</span> {againstLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export interface ScoreBarProps {
  /** Criterion name, e.g. "Evidence". */
  label: string;
  /** Side A (FOR) score. */
  forValue: number;
  /** Side B (AGAINST) score. */
  againstValue: number;
  /** Scale maximum (default 10). */
  max?: number;
  /** Optional weight to show, e.g. 30 → "30%". */
  weight?: number;
  className?: string;
}

/**
 * "Tale of the tape" comparison row: FOR grows left from the centre line, AGAINST grows right, with the
 * scores at the outer ends. One per rubric criterion on the verdict page.
 */
export function ScoreBar({ label, forValue, againstValue, max = 10, weight, className }: ScoreBarProps) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const forWins = forValue > againstValue;
  const againstWins = againstValue > forValue;
  return (
    <div
      role="img"
      aria-label={`${label}: FOR ${nf.format(forValue)} of ${max}, AGAINST ${nf.format(againstValue)} of ${max}`}
      className={cn("grid grid-cols-[2.5rem_1fr_1fr_2.5rem] items-center gap-x-2 gap-y-1", className)}
    >
      <div className="col-span-4 flex items-baseline justify-center gap-2 text-sm font-semibold text-ink-2">
        <span>{label}</span>
        {weight !== undefined ? <span className="tabular text-xs font-normal text-ink-3">{weight}%</span> : null}
      </div>
      <span className={cn("tabular text-right font-display text-xl", forWins ? "text-for-strong" : "text-ink-3")}>
        {nf.format(forValue)}
      </span>
      <div className="flex h-3 justify-end overflow-hidden rounded-l-full bg-surface-2">
        <div className={cn("h-full rounded-l-full", forWins ? "bg-for" : "bg-for/45")} style={{ width: pct(forValue) }} />
      </div>
      <div className="flex h-3 overflow-hidden rounded-r-full bg-surface-2">
        <div
          className={cn("h-full rounded-r-full", againstWins ? "bg-against-bright" : "bg-against-bright/45")}
          style={{ width: pct(againstValue) }}
        />
      </div>
      <span className={cn("tabular font-display text-xl", againstWins ? "text-against-strong" : "text-ink-3")}>
        {nf.format(againstValue)}
      </span>
    </div>
  );
}
