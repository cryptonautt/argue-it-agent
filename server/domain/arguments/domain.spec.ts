import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";
import { feedHref, parseCategorySlug, parseFeedTab } from "./feed-params";
import { canDeleteArgument, canEditArgument } from "./policy";
import { RANKING, affinityMultipliers, decayFactor, roundMultiplier, trendingScore } from "./ranking";
import { argumentFieldsSchema, normalizeBody, propositionHints } from "./validation";

describe("argumentFieldsSchema", () => {
  const base = {
    title: "Arsenal will win the league",
    categorySlug: "sports",
    proposition: "Arsenal will win the Premier League this season.",
    body: "Best defence in the league and a settled squad.",
    links: [],
  };

  it("normalises whitespace in one-line fields", () => {
    const parsed = argumentFieldsSchema.parse({ ...base, title: "  Arsenal \n will   win ", proposition: "Arsenal\twill win it all." });
    expect(parsed.title).toBe("Arsenal will win");
    expect(parsed.proposition).toBe("Arsenal will win it all.");
  });

  it("enforces the design limits (title 120, proposition 280, body 5,000)", () => {
    expect(argumentFieldsSchema.safeParse({ ...base, title: "a".repeat(120) }).success).toBe(true);
    expect(argumentFieldsSchema.safeParse({ ...base, title: "a".repeat(121) }).success).toBe(false);
    expect(argumentFieldsSchema.safeParse({ ...base, proposition: "a".repeat(281) }).success).toBe(false);
    expect(argumentFieldsSchema.safeParse({ ...base, body: "a".repeat(5001) }).success).toBe(false);
    expect(argumentFieldsSchema.safeParse({ ...base, body: "a".repeat(5000) }).success).toBe(true);
  });

  it("counts length after normalisation, so padding can't sneak past or fail the limits", () => {
    expect(argumentFieldsSchema.safeParse({ ...base, title: `  ${"a".repeat(120)}   ` }).success).toBe(true);
    expect(argumentFieldsSchema.safeParse({ ...base, title: "   ab   " }).success).toBe(false);
  });

  it("rejects unsafe or too many links", () => {
    expect(argumentFieldsSchema.safeParse({ ...base, links: ["javascript:alert(1)"] }).success).toBe(false);
    expect(argumentFieldsSchema.safeParse({ ...base, links: ["data:text/html,hi"] }).success).toBe(false);
    const six = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`);
    expect(argumentFieldsSchema.safeParse({ ...base, links: six }).success).toBe(false);
  });

  it("requires every field", () => {
    const result = argumentFieldsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("normalizeBody", () => {
  it("keeps paragraphs but collapses long blank runs and trailing spaces", () => {
    expect(normalizeBody("  One.   \r\n\r\n\r\n\r\nTwo.\n")).toBe("One.\n\nTwo.");
  });
});

describe("propositionHints", () => {
  it("is quiet for a clear statement", () => {
    expect(propositionHints("Lionel Messi is a better footballer than Cristiano Ronaldo.")).toEqual([]);
    expect(propositionHints("")).toEqual([]);
  });
  it("flags questions, 'vs' framing, hedges and vague one-liners", () => {
    expect(propositionHints("Who is better, Messi or Ronaldo?")[0]).toMatch(/statement, not a question/);
    expect(propositionHints("Messi vs Ronaldo for the best ever").join(" ")).toMatch(/which side you back/);
    expect(propositionHints("I think Bitcoin will hit 200k next year").join(" ")).toMatch(/Drop “I think”/);
    expect(propositionHints("Messi rules").join(" ")).toMatch(/a little more/);
  });
});

describe("argument policy", () => {
  const argument = { authorId: "author", status: "visible" as const, lockedAt: null };

  it("lets only the author edit and delete", () => {
    expect(canEditArgument(argument, "author", false)).toEqual({ allowed: true });
    expect(canEditArgument(argument, "someone", false)).toMatchObject({ allowed: false, reason: "not_author" });
    expect(canEditArgument(argument, null, false)).toMatchObject({ allowed: false, reason: "signed_out" });
    expect(canDeleteArgument(argument, "author")).toEqual({ allowed: true });
    expect(canDeleteArgument(argument, "someone")).toMatchObject({ allowed: false, reason: "not_author" });
  });

  it("locks editing once a challenge is accepted or locked_at is set, but still allows delete", () => {
    expect(canEditArgument(argument, "author", true)).toMatchObject({ allowed: false, reason: "locked" });
    expect(canEditArgument({ ...argument, lockedAt: new Date() }, "author", false)).toMatchObject({ reason: "locked" });
    expect(canDeleteArgument({ ...argument, lockedAt: new Date() }, "author")).toEqual({ allowed: true });
  });

  it("freezes hidden and removed arguments", () => {
    expect(canEditArgument({ ...argument, status: "hidden" }, "author", false)).toMatchObject({ reason: "hidden" });
    expect(canDeleteArgument({ ...argument, status: "hidden" }, "author")).toMatchObject({ reason: "hidden" });
    expect(canEditArgument({ ...argument, status: "removed" }, "author", false)).toMatchObject({ reason: "removed" });
  });
});

describe("ranking", () => {
  it("halves weight every half-life and never exceeds 1", () => {
    expect(decayFactor(0, 12)).toBe(1);
    expect(decayFactor(-5, 12)).toBe(1);
    expect(decayFactor(12, 12)).toBeCloseTo(0.5);
    expect(decayFactor(24, 12)).toBeCloseTo(0.25);
  });

  it("weights comments double and ignores events outside the window", () => {
    const comment = trendingScore([{ kind: "comment", ageHours: 0 }], 1000);
    const position = trendingScore([{ kind: "position", ageHours: 0 }], 1000);
    expect(comment).toBeCloseTo(2 * position, 6);
    expect(trendingScore([{ kind: "comment", ageHours: RANKING.windowHours + 1 }], 1000)).toBeCloseTo(0, 6);
  });

  it("gives a brand-new post the weight of one fresh engagement", () => {
    expect(trendingScore([], 0)).toBe(RANKING.freshnessWeight);
  });

  it("computes affinity multipliers relative to the strongest category", () => {
    const result = affinityMultipliers(
      [
        { categoryId: "a", count: 4 },
        { categoryId: "b", count: 2 },
        { categoryId: "a", count: 2 },
        { categoryId: "z", count: 0 },
      ],
      ["c"],
    );
    expect(result.get("a")).toBe(2.5);
    expect(result.get("b")).toBe(1.5);
    expect(result.get("c")).toBe(1.75);
    expect(result.has("z")).toBe(false);
    expect(affinityMultipliers([])).toEqual(new Map());
  });

  it("clamps multipliers into [1, 1 + max boost]", () => {
    expect(roundMultiplier(99)).toBe(2.5);
    expect(roundMultiplier(-3)).toBe(1);
    expect(roundMultiplier(1.23456)).toBe(1.235);
  });
});

describe("feed cursors", () => {
  it("round-trips tab, category, key, snapshot and affinity", () => {
    const id = randomUUID();
    const cat = randomUUID();
    const asOf = new Date("2026-10-31T12:00:00.000Z");
    const encoded = encodeCursor({
      tab: "for-you",
      categorySlug: "sports",
      key: "1.234567",
      id,
      asOf,
      affinity: new Map([[cat, 2]]),
    });
    expect(decodeCursor(encoded)).toEqual({
      tab: "for-you",
      categorySlug: "sports",
      key: "1.234567",
      id,
      asOf,
      affinity: new Map([[cat, 2]]),
    });
  });

  it("returns null for malformed input instead of throwing", () => {
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not base64 json")).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ v: 2 })).toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ v: 1, t: "evil", c: null, k: "1", id: randomUUID() })).toString("base64url"))).toBeNull();
  });

  it("clamps forged affinity multipliers", () => {
    const forged = Buffer.from(
      JSON.stringify({ v: 1, t: "for-you", c: null, k: "1", id: randomUUID(), asOf: new Date().toISOString(), aff: [[randomUUID(), 1e9]] }),
    ).toString("base64url");
    expect([...(decodeCursor(forged)?.affinity?.values() ?? [])]).toEqual([2.5]);
  });
});

describe("feed params", () => {
  it("parses tabs and categories defensively", () => {
    expect(parseFeedTab(undefined)).toBe("for-you");
    expect(parseFeedTab("ending")).toBe("ending");
    expect(parseFeedTab(["new", "trending"])).toBe("new");
    expect(parseFeedTab("../../etc")).toBe("for-you");
    expect(parseCategorySlug("Sports")).toBe("sports");
    expect(parseCategorySlug("drop table;")).toBeNull();
  });

  it("builds canonical hrefs", () => {
    expect(feedHref("for-you", null)).toBe("/");
    expect(feedHref("ending", "crypto")).toBe("/?tab=ending&category=crypto");
  });
});
