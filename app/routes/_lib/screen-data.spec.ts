import { describe, expect, it } from "vitest";

import type { RubricDef } from "@domain/judging/types";

import {
  currentRubrics,
  findCodeRubric,
  isOwnCase,
  normaliseProfile,
  normaliseReviewQueue,
  profileTab,
  queueTab,
  rubricsForRules,
} from "./screen-data";

const rubric = (id: string, version: number, categorySlugs: string[]): RubricDef => ({
  id,
  version,
  name: `${id} v${version}`,
  description: "",
  categorySlugs,
  criteria: [{ key: "k", label: "K", weight: 100, guidance: "g" }] as RubricDef["criteria"],
});

describe("rules rubrics", () => {
  const all = [rubric("sports", 1, ["sports"]), rubric("sports", 2, ["sports"]), rubric("factual", 1, ["crypto"])];

  it("keeps only the latest version of each rubric", () => {
    expect(currentRubrics(all).map((r) => `${r.id}@${r.version}`)).toEqual(["sports@2", "factual@1"]);
  });

  it("attaches category names and orders by the first category that uses each rubric", () => {
    const cats = [
      { slug: "crypto", name: "Crypto" },
      { slug: "sports", name: "Sports & Football" },
    ];
    const out = rubricsForRules(cats, all);
    expect(out.map((r) => [r.id, r.categoryNames])).toEqual([
      ["factual", ["Crypto"]],
      ["sports", ["Sports & Football"]],
    ]);
  });

  it("still lists every rubric when categories failed to load", () => {
    expect(rubricsForRules([], all)).toHaveLength(2);
  });

  it("the real code rubrics cover the five seeded categories", () => {
    const slugs = currentRubrics().flatMap((r) => r.categorySlugs);
    for (const slug of ["sports", "technology", "crypto", "entertainment", "gaming"]) expect(slugs).toContain(slug);
  });

  it("findCodeRubric matches id and version exactly", () => {
    expect(findCodeRubric("sports", 2, all)?.version).toBe(2);
    expect(findCodeRubric("sports", 9, all)).toBeNull();
  });
});

describe("review queue", () => {
  it("reads the tab from the query string, defaulting to review", () => {
    expect(queueTab("?tab=appeals")).toBe("appeals");
    expect(queueTab("?tab=nonsense")).toBe("review");
    expect(queueTab(new URLSearchParams())).toBe("review");
  });

  it("normalises the preferred shape and the alternatives", () => {
    const item = { header: { competitionId: "c1" } };
    expect(normaliseReviewQueue({ review: [item], appeals: { open: [], recent: [] }, viewerId: "u1" })).toEqual({
      review: [item],
      appeals: { open: [], recent: [] },
      viewerId: "u1",
    });
    expect(normaliseReviewQueue({ reviewQueue: [item], appealQueue: { open: [item] }, viewer: { id: "u2" } })).toEqual({
      review: [item],
      appeals: { open: [item], recent: [] },
      viewerId: "u2",
    });
    expect(normaliseReviewQueue(null)).toEqual({ review: [], appeals: { open: [], recent: [] }, viewerId: null });
  });

  it("isOwnCase is true only for a participant", () => {
    const header = { sides: { A: { userId: "a" }, B: { userId: "b" } } };
    expect(isOwnCase(header, "a")).toBe(true);
    expect(isOwnCase(header, "z")).toBe(false);
    expect(isOwnCase(header, null)).toBe(false);
  });
});

describe("profile", () => {
  const profile = {
    userId: "u1",
    handle: "ada",
    displayName: "Ada",
    bio: null,
    avatarUrl: null,
    joinedAt: "2026-10-30T00:00:00.000Z",
    status: "active",
    interests: [],
  };

  it("accepts a bare PublicProfile and leaves the other panels empty", () => {
    const out = normaliseProfile(profile);
    expect(out?.profile.handle).toBe("ada");
    expect(out?.record).toBeNull();
    expect(out?.viewer).toEqual({ signedIn: false, isOwnProfile: false, blockedEitherWay: false, viewerBlocks: false });
  });

  it("accepts the full bundle", () => {
    const out = normaliseProfile({
      profile,
      viewer: { signedIn: true, isOwnProfile: true },
      commentCount: 3,
      argumentCount: 2,
      follows: { followers: 1, following: 0 },
      history: { items: [], nextCursor: null },
    });
    expect(out?.viewer.isOwnProfile).toBe(true);
    expect(out?.commentCount).toBe(3);
    expect(out?.history).toEqual({ items: [], nextCursor: null });
    expect(out?.posted).toBeNull();
  });

  it("returns null for nothing", () => {
    expect(normaliseProfile(null)).toBeNull();
    expect(normaliseProfile({ foo: 1 })).toBeNull();
  });

  it("profileTab defaults to debates", () => {
    expect(profileTab(new URLSearchParams("tab=arguments"))).toBe("arguments");
    expect(profileTab(new URLSearchParams())).toBe("debates");
  });
});
