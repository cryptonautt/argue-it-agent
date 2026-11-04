/**
 * Live Polymarket market data (read-only) for the /markets screens and the agent.
 *
 * Sources (public, no credentials, see docs.polymarket.com/getting-started/api.md):
 * - Gamma `GET /events/keyset`, `/public-search`, `/events/slug/{slug}` for events and their markets;
 * - CLOB `GET /prices-history` for the odds chart.
 *
 * Gamma encodes `outcomes`, `outcomePrices` and `clobTokenIds` as JSON strings; they are decoded here so
 * nothing downstream sees the wire format. Gamma's `restricted` flag is set on practically every event
 * (all of the top 50 by volume on 2026-11-03), so it is not used as a filter: who may trade is decided by
 * Polymarket's own geoblock check in the browser before any order.
 *
 * Responses are cached in-process for a short TTL so a busy page does not fan out to Polymarket, and the
 * last good answer per cache key is kept: when a refresh fails (Polymarket slow or down) that answer is
 * served instead of an error ("stale-while-error"), for at most STALE_MAX_AGE_MS.
 *
 * Payload size: Gamma has no field-selection parameter on `/events` or `/events/keyset` (checked against
 * docs.polymarket.com/api-spec/gamma-openapi.yaml, 2026-11-03), and every event embeds all its markets
 * with their long `description`s (20 events ≈ 3.2 MB JSON, ≈ 290 kB gzipped). `/public-search`'s
 * `optimized=true` drops market ids, volumes and token ids, which the list needs. So list calls get a
 * longer timeout and the list asks for fewer events instead.
 */
import { z } from "zod";

import { ActionError } from "@domain/lib/action-result";

import { marketSlugSchema } from "./slug";

export const GAMMA_API = "https://gamma-api.polymarket.com";
export const CLOB_API = "https://clob.polymarket.com";
export const POLYMARKET_SITE = "https://polymarket.com";

const REQUEST_TIMEOUT_MS = 8_000;
/** List/search payloads are megabytes of JSON; an uncached call has been seen taking ~26 s. */
const LIST_TIMEOUT_MS = 20_000;
const EVENT_TTL_MS = 15_000;
const LIST_TTL_MS = 30_000;
const HISTORY_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;
/** How old a last-good answer may be and still stand in for a failed refresh. */
const STALE_MAX_AGE_MS = 30 * 60_000;

export const PRICE_RANGES = ["1d", "1w", "1m", "max"] as const;
export type PriceRange = (typeof PRICE_RANGES)[number];

/** CLOB `interval` and `fidelity` (bucket minutes) per chart range. */
const RANGE_QUERY: Record<PriceRange, { interval: string; fidelity: number }> = {
  "1d": { interval: "1d", fidelity: 15 },
  "1w": { interval: "1w", fidelity: 60 },
  "1m": { interval: "1m", fidelity: 360 },
  max: { interval: "max", fidelity: 720 },
};

// ---------------------------------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------------------------------

/** One tradable Yes/No market inside an event; in a multi-outcome event it is one candidate/option. */
export interface MarketOutcome {
  marketId: string;
  slug: string;
  conditionId: string | null;
  /** Short option name ("Adam Hamilton (D)") or, for a single-market event, the question. */
  label: string;
  question: string;
  image: string | null;
  /** Probability of Yes, 0..1 (Gamma's last outcome price). */
  yesPrice: number | null;
  noPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  /** Change in the Yes price over the last day, in probability points (0.02 = +2%). */
  dayChange: number | null;
  volume: number;
  yesTokenId: string | null;
  noTokenId: string | null;
  acceptingOrders: boolean;
  negRisk: boolean;
  tickSize: number | null;
  minOrderSize: number | null;
}

export interface MarketEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  image: string | null;
  endDate: string | null;
  volume: number;
  volume24hr: number;
  liquidity: number;
  negRisk: boolean;
  closed: boolean;
  tags: string[];
  /** Open, named outcomes, most likely first. */
  outcomes: MarketOutcome[];
  url: string;
}

