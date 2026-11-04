// One live Polymarket event: odds chart, every open option with Buy Yes / Buy No, the trade panel, and the
// ARGUE IT arguments debating it. Data: clientLoader → `get-market` (the agent's read), revalidated every
// 30 s while the tab is visible so prices stay live. Betting itself happens in the browser (TradePanel).
//
// Layout: on lg the trade panel is a sticky right column; below lg it sits right after the options (DOM
// order matches the visual order, so keyboard and screen-reader order do too) and a Yes/No tap scrolls it
// into view.
import { AlertTriangle, ArrowDown, ArrowUp, ExternalLink, MessageSquarePlus, RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  isRouteErrorResponse,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useRouteError,
  useSearchParams,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";

import { ArgumentCard } from "@/components/argue/arguments/argument-card";
import { formatCents, formatChange, formatMarketDate, formatPercent, formatUsd } from "@/components/argue/markets/format";
import { OddsChart, seriesColorMap } from "@/components/argue/markets/odds-chart";
import { TradePanel, type TradeSide } from "@/components/argue/markets/trade-panel";
import { PageContainer } from "@/components/argue/shell/page";
import { Badge } from "@/components/argue/ui/badge";
import { Button, ButtonLink } from "@/components/argue/ui/button";
import { Card } from "@/components/argue/ui/card";
import { EmptyState } from "@/components/argue/ui/empty-state";
import type { ArgumentCardData } from "@domain/arguments/types";
import { cn } from "@domain/lib/cn";
import type { MarketEvent, PriceRange, PriceSeries } from "@domain/polymarket/markets";

import { loadAction } from "./_lib/route-data";
import { RouteErrorState, RouteLoading } from "./_lib/route-states";

const REFRESH_MS = 30_000;
const RANGES: readonly PriceRange[] = ["1d", "1w", "1m", "max"];
/** Tailwind's `lg`: from here the trade panel is the sticky right column. */
const TWO_COLUMN_QUERY = "(min-width: 64rem)";

interface MarketPage {
  event: MarketEvent;
  history: PriceSeries[];
  debates: ArgumentCardData[];
  trading: { enabled: boolean; builderCode: string | null };
}

export async function clientLoader({ params, request }: ClientLoaderFunctionArgs) {
  const slug = params.slug ?? "";
  const requested = new URL(request.url).searchParams.get("range");
  const range: PriceRange = RANGES.includes(requested as PriceRange) ? (requested as PriceRange) : "max";
  const page = await loadAction<MarketPage>("get-market", { slug, range }, request);
  return { ...page, range };
}
clientLoader.hydrate = true as const;

export const meta: MetaFunction<typeof clientLoader> = ({ loaderData: data }) =>
  data ? [{ title: `${data.event.title} · Markets · ARGUE IT` }] : [{ title: "Market · ARGUE IT" }];

export function HydrateFallback() {
  return <RouteLoading />;
}

/** Like the shared `RouteErrorState`, plus "Try again": a Polymarket outage is usually over in seconds. */
export function ErrorBoundary() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  if (isRouteErrorResponse(error) && [403, 404, 423].includes(error.status)) return <RouteErrorState />;
  const data: unknown = isRouteErrorResponse(error) ? error.data : null;
  const message =
    data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string"
      ? (data as { message: string }).message
      : null;
  return (
    <PageContainer>
      <EmptyState
        icon={<AlertTriangle aria-hidden />}
        title="Something went wrong"
        description={message ?? "We couldn't load this market. Try again in a moment."}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              loading={revalidator.state === "loading"}
              icon={<RotateCw aria-hidden className="size-4" />}
              onClick={() => void revalidator.revalidate()}
            >
              Try again
            </Button>
            <ButtonLink href="/markets" variant="secondary">
              All markets
            </ButtonLink>
          </div>
        }
      />
    </PageContainer>
  );
}

function useLiveRefresh() {
  const revalidator = useRevalidator();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible" && revalidator.state === "idle") void revalidator.revalidate();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [revalidator]);
}

