// Live Polymarket markets (most traded first, or a search). Data: clientLoader → `list-markets`, the same
// read the agent uses. Each card opens /markets/<slug>, where people debate the market and can bet on it.
import { AlertTriangle, RotateCw, Search, TrendingUp } from "lucide-react";
import {
  Form,
  isRouteErrorResponse,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useRouteError,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";

import { MarketCard } from "@/components/argue/markets/market-card";
import { PageContainer, PageHeader } from "@/components/argue/shell/page";
import { Button, ButtonLink } from "@/components/argue/ui/button";
import { EmptyState } from "@/components/argue/ui/empty-state";
import type { MarketEventSummary } from "@domain/polymarket/markets";

import { loadAction } from "./_lib/route-data";
import { RouteErrorState, RouteLoading } from "./_lib/route-states";

// Each listed event carries all its markets (~150 kB of JSON per event), so keep the page to 20.
const LIST_LIMIT = 20;

export const meta: MetaFunction = () => [{ title: "Markets · ARGUE IT" }];

export async function clientLoader({ request }: ClientLoaderFunctionArgs) {
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const result = await loadAction<{ events: MarketEventSummary[] }>(
    "list-markets",
    query ? { query, limit: LIST_LIMIT } : { limit: LIST_LIMIT },
    request,
  );
  return { query, events: result.events ?? [] };
}
clientLoader.hydrate = true as const;

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
        description={message ?? "We couldn't load the markets. Try again in a moment."}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              loading={revalidator.state === "loading"}
              icon={<RotateCw aria-hidden className="size-4" />}
              onClick={() => void revalidator.revalidate()}
            >
              Try again
            </Button>
            <ButtonLink href="/" variant="secondary">
              Back to the feed
            </ButtonLink>
          </div>
        }
      />
    </PageContainer>
  );
}

export default function MarketsPage() {
  const { query, events } = useLoaderData<typeof clientLoader>();
  const navigation = useNavigation();
  const searching = navigation.state === "loading" && navigation.location?.pathname === "/markets";

  return (
    <PageContainer wide>
      <PageHeader
        title="Markets"
        description="Live prediction markets from Polymarket. Argue your call, see the crowd's odds, and bet with your own wallet."
      />
      <Form method="get" role="search" className="mb-6 flex max-w-xl items-center gap-2">
        <label htmlFor="market-search" className="sr-only">
          Search markets
        </label>
        <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius)] border border-line-strong bg-surface px-3 focus-within:ring-2 focus-within:ring-focus">
          <Search aria-hidden className="size-4 shrink-0 text-ink-3" />
          <input
            id="market-search"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Search markets…"
            className="h-full w-full min-w-0 bg-transparent text-ink outline-none"
          />
        </div>
        <button
          type="submit"
          className="h-11 rounded-[var(--radius)] bg-ink px-4 font-semibold text-ink-inverse hover:bg-ink-2"
          aria-busy={searching}
        >
          Search
        </button>
      </Form>

      {events.length === 0 ? (
        <EmptyState
          icon={<TrendingUp aria-hidden className="size-6" />}
          title={query ? `No open markets match “${query}”` : "No markets to show"}
          description={query ? "Try a broader search." : "Polymarket returned no open markets. Try again shortly."}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 pb-10 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <MarketCard key={event.slug} event={event} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