export interface MarketEventSummary {
  slug: string;
  title: string;
  image: string | null;
  endDate: string | null;
  volume: number;
  volume24hr: number;
  outcomeCount: number;
  /** Up to three leading outcomes. */
  leaders: Array<Pick<MarketOutcome, "label" | "yesPrice" | "marketId">>;
}

export interface PricePoint {
  /** Epoch seconds. */
  t: number;
  /** Yes price, 0..1. */
  p: number;
}

export interface PriceSeries {
  marketId: string;
  label: string;
  points: PricePoint[];
}

// ---------------------------------------------------------------------------------------------------
// Wire schemas (only the fields we use; Gamma sends many more)
// ---------------------------------------------------------------------------------------------------

const num = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}, z.number().nullable());

const jsonStringArray = z.preprocess((v) => {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string" || v === "") return [];
  try {
    return JSON.parse(v);
  } catch {
    return [];
  }
}, z.array(z.union([z.string(), z.number()]).transform(String)));

const rawMarketSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  slug: z.string().default(""),
  question: z.string().default(""),
  conditionId: z.string().nullish(),
  groupItemTitle: z.string().nullish(),
  image: z.string().nullish(),
  outcomes: jsonStringArray,
  outcomePrices: jsonStringArray,
  clobTokenIds: jsonStringArray,
  bestBid: num.optional(),
  bestAsk: num.optional(),
  oneDayPriceChange: num.optional(),
  volumeNum: num.optional(),
  volume: num.optional(),
  active: z.boolean().nullish(),
  closed: z.boolean().nullish(),
  archived: z.boolean().nullish(),
  acceptingOrders: z.boolean().nullish(),
  negRisk: z.boolean().nullish(),
  orderPriceMinTickSize: num.optional(),
  orderMinSize: num.optional(),
});

const rawEventSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  slug: z.string(),
  title: z.string().default(""),
  description: z.string().nullish(),
  image: z.string().nullish(),
  icon: z.string().nullish(),
  endDate: z.string().nullish(),
  volume: num.optional(),
  volume24hr: num.optional(),
  liquidity: num.optional(),
  negRisk: z.boolean().nullish(),
  closed: z.boolean().nullish(),
  markets: z.array(z.unknown()).default([]),
  tags: z.array(z.looseObject({ label: z.string().nullish() })).nullish(),
});

const keysetSchema = z.looseObject({ events: z.array(z.unknown()).default([]) });
const searchSchema = z.looseObject({ events: z.array(z.unknown()).nullish() });
const historySchema = z.looseObject({
  history: z.array(z.looseObject({ t: z.number(), p: z.number() })).default([]),
});

// ---------------------------------------------------------------------------------------------------
// Normalisation (pure; exported for tests)
// ---------------------------------------------------------------------------------------------------

function clampPrice(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function priceFor(outcomes: string[], prices: string[], name: string): number | null {
  const index = outcomes.findIndex((o) => o.toLowerCase() === name);
  if (index < 0) return null;
  const raw = prices[index];
  return raw === undefined ? null : clampPrice(Number(raw));
}

function tokenFor(outcomes: string[], tokens: string[], name: string): string | null {
  const index = outcomes.findIndex((o) => o.toLowerCase() === name);
  return index >= 0 ? (tokens[index] ?? null) : null;
}

export function normaliseMarket(raw: unknown): MarketOutcome | null {
  const parsed = rawMarketSchema.safeParse(raw);
  if (!parsed.success) return null;
  const m = parsed.data;
  if (m.closed || m.archived || m.active === false) return null;
  const label = (m.groupItemTitle ?? "").trim() || m.question.trim();
  if (!label) return null;
  return {
    marketId: m.id,
    slug: m.slug,
    conditionId: m.conditionId ?? null,
    label,
    question: m.question,
    image: m.image || null,
    yesPrice: priceFor(m.outcomes, m.outcomePrices, "yes"),
    noPrice: priceFor(m.outcomes, m.outcomePrices, "no"),
    bestBid: clampPrice(m.bestBid),
    bestAsk: clampPrice(m.bestAsk),
    dayChange: m.oneDayPriceChange ?? null,
    volume: m.volumeNum ?? m.volume ?? 0,
    yesTokenId: tokenFor(m.outcomes, m.clobTokenIds, "yes"),
    noTokenId: tokenFor(m.outcomes, m.clobTokenIds, "no"),
    acceptingOrders: m.acceptingOrders === true,
    negRisk: m.negRisk === true,
    tickSize: m.orderPriceMinTickSize ?? null,
    minOrderSize: m.orderMinSize ?? null,
  };
}

export function normaliseEvent(raw: unknown): MarketEvent | null {
  const parsed = rawEventSchema.safeParse(raw);
  if (!parsed.success) return null;
  const e = parsed.data;
  const outcomes = e.markets
    .map(normaliseMarket)
    .filter((o): o is MarketOutcome => o !== null)
    .sort((a, b) => (b.yesPrice ?? -1) - (a.yesPrice ?? -1));
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    description: e.description ?? "",
    image: e.image || e.icon || null,
    endDate: e.endDate ?? null,
    volume: e.volume ?? 0,
    volume24hr: e.volume24hr ?? 0,
    liquidity: e.liquidity ?? 0,
    negRisk: e.negRisk === true,
    closed: e.closed === true,
    tags: (e.tags ?? []).map((t) => t.label ?? "").filter(Boolean),
    outcomes,
    url: `${POLYMARKET_SITE}/event/${encodeURIComponent(e.slug)}`,
  };
}

