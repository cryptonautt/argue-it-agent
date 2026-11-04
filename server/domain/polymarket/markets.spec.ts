import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getMarketEvent,
  getPriceHistory,
  listMarketEvents,
  normaliseEvent,
  normaliseMarket,
  setPolymarketFetch,
} from "./markets";

const hamilton = {
  id: "101",
  slug: "kansas-hamilton",
  question: "Will Adam Hamilton win the Kansas Senate race?",
  conditionId: "0xabc",
  groupItemTitle: "Adam Hamilton (D)",
  outcomes: '["Yes", "No"]',
  outcomePrices: '["0.63", "0.37"]',
  clobTokenIds: '["111", "222"]',
  bestBid: 0.62,
  bestAsk: 0.64,
  oneDayPriceChange: 0.015,
  volumeNum: 1252742,
  active: true,
  closed: false,
  acceptingOrders: true,
  negRisk: true,
  orderPriceMinTickSize: 0.01,
  orderMinSize: 5,
};

const marshall = {
  ...hamilton,
  id: "102",
  slug: "kansas-marshall",
  groupItemTitle: "Roger Marshall (R)",
  outcomePrices: '["0.375", "0.625"]',
  clobTokenIds: '["333", "444"]',
  oneDayPriceChange: undefined,
};

const placeholder = { ...hamilton, id: "103", groupItemTitle: "Person A", outcomePrices: undefined, active: false };

const kansasEvent = {
  id: "9",
  slug: "kansas-senate-election-winner",
  title: "Kansas Senate Election Winner",
  description: "Resolves to the winner.",
  image: "https://polymarket-upload.s3.us-east-2.amazonaws.com/kansas.png",
  endDate: "2026-11-03T00:00:00Z",
  volume: 2513949,
  volume24hr: 284460,
  liquidity: 1000,
  negRisk: true,
  closed: false,
  restricted: true,
  tags: [{ label: "Elections" }, { label: null }],
  markets: [marshall, placeholder, hamilton],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  setPolymarketFetch(null);
  vi.restoreAllMocks();
});

/** Move the cache clock without fake timers (AbortSignal.timeout keeps working). */
function advanceClock(ms: number): void {
  const now = Date.now() + ms;
  vi.spyOn(Date, "now").mockReturnValue(now);
}

describe("normaliseMarket", () => {
  it("decodes Gamma's JSON-string fields into prices and token ids", () => {
    expect(normaliseMarket(hamilton)).toMatchObject({
      marketId: "101",
      label: "Adam Hamilton (D)",
      yesPrice: 0.63,
      noPrice: 0.37,
      yesTokenId: "111",
      noTokenId: "222",
      dayChange: 0.015,
      negRisk: true,
      tickSize: 0.01,
      minOrderSize: 5,
    });
  });

  it("drops inactive placeholder outcomes", () => {
    expect(normaliseMarket(placeholder)).toBeNull();
  });

  it("falls back to the question when there is no option name", () => {
    expect(normaliseMarket({ ...hamilton, groupItemTitle: "" })?.label).toBe(hamilton.question);
  });

  it("tolerates malformed price strings", () => {
    const market = normaliseMarket({ ...hamilton, outcomePrices: "not json", clobTokenIds: null });
    expect(market?.yesPrice).toBeNull();
    expect(market?.yesTokenId).toBeNull();
  });
});

describe("normaliseEvent", () => {
  it("keeps open named outcomes, most likely first, and ignores the restricted flag", () => {
    const event = normaliseEvent(kansasEvent);
    expect(event?.outcomes.map((o) => o.label)).toEqual(["Adam Hamilton (D)", "Roger Marshall (R)"]);
    expect(event?.tags).toEqual(["Elections"]);
    expect(event?.url).toBe("https://polymarket.com/event/kansas-senate-election-winner");
  });
});

