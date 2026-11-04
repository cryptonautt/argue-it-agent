/**
 * Odds over time for a market's leading options (Yes price as a probability, one 0-100% axis).
 *
 * Marks follow the dataviz rules: 2px lines, recessive grid, a legend above plus a value label at each
 * line's end (identity is never colour alone), and a crosshair tooltip on hover/touch. Colours are the
 * fixed categorical slots `--series-1..4` in global.css, assigned by the option's position in the list,
 * never cycled. The option rows under the chart are the table view of the current numbers.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { cn } from "@domain/lib/cn";
import type { PriceRange, PriceSeries } from "@domain/polymarket/markets";

import { SERIES_COLORS, formatPercent } from "./format";

const HEIGHT = 260;
const PAD = { top: 12, right: 52, bottom: 26, left: 40 };
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];
const LABEL_GAP = 14;

const RANGE_LABELS: Record<PriceRange, string> = { "1d": "1D", "1w": "1W", "1m": "1M", max: "ALL" };

function nearestIndex(points: PriceSeries["points"], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((points[mid]?.t ?? 0) < t) lo = mid + 1;
    else hi = mid;
  }
  const prev = points[lo - 1];
  const here = points[lo];
  if (prev && here && t - prev.t < here.t - t) return lo - 1;
  return lo;
}

function formatTick(t: number, span: number): string {
  const date = new Date(t * 1000);
  if (span <= 2 * 86_400) return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (span <= 120 * 86_400) return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** Tooltip time: the date alone once the chart spans more than ~2 days (points are hours apart). */