export function summariseEvent(event: MarketEvent): MarketEventSummary {
  return {
    slug: event.slug,
    title: event.title,
    image: event.image,
    endDate: event.endDate,
    volume: event.volume,
    volume24hr: event.volume24hr,
    outcomeCount: event.outcomes.length,
    leaders: event.outcomes.slice(0, 3).map(({ label, yesPrice, marketId }) => ({ label, yesPrice, marketId })),
  };
}

// ---------------------------------------------------------------------------------------------------
// HTTP + cache
// ---------------------------------------------------------------------------------------------------

type Fetcher = typeof fetch;
let fetcher: Fetcher = (...args) => fetch(...args);

/** Test hook: swap the network for a stub. Pass null to restore the real fetch. */
export function setPolymarketFetch(next: Fetcher | null): void {
  fetcher = next ?? ((...args) => fetch(...args));
  cache.clear();
  lastGood.clear();
}

const cache = new Map<string, { expires: number; value: Promise<unknown> }>();
/** Last successful value per cache key (insertion order = age, oldest first). */
const lastGood = new Map<string, { at: number; value: unknown }>();

function remember(key: string, value: unknown): void {
  lastGood.delete(key);
  lastGood.set(key, { at: Date.now(), value });
  while (lastGood.size > CACHE_MAX_ENTRIES) {
    const oldest = lastGood.keys().next().value;
    if (oldest === undefined) break;
    lastGood.delete(oldest);
  }
}

function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const at = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > at) return hit.value as Promise<T>;
  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, v] of cache) if (v.expires <= at) cache.delete(k);
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  }
  const value: Promise<T> = load().then(
    (fresh) => {
      remember(key, fresh);
      // The TTL runs from when the answer arrived, not from when a (possibly 20 s) request started.
      if (cache.get(key)?.value === value) cache.set(key, { expires: Date.now() + ttlMs, value });
      return fresh;
    },
    (error: unknown) => {
      const stale = lastGood.get(key);
      if (stale && Date.now() - stale.at <= STALE_MAX_AGE_MS) {
        // Serve the last good answer, and keep serving it for one TTL before asking Polymarket again,
        // so an outage does not make every request wait out the timeout.
        if (cache.get(key)?.value === value) cache.set(key, { expires: Date.now() + ttlMs, value });
        return stale.value as T;
      }
      // A failed load with nothing to fall back on must not be served from cache.
      if (cache.get(key)?.value === value) cache.delete(key);
      throw error;
    },
  );
  // In flight: shared by every caller until it settles (the request timeout bounds how long that is).
  cache.set(key, { expires: Number.POSITIVE_INFINITY, value });
  return value;
}

const UNAVAILABLE = "Polymarket isn't responding right now. Try again in a moment.";