describe("network queries", () => {
  it("lists the most traded open events", async () => {
    const fetchStub = vi.fn(async () => jsonResponse({ events: [kansasEvent, { ...kansasEvent, slug: "x", closed: true }] }));
    setPolymarketFetch(fetchStub as unknown as typeof fetch);
    const events = await listMarketEvents({ limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ slug: "kansas-senate-election-winner", outcomeCount: 2 });
    expect(events[0]?.leaders[0]).toMatchObject({ label: "Adam Hamilton (D)", yesPrice: 0.63 });
    const url = String((fetchStub.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("/events/keyset?");
    expect(url).toContain("order=volume24hr");
    expect(url).toContain("limit=10");
  });

  it("searches when given a query, and caches the answer", async () => {
    const fetchStub = vi.fn(async () => jsonResponse({ events: [kansasEvent] }));
    setPolymarketFetch(fetchStub as unknown as typeof fetch);
    await listMarketEvents({ query: "kansas" });
    await listMarketEvents({ query: "kansas" });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(String((fetchStub.mock.calls[0] as unknown[])[0])).toContain("/public-search?q=kansas");
  });

  it("reports an unknown event as NOT_FOUND", async () => {
    setPolymarketFetch((async () => jsonResponse({}, 404)) as unknown as typeof fetch);
    await expect(getMarketEvent("no-such-market")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a malformed slug before calling Polymarket", async () => {
    const fetchStub = vi.fn();
    setPolymarketFetch(fetchStub as unknown as typeof fetch);
    await expect(getMarketEvent("../../etc/passwd")).rejects.toThrow();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("retries one blip", async () => {
    const fetchStub = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(kansasEvent));
    setPolymarketFetch(fetchStub as unknown as typeof fetch);
    await expect(getMarketEvent("kansas-senate-election-winner")).resolves.toMatchObject({ slug: "kansas-senate-election-winner" });
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("maps a Polymarket outage to a retryable error and does not cache it", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(kansasEvent));
    setPolymarketFetch(fetchStub as unknown as typeof fetch);
    await expect(getMarketEvent("kansas-senate-election-winner")).rejects.toMatchObject({ code: "INTERNAL" });
    await expect(getMarketEvent("kansas-senate-election-winner")).resolves.toMatchObject({ title: "Kansas Senate Election Winner" });
  });

  it("reads price history and ignores non-numeric token ids", async () => {
    const fetchStub = vi.fn(async () => jsonResponse({ history: [{ t: 1, p: 0.5 }, { t: 2, p: 1.2 }] }));
    setPolymarketFetch(fetchStub as unknown as typeof fetch);
    await expect(getPriceHistory("111", "1w")).resolves.toEqual([
      { t: 1, p: 0.5 },
      { t: 2, p: 1 },
    ]);
    await expect(getPriceHistory("abc", "1w")).resolves.toEqual([]);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});

describe("stale-while-error cache", () => {
  const down = () => new Response("down", { status: 503 });

  it("serves the last good list when a refresh fails, then backs off for one TTL", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ events: [kansasEvent] }))
      .mockResolvedValueOnce(down())
      .mockResolvedValueOnce(down());
    setPolymarketFetch(fetchStub as unknown as typeof fetch);
    const fresh = await listMarketEvents({ limit: 20 });
    expect(fresh).toHaveLength(1);

    advanceClock(31_000); // past the 30 s list TTL
    await expect(listMarketEvents({ limit: 20 })).resolves.toEqual(fresh);
    expect(fetchStub).toHaveBeenCalledTimes(3); // the refresh and its one retry
    await expect(listMarketEvents({ limit: 20 })).resolves.toEqual(fresh);
    expect(fetchStub).toHaveBeenCalledTimes(3); // the stale answer is cached, not re-fetched
  });

  it("replaces the stale value once Polymarket answers again", async () => {
    const renamed = { ...kansasEvent, title: "Kansas Senate (updated)" };
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(kansasEvent))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(renamed));
    setPolymarketFetch(fetchStub as unknown as typeof fetch);
    const slug = "kansas-senate-election-winner";
    await expect(getMarketEvent(slug)).resolves.toMatchObject({ title: "Kansas Senate Election Winner" });

    advanceClock(16_000); // past the 15 s event TTL
    await expect(getMarketEvent(slug)).resolves.toMatchObject({ title: "Kansas Senate Election Winner" });

    advanceClock(32_000); // past the backoff
    await expect(getMarketEvent(slug)).resolves.toMatchObject({ title: "Kansas Senate (updated)" });
    expect(fetchStub).toHaveBeenCalledTimes(4);
  });

  it("shares a slow in-flight load and starts the TTL when it lands", async () => {
    let answer: (response: Response) => void = () => {};
    const fetchStub = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)));
    setPolymarketFetch(fetchStub as unknown as typeof fetch);
    const first = listMarketEvents({ limit: 20 });
    advanceClock(40_000); // longer than the 30 s list TTL, still loading
    const second = listMarketEvents({ limit: 20 });
    answer(jsonResponse({ events: [kansasEvent] }));
    await expect(first).resolves.toHaveLength(1);
    await expect(second).resolves.toHaveLength(1);
    advanceClock(20_000); // 20 s after the answer arrived: still fresh
    await listMarketEvents({ limit: 20 });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("does not serve an answer older than the stale limit", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ events: [kansasEvent] }))
      .mockResolvedValueOnce(down())
      .mockResolvedValueOnce(down());
    setPolymarketFetch(fetchStub as unknown as typeof fetch);
    await listMarketEvents({ limit: 20 });

    advanceClock(31 * 60_000);
    await expect(listMarketEvents({ limit: 20 })).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("keeps last-good values per key (a search does not stand in for the list)", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ events: [kansasEvent] }))
      .mockResolvedValueOnce(down())
      .mockResolvedValueOnce(down());
    setPolymarketFetch(fetchStub as unknown as typeof fetch);
    await listMarketEvents({ query: "kansas" });
    await expect(listMarketEvents({ limit: 20 })).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