function formatHover(t: number, span: number): string {
  const date = new Date(t * 1000);
  if (span > 2 * 86_400) return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Polymarket seeds a new market at exactly 50%. */
const CREATION_PRICE = 0.5;

/**
 * Drop the leading 50% creation price (often a single point) so a line does not open with a spike to where
 * trading actually began. A series that never left 50%, or would keep fewer than two points, is kept as is.
 */
export function trimCreationRun(points: PriceSeries["points"]): PriceSeries["points"] {
  if (points[0]?.p !== CREATION_PRICE) return points;
  const firstTraded = points.findIndex((pt) => pt.p !== CREATION_PRICE);
  if (firstTraded < 1 || points.length - firstTraded < 2) return points;
  return points.slice(firstTraded);
}

/** Spread end labels so they never overlap, keeping each as close to its line's end as possible. */
function placeLabels(ys: number[], min: number, max: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed: number[] = [];
  for (const [k, item] of order.entries()) {
    const floor = k === 0 ? min : (placed[k - 1] ?? min) + LABEL_GAP;
    placed.push(Math.max(item.y, floor));
  }
  // Push back up if the stack ran off the bottom.
  for (let k = placed.length - 1; k >= 0; k--) {
    const ceiling = k === placed.length - 1 ? max : (placed[k + 1] ?? max) - LABEL_GAP;
    placed[k] = Math.min(placed[k] ?? 0, ceiling);
  }
  const out = new Array<number>(ys.length);
  order.forEach((item, k) => {
    out[item.i] = placed[k] ?? item.y;
  });
  return out;
}

export interface OddsChartProps {
  series: PriceSeries[];
  /** Slot per marketId so a line keeps its colour; defaults to list order. */
  colorFor: (marketId: string) => string;
  range: PriceRange;
  onRangeChange: (range: PriceRange) => void;
  loading?: boolean;
}

export function OddsChart({ series, colorFor, range, onRangeChange, loading = false }: OddsChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hoverT, setHoverT] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const drawable = useMemo(
    () => series.map((s) => ({ ...s, points: trimCreationRun(s.points) })).filter((s) => s.points.length > 1),
    [series],
  );
  const [tMin, tMax] = useMemo(() => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const s of drawable) {
      lo = Math.min(lo, s.points[0]?.t ?? lo);
      hi = Math.max(hi, s.points[s.points.length - 1]?.t ?? hi);
    }
    if (!Number.isFinite(lo)) return [0, 1];
    // Every line a single instant: give the axis a 1 s width around it rather than plotting at x ≈ -1e9.
    return hi > lo ? [lo, hi] : [lo, lo + 1];
  }, [drawable]);

  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + ((t - tMin) / (tMax - tMin)) * plotW;
  const y = (p: number) => PAD.top + (1 - p) * plotH;

  const paths = drawable.map((s) => ({
    s,
    d: s.points.map((pt, i) => `${i === 0 ? "M" : "L"}${x(pt.t).toFixed(1)},${y(pt.p).toFixed(1)}`).join(""),
    last: s.points[s.points.length - 1]!,
  }));
  const labelYs = placeLabels(
    paths.map((p) => y(p.last.p)),
    PAD.top + 4,
    PAD.top + plotH,
  );
  const xTicks = width < 480 ? 3 : 5;

  const hover =
    hoverT === null
      ? null
      : drawable.map((s) => {
          const pt = s.points[nearestIndex(s.points, hoverT)]!;
          return { s, pt };
        });

  function onPointer(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setHoverT(tMin + ratio * (tMax - tMin));
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Chart legend">
          {series.map((s) => (
            <li key={s.marketId} className="flex items-center gap-1.5 text-ink-2">
              <span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{ background: colorFor(s.marketId) }} />
              <span className="max-w-[16rem] truncate">{s.label}</span>
            </li>
          ))}
        </ul>
        <div role="group" aria-label="Chart range" className="flex gap-1">
          {(Object.keys(RANGE_LABELS) as PriceRange[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={key === range}
              onClick={() => onRangeChange(key)}
              className={cn(
                "rounded-[var(--radius-sm)] px-2 py-1 text-xs font-semibold",
                key === range ? "bg-surface-2 text-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {RANGE_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <div ref={wrapRef} className={cn("relative w-full", loading && "opacity-60")}>
        {drawable.length === 0 ? (
          <div
            className="grid place-items-center rounded-[var(--radius-sm)] bg-surface-2 text-sm text-ink-3"
            style={{ height: HEIGHT }}
          >
            {loading ? "Loading odds history…" : "No price history for this range yet."}
          </div>
        ) : (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Odds over time for ${series.map((s) => s.label).join(", ")}`}
            className="block select-none"
          >
            {Y_TICKS.map((p) => (
              <g key={p}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + plotW}
                  y1={y(p)}
                  y2={y(p)}
                  stroke="var(--color-line)"
                  strokeDasharray={p === 0 ? undefined : "2 4"}
                />
                <text x={PAD.left - 6} y={y(p)} dy="0.32em" textAnchor="end" className="fill-ink-3 text-[11px]">
                  {Math.round(p * 100)}%
                </text>
              </g>
            ))}
            {Array.from({ length: xTicks }, (_, i) => tMin + ((tMax - tMin) * i) / (xTicks - 1)).map((t, i) => (
              <text
                key={t}
                x={x(t)}
                y={HEIGHT - 6}
                textAnchor={i === 0 ? "start" : i === xTicks - 1 ? "end" : "middle"}
                className="fill-ink-3 text-[11px]"
              >
                {formatTick(t, tMax - tMin)}
              </text>
            ))}
            {paths.map(({ s, d }) => (
              <path
                key={s.marketId}
                d={d}
                fill="none"
                stroke={colorFor(s.marketId)}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {paths.map(({ s, last }, i) => (
              <g key={`end-${s.marketId}`}>
                <circle cx={x(last.t)} cy={y(last.p)} r={4} fill={colorFor(s.marketId)} stroke="var(--color-surface)" strokeWidth={2} />
                <text x={PAD.left + plotW + 8} y={labelYs[i]} dy="0.32em" className="fill-ink text-xs font-semibold">
                  {formatPercent(last.p)}
                </text>
              </g>
            ))}
            {hover ? (
              <g pointerEvents="none">
                <line
                  x1={x(hoverT!)}
                  x2={x(hoverT!)}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                  stroke="var(--color-line-strong)"
                />
                {hover.map(({ s, pt }) => (
                  <circle
                    key={s.marketId}
                    cx={x(pt.t)}
                    cy={y(pt.p)}
                    r={4}
                    fill={colorFor(s.marketId)}
                    stroke="var(--color-surface)"
                    strokeWidth={2}
                  />
                ))}
              </g>
            ) : null}
            <rect
              x={PAD.left}
              y={PAD.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={onPointer}
              onPointerDown={onPointer}
              onPointerLeave={() => setHoverT(null)}
            />
          </svg>
        )}
        {hover && hoverT !== null ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-[var(--radius-sm)] border border-line bg-surface px-3 py-2 text-xs shadow-md"
            style={
              x(hoverT) > width / 2
                ? { right: width - x(hoverT) + 12 }
                : { left: x(hoverT) + 12 }
            }
          >
            <p className="mb-1 text-ink-3">{formatHover(hover[0]?.pt.t ?? hoverT, tMax - tMin)}</p>
            <ul className="space-y-0.5">
              {[...hover]
                .sort((a, b) => b.pt.p - a.pt.p)
                .map(({ s, pt }) => (
                  <li key={s.marketId} className="flex items-center gap-2">
                    <span aria-hidden className="size-2 rounded-full" style={{ background: colorFor(s.marketId) }} />
                    <span className="max-w-[10rem] truncate text-ink-2">{s.label}</span>
                    <span className="ml-auto font-semibold text-ink">{formatPercent(pt.p)}</span>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Colour slot per option, by its position in the event's option list (stable while prices refresh). */
export function seriesColorMap(marketIds: readonly string[]): (marketId: string) => string {
  const slots = new Map(marketIds.slice(0, SERIES_COLORS.length).map((id, i) => [id, SERIES_COLORS[i]!]));
  return (marketId) => slots.get(marketId) ?? "var(--color-ink-3)";
}