async function fetchOnce(url: string, timeoutMs: number): Promise<Response | null> {
  try {
    return await fetcher(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
}

async function getJson(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<{ status: number; body: unknown }> {
  let response = await fetchOnce(url, timeoutMs);
  // One retry for a dropped connection, timeout or 5xx: Polymarket's API has occasional blips.
  if (response === null || response.status >= 500) response = await fetchOnce(url, timeoutMs);
  if (response === null) throw new ActionError("INTERNAL", UNAVAILABLE);
  if (response.status === 404) return { status: 404, body: null };
  if (response.status === 429) throw new ActionError("RATE_LIMITED", "Polymarket is busy. Try again in a few seconds.");
  if (!response.ok) throw new ActionError("INTERNAL", UNAVAILABLE);
  try {
    return { status: response.status, body: await response.json() };
  } catch {
    throw new ActionError("INTERNAL", UNAVAILABLE);
  }
}

// ---------------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------------

export interface ListMarketsInput {
  /** Free-text search; empty lists the most traded open events. */
  query?: string;
  limit?: number;
}

export async function listMarketEvents(input: ListMarketsInput = {}): Promise<MarketEventSummary[]> {
  const limit = Math.min(Math.max(input.limit ?? 24, 1), 50);
  const query = input.query?.trim().slice(0, 100) ?? "";
  const events = await cached(`list:${query}:${limit}`, LIST_TTL_MS, async () => {
    if (query) {
      const params = new URLSearchParams({ q: query, limit_per_type: String(limit), events_status: "active" });
      const { body } = await getJson(`${GAMMA_API}/public-search?${params}`, LIST_TIMEOUT_MS);
      return searchSchema.parse(body ?? {}).events ?? [];
    }
    const params = new URLSearchParams({
      closed: "false",
      limit: String(limit),
      order: "volume24hr",
      ascending: "false",
    });
    const { body } = await getJson(`${GAMMA_API}/events/keyset?${params}`, LIST_TIMEOUT_MS);
    return keysetSchema.parse(body ?? {}).events;
  });
  return events
    .map(normaliseEvent)
    .filter((e): e is MarketEvent => e !== null && !e.closed && e.outcomes.length > 0)
    .map(summariseEvent);
}

export async function getMarketEvent(slug: string): Promise<MarketEvent> {
  const parsed = marketSlugSchema.safeParse(slug);
  if (!parsed.success) throw new ActionError("NOT_FOUND", "That market doesn't exist on Polymarket.");
  const safe = parsed.data;
  const event = await cached(`event:${safe}`, EVENT_TTL_MS, async () => {
    const { status, body } = await getJson(`${GAMMA_API}/events/slug/${encodeURIComponent(safe)}`);
    return status === 404 ? null : normaliseEvent(body);
  });
  if (!event) throw new ActionError("NOT_FOUND", "That market doesn't exist on Polymarket.");
  return event;
}

export async function getPriceHistory(tokenId: string, range: PriceRange): Promise<PricePoint[]> {
  if (!/^\d{1,100}$/.test(tokenId)) return [];
  const { interval, fidelity } = RANGE_QUERY[range];
  return cached(`history:${tokenId}:${range}`, HISTORY_TTL_MS, async () => {
    const params = new URLSearchParams({ market: tokenId, interval, fidelity: String(fidelity) });
    const { body } = await getJson(`${CLOB_API}/prices-history?${params}`);
    return historySchema
      .parse(body ?? {})
      .history.filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p))
      .map((point) => ({ t: point.t, p: clampPrice(point.p) ?? 0 }));
  });
}

/** Yes-price history for the event's leading outcomes (the chart shows at most `max` lines). */
export async function getEventPriceSeries(event: MarketEvent, range: PriceRange, max = 4): Promise<PriceSeries[]> {
  const leaders = event.outcomes.filter((o) => o.yesTokenId).slice(0, max);
  const series = await Promise.all(
    leaders.map(async (o) => {
      try {
        return { marketId: o.marketId, label: o.label, points: await getPriceHistory(o.yesTokenId!, range) };
      } catch {
        // One missing line should not blank the whole chart.
        return { marketId: o.marketId, label: o.label, points: [] };
      }
    }),
  );
  return series;
}