export default function MarketPage() {
  const { event, history, debates, trading, range } = useLoaderData<typeof clientLoader>();
  const [, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  useLiveRefresh();

  const [selectedId, setSelectedId] = useState<string | null>(event.outcomes[0]?.marketId ?? null);
  const [side, setSide] = useState<TradeSide>("yes");
  const selected = event.outcomes.find((o) => o.marketId === selectedId) ?? event.outcomes[0] ?? null;
  const colorFor = useMemo(() => seriesColorMap(history.map((s) => s.marketId)), [history]);
  const ends = formatMarketDate(event.endDate);
  const ticketRef = useRef<HTMLElement>(null);

  function choose(marketId: string, nextSide: TradeSide) {
    setSelectedId(marketId);
    setSide(nextSide);
    // One column: the ticket sits under the options, so bring it on screen once it shows the new pick.
    if (window.matchMedia(TWO_COLUMN_QUERY).matches) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    window.requestAnimationFrame(() => ticketRef.current?.scrollIntoView({ block: "nearest", behavior }));
  }

  const startDebateHref = `/new?market=${encodeURIComponent(event.slug)}&title=${encodeURIComponent(event.title.slice(0, 120))}`;

  return (
    <PageContainer wide>
      <div className="grid grid-cols-1 gap-6 pb-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr]">
        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1">
          <header className="flex items-start gap-3 sm:gap-4">
            {event.image ? (
              <img
                src={event.image}
                alt=""
                className="size-10 shrink-0 rounded-[var(--radius-sm)] object-cover sm:size-16 sm:rounded-[var(--radius)]"
              />
            ) : null}
            <div className="min-w-0">
              {event.tags.length > 0 ? (
                <ul aria-label="Tags" className="flex flex-wrap gap-x-1.5 text-sm text-ink-3">
                  {event.tags.slice(0, 3).map((tag, i, shown) => (
                    // The separator ends its tag's line, so a wrapped line never starts with "·".
                    <li key={`${tag}-${i}`} className="whitespace-nowrap">
                      {tag}
                      {i < shown.length - 1 ? (
                        <span aria-hidden className="ml-1.5">
                          ·
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <h1 className="text-3xl break-words text-ink sm:text-4xl">{event.title}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
                <span>{formatUsd(event.volume, { compact: true })} vol</span>
                {ends ? <span>Ends {ends}</span> : null}
                <a
                  href={event.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-ink"
                >
                  Source: Polymarket <ExternalLink aria-hidden className="size-3.5" />
                </a>
              </p>
            </div>
          </header>

          <Card>
            <OddsChart
              series={history}
              colorFor={colorFor}
              range={range}
              loading={navigation.state === "loading"}
              onRangeChange={(next) =>
                setSearchParams(next === "max" ? {} : { range: next }, { replace: true, preventScrollReset: true })
              }
            />
          </Card>

          <Card flush className="overflow-hidden">
            <ul aria-label="Options and current odds" className="divide-y divide-line">
              {event.outcomes.map((o) => {
                const change = formatChange(o.dayChange);
                const isSelected = selected?.marketId === o.marketId;
                return (
                  <li
                    key={o.marketId}
                    className={cn(
                      // Narrow: name + chance on one line, Yes/No side by side under them. sm+: one row.
                      "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 px-4 py-3",
                      "sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-x-4",
                      isSelected && "bg-surface-2",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {o.image && event.outcomes.length > 1 ? (
                        <img
                          src={o.image}
                          alt=""
                          loading="lazy"
                          className="size-9 shrink-0 rounded-[var(--radius-sm)] object-cover"
                        />
                      ) : null}
                      <div className="min-w-0">
                        <p className="font-semibold break-words text-ink">{o.label}</p>
                        <p className="hidden text-xs text-ink-3 sm:block">{formatUsd(o.volume, { compact: true })} vol</p>
                      </div>
                    </div>
                    <p className="flex items-center justify-end whitespace-nowrap">
                      <span className="min-w-[3.25rem] text-right text-xl font-semibold text-ink tabular-nums">
                        {formatPercent(o.yesPrice)}
                        <span className="sr-only"> chance</span>
                      </span>
                      {/* Fixed-width slot, filled or not, so every chance lines up. */}
                      <span
                        className={cn(
                          "ml-1.5 inline-flex w-11 items-center text-xs font-semibold tabular-nums",
                          change?.direction === "up" ? "text-success" : "text-danger",
                        )}
                      >
                        {change ? (
                          <>
                            {change.direction === "up" ? (
                              <ArrowUp aria-hidden className="size-3 shrink-0" />
                            ) : (
                              <ArrowDown aria-hidden className="size-3 shrink-0" />
                            )}
                            <span className="sr-only">{change.direction === "up" ? ", up " : ", down "}</span>
                            {change.text}
                            <span className="sr-only"> today</span>
                          </>
                        ) : null}
                      </span>
                    </p>
                    <div className="col-span-full grid grid-cols-2 gap-2 sm:col-span-1 sm:flex">
                      <button
                        type="button"
                        onClick={() => choose(o.marketId, "yes")}
                        aria-pressed={isSelected && side === "yes"}
                        className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-sm)] bg-for-soft px-3 py-2 text-sm font-semibold whitespace-nowrap text-for-strong hover:bg-for hover:text-on-for aria-pressed:bg-for aria-pressed:text-on-for sm:min-h-10 sm:min-w-24"
                      >
                        Yes {formatCents(o.yesPrice)}
                        <span className="sr-only">, {o.label}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => choose(o.marketId, "no")}
                        aria-pressed={isSelected && side === "no"}
                        className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-sm)] bg-against-soft px-3 py-2 text-sm font-semibold whitespace-nowrap text-against-strong hover:bg-against hover:text-on-against aria-pressed:bg-against aria-pressed:text-on-against sm:min-h-10 sm:min-w-24"
                      >
                        No {formatCents(o.noPrice)}
                        <span className="sr-only">, {o.label}</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        <aside
          ref={ticketRef}
          id="trade-ticket"
          className="scroll-mt-20 scroll-mb-4 lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start"
        >
          <TradePanel
            eventTitle={event.title}
            eventUrl={event.url}
            outcome={selected}
            side={side}
            onSideChange={setSide}
            trading={trading}
          />
        </aside>

        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-2">
          <section aria-labelledby="market-debates" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="market-debates" className="text-2xl text-ink">
                The debate{" "}
                {debates.length > 0 ? <Badge tone="neutral">{debates.length}</Badge> : null}
              </h2>
              <ButtonLink href={startDebateHref} variant="secondary" icon={<MessageSquarePlus aria-hidden className="size-4" />}>
                Argue your call
              </ButtonLink>
            </div>
            {debates.length === 0 ? (
              <p className="rounded-[var(--radius)] border border-dashed border-line-strong px-4 py-6 text-center text-ink-2">
                No one has argued this market yet. Post the first argument and let people pick a side.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {debates.map((argument) => (
                  <ArgumentCard key={argument.id} argument={argument} headingLevel="h3" />
                ))}
              </div>
            )}
          </section>

          {event.description ? (
            <section aria-labelledby="market-rules">
              <h2 id="market-rules" className="mb-2 text-2xl text-ink">
                Rules
              </h2>
              <p className="text-sm whitespace-pre-line text-ink-2">{event.description}</p>
            </section>
          ) : null}
        </div>
      </div>
    </PageContainer>
  );
}
