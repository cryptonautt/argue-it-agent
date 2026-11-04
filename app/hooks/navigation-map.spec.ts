import { describe, expect, it } from "vitest";

import { navFromCommand, pathForNav, toNavigationState, type ArgueNav } from "./navigation-map";

describe("toNavigationState", () => {
  it("maps every ported route to its view", () => {
    const table: Array<[string, string | undefined, ArgueNav]> = [
      ["/", undefined, { view: "feed" }],
      ["/a/arg-1", undefined, { view: "argument", argumentId: "arg-1" }],
      ["/new", undefined, { view: "new-argument" }],
      ["/challenge/new", undefined, { view: "new-challenge" }],
      ["/challenge/new", "?argument=arg-9", { view: "new-challenge", argumentId: "arg-9" }],
      ["/c/abc", undefined, { view: "debate", competitionId: "abc" }],
      ["/c/abc/verdict", undefined, { view: "verdict", competitionId: "abc" }],
      ["/c/abc/verdict/", undefined, { view: "verdict", competitionId: "abc" }],
      ["/admin/review", undefined, { view: "review-queue", tab: "review" }],
      ["/admin/review", "?tab=appeals", { view: "review-queue", tab: "appeals" }],
      ["/admin/review", "?tab=nonsense", { view: "review-queue", tab: "review" }],
      ["/admin/appeals", undefined, { view: "review-queue", tab: "appeals" }],
      ["/u/ngozi", undefined, { view: "profile", handle: "ngozi" }],
      ["/welcome", undefined, { view: "welcome" }],
      ["/rules", undefined, { view: "rules" }],
      ["/markets", undefined, { view: "markets" }],
      ["/markets/kansas-senate-election-winner", undefined, { view: "market", slug: "kansas-senate-election-winner" }],
    ];
    for (const [pathname, search, expected] of table) {
      expect(toNavigationState(pathname, search), `${pathname}${search ?? ""}`).toEqual(expected);
    }
  });

  it("accepts URLSearchParams as well as a query string", () => {
    expect(toNavigationState("/admin/review", new URLSearchParams({ tab: "appeals" }))).toEqual({
      view: "review-queue",
      tab: "appeals",
    });
  });

  it("returns null for template routes that are not ARGUE IT screens", () => {
    for (const pathname of ["/chat", "/chat/t-1", "/settings", "/database", "/a", "/c/abc/other", "/admin"]) {
      expect(toNavigationState(pathname), pathname).toBeNull();
    }
  });
});

describe("pathForNav", () => {
  const navs: ArgueNav[] = [
    { view: "feed" },
    { view: "argument", argumentId: "arg-1" },
    { view: "new-argument" },
    { view: "new-challenge" },
    { view: "new-challenge", argumentId: "arg-9" },
    { view: "debate", competitionId: "abc" },
    { view: "verdict", competitionId: "abc" },
    { view: "review-queue", tab: "review" },
    { view: "review-queue", tab: "appeals" },
    { view: "profile", handle: "ngozi" },
    { view: "welcome" },
    { view: "rules" },
    { view: "markets" },
    { view: "market", slug: "kansas-senate-election-winner" },
  ];

  it("round-trips through toNavigationState", () => {
    for (const nav of navs) {
      const path = pathForNav(nav);
      const [pathname, query] = path.split("?");
      expect(toNavigationState(pathname ?? "/", query), path).toEqual(nav);
    }
  });

  it("builds the verdict URL", () => {
    expect(pathForNav({ view: "verdict", competitionId: "abc" })).toBe("/c/abc/verdict");
  });
});

describe("navFromCommand", () => {
  it("requires the record id for record views instead of guessing", () => {
    expect(() => navFromCommand({ view: "verdict" })).toThrow(/competitionId/);
    expect(() => navFromCommand({ view: "argument" })).toThrow(/argumentId/);
    expect(() => navFromCommand({ view: "profile" })).toThrow(/handle/);
  });

  it("returns null for non-ARGUE views so the template routing still works", () => {
    expect(navFromCommand({ view: "chat" })).toBeNull();
    expect(navFromCommand({})).toBeNull();
  });

  it("builds a review-queue command with the requested tab", () => {
    expect(navFromCommand({ view: "review-queue", tab: "appeals" })).toEqual({ view: "review-queue", tab: "appeals" });
    expect(navFromCommand({ view: "verdict", competitionId: " abc " })).toEqual({ view: "verdict", competitionId: "abc" });
  });
});
